//! Confluent Schema Registry support.
//!
//! Confluent's wire format for a schema-encoded message value is:
//!   byte 0      : magic byte, always 0x00
//!   bytes 1..5  : 4-byte big-endian schema id
//!   bytes 5..   : payload (Avro binary / Protobuf / JSON), per the schema type
//!
//! This module detects that framing, fetches the schema definition from the
//! registry (with a small cache), and decodes Avro payloads to JSON. Other
//! schema types fall back to showing the raw payload plus the schema id, which
//! is already a big usability win over raw bytes.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

/// Result of attempting to decode a wire-encoded value.
pub struct Decoded {
    pub schema_id: i32,
    /// Decoded value as a string when we could decode it; None otherwise.
    pub value: Option<String>,
}

/// A cached schema entry from the registry.
#[derive(Clone)]
struct CachedSchema {
    schema_type: String, // "AVRO", "JSON", "PROTOBUF"
    schema: String,      // the schema definition text
}

/// Client for one Schema Registry base URL, with an in-memory schema cache.
pub struct SchemaRegistry {
    base_url: String,
    http: reqwest::blocking::Client,
    cache: Mutex<HashMap<i32, CachedSchema>>,
}

impl SchemaRegistry {
    pub fn new(base_url: String) -> Self {
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http,
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Parse the Confluent wire header. Returns (schema_id, payload) when the
    /// bytes start with the 0x00 magic byte and have a 4-byte id.
    pub fn parse_wire(bytes: &[u8]) -> Option<(i32, &[u8])> {
        if bytes.len() < 5 || bytes[0] != 0x00 {
            return None;
        }
        let id = i32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]);
        Some((id, &bytes[5..]))
    }

    /// Fetch (and cache) the schema for an id from `GET /schemas/ids/{id}`.
    fn get_schema(&self, id: i32) -> Option<CachedSchema> {
        if let Some(s) = self.cache.lock().ok()?.get(&id) {
            return Some(s.clone());
        }
        let url = format!("{}/schemas/ids/{}", self.base_url, id);
        let resp = self.http.get(&url).send().ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let json: serde_json::Value = resp.json().ok()?;
        let schema = json.get("schema")?.as_str()?.to_string();
        let schema_type = json
            .get("schemaType")
            .and_then(|v| v.as_str())
            .unwrap_or("AVRO") // registry omits schemaType for Avro
            .to_string();
        let cached = CachedSchema {
            schema_type,
            schema,
        };
        if let Ok(mut c) = self.cache.lock() {
            c.insert(id, cached.clone());
        }
        Some(cached)
    }

    /// Decode a wire-encoded value to a readable string using the registry.
    pub fn decode(&self, bytes: &[u8]) -> Option<Decoded> {
        let (id, payload) = Self::parse_wire(bytes)?;
        let schema = match self.get_schema(id) {
            Some(s) => s,
            None => {
                // We know the schema id even if the registry is unreachable.
                return Some(Decoded {
                    schema_id: id,
                    value: None,
                });
            }
        };

        let value = match schema.schema_type.as_str() {
            "AVRO" => decode_avro(&schema.schema, payload),
            // JSON Schema payloads are just JSON after the header.
            "JSON" => String::from_utf8(payload.to_vec()).ok(),
            // Protobuf needs the .proto descriptors; show raw for now.
            _ => None,
        };

        Some(Decoded {
            schema_id: id,
            value,
        })
    }
}

/// Decode an Avro-binary payload to pretty JSON using its writer schema.
fn decode_avro(schema_str: &str, payload: &[u8]) -> Option<String> {
    let schema = apache_avro::Schema::parse_str(schema_str).ok()?;
    let mut reader = payload;
    let value = apache_avro::from_avro_datum(&schema, &mut reader, None).ok()?;
    let json: serde_json::Value = avro_to_json(value);
    serde_json::to_string_pretty(&json).ok()
}

/// Convert an apache_avro::types::Value into serde_json::Value.
fn avro_to_json(v: apache_avro::types::Value) -> serde_json::Value {
    use apache_avro::types::Value as A;
    use serde_json::Value as J;
    match v {
        A::Null => J::Null,
        A::Boolean(b) => J::Bool(b),
        A::Int(i) | A::Date(i) | A::TimeMillis(i) => J::from(i),
        A::Long(i)
        | A::TimeMicros(i)
        | A::TimestampMillis(i)
        | A::TimestampMicros(i)
        | A::LocalTimestampMillis(i)
        | A::LocalTimestampMicros(i) => J::from(i),
        A::Float(f) => serde_json::Number::from_f64(f as f64)
            .map(J::Number)
            .unwrap_or(J::Null),
        A::Double(f) => serde_json::Number::from_f64(f)
            .map(J::Number)
            .unwrap_or(J::Null),
        A::Bytes(b) | A::Fixed(_, b) => {
            J::String(String::from_utf8_lossy(&b).to_string())
        }
        A::String(s) | A::Enum(_, s) => J::String(s),
        A::Uuid(u) => J::String(u.to_string()),
        A::Union(_, inner) => avro_to_json(*inner),
        A::Array(items) => J::Array(items.into_iter().map(avro_to_json).collect()),
        A::Map(m) => {
            J::Object(m.into_iter().map(|(k, v)| (k, avro_to_json(v))).collect())
        }
        A::Record(fields) => {
            J::Object(fields.into_iter().map(|(k, v)| (k, avro_to_json(v))).collect())
        }
        other => J::String(format!("{:?}", other)),
    }
}

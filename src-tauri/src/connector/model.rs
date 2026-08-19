//! Protocol-agnostic data models shared across every connector and sent to the
//! React UI as plain JSON. Nothing here holds a live driver handle.

use serde::{Deserialize, Serialize};

/// Supported protocols. Add a variant here when you add a connector.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Kafka,
    Redis,
    Rabbitmq,
    Nats,
}

/// Everything needed to open a connection. A flat, serializable bag so the UI
/// can build a connection form and persist profiles locally.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    /// e.g. "localhost:9092" or "localhost:9092,broker2:9092"
    pub bootstrap: String,
    /// Optional auth — kept generic so each protocol reads what it needs.
    #[serde(default)]
    pub sasl_mechanism: Option<String>,
    #[serde(default)]
    pub sasl_username: Option<String>,
    #[serde(default)]
    pub sasl_password: Option<String>,
    #[serde(default)]
    pub use_ssl: bool,
    /// Optional Confluent Schema Registry base URL (e.g. http://localhost:8081).
    /// When set, Avro/JSON-Schema encoded values are decoded automatically.
    #[serde(default)]
    pub schema_registry_url: Option<String>,
    /// Escape hatch: raw protocol-specific properties (e.g. librdkafka props).
    #[serde(default)]
    pub extra: std::collections::HashMap<String, String>,
}

/// Result of a `ping` — a friendly summary of the server we connected to.
#[derive(Debug, Clone, Serialize)]
pub struct ServerInfo {
    pub protocol: Protocol,
    pub version: Option<String>,
    /// Broker/node count, or 1 for single-node systems.
    pub node_count: u32,
    pub detail: String,
}

/// A lightweight reference to a stream (topic/queue/key) for the sidebar list.
#[derive(Debug, Clone, Serialize)]
pub struct StreamRef {
    pub name: String,
    /// Partition count where applicable (Kafka); 1 otherwise.
    pub partitions: u32,
    /// Best-effort total message count / length, if cheaply available.
    pub approx_messages: Option<i64>,
    /// True for internal/system streams (e.g. __consumer_offsets).
    pub internal: bool,
}

/// Full detail for one stream — powers the "describe" panel.
#[derive(Debug, Clone, Serialize)]
pub struct StreamDetail {
    pub name: String,
    pub partitions: Vec<PartitionInfo>,
    /// Config key/values (Kafka topic config, etc.).
    pub config: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PartitionInfo {
    pub id: i32,
    pub leader: i32,
    pub low_watermark: i64,
    pub high_watermark: i64,
    pub replicas: Vec<i32>,
}

/// Where to start reading and how much — the message viewer's query.
#[derive(Debug, Clone, Deserialize)]
pub struct ReadQuery {
    pub start: StartPosition,
    /// Max messages to return in this batch.
    pub limit: u32,
    /// Optional partition filter (Kafka); None = all partitions.
    #[serde(default)]
    pub partition: Option<i32>,
    /// Optional substring/JSON filter applied to value; None = no filter.
    #[serde(default)]
    pub filter: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum StartPosition {
    /// Newest messages (tail).
    Latest,
    /// Oldest available messages.
    Earliest,
    /// From a specific absolute offset.
    Offset(i64),
    /// From a Unix-millis timestamp.
    Timestamp(i64),
}

/// A single message, normalized across protocols.
#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub partition: i32,
    pub offset: i64,
    pub timestamp: Option<i64>,
    pub key: Option<String>,
    /// Decoded value as a UTF-8 string when possible.
    pub value: Option<String>,
    /// True when the value looks like valid JSON (UI can pretty-print).
    pub is_json: bool,
    /// Headers as string pairs.
    pub headers: Vec<(String, String)>,
    /// Raw byte size of the value.
    pub size_bytes: usize,
    /// Confluent Schema Registry schema id, if the value was wire-encoded.
    #[serde(default)]
    pub schema_id: Option<i32>,
}

/// A message to publish.
#[derive(Debug, Clone, Deserialize)]
pub struct OutgoingMessage {
    #[serde(default)]
    pub key: Option<String>,
    pub value: String,
    #[serde(default)]
    pub partition: Option<i32>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
}

/// Consumer group / progress info.
#[derive(Debug, Clone, Serialize)]
pub struct ConsumerGroup {
    pub id: String,
    pub state: String,
    pub members: u32,
    /// Total lag across assigned partitions, if computable.
    pub total_lag: Option<i64>,
}

/// Per-topic-partition lag detail for one consumer group.
#[derive(Debug, Clone, Serialize)]
pub struct GroupOffset {
    pub topic: String,
    pub partition: i32,
    pub committed: i64,
    pub high_watermark: i64,
    pub lag: i64,
}

/// Spec for creating a topic.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateTopicSpec {
    pub name: String,
    pub partitions: i32,
    pub replication: i32,
    #[serde(default)]
    pub config: Vec<(String, String)>,
}

//! RabbitMQ connector — implemented over the RabbitMQ **HTTP Management API**
//! (default port 15672), which is the natural fit for browsing: it lists queues
//! and can peek messages without consuming/acking them.
//!
//! Mapping onto StreamScope's model:
//! - a "stream" (StreamRef) = a queue; `approx_messages` = queue depth.
//! - `read_messages` peeks messages via POST /api/queues/{vhost}/{q}/get with
//!   `ackmode=reject_requeue_true`, so browsing does not remove messages.
//!
//! Config mapping: `bootstrap` = host (":15672" is added if no port is given),
//! `sasl_username`/`sasl_password` = management credentials (default guest/guest),
//! `use_ssl` selects https. Vhost defaults to "/" (override via extra["vhost"]).

use async_trait::async_trait;

use super::model::*;
use super::{Connector, ConnectorError, ConnectorResult};

pub struct RabbitMqConnector {
    base_url: String,
    user: String,
    pass: String,
    vhost: String,
    http: reqwest::blocking::Client,
}

impl RabbitMqConnector {
    pub fn new(config: ConnectionConfig) -> ConnectorResult<Self> {
        let scheme = if config.use_ssl { "https" } else { "http" };
        // Add the default management port if the user didn't specify one.
        let host = if config.bootstrap.contains(':') {
            config.bootstrap.clone()
        } else if config.bootstrap.trim().is_empty() {
            "localhost:15672".to_string()
        } else {
            format!("{}:15672", config.bootstrap)
        };
        let http = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(6))
            .build()
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;
        Ok(Self {
            base_url: format!("{}://{}", scheme, host),
            user: config
                .sasl_username
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "guest".into()),
            pass: config
                .sasl_password
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "guest".into()),
            vhost: config
                .extra
                .get("vhost")
                .cloned()
                .unwrap_or_else(|| "/".into()),
            http,
        })
    }

    fn vhost_enc(&self) -> String {
        // "/" must be URL-encoded as %2F in the management API paths.
        if self.vhost == "/" {
            "%2F".to_string()
        } else {
            urlencode(&self.vhost)
        }
    }

    fn get_json(&self, path: &str) -> ConnectorResult<serde_json::Value> {
        let resp = self
            .http
            .get(format!("{}{}", self.base_url, path))
            .basic_auth(&self.user, Some(&self.pass))
            .send()
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(ConnectorError::Other(format!(
                "management API {} -> {}",
                path,
                resp.status()
            )));
        }
        resp.json()
            .map_err(|e| ConnectorError::Other(e.to_string()))
    }
}

// Minimal percent-encoding for vhost/queue names in URL paths.
fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[async_trait]
impl Connector for RabbitMqConnector {
    fn protocol(&self) -> Protocol {
        Protocol::Rabbitmq
    }

    async fn ping(&self) -> ConnectorResult<ServerInfo> {
        let overview = self.get_json("/api/overview")?;
        let version = overview
            .get("rabbitmq_version")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        Ok(ServerInfo {
            protocol: Protocol::Rabbitmq,
            version: version.clone(),
            node_count: 1,
            detail: version
                .map(|v| format!("RabbitMQ {}", v))
                .unwrap_or_else(|| "RabbitMQ".to_string()),
        })
    }

    async fn list_streams(&self) -> ConnectorResult<Vec<StreamRef>> {
        let path = format!("/api/queues/{}", self.vhost_enc());
        let arr = self.get_json(&path)?;
        let mut out = Vec::new();
        if let Some(items) = arr.as_array() {
            for q in items {
                let name = q
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if name.is_empty() {
                    continue;
                }
                let depth = q.get("messages").and_then(|v| v.as_i64());
                out.push(StreamRef {
                    name,
                    partitions: 1,
                    approx_messages: depth,
                    internal: false,
                });
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    async fn describe_stream(&self, name: &str) -> ConnectorResult<StreamDetail> {
        let path = format!("/api/queues/{}/{}", self.vhost_enc(), urlencode(name));
        let q = self.get_json(&path)?;
        let mut config = Vec::new();
        for key in ["state", "durable", "messages", "messages_ready", "consumers"] {
            if let Some(v) = q.get(key) {
                config.push((key.to_string(), v.to_string()));
            }
        }
        Ok(StreamDetail {
            name: name.to_string(),
            partitions: Vec::new(),
            config,
        })
    }

    async fn read_messages(
        &self,
        stream: &str,
        query: &ReadQuery,
    ) -> ConnectorResult<Vec<Message>> {
        // Peek messages without consuming (reject_requeue_true re-queues them).
        let path = format!(
            "{}/api/queues/{}/{}/get",
            self.base_url,
            self.vhost_enc(),
            urlencode(stream)
        );
        let body = serde_json::json!({
            "count": query.limit.max(1),
            "ackmode": "reject_requeue_true",
            "encoding": "auto",
        });
        let resp = self
            .http
            .post(&path)
            .basic_auth(&self.user, Some(&self.pass))
            .json(&body)
            .send()
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(ConnectorError::Other(format!(
                "get messages -> {}",
                resp.status()
            )));
        }
        let arr: serde_json::Value = resp
            .json()
            .map_err(|e| ConnectorError::Other(e.to_string()))?;

        let mut out = Vec::new();
        if let Some(items) = arr.as_array() {
            for (i, m) in items.iter().enumerate() {
                let payload = m
                    .get("payload")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let is_json =
                    serde_json::from_str::<serde_json::Value>(&payload).is_ok();
                let size = m
                    .get("payload_bytes")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(payload.len() as i64) as usize;
                // Surface routing key as the message key.
                let key = m
                    .get("routing_key")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.push(Message {
                    partition: 0,
                    offset: i as i64,
                    timestamp: None,
                    key,
                    value: Some(payload),
                    is_json,
                    headers: Vec::new(),
                    size_bytes: size,
                    schema_id: None,
                });
            }
        }
        Ok(out)
    }
}

//! NATS connector — implemented over NATS **JetStream** (persisted streams),
//! which fits StreamScope's "browse stored messages" model. Core NATS pub/sub
//! is fire-and-forget and not browsable, so we expose JetStream streams.
//!
//! Mapping onto StreamScope's model:
//! - a "stream" (StreamRef) = a JetStream stream; `approx_messages` = message count.
//! - `read_messages` reads the most recent messages by sequence number.
//!
//! Config mapping: `bootstrap` = host:port (":4222" added if missing),
//! optional user/pass auth. Connections are opened per call and closed after,
//! keeping the connector stateless and Send-safe.

use async_trait::async_trait;
use futures::StreamExt;

use super::model::*;
use super::{Connector, ConnectorError, ConnectorResult};

pub struct NatsConnector {
    url: String,
    user: Option<String>,
    pass: Option<String>,
}

impl NatsConnector {
    pub fn new(config: ConnectionConfig) -> ConnectorResult<Self> {
        let host = if config.bootstrap.trim().is_empty() {
            "localhost:4222".to_string()
        } else if config.bootstrap.contains(':') {
            config.bootstrap.clone()
        } else {
            format!("{}:4222", config.bootstrap)
        };
        Ok(Self {
            url: format!("nats://{}", host),
            user: config.sasl_username.clone().filter(|s| !s.is_empty()),
            pass: config.sasl_password.clone().filter(|s| !s.is_empty()),
        })
    }

    async fn connect(&self) -> ConnectorResult<async_nats::Client> {
        let opts = match (&self.user, &self.pass) {
            (Some(u), Some(p)) => {
                async_nats::ConnectOptions::with_user_and_password(u.clone(), p.clone())
            }
            _ => async_nats::ConnectOptions::new(),
        };
        opts.connect(&self.url)
            .await
            .map_err(|e| ConnectorError::Connection(e.to_string()))
    }
}

#[async_trait]
impl Connector for NatsConnector {
    fn protocol(&self) -> Protocol {
        Protocol::Nats
    }

    async fn ping(&self) -> ConnectorResult<ServerInfo> {
        let client = self.connect().await?;
        let info = client.server_info();
        let version = Some(info.version.clone());
        client.flush().await.ok();
        Ok(ServerInfo {
            protocol: Protocol::Nats,
            version: version.clone(),
            node_count: 1,
            detail: format!("NATS {}", info.version),
        })
    }

    async fn list_streams(&self) -> ConnectorResult<Vec<StreamRef>> {
        let client = self.connect().await?;
        let js = async_nats::jetstream::new(client);

        let mut out = Vec::new();
        let mut names = js.stream_names();
        while let Some(name) = names.next().await {
            let name = match name {
                Ok(n) => n,
                Err(_) => continue,
            };
            // Fetch message count from stream info (best-effort).
            let approx = match js.get_stream(&name).await {
                Ok(mut s) => s
                    .info()
                    .await
                    .ok()
                    .map(|i| i.state.messages as i64),
                Err(_) => None,
            };
            out.push(StreamRef {
                name,
                partitions: 1,
                approx_messages: approx,
                internal: false,
            });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    async fn describe_stream(&self, name: &str) -> ConnectorResult<StreamDetail> {
        let client = self.connect().await?;
        let js = async_nats::jetstream::new(client);
        let mut stream = js
            .get_stream(name)
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;
        let info = stream
            .info()
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;
        let config = vec![
            ("messages".to_string(), info.state.messages.to_string()),
            ("bytes".to_string(), info.state.bytes.to_string()),
            (
                "first_seq".to_string(),
                info.state.first_sequence.to_string(),
            ),
            (
                "last_seq".to_string(),
                info.state.last_sequence.to_string(),
            ),
            ("subjects".to_string(), info.config.subjects.join(", ")),
        ];
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
        let client = self.connect().await?;
        let js = async_nats::jetstream::new(client);
        let mut js_stream = js
            .get_stream(stream)
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;
        let info = js_stream
            .info()
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;

        let last = info.state.last_sequence;
        let first = info.state.first_sequence;
        if last == 0 {
            return Ok(Vec::new());
        }
        let limit = query.limit.max(1) as u64;
        let start = last.saturating_sub(limit - 1).max(first);

        let mut out = Vec::new();
        for seq in start..=last {
            match js_stream.get_raw_message(seq).await {
                Ok(raw) => {
                    let value = String::from_utf8(raw.payload.to_vec()).ok();
                    let is_json = value
                        .as_deref()
                        .map(|s| serde_json::from_str::<serde_json::Value>(s).is_ok())
                        .unwrap_or(false);
                    let size = raw.payload.len();
                    out.push(Message {
                        partition: 0,
                        offset: seq as i64,
                        timestamp: None,
                        key: Some(raw.subject.to_string()),
                        value,
                        is_json,
                        headers: Vec::new(),
                        size_bytes: size,
                        schema_id: None,
                    });
                }
                Err(_) => continue,
            }
        }
        // Newest first for the viewer.
        out.sort_by(|a, b| b.offset.cmp(&a.offset));
        Ok(out)
    }

    async fn produce(&self, stream: &str, msg: &OutgoingMessage) -> ConnectorResult<()> {
        let client = self.connect().await?;
        let js = async_nats::jetstream::new(client);
        // Publish to the stream's name as the subject (works when the stream
        // subscribes to that subject).
        js.publish(stream.to_string(), msg.value.clone().into())
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;
        Ok(())
    }
}

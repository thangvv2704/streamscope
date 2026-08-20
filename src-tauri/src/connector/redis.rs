//! Redis connector — implements `Connector` on top of the `redis` crate.
//!
//! Mapping Redis onto StreamScope's stream/message model:
//! - a "stream" (StreamRef) = a Redis key; its `partitions` field is unused (1),
//!   and `approx_messages` = the element count for collection types.
//! - `read_messages` returns the key's value(s): a string key yields one row;
//!   list/set/zset/hash yield one row per element; a Redis Stream yields its
//!   entries. This reuses the exact same message table UI as Kafka.
//!
//! Everything returned is owned, JSON-friendly `model` data.

use async_trait::async_trait;
use redis::{AsyncCommands, Client};

use super::model::*;
use super::{Connector, ConnectorError, ConnectorResult};

pub struct RedisConnector {
    client: Client,
    config: ConnectionConfig,
}

impl RedisConnector {
    pub fn new(config: ConnectionConfig) -> ConnectorResult<Self> {
        // Build a redis:// URL from the generic config. `bootstrap` is host:port.
        let host = if config.bootstrap.trim().is_empty() {
            "127.0.0.1:6379".to_string()
        } else {
            config.bootstrap.clone()
        };
        let scheme = if config.use_ssl { "rediss" } else { "redis" };
        let auth = match (&config.sasl_username, &config.sasl_password) {
            (Some(u), Some(p)) if !u.is_empty() => format!("{}:{}@", u, p),
            (_, Some(p)) if !p.is_empty() => format!(":{}@", p),
            _ => String::new(),
        };
        let url = format!("{}://{}{}", scheme, auth, host);
        let client = Client::open(url)
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;
        Ok(Self { client, config })
    }

    async fn conn(&self) -> ConnectorResult<redis::aio::MultiplexedConnection> {
        self.client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| ConnectorError::Connection(e.to_string()))
    }
}

fn as_message(partition: i32, offset: i64, key: Option<String>, value: String) -> Message {
    let is_json = serde_json::from_str::<serde_json::Value>(&value).is_ok();
    let size_bytes = value.len();
    Message {
        partition,
        offset,
        timestamp: None,
        key,
        value: Some(value),
        is_json,
        headers: Vec::new(),
        size_bytes,
        schema_id: None,
    }
}

#[async_trait]
impl Connector for RedisConnector {
    fn protocol(&self) -> Protocol {
        Protocol::Redis
    }

    async fn ping(&self) -> ConnectorResult<ServerInfo> {
        let mut c = self.conn().await?;
        let pong: String = redis::cmd("PING")
            .query_async(&mut c)
            .await
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;
        // Fetch a version line from INFO server.
        let info: String = redis::cmd("INFO")
            .arg("server")
            .query_async(&mut c)
            .await
            .unwrap_or_default();
        let version = info
            .lines()
            .find(|l| l.starts_with("redis_version:"))
            .map(|l| l.trim_start_matches("redis_version:").trim().to_string());
        let _ = pong;
        Ok(ServerInfo {
            protocol: Protocol::Redis,
            version: version.clone(),
            node_count: 1,
            detail: version
                .map(|v| format!("Redis {}", v))
                .unwrap_or_else(|| "Redis".to_string()),
        })
    }

    async fn list_streams(&self) -> ConnectorResult<Vec<StreamRef>> {
        let mut c = self.conn().await?;
        // SCAN all keys (bounded) so a huge keyspace doesn't hang the UI.
        let mut cursor: u64 = 0;
        let mut keys: Vec<String> = Vec::new();
        loop {
            let (next, batch): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("COUNT")
                .arg(500)
                .query_async(&mut c)
                .await
                .map_err(|e| ConnectorError::Other(e.to_string()))?;
            keys.extend(batch);
            cursor = next;
            if cursor == 0 || keys.len() >= 5000 {
                break;
            }
        }

        let mut out = Vec::new();
        for name in keys {
            out.push(StreamRef {
                name,
                partitions: 1,
                approx_messages: None,
                internal: false,
            });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    async fn describe_stream(&self, name: &str) -> ConnectorResult<StreamDetail> {
        let mut c = self.conn().await?;
        let key_type: String = redis::cmd("TYPE")
            .arg(name)
            .query_async(&mut c)
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;
        let ttl: i64 = c.ttl(name).await.unwrap_or(-1);
        let config = vec![
            ("type".to_string(), key_type),
            ("ttl".to_string(), ttl.to_string()),
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
        let mut c = self.conn().await?;
        let limit = query.limit.max(1) as isize;
        let key_type: String = redis::cmd("TYPE")
            .arg(stream)
            .query_async(&mut c)
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;

        let mut out: Vec<Message> = Vec::new();
        match key_type.as_str() {
            "string" => {
                let v: Option<String> = c.get(stream).await.ok().flatten();
                if let Some(v) = v {
                    out.push(as_message(0, 0, None, v));
                }
            }
            "list" => {
                let items: Vec<String> =
                    c.lrange(stream, 0, limit - 1).await.unwrap_or_default();
                for (i, v) in items.into_iter().enumerate() {
                    out.push(as_message(0, i as i64, None, v));
                }
            }
            "set" => {
                let items: Vec<String> = c.smembers(stream).await.unwrap_or_default();
                for (i, v) in items.into_iter().take(limit as usize).enumerate() {
                    out.push(as_message(0, i as i64, None, v));
                }
            }
            "zset" => {
                let items: Vec<(String, f64)> = c
                    .zrange_withscores(stream, 0, limit - 1)
                    .await
                    .unwrap_or_default();
                for (i, (member, score)) in items.into_iter().enumerate() {
                    out.push(as_message(
                        0,
                        i as i64,
                        Some(score.to_string()),
                        member,
                    ));
                }
            }
            "hash" => {
                let map: std::collections::HashMap<String, String> =
                    c.hgetall(stream).await.unwrap_or_default();
                for (i, (field, v)) in map.into_iter().take(limit as usize).enumerate() {
                    out.push(as_message(0, i as i64, Some(field), v));
                }
            }
            "stream" => {
                // XRANGE returns entries: id -> [field, value, ...]
                let entries: Vec<(String, Vec<(String, String)>)> = redis::cmd("XRANGE")
                    .arg(stream)
                    .arg("-")
                    .arg("+")
                    .arg("COUNT")
                    .arg(limit)
                    .query_async(&mut c)
                    .await
                    .unwrap_or_default();
                for (i, (id, fields)) in entries.into_iter().enumerate() {
                    let obj: serde_json::Map<String, serde_json::Value> = fields
                        .into_iter()
                        .map(|(k, v)| (k, serde_json::Value::String(v)))
                        .collect();
                    let value = serde_json::to_string(&obj).unwrap_or_default();
                    out.push(as_message(0, i as i64, Some(id), value));
                }
            }
            other => {
                return Err(ConnectorError::Other(format!(
                    "unsupported Redis type '{}'",
                    other
                )));
            }
        }
        Ok(out)
    }

    async fn produce(&self, stream: &str, msg: &OutgoingMessage) -> ConnectorResult<()> {
        let mut c = self.conn().await?;
        // Simplest useful semantics: SET key = value.
        let _: () = c
            .set(stream, &msg.value)
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;
        Ok(())
    }

    async fn delete_stream(&self, name: &str) -> ConnectorResult<()> {
        let mut c = self.conn().await?;
        let _: i64 = c
            .del(name)
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;
        Ok(())
    }
}

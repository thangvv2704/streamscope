//! Connector layer — the multi-protocol abstraction that lets StreamScope
//! speak Kafka today and Redis / RabbitMQ / NATS tomorrow with the same UI.
//!
//! The UI never talks to a protocol directly. It talks to a `Connector` trait
//! object. Each protocol lives in its own submodule and implements this trait.
//! Adding a new protocol == writing one more file that implements `Connector`.

pub mod kafka;
pub mod model;
pub mod schema;

use async_trait::async_trait;
use model::*;

/// Errors any connector can return. Kept protocol-agnostic on purpose so the
/// UI can render them uniformly.
#[derive(Debug, thiserror::Error)]
pub enum ConnectorError {
    #[error("connection failed: {0}")]
    Connection(String),
    #[error("operation timed out")]
    Timeout,
    #[error("not supported by this protocol: {0}")]
    Unsupported(String),
    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for ConnectorError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type ConnectorResult<T> = Result<T, ConnectorError>;

/// The universal interface every streaming/messaging backend implements.
///
/// Methods are intentionally coarse-grained and return owned, JSON-friendly
/// data (see `model.rs`) — never live driver handles — so results cross the
/// Tauri boundary cleanly.
#[async_trait]
pub trait Connector: Send + Sync {
    /// Which protocol this connector speaks (for UI badges/icons).
    fn protocol(&self) -> Protocol;

    /// Verify the connection is alive and return broker/server info.
    async fn ping(&self) -> ConnectorResult<ServerInfo>;

    /// List the top-level "streams" — Kafka topics, Redis streams/keys,
    /// RabbitMQ queues, NATS subjects. Unified as `StreamRef`.
    async fn list_streams(&self) -> ConnectorResult<Vec<StreamRef>>;

    /// Detailed metadata for one stream (partitions, offsets, config...).
    async fn describe_stream(&self, name: &str) -> ConnectorResult<StreamDetail>;

    /// Approximate message counts for specific streams (lazy, on-demand).
    /// Returns (name, count) only for streams that could be measured.
    async fn stream_counts(
        &self,
        _names: &[String],
    ) -> ConnectorResult<Vec<(String, i64)>> {
        Ok(Vec::new())
    }

    /// Read a bounded batch of messages from a stream, according to `query`.
    /// This is the workhorse — the "view messages" experience.
    async fn read_messages(
        &self,
        stream: &str,
        query: &ReadQuery,
    ) -> ConnectorResult<Vec<Message>>;

    /// Consumer-group-style progress info, where the protocol has it.
    async fn list_consumer_groups(&self) -> ConnectorResult<Vec<ConsumerGroup>> {
        Err(ConnectorError::Unsupported(
            "consumer groups".to_string(),
        ))
    }

    /// Per-partition committed offsets and lag for one consumer group.
    async fn group_offsets(&self, _group: &str) -> ConnectorResult<Vec<GroupOffset>> {
        Err(ConnectorError::Unsupported("group offsets".to_string()))
    }

    /// Publish a message. Optional — some read-only setups won't allow it.
    async fn produce(&self, _stream: &str, _msg: &OutgoingMessage) -> ConnectorResult<()> {
        Err(ConnectorError::Unsupported("produce".to_string()))
    }

    /// Create a new stream/topic.
    async fn create_stream(&self, _spec: &CreateTopicSpec) -> ConnectorResult<()> {
        Err(ConnectorError::Unsupported("create stream".to_string()))
    }

    /// Delete a stream/topic.
    async fn delete_stream(&self, _name: &str) -> ConnectorResult<()> {
        Err(ConnectorError::Unsupported("delete stream".to_string()))
    }
}

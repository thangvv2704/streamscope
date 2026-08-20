//! Tauri commands — the RPC surface the React UI calls via `invoke(...)`.
//!
//! State is a registry of open connections keyed by connection id. Each entry
//! is a boxed `Connector` trait object, so the same commands work for Kafka
//! today and Redis/RabbitMQ tomorrow with zero changes here.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::connector::kafka::KafkaConnector;
use crate::connector::model::*;
use crate::connector::nats::NatsConnector;
use crate::connector::rabbitmq::RabbitMqConnector;
use crate::connector::redis::RedisConnector;
use crate::connector::{Connector, ConnectorError, ConnectorResult};

/// Registry of live connections, shared across commands.
#[derive(Default)]
pub struct AppState {
    connections: Mutex<HashMap<String, Arc<dyn Connector>>>,
}

impl AppState {
    async fn get(&self, id: &str) -> ConnectorResult<Arc<dyn Connector>> {
        self.connections
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| ConnectorError::Other(format!("no open connection '{}'", id)))
    }
}

/// Factory: build the right connector for a protocol.
fn build_connector(config: ConnectionConfig) -> ConnectorResult<Arc<dyn Connector>> {
    match config.protocol {
        Protocol::Kafka => Ok(Arc::new(KafkaConnector::new(config))),
        Protocol::Redis => Ok(Arc::new(RedisConnector::new(config)?)),
        Protocol::Rabbitmq => Ok(Arc::new(RabbitMqConnector::new(config)?)),
        Protocol::Nats => Ok(Arc::new(NatsConnector::new(config)?)),
    }
}

/// Test a connection config without registering it — powers the "Test"
/// button in the connection form so users get a clear pass/fail before saving.
#[tauri::command]
pub async fn test_connection(
    config: ConnectionConfig,
) -> ConnectorResult<ServerInfo> {
    let connector = build_connector(config)?;
    connector.ping().await
}

/// Open (or re-open) a connection, verify it with a ping, and register it.
#[tauri::command]
pub async fn connect(
    state: tauri::State<'_, AppState>,
    config: ConnectionConfig,
) -> ConnectorResult<ServerInfo> {
    let id = config.id.clone();
    let connector = build_connector(config)?;
    let info = connector.ping().await?;
    state.connections.lock().await.insert(id, connector);
    Ok(info)
}

/// Close and forget a connection.
#[tauri::command]
pub async fn disconnect(
    state: tauri::State<'_, AppState>,
    id: String,
) -> ConnectorResult<()> {
    state.connections.lock().await.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn list_streams(
    state: tauri::State<'_, AppState>,
    id: String,
) -> ConnectorResult<Vec<StreamRef>> {
    state.get(&id).await?.list_streams().await
}

#[tauri::command]
pub async fn describe_stream(
    state: tauri::State<'_, AppState>,
    id: String,
    stream: String,
) -> ConnectorResult<StreamDetail> {
    state.get(&id).await?.describe_stream(&stream).await
}

#[tauri::command]
pub async fn stream_counts(
    state: tauri::State<'_, AppState>,
    id: String,
    names: Vec<String>,
) -> ConnectorResult<Vec<(String, i64)>> {
    state.get(&id).await?.stream_counts(&names).await
}

#[tauri::command]
pub async fn read_messages(
    state: tauri::State<'_, AppState>,
    id: String,
    stream: String,
    query: ReadQuery,
) -> ConnectorResult<Vec<Message>> {
    state.get(&id).await?.read_messages(&stream, &query).await
}

#[tauri::command]
pub async fn produce(
    state: tauri::State<'_, AppState>,
    id: String,
    stream: String,
    message: OutgoingMessage,
) -> ConnectorResult<()> {
    state.get(&id).await?.produce(&stream, &message).await
}

#[tauri::command]
pub async fn list_consumer_groups(
    state: tauri::State<'_, AppState>,
    id: String,
) -> ConnectorResult<Vec<ConsumerGroup>> {
    state.get(&id).await?.list_consumer_groups().await
}

#[tauri::command]
pub async fn group_offsets(
    state: tauri::State<'_, AppState>,
    id: String,
    group: String,
) -> ConnectorResult<Vec<GroupOffset>> {
    state.get(&id).await?.group_offsets(&group).await
}

#[tauri::command]
pub async fn reset_group_offset(
    state: tauri::State<'_, AppState>,
    id: String,
    group: String,
    to_earliest: bool,
) -> ConnectorResult<()> {
    state
        .get(&id)
        .await?
        .reset_group_offset(&group, to_earliest)
        .await
}

#[tauri::command]
pub async fn set_stream_config(
    state: tauri::State<'_, AppState>,
    id: String,
    stream: String,
    entries: Vec<(String, String)>,
) -> ConnectorResult<()> {
    state
        .get(&id)
        .await?
        .set_stream_config(&stream, &entries)
        .await
}

#[tauri::command]
pub async fn create_stream(
    state: tauri::State<'_, AppState>,
    id: String,
    spec: CreateTopicSpec,
) -> ConnectorResult<()> {
    state.get(&id).await?.create_stream(&spec).await
}

#[tauri::command]
pub async fn delete_stream(
    state: tauri::State<'_, AppState>,
    id: String,
    stream: String,
) -> ConnectorResult<()> {
    state.get(&id).await?.delete_stream(&stream).await
}

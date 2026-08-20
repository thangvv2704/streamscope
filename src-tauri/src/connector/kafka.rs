//! Kafka connector — implements `Connector` on top of librdkafka via rdkafka.
//!
//! Design notes:
//! - We create short-lived consumers per read so the UI stays stateless and
//!   simple; good enough for a message viewer and easy to reason about.
//! - Everything returned is owned, JSON-friendly `model` data — no rdkafka
//!   types leak past this file.

use std::time::Duration;

use async_trait::async_trait;
use rdkafka::admin::{
    AdminClient, AdminOptions, NewTopic, ResourceSpecifier, TopicReplication,
};
use rdkafka::client::DefaultClientContext;
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::message::{Headers, Message as _};
use rdkafka::producer::{BaseRecord, DefaultProducerContext, Producer, ThreadedProducer};
use rdkafka::{Offset, TopicPartitionList};

use super::model::*;
use super::schema::SchemaRegistry;
use super::{Connector, ConnectorError, ConnectorResult};

/// A configured Kafka connection. Cheap to clone the config; consumers are
/// created on demand.
pub struct KafkaConnector {
    config: ConnectionConfig,
    registry: Option<SchemaRegistry>,
}

impl KafkaConnector {
    pub fn new(config: ConnectionConfig) -> Self {
        let registry = config
            .schema_registry_url
            .as_ref()
            .filter(|u| !u.trim().is_empty())
            .map(|u| SchemaRegistry::new(u.clone()));
        Self { config, registry }
    }

    /// Build a librdkafka ClientConfig from our generic ConnectionConfig.
    fn client_config(&self) -> ClientConfig {
        let mut cc = ClientConfig::new();
        cc.set("bootstrap.servers", &self.config.bootstrap);
        cc.set("socket.timeout.ms", "5000");

        if self.config.use_ssl {
            cc.set("security.protocol", "ssl");
        }
        if let Some(mech) = &self.config.sasl_mechanism {
            // If SASL is set, upgrade the security protocol accordingly.
            let proto = if self.config.use_ssl {
                "sasl_ssl"
            } else {
                "sasl_plaintext"
            };
            cc.set("security.protocol", proto);
            cc.set("sasl.mechanism", mech);
            if let Some(u) = &self.config.sasl_username {
                cc.set("sasl.username", u);
            }
            if let Some(p) = &self.config.sasl_password {
                cc.set("sasl.password", p);
            }
        }

        // Any raw librdkafka overrides the user provided.
        for (k, v) in &self.config.extra {
            cc.set(k, v);
        }
        cc
    }

    fn base_consumer(&self) -> ConnectorResult<BaseConsumer> {
        let mut cc = self.client_config();
        // A stable-ish group so metadata calls behave; not used for commits.
        cc.set("group.id", "streamscope-viewer");
        cc.set("enable.auto.commit", "false");
        cc.create()
            .map_err(|e| ConnectorError::Connection(e.to_string()))
    }

    /// A consumer bound to a *specific* group id, used to read that group's
    /// committed offsets for lag computation.
    fn group_consumer(&self, group: &str) -> ConnectorResult<BaseConsumer> {
        let mut cc = self.client_config();
        cc.set("group.id", group);
        cc.set("enable.auto.commit", "false");
        cc.create()
            .map_err(|e| ConnectorError::Connection(e.to_string()))
    }

    fn admin_client(&self) -> ConnectorResult<AdminClient<DefaultClientContext>> {
        self.client_config()
            .create()
            .map_err(|e| ConnectorError::Connection(e.to_string()))
    }

    /// Read a topic's dynamic configuration via describe_configs.
    async fn topic_config(&self, name: &str) -> ConnectorResult<Vec<(String, String)>> {
        let admin = self.admin_client()?;
        let results = admin
            .describe_configs(
                &[ResourceSpecifier::Topic(name)],
                &AdminOptions::new(),
            )
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;

        let mut out = Vec::new();
        for res in results {
            if let Ok(cfg) = res {
                for entry in cfg.entries {
                    let value = entry.value.unwrap_or_default();
                    out.push((entry.name, value));
                }
            }
        }
        out.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(out)
    }
}

#[async_trait]
impl Connector for KafkaConnector {
    fn protocol(&self) -> Protocol {
        Protocol::Kafka
    }

    async fn ping(&self) -> ConnectorResult<ServerInfo> {
        let consumer = self.base_consumer()?;
        let meta = consumer
            .fetch_metadata(None, Duration::from_secs(5))
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;
        let broker_count = meta.brokers().len() as u32;
        Ok(ServerInfo {
            protocol: Protocol::Kafka,
            version: None,
            node_count: broker_count,
            detail: format!("{} broker(s)", broker_count),
        })
    }

    async fn list_streams(&self) -> ConnectorResult<Vec<StreamRef>> {
        let consumer = self.base_consumer()?;
        let meta = consumer
            .fetch_metadata(None, Duration::from_secs(5))
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;

        // Fast path: metadata only. Message counts are fetched lazily and
        // on-demand via `topic_counts` so listing stays instant even on large
        // clusters (watermark queries per partition are expensive).
        let mut out = Vec::new();
        for t in meta.topics() {
            let name = t.name().to_string();
            let internal = name.starts_with("__");
            out.push(StreamRef {
                partitions: t.partitions().len() as u32,
                name,
                approx_messages: None,
                internal,
            });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    async fn stream_counts(&self, names: &[String]) -> ConnectorResult<Vec<(String, i64)>> {
        let consumer = self.base_consumer()?;
        // Need partition ids per topic; fetch metadata once.
        let meta = consumer
            .fetch_metadata(None, Duration::from_secs(5))
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;

        let mut out = Vec::new();
        for t in meta.topics() {
            let name = t.name().to_string();
            if !names.iter().any(|n| n == &name) {
                continue;
            }
            let mut total: i64 = 0;
            let mut ok = true;
            for p in t.partitions() {
                match consumer.fetch_watermarks(&name, p.id(), Duration::from_millis(800)) {
                    Ok((low, high)) => total += (high - low).max(0),
                    Err(_) => {
                        ok = false;
                        break;
                    }
                }
            }
            if ok {
                out.push((name, total));
            }
        }
        Ok(out)
    }

    async fn describe_stream(&self, name: &str) -> ConnectorResult<StreamDetail> {
        let consumer = self.base_consumer()?;
        let meta = consumer
            .fetch_metadata(Some(name), Duration::from_secs(5))
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;

        let topic = meta
            .topics()
            .iter()
            .find(|t| t.name() == name)
            .ok_or_else(|| ConnectorError::Other(format!("topic '{}' not found", name)))?;

        let mut partitions = Vec::new();
        for p in topic.partitions() {
            let (low, high) = consumer
                .fetch_watermarks(name, p.id(), Duration::from_secs(5))
                .unwrap_or((-1, -1));
            partitions.push(PartitionInfo {
                id: p.id(),
                leader: p.leader(),
                low_watermark: low,
                high_watermark: high,
                replicas: p.replicas().to_vec(),
            });
        }

        // Fetch topic configuration via AdminClient (best-effort).
        let config = self.topic_config(name).await.unwrap_or_default();

        Ok(StreamDetail {
            name: name.to_string(),
            partitions,
            config,
        })
    }

    async fn read_messages(
        &self,
        stream: &str,
        query: &ReadQuery,
    ) -> ConnectorResult<Vec<Message>> {
        let consumer = self.base_consumer()?;

        // Determine partitions to read.
        let meta = consumer
            .fetch_metadata(Some(stream), Duration::from_secs(5))
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;
        let topic = meta
            .topics()
            .iter()
            .find(|t| t.name() == stream)
            .ok_or_else(|| ConnectorError::Other(format!("topic '{}' not found", stream)))?;

        let partition_ids: Vec<i32> = match query.partition {
            Some(p) => vec![p],
            None => topic.partitions().iter().map(|p| p.id()).collect(),
        };

        // Build the assignment with the right starting offset per partition.
        let mut tpl = TopicPartitionList::new();
        for &pid in &partition_ids {
            let (low, high) = consumer
                .fetch_watermarks(stream, pid, Duration::from_secs(5))
                .unwrap_or((0, 0));

            let start_offset = match &query.start {
                StartPosition::Earliest => Offset::Offset(low),
                StartPosition::Latest => {
                    // Start `limit` back from the tail so the user sees recent msgs.
                    let back = (high - query.limit as i64).max(low);
                    Offset::Offset(back)
                }
                StartPosition::Offset(o) => Offset::Offset((*o).max(low)),
                StartPosition::Timestamp(ts) => {
                    // Resolve the timestamp to an offset via offsets_for_times.
                    let mut req = TopicPartitionList::new();
                    let _ = req.add_partition_offset(stream, pid, Offset::Offset(*ts));
                    match consumer.offsets_for_times(req, Duration::from_secs(5)) {
                        Ok(resolved) => resolved
                            .find_partition(stream, pid)
                            .and_then(|e| match e.offset() {
                                Offset::Offset(o) => Some(Offset::Offset(o)),
                                _ => None,
                            })
                            .unwrap_or(Offset::Offset(low)),
                        Err(_) => Offset::Offset(low),
                    }
                }
            };
            tpl.add_partition_offset(stream, pid, start_offset)
                .map_err(|e| ConnectorError::Other(e.to_string()))?;
        }

        consumer
            .assign(&tpl)
            .map_err(|e| ConnectorError::Other(e.to_string()))?;

        // Poll until we have `limit` messages or we hit a short idle timeout.
        let mut messages = Vec::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        while messages.len() < query.limit as usize && std::time::Instant::now() < deadline {
            match consumer.poll(Duration::from_millis(500)) {
                Some(Ok(m)) => {
                    let value_bytes = m.payload().unwrap_or(&[]);

                    // Decode: prefer Schema Registry when the value is
                    // Confluent-wire-encoded, else fall back to plain UTF-8.
                    let mut schema_id: Option<i32> = None;
                    let value = match self.registry.as_ref().and_then(|r| r.decode(value_bytes)) {
                        Some(decoded) => {
                            schema_id = Some(decoded.schema_id);
                            decoded
                                .value
                                .or_else(|| String::from_utf8(value_bytes.to_vec()).ok())
                        }
                        None => String::from_utf8(value_bytes.to_vec()).ok(),
                    };
                    let is_json = value
                        .as_deref()
                        .map(|s| serde_json::from_str::<serde_json::Value>(s).is_ok())
                        .unwrap_or(false);

                    // Optional client-side filter on the value.
                    if let Some(f) = &query.filter {
                        let hit = value.as_deref().map(|s| s.contains(f)).unwrap_or(false);
                        if !hit {
                            continue;
                        }
                    }

                    let key = m.key().and_then(|k| String::from_utf8(k.to_vec()).ok());
                    let mut headers = Vec::new();
                    if let Some(hs) = m.headers() {
                        for i in 0..hs.count() {
                            let h = hs.get(i);
                            let val = h
                                .value
                                .and_then(|v| String::from_utf8(v.to_vec()).ok())
                                .unwrap_or_default();
                            headers.push((h.key.to_string(), val));
                        }
                    }

                    messages.push(Message {
                        partition: m.partition(),
                        offset: m.offset(),
                        timestamp: m.timestamp().to_millis(),
                        key,
                        value,
                        is_json,
                        headers,
                        size_bytes: value_bytes.len(),
                        schema_id,
                    });
                }
                Some(Err(e)) => {
                    return Err(ConnectorError::Other(e.to_string()));
                }
                None => {
                    // No message this poll; keep waiting until the deadline.
                }
            }
        }

        // Present newest-first for the viewer.
        messages.sort_by(|a, b| b.offset.cmp(&a.offset).then(b.partition.cmp(&a.partition)));
        Ok(messages)
    }

    async fn list_consumer_groups(&self) -> ConnectorResult<Vec<ConsumerGroup>> {
        // Collect owned group summaries FIRST, then drop the non-Send group
        // list before any `.await`, so this future stays `Send`.
        let summaries: Vec<(String, String, u32)> = {
            let consumer = self.base_consumer()?;
            let group_list = consumer
                .fetch_group_list(None, Duration::from_secs(5))
                .map_err(|e| ConnectorError::Connection(e.to_string()))?;
            group_list
                .groups()
                .iter()
                .map(|g| {
                    (
                        g.name().to_string(),
                        g.state().to_string(),
                        g.members().len() as u32,
                    )
                })
                .collect()
        };

        let mut out = Vec::new();
        for (id, state, members) in summaries {
            // Best-effort total lag.
            let total_lag = match self.group_offsets(&id).await {
                Ok(offsets) if !offsets.is_empty() => {
                    Some(offsets.iter().map(|o| o.lag.max(0)).sum())
                }
                _ => None,
            };
            out.push(ConsumerGroup {
                id,
                state,
                members,
                total_lag,
            });
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(out)
    }

    async fn group_offsets(&self, group: &str) -> ConnectorResult<Vec<GroupOffset>> {
        // Query committed offsets for this group across all user topics, then
        // keep only the partitions it has actually committed to. This avoids
        // parsing raw member assignment bytes and works during rebalances.
        let base = self.base_consumer()?;

        let mut tpl = TopicPartitionList::new();
        let meta = base
            .fetch_metadata(None, Duration::from_secs(5))
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;
        for t in meta.topics() {
            if t.name().starts_with("__") {
                continue;
            }
            for p in t.partitions() {
                let _ = tpl.add_partition(t.name(), p.id());
            }
        }

        if tpl.count() == 0 {
            return Ok(Vec::new());
        }

        // Ask the cluster for THIS group's committed offsets.
        let group_consumer = self.group_consumer(group)?;
        let committed = group_consumer
            .committed_offsets(tpl, Duration::from_secs(8))
            .map_err(|e| ConnectorError::Other(e.to_string()))?;

        let mut out = Vec::new();
        for elem in committed.elements() {
            let committed_offset = match elem.offset() {
                Offset::Offset(o) => o,
                _ => continue, // Invalid/none => group hasn't committed here.
            };
            let topic = elem.topic().to_string();
            let partition = elem.partition();
            let (_low, high) = base
                .fetch_watermarks(&topic, partition, Duration::from_secs(5))
                .unwrap_or((0, 0));
            let lag = (high - committed_offset).max(0);
            out.push(GroupOffset {
                topic,
                partition,
                committed: committed_offset,
                high_watermark: high,
                lag,
            });
        }
        out.sort_by(|a, b| a.topic.cmp(&b.topic).then(a.partition.cmp(&b.partition)));
        Ok(out)
    }

    async fn reset_group_offset(
        &self,
        group: &str,
        to_earliest: bool,
    ) -> ConnectorResult<()> {
        let base = self.base_consumer()?;
        let meta = base
            .fetch_metadata(None, Duration::from_secs(5))
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;

        // Build a TPL with the target offset (low or high watermark) per partition.
        let mut tpl = TopicPartitionList::new();
        for t in meta.topics() {
            if t.name().starts_with("__") {
                continue;
            }
            for p in t.partitions() {
                let (low, high) = base
                    .fetch_watermarks(t.name(), p.id(), Duration::from_secs(5))
                    .unwrap_or((0, 0));
                let target = if to_earliest { low } else { high };
                let _ = tpl.add_partition_offset(t.name(), p.id(), Offset::Offset(target));
            }
        }
        if tpl.count() == 0 {
            return Ok(());
        }

        // Commit the new offsets as this group.
        let group_consumer = self.group_consumer(group)?;
        group_consumer
            .commit(&tpl, rdkafka::consumer::CommitMode::Sync)
            .map_err(|e| ConnectorError::Other(e.to_string()))?;
        Ok(())
    }

    async fn produce(&self, stream: &str, msg: &OutgoingMessage) -> ConnectorResult<()> {
        let producer: ThreadedProducer<DefaultProducerContext> = self
            .client_config()
            .create()
            .map_err(|e| ConnectorError::Connection(e.to_string()))?;

        let key = msg.key.clone().unwrap_or_default();
        let mut record = BaseRecord::to(stream).payload(&msg.value).key(&key);
        if let Some(p) = msg.partition {
            record = record.partition(p);
        }

        producer
            .send(record)
            .map_err(|(e, _)| ConnectorError::Other(e.to_string()))?;
        let _ = producer.flush(Duration::from_secs(5));
        Ok(())
    }

    async fn create_stream(&self, spec: &CreateTopicSpec) -> ConnectorResult<()> {
        let admin = self.admin_client()?;
        let new_topic = NewTopic::new(
            &spec.name,
            spec.partitions,
            TopicReplication::Fixed(spec.replication),
        );
        let new_topic = spec
            .config
            .iter()
            .fold(new_topic, |t, (k, v)| t.set(k, v));

        let res = admin
            .create_topics(&[new_topic], &AdminOptions::new())
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;
        for r in res {
            r.map_err(|(name, e)| {
                ConnectorError::Other(format!("{}: {}", name, e))
            })?;
        }
        Ok(())
    }

    async fn delete_stream(&self, name: &str) -> ConnectorResult<()> {
        let admin = self.admin_client()?;
        let res = admin
            .delete_topics(&[name], &AdminOptions::new())
            .await
            .map_err(|e| ConnectorError::Other(e.to_string()))?;
        for r in res {
            r.map_err(|(name, e)| {
                ConnectorError::Other(format!("{}: {}", name, e))
            })?;
        }
        Ok(())
    }
}

// TypeScript mirrors of the Rust `connector::model` types.
// Keep these in sync with src-tauri/src/connector/model.rs.

export type Protocol = "kafka" | "redis" | "rabbitmq" | "nats";

export interface ConnectionConfig {
  id: string;
  name: string;
  protocol: Protocol;
  bootstrap: string;
  sasl_mechanism?: string | null;
  sasl_username?: string | null;
  sasl_password?: string | null;
  use_ssl: boolean;
  schema_registry_url?: string | null;
  extra: Record<string, string>;
}

export interface ServerInfo {
  protocol: Protocol;
  version: string | null;
  node_count: number;
  detail: string;
}

export interface StreamRef {
  name: string;
  partitions: number;
  approx_messages: number | null;
  internal: boolean;
}

export interface PartitionInfo {
  id: number;
  leader: number;
  low_watermark: number;
  high_watermark: number;
  replicas: number[];
}

export interface StreamDetail {
  name: string;
  partitions: PartitionInfo[];
  config: [string, string][];
}

export type StartPosition =
  | { kind: "latest" }
  | { kind: "earliest" }
  | { kind: "offset"; value: number }
  | { kind: "timestamp"; value: number };

export interface ReadQuery {
  start: StartPosition;
  limit: number;
  partition?: number | null;
  filter?: string | null;
}

export interface Message {
  partition: number;
  offset: number;
  timestamp: number | null;
  key: string | null;
  value: string | null;
  is_json: boolean;
  headers: [string, string][];
  size_bytes: number;
  schema_id?: number | null;
}

export interface OutgoingMessage {
  key?: string | null;
  value: string;
  partition?: number | null;
  headers: [string, string][];
}

export interface ConsumerGroup {
  id: string;
  state: string;
  members: number;
  total_lag: number | null;
}

export interface GroupOffset {
  topic: string;
  partition: number;
  committed: number;
  high_watermark: number;
  lag: number;
}

export interface CreateTopicSpec {
  name: string;
  partitions: number;
  replication: number;
  config: [string, string][];
}

// Thin typed wrapper over Tauri's invoke(). This is the only place the UI
// touches the Rust backend, mirroring the command names in commands.rs.

import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig,
  ConsumerGroup,
  CreateTopicSpec,
  GroupOffset,
  Message,
  OutgoingMessage,
  ReadQuery,
  ServerInfo,
  StreamDetail,
  StreamRef,
} from "./types";

export const api = {
  testConnection: (config: ConnectionConfig) =>
    invoke<ServerInfo>("test_connection", { config }),

  connect: (config: ConnectionConfig) =>
    invoke<ServerInfo>("connect", { config }),

  disconnect: (id: string) => invoke<void>("disconnect", { id }),

  listStreams: (id: string) => invoke<StreamRef[]>("list_streams", { id }),

  streamCounts: (id: string, names: string[]) =>
    invoke<[string, number][]>("stream_counts", { id, names }),

  describeStream: (id: string, stream: string) =>
    invoke<StreamDetail>("describe_stream", { id, stream }),

  readMessages: (id: string, stream: string, query: ReadQuery) =>
    invoke<Message[]>("read_messages", { id, stream, query }),

  produce: (id: string, stream: string, message: OutgoingMessage) =>
    invoke<void>("produce", { id, stream, message }),

  listConsumerGroups: (id: string) =>
    invoke<ConsumerGroup[]>("list_consumer_groups", { id }),

  groupOffsets: (id: string, group: string) =>
    invoke<GroupOffset[]>("group_offsets", { id, group }),

  resetGroupOffset: (id: string, group: string, toEarliest: boolean) =>
    invoke<void>("reset_group_offset", { id, group, toEarliest }),

  createStream: (id: string, spec: CreateTopicSpec) =>
    invoke<void>("create_stream", { id, spec }),

  deleteStream: (id: string, stream: string) =>
    invoke<void>("delete_stream", { id, stream }),

  setStreamConfig: (id: string, stream: string, entries: [string, string][]) =>
    invoke<void>("set_stream_config", { id, stream, entries }),
};

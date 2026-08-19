import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { api } from "./api/client";
import { friendlyError } from "./api/errors";
import type {
  ConnectionConfig,
  ConsumerGroup,
  Message,
  OutgoingMessage,
  ReadQuery,
  StartPosition,
  StreamRef,
} from "./api/types";
import { ConnectionModal } from "./components/ConnectionModal";
import { MessageViewer } from "./components/MessageViewer";
import { ProduceModal } from "./components/ProduceModal";
import { ConsumerGroupsPanel } from "./components/ConsumerGroupsPanel";
import { TopicInfoModal } from "./components/TopicInfoModal";
import { ContextMenu, MenuItem } from "./components/ContextMenu";
import { HealthLog, LogEntry } from "./components/HealthLog";
import {
  BrandIcon,
  CopyIcon,
  InfoIcon,
  MoonIcon,
  PlusIcon,
  RefreshIcon,
  StarIcon,
  SunIcon,
  TrashIcon,
} from "./components/Icons";

// A saved connection profile plus its live status.
interface Conn extends ConnectionConfig {
  connected: boolean;
  info?: string;
}

type SidebarTab = "topics" | "groups";
type Theme = "dark" | "light";

const LS_KEY = "streamscope.connections";
const THEME_KEY = "streamscope.theme";
const FAV_KEY = "streamscope.favorites";

function loadTheme(): Theme {
  return (localStorage.getItem(THEME_KEY) as Theme) || "dark";
}

function loadConns(): Conn[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

// Compact number formatting: 1234 -> "1.2k", 2500000 -> "2.5M".
function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

function App() {
  const [conns, setConns] = useState<Conn[]>(loadConns);
  const [health, setHealth] = useState<LogEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [streams, setStreams] = useState<StreamRef[]>([]);
  const [groups, setGroups] = useState<ConsumerGroup[]>([]);
  const [tab, setTab] = useState<SidebarTab>("topics");
  const [topicFilter, setTopicFilter] = useState("");
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [activeStream, setActiveStream] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({
    text: "Ready",
  });
  // Connection modal: null = closed, "new" = create, or an existing config = edit.
  const [connModal, setConnModal] = useState<null | "new" | ConnectionConfig>(
    null
  );
  const [connMenu, setConnMenu] = useState<{
    x: number;
    y: number;
    conn: Conn;
  } | null>(null);
  const [produceFor, setProduceFor] = useState<{
    stream: string;
    prefill?: OutgoingMessage;
  } | null>(null);
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);

  // Apply theme to <html> and persist.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Append a line to the connection health log (capped to the last 200).
  const addLog = useCallback(
    (text: string, level: LogEntry["level"] = "info") => {
      const now = new Date();
      const time = now.toTimeString().slice(0, 8);
      setHealth((prev) => {
        const next = [
          ...prev,
          { id: now.getTime() + Math.random(), time, text, level },
        ];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    },
    []
  );

  // Greeting line on startup so the log is never empty.
  useEffect(() => {
    addLog("StreamScope ready", "ok");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Make the app feel like a finished product: block the browser context menu
  // and the common DevTools shortcuts (F12, Cmd/Ctrl+Shift+I/J/C, Cmd+Alt+I).
  // Text inputs keep normal behaviour. (Release builds also ship without the
  // DevTools engine; this covers the dev build's interactive entry points.)
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      const editable =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (!editable) e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      const isDevtools =
        e.key === "F12" ||
        (mod && e.shiftKey && (key === "i" || key === "j" || key === "c")) ||
        (e.metaKey && e.altKey && key === "i"); // macOS Cmd+Opt+I
      if (isDevtools) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  // Read query controls
  const [startKind, setStartKind] = useState<StartPosition["kind"]>("latest");
  const [timestamp, setTimestamp] = useState<number | null>(null);
  const [limit, setLimit] = useState(50);
  const [partition, setPartition] = useState<number | null>(null); // null = all

  const active = useMemo(
    () => conns.find((c) => c.id === activeId) ?? null,
    [conns, activeId]
  );

  // Client-side topic filter for fast searching hundreds of topics.
  const visibleStreams = useMemo(() => {
    const q = topicFilter.trim().toLowerCase();
    const favSet = new Set(favorites);
    const filtered = q
      ? streams.filter((s) => s.name.toLowerCase().includes(q))
      : streams;
    // Favorites first, each group alphabetical.
    return [...filtered].sort((a, b) => {
      const fa = favSet.has(a.name) ? 0 : 1;
      const fb = favSet.has(b.name) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return a.name.localeCompare(b.name);
    });
  }, [streams, topicFilter, favorites]);

  const isFav = (name: string) => favorites.includes(name);
  const toggleFav = (name: string) =>
    setFavorites((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
    );

  // Persist profiles locally (privacy-first, no cloud).
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(conns));
  }, [conns]);

  useEffect(() => {
    localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
  }, [favorites]);

  const saveConnection = (cfg: ConnectionConfig) => {
    const isExisting = conns.some((c) => c.id === cfg.id);
    setConns((prev) => {
      const idx = prev.findIndex((c) => c.id === cfg.id);
      const next: Conn = { ...cfg, connected: false };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...next };
        return copy;
      }
      return [...prev, next];
    });
    setConnModal(null);
    // Auto-connect new profiles; for edits, reconnect only if it was active.
    if (!isExisting || activeId === cfg.id) {
      connect({ ...cfg, connected: false });
    }
  };

  const duplicateConnection = (c: Conn) => {
    const copy: Conn = {
      ...c,
      id: crypto.randomUUID(),
      name: `${c.name} (copy)`,
      connected: false,
    };
    setConns((prev) => [...prev, copy]);
  };

  const deleteConnection = (c: Conn) => {
    setConns((prev) => prev.filter((x) => x.id !== c.id));
    addLog(`${c.name} — removed`, "warn");
    if (activeId === c.id) {
      setActiveId(null);
      setStreams([]);
      setActiveStream(null);
      setMessages([]);
      setGroups([]);
    }
  };

  const connect = useCallback(
    async (c: Conn) => {
      setStatus({ text: `Connecting to ${c.name}…` });
      addLog(`${c.name} — connecting to ${c.bootstrap}…`);
      setActiveId(c.id);
      setActiveStream(null);
      setMessages([]);
      setGroups([]);
      setTopicFilter("");
      try {
        const info = await api.connect(c);
        setConns((prev) =>
          prev.map((x) =>
            x.id === c.id ? { ...x, connected: true, info: info.detail } : x
          )
        );
        setStatus({ text: `Connected · ${info.detail}` });
        addLog(`${c.name} — status: online`, "ok");
        addLog(`${c.name} — ${info.detail}`);
        const list = await api.listStreams(c.id);
        setStreams(list);
        addLog(`${c.name} — topics visible: ${list.length}`);
        // Fetch message counts lazily in the background (non-blocking).
        fetchCounts(
          c.id,
          list.filter((s) => !s.internal).map((s) => s.name)
        );
      } catch (e) {
        setStatus({ text: friendlyError(e), err: true });
        addLog(`${c.name} — connection failed`, "err");
        setConns((prev) =>
          prev.map((x) => (x.id === c.id ? { ...x, connected: false } : x))
        );
      }
    },
    [addLog]
  );

  // Fetch topic message counts in batches, merging results as they arrive so
  // the UI never blocks on large clusters.
  const fetchCounts = async (connId: string, names: string[]) => {
    const BATCH = 25;
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH);
      try {
        const counts = await api.streamCounts(connId, batch);
        if (counts.length === 0) continue;
        const map = new Map(counts);
        setStreams((prev) =>
          prev.map((s) =>
            map.has(s.name)
              ? { ...s, approx_messages: map.get(s.name)! }
              : s
          )
        );
      } catch {
        // best-effort; ignore failures for a batch
      }
    }
  };

  const loadGroups = useCallback(async () => {
    if (!active) return;
    setStatus({ text: "Loading consumer groups…" });
    try {
      const g = await api.listConsumerGroups(active.id);
      setGroups(g);
      setStatus({ text: `${g.length} consumer group(s)` });
    } catch (e) {
      setStatus({ text: friendlyError(e), err: true });
      setGroups([]);
    }
  }, [active]);

  const openStream = useCallback(
    async (name: string) => {
      if (!active) return;
      setActiveStream(name);
      await loadMessages(active.id, name, startKind, timestamp, limit, partition);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, startKind, timestamp, limit, partition]
  );

  async function loadMessages(
    id: string,
    stream: string,
    kind: StartPosition["kind"],
    ts: number | null,
    lim: number,
    part: number | null,
    silent = false
  ) {
    if (!silent) setLoading(true);
    if (!silent) setStatus({ text: `Reading ${stream}…` });
    const start: StartPosition =
      kind === "latest"
        ? { kind: "latest" }
        : kind === "earliest"
        ? { kind: "earliest" }
        : kind === "timestamp"
        ? { kind: "timestamp", value: ts ?? Date.now() }
        : { kind: "offset", value: 0 };
    const query: ReadQuery = {
      start,
      limit: lim,
      partition: part,
      filter: null,
    };
    try {
      const msgs = await api.readMessages(id, stream, query);
      setMessages(msgs);
      setStatus({ text: `${msgs.length} message(s) · ${stream}` });
      if (!silent) addLog(`read ${stream} — ${msgs.length} message(s)`);
    } catch (e) {
      setStatus({ text: friendlyError(e), err: true });
      if (!silent) addLog(`read ${stream} — failed`, "err");
      if (!silent) setMessages([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  const refresh = () => {
    if (active && activeStream)
      loadMessages(active.id, activeStream, startKind, timestamp, limit, partition);
  };

  const sendMessage = async (msg: OutgoingMessage) => {
    if (!active || !produceFor) return;
    setStatus({ text: `Producing to ${produceFor.stream}…` });
    try {
      await api.produce(active.id, produceFor.stream, msg);
      setStatus({ text: `Produced to ${produceFor.stream}` });
      setProduceFor(null);
      // Refresh if we're viewing the same topic.
      if (activeStream === produceFor.stream) refresh();
    } catch (e) {
      setStatus({ text: friendlyError(e), err: true });
    }
  };

  const deleteTopic = async (name: string) => {
    if (!active) return;
    if (!confirm(`Delete topic "${name}"? This cannot be undone.`)) return;
    setStatus({ text: `Deleting ${name}…` });
    try {
      await api.deleteStream(active.id, name);
      setStatus({ text: `Deleted ${name}` });
      if (activeStream === name) {
        setActiveStream(null);
        setMessages([]);
      }
      setStreams(await api.listStreams(active.id));
    } catch (e) {
      setStatus({ text: friendlyError(e), err: true });
    }
  };

  const createTopic = async () => {
    if (!active) return;
    const name = prompt("New topic name:");
    if (!name?.trim()) return;
    const partsStr = prompt("Partitions:", "1");
    const parts = Number(partsStr ?? "1") || 1;
    const replStr = prompt("Replication factor:", "1");
    const repl = Number(replStr ?? "1") || 1;
    setStatus({ text: `Creating ${name}…` });
    try {
      await api.createStream(active.id, {
        name: name.trim(),
        partitions: parts,
        replication: repl,
        config: [],
      });
      setStatus({ text: `Created ${name}` });
      setStreams(await api.listStreams(active.id));
    } catch (e) {
      setStatus({ text: friendlyError(e), err: true });
    }
  };

  // Turn a viewed message into a produce prefill (reproduce/replay).
  const replay = (m: Message) => {
    if (!activeStream) return;
    setProduceFor({
      stream: activeStream,
      prefill: {
        key: m.key ?? null,
        value: m.value ?? "",
        partition: null,
        headers: m.headers,
      },
    });
  };

  return (
    <div className="app">
      {/* Topbar */}
      <div className="topbar">
        <div className="brand">
          <span className="mark">
            <BrandIcon size={20} />
          </span>
          StreamScope
        </div>
        <div className="spacer" />
        <div className={`status-inline ${status.err ? "err" : ""}`}>
          <span className={`status-dot ${status.err ? "err" : ""}`} />
          {status.text}
        </div>
        <button
          className="icon-btn"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>

      {/* Body: [Connections | Messages | Topics] */}
      <div className="body">
        {/* Left: Connections */}
        <div className="sidebar left">
          <div className="sidebar-header">
            Connections
            <div className="spacer" />
            <button
              className="icon-btn"
              onClick={() => setConnModal("new")}
              title="New connection"
            >
              <PlusIcon />
            </button>
          </div>
          <div className="sidebar-scroll">
            {conns.length === 0 && (
              <div className="spin">
                No connections yet.
                <br />
                Click + to add one.
              </div>
            )}
            {conns.map((c) => (
              <div
                key={c.id}
                className={`list-item topic-row ${
                  c.id === activeId ? "active" : ""
                }`}
                onClick={() => connect(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setConnMenu({ x: e.clientX, y: e.clientY, conn: c });
                }}
                title="Right-click for actions"
              >
                <span
                  className="dot"
                  style={{
                    background: c.connected
                      ? "var(--green)"
                      : "var(--text-faint)",
                  }}
                />
                <span className="name">{c.name}</span>
                <span className={`badge ${c.protocol}`}>{c.protocol}</span>
                <span
                  className="row-del"
                  title="Edit connection"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConnModal(c);
                  }}
                >
                  <InfoIcon size={13} />
                </span>
              </div>
            ))}
          </div>

          {/* Health log fills the lower part of the left column */}
          <HealthLog entries={health} onClear={() => setHealth([])} />
        </div>

        {/* Center: Message viewer */}
        <div className="main">
          {!activeStream ? (
            <div className="empty">
              <span className="mark">
                <BrandIcon size={44} />
              </span>
              <h2>StreamScope</h2>
              <p>
                The streaming client developers actually enjoy using.
                <br />
                {active
                  ? "Pick a topic from the list on the right."
                  : "Add or select a connection to get started."}
              </p>
              <div className="hint-chips">
                <span>Browse &amp; tail messages</span>
                <span>Avro / JSON decode</span>
                <span>Consumer lag</span>
                <span>Produce &amp; replay</span>
              </div>
            </div>
          ) : (
            <MessageViewer
              stream={activeStream}
              messages={messages}
              loading={loading}
              startKind={startKind}
              timestamp={timestamp}
              limit={limit}
              partition={partition}
              partitionCount={
                streams.find((s) => s.name === activeStream)?.partitions ?? 1
              }
              onStartKind={setStartKind}
              onTimestamp={setTimestamp}
              onLimit={setLimit}
              onPartition={setPartition}
              onRefresh={refresh}
              onProduce={() =>
                activeStream && setProduceFor({ stream: activeStream })
              }
              onInfo={() => activeStream && setInfoFor(activeStream)}
              onReplay={replay}
            />
          )}
        </div>

        {/* Right: Topics / Consumer Groups */}
        <div className="sidebar right">
          <div className="sidebar-header" style={{ gap: 4 }}>
            <button
              className={tab === "topics" ? "primary" : "ghost"}
              onClick={() => setTab("topics")}
            >
              Topics
            </button>
            <button
              className={tab === "groups" ? "primary" : "ghost"}
              onClick={() => {
                setTab("groups");
                loadGroups();
              }}
            >
              Groups
            </button>
            <div className="spacer" />
            {active && tab === "topics" && (
              <>
                <button
                  className="icon-btn"
                  onClick={createTopic}
                  title="Create topic"
                >
                  <PlusIcon />
                </button>
                <button
                  className="icon-btn"
                  onClick={async () => {
                    if (!active) return;
                    const list = await api.listStreams(active.id);
                    setStreams(list);
                    fetchCounts(
                      active.id,
                      list.filter((s) => !s.internal).map((s) => s.name)
                    );
                  }}
                  title="Refresh topics"
                >
                  <RefreshIcon />
                </button>
              </>
            )}
          </div>

          {tab === "topics" && active && (
            <div className="search-wrap">
              <input
                placeholder="Search topics…"
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
              />
            </div>
          )}

          <div className="sidebar-scroll">
            {!active && <div className="spin">Select a connection.</div>}

            {active && tab === "topics" && (
              <>
                {visibleStreams.length === 0 && (
                  <div className="spin">
                    {streams.length === 0 ? "No topics." : "No match."}
                  </div>
                )}
                {visibleStreams.map((s) => (
                  <div
                    key={s.name}
                    className={`list-item topic-row ${
                      s.name === activeStream ? "active" : ""
                    } ${s.internal ? "internal" : ""}`}
                    onClick={() => openStream(s.name)}
                  >
                    <span
                      className={`fav-star ${isFav(s.name) ? "on" : ""}`}
                      title={isFav(s.name) ? "Unfavorite" : "Favorite"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFav(s.name);
                      }}
                    >
                      <StarIcon size={13} filled={isFav(s.name)} />
                    </span>
                    <span className="name">{s.name}</span>
                    <span
                      className="meta"
                      title={`${s.partitions} partition(s)${
                        s.approx_messages != null
                          ? ` · ${s.approx_messages.toLocaleString()} messages`
                          : ""
                      }`}
                    >
                      {s.approx_messages != null
                        ? fmtCount(s.approx_messages)
                        : `${s.partitions}p`}
                    </span>
                    {!s.internal && (
                      <span
                        className="row-del"
                        title="Delete topic"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTopic(s.name);
                        }}
                      >
                        <TrashIcon size={13} />
                      </span>
                    )}
                  </div>
                ))}
              </>
            )}

            {active && tab === "groups" && (
              <ConsumerGroupsPanel
                connId={active.id}
                groups={groups}
                onRefresh={loadGroups}
              />
            )}
          </div>
        </div>
      </div>

      {connModal && (
        <ConnectionModal
          initial={connModal === "new" ? undefined : connModal}
          onSave={saveConnection}
          onCancel={() => setConnModal(null)}
        />
      )}

      {connMenu &&
        (() => {
          const c = connMenu.conn;
          const items: MenuItem[] = [
            {
              label: "Connect",
              icon: <RefreshIcon size={14} />,
              onClick: () => connect(c),
            },
            {
              label: "Edit…",
              icon: <InfoIcon size={14} />,
              onClick: () => setConnModal(c),
              separatorBefore: true,
            },
            {
              label: "Duplicate",
              icon: <CopyIcon size={14} />,
              onClick: () => duplicateConnection(c),
            },
            {
              label: "Delete",
              icon: <TrashIcon size={14} />,
              onClick: () => deleteConnection(c),
              danger: true,
              separatorBefore: true,
            },
          ];
          return (
            <ContextMenu
              x={connMenu.x}
              y={connMenu.y}
              items={items}
              onClose={() => setConnMenu(null)}
            />
          );
        })()}

      {produceFor && (
        <ProduceModal
          stream={produceFor.stream}
          prefill={produceFor.prefill}
          onSend={sendMessage}
          onCancel={() => setProduceFor(null)}
        />
      )}

      {infoFor && active && (
        <TopicInfoModal
          connId={active.id}
          stream={infoFor}
          onClose={() => setInfoFor(null)}
        />
      )}
    </div>
  );
}

export default App;

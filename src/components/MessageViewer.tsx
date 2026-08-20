import { useEffect, useMemo, useRef, useState } from "react";
import type { Message, StartPosition } from "../api/types";
import { CopyIcon, InfoIcon, PlusIcon, ReplayIcon, SearchIcon } from "./Icons";
import { ContextMenu, MenuItem } from "./ContextMenu";
import { Select } from "./Select";
import { JsonView } from "./JsonView";
import { DateTimePicker } from "./DateTimePicker";
import { FieldsDropdown } from "./FieldsDropdown";

// The message viewer: a dense table (newest first) plus a detail drawer that
// pretty-prints JSON — the daily-driver experience that beats web Kafka UIs.
type ViewMode = "auto" | "string" | "json" | "hex";

export function MessageViewer(props: {
  stream: string;
  messages: Message[];
  loading: boolean;
  startKind: StartPosition["kind"];
  timestamp: number | null;
  limit: number;
  partition: number | null;
  partitionCount: number;
  onStartKind: (k: StartPosition["kind"]) => void;
  onTimestamp: (ms: number | null) => void;
  onLimit: (n: number) => void;
  onPartition: (p: number | null) => void;
  onRefresh: () => void;
  onProduce: () => void;
  onInfo: () => void;
  onReplay: (m: Message) => void;
}) {
  const [selected, setSelected] = useState<Message | null>(null);
  const [detailTab, setDetailTab] = useState<"payload" | "headers" | "key">(
    "payload"
  );
  const [viewMode, setViewMode] = useState<ViewMode>("auto");
  const [tsStr, setTsStr] = useState(""); // datetime-local string for "From timestamp"
  const [quickSearch, setQuickSearch] = useState("");
  // Which fields the text filter applies to (multi-select via checkboxes).
  const [fKey, setFKey] = useState(true);
  const [fValue, setFValue] = useState(true);
  const [fHeaders, setFHeaders] = useState(true);
  // Client-side time-range filter over loaded messages.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    msg: Message;
  } | null>(null);

  // Live tail: re-run the search on an interval while enabled. Uses a ref to the
  // latest onRefresh so the interval never captures a stale closure.
  const refreshRef = useRef(props.onRefresh);
  refreshRef.current = props.onRefresh;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => refreshRef.current(), 2000);
    return () => clearInterval(t);
  }, [live]);

  const fmtTime = (ms: number | null) =>
    ms ? new Date(ms).toLocaleString() : "—";

  const toHex = (s: string) =>
    Array.from(s)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(" ");

  // Render a message value according to the selected deserializer/view mode.
  const pretty = (m: Message) => {
    if (m.value == null) return "(null)";
    switch (viewMode) {
      case "string":
        return m.value;
      case "hex":
        return toHex(m.value);
      case "json":
        try {
          return JSON.stringify(JSON.parse(m.value), null, 2);
        } catch {
          return m.value;
        }
      default: // auto
        if (m.is_json) {
          try {
            return JSON.stringify(JSON.parse(m.value), null, 2);
          } catch {
            return m.value;
          }
        }
        return m.value;
    }
  };

  // Client-side filter over loaded messages: text (across ticked fields) + time range.
  const shown = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    const fromMs = fromDate ? new Date(fromDate).getTime() : null;
    const toMs = toDate ? new Date(toDate).getTime() : null;

    const inKey = (m: Message) => m.key?.toLowerCase().includes(q) ?? false;
    const inValue = (m: Message) =>
      m.value?.toLowerCase().includes(q) ?? false;
    const inHeaders = (m: Message) =>
      m.headers.some(
        ([k, v]) =>
          k.toLowerCase().includes(q) || v.toLowerCase().includes(q)
      );

    return props.messages.filter((m) => {
      // Time range
      if (fromMs != null && (m.timestamp == null || m.timestamp < fromMs))
        return false;
      if (toMs != null && (m.timestamp == null || m.timestamp > toMs))
        return false;
      // Text (only when a query is present)
      if (q) {
        const hit =
          (fKey && inKey(m)) ||
          (fValue && inValue(m)) ||
          (fHeaders && inHeaders(m));
        if (!hit) return false;
      }
      return true;
    });
  }, [props.messages, quickSearch, fKey, fValue, fHeaders, fromDate, toDate]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      // ignore
    }
  };

  // Export the currently-shown messages to a downloaded file.
  const download = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportJson = () => {
    download(
      JSON.stringify(shown, null, 2),
      `${props.stream}.json`,
      "application/json"
    );
  };
  const exportCsv = () => {
    const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["partition", "offset", "timestamp", "key", "value"].join(","),
      ...shown.map((m) =>
        [
          m.partition,
          m.offset,
          m.timestamp ?? "",
          esc(m.key ?? ""),
          esc(m.value ?? ""),
        ].join(",")
      ),
    ];
    download(rows.join("\n"), `${props.stream}.csv`, "text/csv");
  };

  return (
    <>
      {/* Row 1: topic title + info */}
      <div className="toolbar">
        <span className="title" title={props.stream}>
          {props.stream}
        </span>
        <button
          className="icon-btn"
          onClick={props.onInfo}
          title="Topic details & config"
        >
          <InfoIcon size={15} />
        </button>
        <div className="spacer" />
        <button
          className={live ? "live-toggle on" : "live-toggle"}
          onClick={() => setLive((v) => !v)}
          title="Auto-refresh every 2s (live tail)"
          style={{ height: 28 }}
        >
          <span className="live-dot" />
          Live
        </button>
        {shown.length > 0 && (
          <>
            <button
              onClick={exportJson}
              title="Export shown messages as JSON"
              style={{ height: 28, padding: "0 10px" }}
            >
              Export JSON
            </button>
            <button
              onClick={exportCsv}
              title="Export shown messages as CSV"
              style={{ height: 28, padding: "0 10px" }}
            >
              CSV
            </button>
          </>
        )}
        <span className="count-pill">
          {shown.length}/{props.messages.length}
        </span>
      </div>

      {/* Search panel — two balanced rows */}
      <div className="search-panel">
        {/* Row 1: read controls (dropdowns) */}
        <div className="sp-row">
          <div className="sp-field">
            <label>Search type</label>
            <Select
              value={props.startKind}
              minWidth={128}
              onChange={(v) => props.onStartKind(v as StartPosition["kind"])}
              options={[
                { value: "latest", label: "Newest" },
                { value: "earliest", label: "Oldest" },
                { value: "timestamp", label: "From timestamp" },
              ]}
            />
          </div>

          {props.startKind === "timestamp" && (
            <div className="sp-field">
              <label>Timestamp</label>
              <DateTimePicker
                value={tsStr}
                placeholder="Pick date & time…"
                onChange={(v) => {
                  setTsStr(v);
                  props.onTimestamp(v ? new Date(v).getTime() : null);
                }}
              />
            </div>
          )}

          <div className="sp-field">
            <label>Partition</label>
            <Select
              value={props.partition == null ? "all" : String(props.partition)}
              minWidth={80}
              onChange={(v) => props.onPartition(v === "all" ? null : Number(v))}
              options={[
                { value: "all", label: "All" },
                ...Array.from({ length: props.partitionCount }).map((_, i) => ({
                  value: String(i),
                  label: String(i),
                })),
              ]}
            />
          </div>

          <div className="sp-field">
            <label>Max messages</label>
            <Select
              value={String(props.limit)}
              minWidth={80}
              onChange={(v) => props.onLimit(Number(v))}
              options={[25, 50, 100, 250, 500, 1000].map((n) => ({
                value: String(n),
                label: String(n),
              }))}
            />
          </div>

          <div className="sp-field">
            <label>View as</label>
            <Select
              value={viewMode}
              minWidth={88}
              onChange={(v) => setViewMode(v as ViewMode)}
              options={[
                { value: "auto", label: "Auto" },
                { value: "json", label: "JSON" },
                { value: "string", label: "String" },
                { value: "hex", label: "Hex" },
              ]}
            />
          </div>
        </div>

        {/* Row 2: time range + text filter + search */}
        <div className="sp-row">
          <div className="sp-field">
            <label>Time range (loaded)</label>
            <div className="dtp-range">
              <DateTimePicker
                value={fromDate}
                onChange={setFromDate}
                placeholder="From…"
              />
              <span className="dtp-range-sep">→</span>
              <DateTimePicker
                value={toDate}
                onChange={setToDate}
                placeholder="To…"
              />
              {(fromDate || toDate) && (
                <span
                  className="clear-dates"
                  title="Clear date range"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                  }}
                >
                  ✕
                </span>
              )}
            </div>
          </div>

          <div className="sp-field sp-grow">
            <label>Text filter</label>
            <div className="filter-input">
              <span className="filter-ico">
                <SearchIcon size={14} />
              </span>
              <input
                placeholder="Filter loaded messages…"
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="sp-field">
            <label>Fields</label>
            <FieldsDropdown
              options={[
                { key: "key", label: "Key", checked: fKey, onToggle: setFKey },
                {
                  key: "value",
                  label: "Value",
                  checked: fValue,
                  onToggle: setFValue,
                },
                {
                  key: "headers",
                  label: "Headers",
                  checked: fHeaders,
                  onToggle: setFHeaders,
                },
              ]}
            />
          </div>

          <div className="sp-field sp-action">
            <label>&nbsp;</label>
            <button className="primary" onClick={props.onRefresh}>
              {props.loading ? "…" : "Search"}
            </button>
          </div>
        </div>
      </div>

      <div className="messages">
        {props.loading ? (
          <div className="skeleton-list">
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="skeleton-row" key={i}>
                <span className="sk sk-sm" />
                <span className="sk sk-sm" />
                <span className="sk sk-md" />
                <span className="sk sk-grow" />
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <p>
              {props.messages.length === 0
                ? 'No messages here. Try "Earliest" or a higher limit.'
                : "No messages match your filter."}
            </p>
            {props.messages.length === 0 && (
              <button onClick={props.onProduce}>
                <PlusIcon size={14} /> Produce a message
              </button>
            )}
          </div>
        ) : (
          <table className="msg-table">
            <thead>
              <tr>
                <th className="col-num">Part</th>
                <th className="col-num">Offset</th>
                <th>Time</th>
                <th>Key</th>
                <th>Value</th>
                <th className="col-num">Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr
                  key={`${m.partition}-${m.offset}`}
                  className={
                    selected &&
                    selected.partition === m.partition &&
                    selected.offset === m.offset
                      ? "selected"
                      : ""
                  }
                  onClick={() => setSelected(m)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelected(m);
                    setMenu({ x: e.clientX, y: e.clientY, msg: m });
                  }}
                >
                  <td className="col-num">{m.partition}</td>
                  <td className="col-num">{m.offset}</td>
                  <td>{fmtTime(m.timestamp)}</td>
                  <td>{m.key ?? <span style={{ opacity: 0.4 }}>—</span>}</td>
                  <td className="val-cell">
                    {m.schema_id != null && (
                      <span
                        className="badge schema-badge"
                        style={{ marginRight: 6 }}
                        title={`Schema Registry id ${m.schema_id}`}
                      >
                        #{m.schema_id}
                      </span>
                    )}
                    {m.is_json && <span className="json-tag">{"{} "}</span>}
                    {m.value ?? "(null)"}
                  </td>
                  <td className="col-num">{m.size_bytes}B</td>
                  <td className="col-num">
                    <span
                      title="Replay this message"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onReplay(m);
                      }}
                      style={{
                        cursor: "pointer",
                        color: "var(--accent)",
                        display: "inline-flex",
                      }}
                    >
                      <ReplayIcon size={14} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="detail">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div className="kv" style={{ padding: 0 }}>
              <b>Partition</b> {selected.partition} &nbsp; <b>Offset</b>{" "}
              {selected.offset} &nbsp; <b>Time</b> {fmtTime(selected.timestamp)}
              {selected.schema_id != null && (
                <>
                  {" "}
                  &nbsp; <b>Schema</b> #{selected.schema_id}
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => props.onReplay(selected)}>
                <ReplayIcon size={14} /> Replay
              </button>
            </div>
          </div>

          {/* Tabs: Payload | Headers | Key */}
          <div className="tabs">
            {(["payload", "headers", "key"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setDetailTab(t)}
                className={`tab ${detailTab === t ? "active" : ""}`}
              >
                {t}
                {t === "headers" && ` (${selected.headers.length})`}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button
              className="ghost"
              onClick={() => {
                const text =
                  detailTab === "payload"
                    ? pretty(selected)
                    : detailTab === "key"
                    ? selected.key ?? ""
                    : selected.headers
                        .map(([k, v]) => `${k}=${v}`)
                        .join("\n");
                copy(text, detailTab);
              }}
            >
              <CopyIcon size={13} />
              {copied === detailTab ? "Copied" : "Copy"}
            </button>
          </div>

          {detailTab === "payload" && (
            <JsonView
              text={pretty(selected)}
              isJson={
                selected.is_json &&
                viewMode !== "hex" &&
                viewMode !== "string"
              }
            />
          )}

          {detailTab === "key" && (
            <pre>{selected.key ?? "(no key)"}</pre>
          )}

          {detailTab === "headers" &&
            (selected.headers.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
                No headers on this message.
              </div>
            ) : (
              <table className="msg-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Header</th>
                    <th>Value</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {selected.headers.map(([k, v], i) => (
                    <tr key={`${k}-${i}`}>
                      <td style={{ color: "var(--text-dim)" }}>{k}</td>
                      <td style={{ fontFamily: "var(--mono)" }}>{v}</td>
                      <td className="col-num">
                        <span
                          title="Copy this header value"
                          onClick={() => copy(v, `h-${i}`)}
                          style={{ cursor: "pointer", color: "var(--accent)" }}
                        >
                          {copied === `h-${i}` ? "✓" : "⎘"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
        </div>
      )}

      {menu &&
        (() => {
          const m = menu.msg;
          const items: MenuItem[] = [
            {
              label: "Replay / reproduce",
              icon: <ReplayIcon size={14} />,
              onClick: () => props.onReplay(m),
            },
            {
              label: "Produce new message…",
              icon: <PlusIcon size={14} />,
              onClick: () => props.onProduce(),
            },
            {
              label: "Copy value",
              icon: <CopyIcon size={14} />,
              onClick: () => copy(pretty(m), "ctx"),
              separatorBefore: true,
            },
            {
              label: "Copy key",
              icon: <CopyIcon size={14} />,
              onClick: () => copy(m.key ?? "", "ctx"),
            },
            {
              label: "View details",
              icon: <InfoIcon size={14} />,
              onClick: () => setSelected(m),
              separatorBefore: true,
            },
          ];
          return (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={items}
              onClose={() => setMenu(null)}
            />
          );
        })()}
    </>
  );
}

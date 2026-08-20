import { useState } from "react";
import { api } from "../api/client";
import type { ConsumerGroup, GroupOffset } from "../api/types";

// Consumer groups list with state, members, and lag. Click a group to expand
// its per-partition committed offsets and lag — the debugging view engineers
// actually need.
export function ConsumerGroupsPanel(props: {
  connId: string;
  groups: ConsumerGroup[];
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, GroupOffset[]>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const stateColor = (s: string) => {
    const v = s.toLowerCase();
    if (v.includes("stable")) return "var(--green)";
    if (v.includes("empty") || v.includes("dead")) return "var(--text-dim)";
    return "var(--amber)";
  };

  const [resetting, setResetting] = useState<string | null>(null);

  const loadOffsets = async (id: string) => {
    setLoading(id);
    try {
      const o = await api.groupOffsets(props.connId, id);
      setOffsets((prev) => ({ ...prev, [id]: o }));
    } catch {
      setOffsets((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setLoading(null);
    }
  };

  const toggle = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!offsets[id]) await loadOffsets(id);
  };

  const resetOffset = async (id: string, toEarliest: boolean) => {
    const where = toEarliest ? "earliest" : "latest";
    if (
      !confirm(
        `Reset consumer group "${id}" to ${where}? This changes committed offsets for all topics.`
      )
    )
      return;
    setResetting(id);
    try {
      await api.resetGroupOffset(props.connId, id, toEarliest);
      await loadOffsets(id);
    } catch (e) {
      alert(`Reset failed: ${e}`);
    } finally {
      setResetting(null);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "6px 10px",
        }}
      >
        <span className="section-label" style={{ padding: 0 }}>
          {props.groups.length} group(s)
        </span>
        <button style={{ padding: "3px 8px" }} onClick={props.onRefresh}>
          ↻
        </button>
      </div>

      {props.groups.length === 0 && (
        <div className="spin">No consumer groups.</div>
      )}

      {props.groups.map((g) => (
        <div key={g.id}>
          <div
            className="list-item"
            style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
            onClick={() => toggle(g.id)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className="dot"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: stateColor(g.state),
                }}
              />
              <span className="name" style={{ fontFamily: "var(--mono)" }}>
                {g.id}
              </span>
              {g.total_lag != null && g.total_lag > 0 && (
                <span
                  className="badge"
                  style={{
                    background: "color-mix(in srgb, var(--red) 15%, transparent)",
                    color: "var(--red)",
                    borderColor: "color-mix(in srgb, var(--red) 40%, transparent)",
                  }}
                >
                  lag {g.total_lag}
                </span>
              )}
            </div>
            <div className="meta" style={{ paddingLeft: 16 }}>
              {g.state} · {g.members} member(s)
              {g.total_lag != null && ` · total lag ${g.total_lag}`}
            </div>
          </div>

          {expanded === g.id && (
            <div style={{ padding: "4px 10px 10px 18px", fontSize: 11 }}>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginBottom: 8,
                  alignItems: "center",
                }}
              >
                <span style={{ color: "var(--text-dim)" }}>Reset to:</span>
                <button
                  style={{ height: 24, padding: "0 8px", fontSize: 11 }}
                  disabled={resetting === g.id}
                  onClick={() => resetOffset(g.id, true)}
                >
                  Earliest
                </button>
                <button
                  style={{ height: 24, padding: "0 8px", fontSize: 11 }}
                  disabled={resetting === g.id}
                  onClick={() => resetOffset(g.id, false)}
                >
                  Latest
                </button>
                {resetting === g.id && (
                  <span style={{ color: "var(--text-dim)" }}>resetting…</span>
                )}
              </div>
              {loading === g.id ? (
                <div className="spin" style={{ padding: 8 }}>
                  Loading offsets…
                </div>
              ) : (offsets[g.id]?.length ?? 0) === 0 ? (
                <div style={{ color: "var(--text-dim)" }}>
                  No committed offsets.
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontFamily: "var(--mono)",
                  }}
                >
                  <thead>
                    <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
                      <th style={{ padding: "2px 4px" }}>topic/p</th>
                      <th style={{ padding: "2px 4px", textAlign: "right" }}>
                        committed
                      </th>
                      <th style={{ padding: "2px 4px", textAlign: "right" }}>
                        end
                      </th>
                      <th style={{ padding: "2px 4px", textAlign: "right" }}>
                        lag
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {offsets[g.id].map((o) => (
                      <tr key={`${o.topic}-${o.partition}`}>
                        <td style={{ padding: "2px 4px" }}>
                          {o.topic}#{o.partition}
                        </td>
                        <td style={{ padding: "2px 4px", textAlign: "right" }}>
                          {o.committed}
                        </td>
                        <td style={{ padding: "2px 4px", textAlign: "right" }}>
                          {o.high_watermark}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                            color: o.lag > 0 ? "var(--red)" : "var(--green)",
                          }}
                        >
                          {o.lag}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

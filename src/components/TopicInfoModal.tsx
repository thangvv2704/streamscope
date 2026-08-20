import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { StreamDetail } from "../api/types";

// Shows a topic's partitions (with watermarks) and its dynamic configuration —
// the "describe" experience, fetched live via AdminClient.
export function TopicInfoModal(props: {
  connId: string;
  stream: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<StreamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configFilter, setConfigFilter] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const saveConfig = async () => {
    const entries = Object.entries(edits);
    if (entries.length === 0) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await api.setStreamConfig(
        props.connId,
        props.stream,
        entries as [string, string][]
      );
      setSaveMsg("Saved ✓");
      setEdits({});
      // Refresh to show applied values.
      const d = await api.describeStream(props.connId, props.stream);
      setDetail(d);
    } catch (e) {
      setSaveMsg(`${e}`);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    let alive = true;
    api
      .describeStream(props.connId, props.stream)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(`${e}`));
    return () => {
      alive = false;
    };
  }, [props.connId, props.stream]);

  const configs = (detail?.config ?? []).filter(([k]) =>
    k.toLowerCase().includes(configFilter.trim().toLowerCase())
  );

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal"
        style={{ width: 640, maxHeight: "80vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>
          Topic{" "}
          <span style={{ fontFamily: "var(--mono)", color: "var(--accent)" }}>
            {props.stream}
          </span>
        </h3>

        {error && (
          <div style={{ color: "var(--red)", fontSize: 12 }}>{error}</div>
        )}
        {!detail && !error && <div className="spin">Loading…</div>}

        {detail && (
          <>
            <div className="section-label" style={{ paddingLeft: 0 }}>
              Partitions ({detail.partitions.length})
            </div>
            <table
              className="msg-table"
              style={{ marginBottom: 14, fontSize: 11 }}
            >
              <thead>
                <tr>
                  <th className="col-num">P</th>
                  <th className="col-num">Leader</th>
                  <th className="col-num">Low</th>
                  <th className="col-num">High</th>
                  <th className="col-num">Msgs</th>
                  <th>Replicas</th>
                </tr>
              </thead>
              <tbody>
                {detail.partitions.map((p) => (
                  <tr key={p.id}>
                    <td className="col-num">{p.id}</td>
                    <td className="col-num">{p.leader}</td>
                    <td className="col-num">{p.low_watermark}</td>
                    <td className="col-num">{p.high_watermark}</td>
                    <td className="col-num">
                      {Math.max(0, p.high_watermark - p.low_watermark)}
                    </td>
                    <td>{p.replicas.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div className="section-label" style={{ paddingLeft: 0 }}>
                Configuration ({detail.config.length})
              </div>
              <input
                placeholder="Filter config…"
                value={configFilter}
                onChange={(e) => setConfigFilter(e.target.value)}
                style={{ width: 180 }}
              />
            </div>
            {detail.config.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
                No configuration returned (broker may restrict describe_configs).
              </div>
            ) : (
              <table className="msg-table" style={{ fontSize: 11 }}>
                <tbody>
                  {configs.map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ color: "var(--text-dim)", width: "45%" }}>
                        {k}
                      </td>
                      <td>
                        <input
                          value={edits[k] ?? v}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [k]: e.target.value,
                            }))
                          }
                          style={{
                            height: 26,
                            fontFamily: "var(--mono)",
                            fontSize: 11,
                            borderColor:
                              edits[k] != null && edits[k] !== v
                                ? "var(--accent)"
                                : undefined,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        <div className="modal-actions">
          {saveMsg && (
            <span
              style={{
                fontSize: 12,
                color: saveMsg.startsWith("Saved")
                  ? "var(--green)"
                  : "var(--red)",
                marginRight: "auto",
              }}
            >
              {saveMsg}
            </span>
          )}
          <button onClick={props.onClose}>Close</button>
          <button
            className="primary"
            onClick={saveConfig}
            disabled={saving || Object.keys(edits).length === 0}
          >
            {saving ? "Saving…" : "Save config"}
          </button>
        </div>
      </div>
    </div>
  );
}

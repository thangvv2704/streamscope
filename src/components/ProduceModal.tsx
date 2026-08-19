import { useState } from "react";
import type { OutgoingMessage } from "../api/types";
import {
  RANDOM_KINDS,
  RandomKind,
  expandPlaceholders,
  randomValue,
} from "../api/random";
import {
  MessageTemplate,
  deleteTemplate,
  loadTemplates,
  saveTemplate,
} from "../api/templates";
import { TrashIcon } from "./Icons";

type HeaderRow = { key: string; value: string };

// Produce a message. Doubles as "Reproduce/Replay" when given a prefill from an
// existing message. Headers are fully editable, and each row can be filled with
// a random value (UUID / timestamp / number / string). Placeholders like
// {{uuid}} in any field are expanded to fresh random values on send.
export function ProduceModal(props: {
  stream: string;
  prefill?: OutgoingMessage;
  onSend: (msg: OutgoingMessage) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState(props.prefill?.key ?? "");
  const [value, setValue] = useState(props.prefill?.value ?? "");
  const [headers, setHeaders] = useState<HeaderRow[]>(
    (props.prefill?.headers ?? []).map(([k, v]) => ({ key: k, value: v }))
  );
  const [templates, setTemplates] = useState<MessageTemplate[]>(loadTemplates);
  const [selectedTpl, setSelectedTpl] = useState("");
  const [savingName, setSavingName] = useState<string | null>(null); // null = not saving
  const isReplay = props.prefill != null;

  // Apply a saved template into the form.
  const applyTemplate = (id: string) => {
    setSelectedTpl(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setKey(t.key);
    setValue(t.value);
    setHeaders(t.headers.map(([k, v]) => ({ key: k, value: v })));
  };

  const confirmSaveTemplate = () => {
    const name = (savingName ?? "").trim();
    if (!name) return;
    const created = saveTemplate({
      name,
      key,
      value,
      headers: headers
        .filter((h) => h.key.trim() !== "")
        .map((h) => [h.key, h.value]) as [string, string][],
    });
    setTemplates(loadTemplates());
    setSelectedTpl(created.id);
    setSavingName(null);
  };

  const prettifyJson = () => {
    try {
      setValue(JSON.stringify(JSON.parse(value), null, 2));
    } catch {
      // not JSON, leave as-is
    }
  };

  const setHeader = (i: number, patch: Partial<HeaderRow>) => {
    setHeaders((prev) =>
      prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h))
    );
  };
  const addHeader = () =>
    setHeaders((prev) => [...prev, { key: "", value: "" }]);
  const removeHeader = (i: number) =>
    setHeaders((prev) => prev.filter((_, idx) => idx !== i));

  const send = () => {
    // Expand {{...}} placeholders in every field, fresh per send.
    const msg: OutgoingMessage = {
      key: key.trim() ? expandPlaceholders(key) : null,
      value: expandPlaceholders(value),
      partition: null, // let Kafka assign the partition
      headers: headers
        .filter((h) => h.key.trim() !== "")
        .map((h) => [
          expandPlaceholders(h.key),
          expandPlaceholders(h.value),
        ]) as [string, string][],
    };
    props.onSend(msg);
  };

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div
        className="modal"
        style={{ width: 620, maxHeight: "85vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>
          {isReplay ? "Replay message → " : "Produce to "}
          <span style={{ fontFamily: "var(--mono)", color: "var(--accent)" }}>
            {props.stream}
          </span>
        </h3>

        {/* Template bar */}
        <div className="field">
          <label>Templates</label>
          {savingName === null ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select
                value={selectedTpl}
                onChange={(e) => applyTemplate(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">
                  {templates.length === 0
                    ? "No saved templates"
                    : "Load a template…"}
                </option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {selectedTpl && (
                <button
                  className="icon-btn"
                  title="Delete this template"
                  onClick={() => {
                    setTemplates(deleteTemplate(selectedTpl));
                    setSelectedTpl("");
                  }}
                >
                  <TrashIcon size={14} />
                </button>
              )}
              <button
                onClick={() => setSavingName("")}
                title="Save current as template"
              >
                Save as template
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                autoFocus
                placeholder="Template name…"
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmSaveTemplate();
                  if (e.key === "Escape") setSavingName(null);
                }}
                style={{ flex: 1 }}
              />
              <button onClick={() => setSavingName(null)}>Cancel</button>
              <button
                className="primary"
                onClick={confirmSaveTemplate}
                disabled={!savingName.trim()}
              >
                Save
              </button>
            </div>
          )}
        </div>

        {!isReplay && (
          <div className="field">
            <label>Key</label>
            <input value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
        )}

        <div className="field">
          <label style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Value</span>
            <span
              onClick={prettifyJson}
              style={{ cursor: "pointer", color: "var(--accent)" }}
            >
              Format JSON
            </span>
          </label>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={9}
            style={{ fontFamily: "var(--mono)", resize: "vertical" }}
          />
        </div>

        {/* Header editor */}
        <div className="field">
          <label
            style={{ display: "flex", justifyContent: "space-between" }}
          >
            <span>Headers</span>
            <span
              onClick={addHeader}
              style={{ cursor: "pointer", color: "var(--accent)" }}
            >
              + Add header
            </span>
          </label>

          {headers.length === 0 && (
            <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
              No headers. Click "Add header".
            </div>
          )}

          {headers.map((h, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 6,
                marginBottom: 6,
                alignItems: "center",
              }}
            >
              <input
                placeholder="key"
                value={h.key}
                onChange={(e) => setHeader(i, { key: e.target.value })}
                style={{ flex: 1 }}
              />
              <input
                placeholder="value (supports {{uuid}}, {{timestamp}}…)"
                value={h.value}
                onChange={(e) => setHeader(i, { value: e.target.value })}
                style={{ flex: 2, fontFamily: "var(--mono)" }}
              />
              {/* Fill this row's value with a random value of the chosen kind */}
              <select
                title="Fill value with a random value"
                value=""
                onChange={(e) => {
                  const kind = e.target.value as RandomKind;
                  if (kind) setHeader(i, { value: randomValue(kind) });
                }}
                style={{ width: "auto" }}
              >
                <option value="">rand…</option>
                {RANDOM_KINDS.map((r) => (
                  <option key={r.kind} value={r.kind}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                title="Remove header"
                onClick={() => removeHeader(i)}
                style={{ padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>
          ))}

          <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 4 }}>
            Tip: type <code>{"{{uuid}}"}</code>, <code>{"{{timestamp}}"}</code>,{" "}
            <code>{"{{iso}}"}</code>, <code>{"{{number}}"}</code>, or{" "}
            <code>{"{{string}}"}</code> in any field — each is replaced with a
            fresh random value when you send.
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={props.onCancel}>Cancel</button>
          <button className="primary" onClick={send} disabled={!value}>
            {isReplay ? "Replay" : "Produce"}
          </button>
        </div>
      </div>
    </div>
  );
}

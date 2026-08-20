import { useState } from "react";
import { api } from "../api/client";
import { friendlyError } from "../api/errors";
import type { ConnectionConfig, Protocol } from "../api/types";

// Form to create OR edit a connection profile. When `initial` is provided the
// form is prefilled and keeps the same id (edit mode). Kafka is fully wired;
// other protocols appear (disabled) to signal the multi-protocol roadmap.
export function ConnectionModal(props: {
  initial?: ConnectionConfig;
  onSave: (cfg: ConnectionConfig) => void;
  onCancel: () => void;
}) {
  const init = props.initial;
  const isEdit = init != null;

  const [name, setName] = useState(init?.name ?? "Local Kafka");
  const [protocol, setProtocol] = useState<Protocol>(init?.protocol ?? "kafka");
  const [bootstrap, setBootstrap] = useState(init?.bootstrap ?? "localhost:9092");
  const [schemaUrl, setSchemaUrl] = useState(init?.schema_registry_url ?? "");
  const [useSsl, setUseSsl] = useState(init?.use_ssl ?? false);
  const [saslMech, setSaslMech] = useState(init?.sasl_mechanism ?? "");
  const [saslUser, setSaslUser] = useState(init?.sasl_username ?? "");
  const [saslPass, setSaslPass] = useState(init?.sasl_password ?? "");
  const [showAuth, setShowAuth] = useState(
    !!(init?.sasl_mechanism || init?.use_ssl)
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const buildCfg = (): ConnectionConfig => ({
    id: init?.id ?? crypto.randomUUID(),
    name: name.trim() || "Untitled",
    protocol,
    bootstrap: bootstrap.trim(),
    use_ssl: useSsl,
    schema_registry_url: schemaUrl.trim() || null,
    sasl_mechanism: saslMech.trim() || null,
    sasl_username: saslUser.trim() || null,
    sasl_password: saslPass || null,
    extra: init?.extra ?? {},
  });

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const info = await api.testConnection(buildCfg());
      setTestResult({ ok: true, text: `Connected · ${info.detail}` });
    } catch (e) {
      setTestResult({ ok: false, text: friendlyError(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = () => props.onSave(buildCfg());

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? "Edit connection" : "New connection"}</h3>

        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field">
          <label>Protocol</label>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as Protocol)}
          >
            <option value="kafka">Kafka</option>
            <option value="redis">Redis</option>
            <option value="rabbitmq" disabled>
              RabbitMQ (coming soon)
            </option>
            <option value="nats" disabled>
              NATS (coming soon)
            </option>
          </select>
        </div>

        <div className="field">
          <label>
            {protocol === "redis" ? "Host" : "Bootstrap servers"}
          </label>
          <input
            value={bootstrap}
            onChange={(e) => setBootstrap(e.target.value)}
            placeholder={
              protocol === "redis"
                ? "localhost:6379"
                : "host:9092,host2:9092"
            }
          />
        </div>

        <div className="field">
          <label>Schema Registry URL (optional)</label>
          <input
            value={schemaUrl}
            onChange={(e) => setSchemaUrl(e.target.value)}
            placeholder="http://localhost:8081 — decodes Avro/JSON"
          />
        </div>

        <div className="field">
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={showAuth}
              onChange={(e) => setShowAuth(e.target.checked)}
            />
            Use authentication (SASL / SSL)
          </label>
        </div>

        {showAuth && (
          <>
            <div className="field">
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={useSsl}
                  onChange={(e) => setUseSsl(e.target.checked)}
                />
                SSL / TLS
              </label>
            </div>
            <div className="field">
              <label>SASL mechanism</label>
              <select
                value={saslMech}
                onChange={(e) => setSaslMech(e.target.value)}
              >
                <option value="">None</option>
                <option value="PLAIN">PLAIN</option>
                <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                <option value="SCRAM-SHA-512">SCRAM-SHA-512</option>
              </select>
            </div>
            <div className="field-row">
              <div className="field" style={{ flex: 1 }}>
                <label>Username</label>
                <input
                  value={saslUser}
                  onChange={(e) => setSaslUser(e.target.value)}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Password</label>
                <input
                  type="password"
                  value={saslPass}
                  onChange={(e) => setSaslPass(e.target.value)}
                />
              </div>
            </div>
          </>
        )}

        {testResult && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              borderRadius: 6,
              fontSize: 12,
              background: testResult.ok
                ? "color-mix(in srgb, var(--green) 14%, transparent)"
                : "color-mix(in srgb, var(--red) 14%, transparent)",
              border: testResult.ok
                ? "1px solid color-mix(in srgb, var(--green) 35%, transparent)"
                : "1px solid color-mix(in srgb, var(--red) 35%, transparent)",
              color: testResult.ok ? "var(--green)" : "var(--red)",
              wordBreak: "break-word",
            }}
          >
            {testResult.ok ? "✓ " : "✗ "}
            {testResult.text}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={props.onCancel}>Cancel</button>
          <button onClick={test} disabled={testing || !bootstrap.trim()}>
            {testing ? "Testing…" : "Test"}
          </button>
          <button className="primary" onClick={save}>
            {isEdit ? "Save changes" : "Save & Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

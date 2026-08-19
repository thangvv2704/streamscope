import { useEffect, useRef, useState } from "react";

export interface LogEntry {
  id: number;
  time: string; // HH:MM:SS
  text: string;
  level: "info" | "ok" | "warn" | "err";
}

// A terminal-style connection health log that fills the lower-left area.
// Autoscrolls to the newest entry unless the user turns autoscroll off.
export function HealthLog(props: {
  entries: LogEntry[];
  onClear: () => void;
}) {
  const [autoscroll, setAutoscroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoscroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [props.entries, autoscroll]);

  return (
    <div className="health">
      <div className="health-header">
        <span>Health Log</span>
        <div className="spacer" />
        <button
          className="icon-btn"
          title="Clear log"
          onClick={props.onClear}
          style={{ width: 24, height: 24 }}
        >
          ⌫
        </button>
      </div>

      <div className="health-scroll" ref={scrollRef}>
        {props.entries.length === 0 ? (
          <div className="health-empty">No activity yet.</div>
        ) : (
          props.entries.map((e) => (
            <div className={`health-line ${e.level}`} key={e.id}>
              <span className="health-time">{e.time}</span>
              <span className="health-text">{e.text}</span>
            </div>
          ))
        )}
      </div>

      <label className="health-foot">
        <input
          type="checkbox"
          checked={autoscroll}
          onChange={(e) => setAutoscroll(e.target.checked)}
        />
        Autoscroll
      </label>
    </div>
  );
}

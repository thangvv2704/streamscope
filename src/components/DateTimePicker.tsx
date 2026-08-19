import { useEffect, useRef, useState } from "react";

// A fully theme-able date + time picker that replaces the native
// <input type="datetime-local"> (whose calendar popup is drawn by the browser
// and cannot be styled). Value is the datetime-local string "YYYY-MM-DDTHH:mm".

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function toStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
function parse(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function fmtDisplay(v: string): string {
  const d = parse(v);
  if (!d) return "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function DateTimePicker(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const base = parse(props.value) ?? new Date();
  const [viewY, setViewY] = useState(base.getFullYear());
  const [viewM, setViewM] = useState(base.getMonth());

  useEffect(() => {
    if (!open || !rootRef.current) return;
    const r = rootRef.current.getBoundingClientRect();
    const H = 320;
    const flip = r.bottom + H > window.innerHeight - 8;
    setPos({
      left: Math.min(r.left, window.innerWidth - 268),
      top: flip ? Math.max(8, r.top - H - 4) : r.bottom + 4,
    });
    const cur = parse(props.value) ?? new Date();
    setViewY(cur.getFullYear());
    setViewM(cur.getMonth());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        rootRef.current?.contains(e.target as Node) ||
        popRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sel = parse(props.value);
  const hh = sel ? sel.getHours() : 0;
  const mm = sel ? sel.getMinutes() : 0;

  // Build the calendar grid (Monday-first).
  const first = new Date(viewY, viewM, 1);
  const startDow = (first.getDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const today = new Date();
  const isToday = (d: number) =>
    d === today.getDate() &&
    viewM === today.getMonth() &&
    viewY === today.getFullYear();
  const isSel = (d: number) =>
    sel != null &&
    d === sel.getDate() &&
    viewM === sel.getMonth() &&
    viewY === sel.getFullYear();

  const pickDay = (d: number) => {
    const next = new Date(viewY, viewM, d, hh, mm);
    props.onChange(toStr(next));
  };
  const setTime = (h: number, m: number) => {
    const day = sel ?? new Date(viewY, viewM, today.getDate());
    const next = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      h,
      m
    );
    props.onChange(toStr(next));
  };
  const prevMonth = () => {
    if (viewM === 0) {
      setViewM(11);
      setViewY((y) => y - 1);
    } else setViewM((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewM === 11) {
      setViewM(0);
      setViewY((y) => y + 1);
    } else setViewM((m) => m + 1);
  };

  return (
    <div className="dtp" ref={rootRef}>
      <button
        type="button"
        className={`dtp-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={props.value ? "" : "dtp-ph"}>
          {props.value ? fmtDisplay(props.value) : props.placeholder ?? "Pick…"}
        </span>
      </button>

      {open && pos && (
        <div
          ref={popRef}
          className="dtp-pop"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="dtp-head">
            <button type="button" className="dtp-nav" onClick={prevMonth}>
              ‹
            </button>
            <span className="dtp-title">
              {MONTHS[viewM]} {viewY}
            </span>
            <button type="button" className="dtp-nav" onClick={nextMonth}>
              ›
            </button>
          </div>

          <div className="dtp-grid dtp-dow">
            {DOW.map((d) => (
              <span key={d} className="dtp-dowcell">
                {d}
              </span>
            ))}
          </div>
          <div className="dtp-grid">
            {cells.map((d, i) =>
              d == null ? (
                <span key={i} />
              ) : (
                <button
                  type="button"
                  key={i}
                  className={`dtp-day ${isSel(d) ? "sel" : ""} ${
                    isToday(d) ? "today" : ""
                  }`}
                  onClick={() => pickDay(d)}
                >
                  {d}
                </button>
              )
            )}
          </div>

          <div className="dtp-time">
            <span>Time</span>
            <input
              type="number"
              min={0}
              max={23}
              value={pad(hh)}
              onChange={(e) =>
                setTime(Math.min(23, Math.max(0, Number(e.target.value))), mm)
              }
            />
            <b>:</b>
            <input
              type="number"
              min={0}
              max={59}
              value={pad(mm)}
              onChange={(e) =>
                setTime(hh, Math.min(59, Math.max(0, Number(e.target.value))))
              }
            />
            <div className="spacer" />
            <button
              type="button"
              className="dtp-now"
              onClick={() => {
                props.onChange(toStr(new Date()));
                setOpen(false);
              }}
            >
              Now
            </button>
            <button
              type="button"
              className="primary dtp-done"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

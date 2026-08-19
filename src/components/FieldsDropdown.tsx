import { useEffect, useRef, useState } from "react";

export interface FieldOption {
  key: string;
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}

// A dropdown that hides multiple checkbox options behind a compact trigger.
// The trigger summarises the current selection (e.g. "All fields", "Key, Value").
export function FieldsDropdown(props: {
  label?: string;
  options: FieldOption[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; w: number } | null>(
    null
  );

  const checked = props.options.filter((o) => o.checked);
  const summary =
    checked.length === 0
      ? "None"
      : checked.length === props.options.length
      ? "All fields"
      : checked.map((o) => o.label).join(", ");

  useEffect(() => {
    if (!open || !rootRef.current) return;
    const r = rootRef.current.getBoundingClientRect();
    const H = props.options.length * 36 + 10;
    const flip = r.bottom + H > window.innerHeight - 8;
    setPos({
      left: r.left,
      top: flip ? r.top - H - 4 : r.bottom + 4,
      w: r.width,
    });
  }, [open, props.options.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        rootRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", () => setOpen(false), true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", () => setOpen(false), true);
    };
  }, [open]);

  return (
    <div className="select" ref={rootRef}>
      <button
        type="button"
        className={`select-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Choose which fields the filter matches"
      >
        <span className="select-value">{summary}</span>
        <svg
          className="select-caret"
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      {open && pos && (
        <div
          ref={menuRef}
          className="select-menu"
          style={{ left: pos.left, top: pos.top, minWidth: pos.w }}
        >
          {props.options.map((o) => (
            <label key={o.key} className="fd-option">
              <input
                type="checkbox"
                checked={o.checked}
                onChange={(e) => o.onToggle(e.target.checked)}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

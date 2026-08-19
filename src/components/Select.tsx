import { useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

// A fully theme-able dropdown that replaces native <select> (whose popup menu
// is drawn by the OS and can't be styled). Renders its own menu, positioned
// under the trigger, closing on outside click / Escape.
export function Select(props: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  minWidth?: number;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number;
    width: number;
    flip: boolean;
  } | null>(null);

  const current =
    props.options.find((o) => o.value === props.value) ?? props.options[0];

  // Position the menu under the trigger (fixed, so it escapes overflow clips).
  useEffect(() => {
    if (!open || !rootRef.current) return;
    const r = rootRef.current.getBoundingClientRect();
    const menuH = Math.min(props.options.length * 34 + 8, 280);
    const flip = r.bottom + menuH > window.innerHeight - 8;
    setMenuPos({
      left: r.left,
      top: flip ? r.top - menuH - 4 : r.bottom + 4,
      width: Math.max(r.width, props.minWidth ?? 0),
      flip,
    });
  }, [open, props.options.length, props.minWidth]);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
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
    <div
      className="select"
      ref={rootRef}
      style={{ minWidth: props.minWidth }}
    >
      <button
        type="button"
        className={`select-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={props.ariaLabel}
      >
        <span className="select-value">{current?.label ?? ""}</span>
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

      {open && menuPos && (
        <div
          ref={menuRef}
          className="select-menu"
          style={{
            left: menuPos.left,
            top: menuPos.top,
            minWidth: menuPos.width,
          }}
        >
          {props.options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`select-option ${
                o.value === props.value ? "selected" : ""
              }`}
              onClick={() => {
                props.onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="select-check">
                {o.value === props.value ? "✓" : ""}
              </span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

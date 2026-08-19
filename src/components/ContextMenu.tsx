import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}

// A lightweight custom context menu. Positions at the cursor, flips to stay on
// screen, and closes on outside click / Escape / scroll.
export function ContextMenu(props: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: props.x, y: props.y });

  // Keep the menu within the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let x = props.x;
    let y = props.y;
    if (x + rect.width > window.innerWidth - 8)
      x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight - 8)
      y = window.innerHeight - rect.height - 8;
    setPos({ x, y });
  }, [props.x, props.y]);

  useEffect(() => {
    const close = () => props.onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [props]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.items.map((it, i) => (
        <div key={i}>
          {it.separatorBefore && <div className="ctx-sep" />}
          <button
            className={`ctx-item ${it.danger ? "danger" : ""}`}
            onClick={() => {
              it.onClick();
              props.onClose();
            }}
          >
            {it.icon && <span className="ctx-ico">{it.icon}</span>}
            {it.label}
          </button>
        </div>
      ))}
    </div>
  );
}

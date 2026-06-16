import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "../../hooks/useAnchoredPosition";

interface TooltipProps {
  /** Hover/focus hint. Falsy renders the child untouched (no wrapper). */
  content: ReactNode;
  /** Single focusable element; gets aria-describedby while the tip is open. */
  children: ReactElement;
  placement?: "top" | "bottom";
  /** Hover dwell before showing; shorter than native title's ~1s. */
  delayMs?: number;
  /** Extra classes for the inline-flex wrapper (e.g. self-start in a column). */
  className?: string;
}

/**
 * Hover/focus tooltip that replaces native `title`. Listeners sit on a wrapper
 * span so a `disabled` child still triggers it (disabled controls swallow their
 * own events). Portaled to body with fixed coords so the scrollable properties
 * panel can't clip it; repositions on scroll/resize.
 */
export function Tooltip({ content, children, placement = "top", delayMs = 120, className }: TooltipProps) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef(0);
  const [open, setOpen] = useState(false);
  const pos = useAnchoredPosition(wrapRef, open, (r) => ({
    top: placement === "top" ? r.top - 6 : r.bottom + 6,
    left: r.left + r.width / 2,
  }));

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  if (!content || !isValidElement(children)) return children;

  // Hover dwells to avoid flicker on pass-through; focus shows at once so a
  // keyboard tab-through gets the aria-describedby hint announced.
  const showAfterDelay = () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), delayMs);
  };
  const showNow = () => {
    window.clearTimeout(timerRef.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(timerRef.current);
    setOpen(false);
  };

  const trigger = cloneElement(
    children as ReactElement<{ "aria-describedby"?: string }>,
    { "aria-describedby": open ? id : undefined },
  );

  return (
    <span
      ref={wrapRef}
      className={className ? `inline-flex ${className}` : "inline-flex"}
      onPointerEnter={showAfterDelay}
      onPointerLeave={hide}
      onFocus={showNow}
      onBlur={hide}
    >
      {trigger}
      {open && pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="fixed z-[60] px-2 py-1 rounded bg-surface border border-border text-[10px] font-mono text-text shadow-lg pointer-events-none max-w-64 whitespace-normal"
            style={{
              top: pos.top,
              left: pos.left,
              transform: placement === "top" ? "translate(-50%, -100%)" : "translateX(-50%)",
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

/** Either `labelledBy` (preferred — id of the title element) or
 *  `describedBy` (id of the body element, for dialogs with no title)
 *  must be supplied. The discriminated union compiles in the rule so
 *  a Dialog without an accessible name is a TS error, not a runtime
 *  a11y bug. The other field stays optional. */
type Labelling =
  | { labelledBy: string; describedBy?: string }
  | { describedBy: string; labelledBy?: string };

type Props = Labelling & {
  onClose: () => void;
  role?: 'dialog' | 'alertdialog';
  /** Render via portal to document.body. Use when an ancestor has a
   *  CSS transform that would otherwise contain `position: fixed`. */
  portal?: boolean;
  /** Tailwind classes for the inner dialog box (background, border,
   *  width, etc.). Each modal supplies its own — visual variants stay
   *  intentional. */
  boxClassName: string;
  children: ReactNode;
};

/** Modal shell: backdrop + dialog box with focus trap, body scroll
 *  lock, ARIA dialog semantics, and Escape / click-outside close.
 *
 *  Backdrop close fires only when both press and release happen on the
 *  backdrop itself — prevents accidental close when dragging text out
 *  of an input or releasing a selection over the backdrop. */
export function DialogShell(props: Props) {
  const {
    onClose,
    labelledBy,
    describedBy,
    role = 'dialog',
    portal = false,
    boxClassName,
    children,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, onClose);
  useBodyScrollLock();

  const node = (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role={role}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      <div className={boxClassName}>{children}</div>
    </div>
  );

  return portal ? createPortal(node, document.body) : node;
}

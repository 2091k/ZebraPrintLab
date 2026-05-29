import type { ReactNode } from "react";
import { labelCls } from "../Properties/styles";

/** Shared muted-monospace class for ZPL command tags so the visual
 *  weight stays identical across the label-row, checkbox-row and
 *  any future field primitives that dock a tag rightwards. */
const commandTagCls = "font-mono text-[10px] text-muted/60 tracking-tight";

/** Field label with a ghost-rendered ZPL command tag docked right.
 *  The distinctive design move of the printer-settings modal: users
 *  see exactly which command each control emits, turning the modal
 *  into a discoverable spec reference without crowding the form.
 *  Density matches the Properties Panel's `labelCls`. */
export function ZplCommandLabel({
  text,
  command,
  htmlFor,
}: {
  text: string;
  command: string;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className={labelCls}>
        {text}
      </label>
      <span className={commandTagCls}>{command}</span>
    </div>
  );
}

/** Checkbox row with the same ZPL-command-docked-right treatment as
 *  `ZplCommandLabel`. The command tag sits outside the `<label>` so
 *  clicking it does not toggle the checkbox; the user can still read
 *  the spec hint without changing state. */
export function ZplCheckbox({
  text,
  command,
  checked,
  onChange,
}: {
  text: string;
  command: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="accent-accent"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="text-xs text-text">{text}</span>
      </label>
      <span className={commandTagCls}>{command}</span>
    </div>
  );
}

/** Wrapper for a field row to give it consistent vertical spacing.
 *  Children are the label (via ZplCommandLabel) and the control. */
export function ZplField({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

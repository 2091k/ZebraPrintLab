import { clampMin } from '../../lib/inputParse';
import { inputCls, labelCls } from './styles';

interface NumberInputProps {
  label: string;
  value: number;
  /** When set, the change handler receives a value clamped to at least `min`,
   *  guarding against the empty/0 input collapse that bare Number() invites. */
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  readOnly?: boolean;
}

/**
 * Standard label + number input pair used by registry properties panels.
 * Centralises the layout, the labelCls/inputCls coupling, and the
 * empty-or-NaN-to-min sanitisation so individual registries don't repeat
 * the boilerplate.
 */
export function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  readOnly,
}: NumberInputProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className={labelCls}>{label}</label>
      <input
        type="number"
        className={inputCls}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(e) => {
          const raw = e.target.value;
          let next = min !== undefined ? clampMin(raw, min) : Number(raw);
          // Drop NaN before it corrupts the store. clampMin already returns
          // `min` for unparsable input, so this only matters when `min` is
          // undefined and the user pastes a non-numeric string.
          if (isNaN(next)) return;
          if (max !== undefined && next > max) next = max;
          onChange(next);
        }}
      />
    </div>
  );
}

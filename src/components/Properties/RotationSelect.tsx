import { ZPL_ROTATIONS, type ZplRotation } from '../../registry/rotation';
import { useT } from '../../lib/useT';
import { FieldLabel } from './ZplCmd';
import { Select } from '../ui/Select';

interface Props {
  value: ZplRotation;
  onChange: (next: ZplRotation) => void;
  /** Optional ZPL command this field emits; shown when showZplCommands is on. */
  zplCmd?: string;
}

export function RotationSelect({ value, onChange, zplCmd }: Props) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel cmd={zplCmd}>{t.registry.text.rotation}</FieldLabel>
      <Select<ZplRotation>
        value={value}
        onChange={onChange}
        aria-label={t.registry.text.rotation}
        groups={[{ options: ZPL_ROTATIONS.map((r) => ({ value: r, label: t.registry.text[`rotation${r}`] })) }]}
      />
    </div>
  );
}

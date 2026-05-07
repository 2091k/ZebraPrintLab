import type { ObjectTypeDefinition } from '../types/ObjectType';
import { useT } from '../lib/useT';
import { inputCls, labelCls } from '../components/Properties/styles';
import { fieldPos, fdField } from './zplHelpers';
import { commitHeightTransform } from './transformHelpers';
import { filterContent, type ContentSpec } from './contentSpec';
import { type ZplRotation } from './rotation';
import { RotationSelect } from '../components/Properties/RotationSelect';
import { NumberInput } from '../components/Properties/NumberInput';

const ean13Spec: ContentSpec = { charset: '0-9', maxLength: 12 };

export interface Ean13Props {
  content: string;        // 12 digits — ZPL appends the check digit automatically
  height: number;
  moduleWidth: number;
  printInterpretation: boolean;
  rotation: ZplRotation;
}

export const ean13: ObjectTypeDefinition<Ean13Props> = {
  label: 'EAN-13',
  icon: 'EAN',
  group: 'code-1d',
  defaultProps: {
    content: '590123412345',
    height: 100,
    moduleWidth: 2,
    printInterpretation: true,
    rotation: 'N',
  },
  defaultSize: { width: 300, height: 120 },

  commitTransform: commitHeightTransform,

  toZPL: (obj) => {
    const p = obj.props;
    const interp = p.printInterpretation ? 'Y' : 'N';
    return [
      `^BY${p.moduleWidth}`,
      fieldPos(obj),
      `^BE${p.rotation},${p.height},${interp},N`,
      fdField(p.content),
    ].filter(Boolean).join('');
  },

  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>{t.registry.ean13.content}</label>
          <input
            className={inputCls}
            value={p.content}
            maxLength={12}
            placeholder={t.registry.ean13.placeholder}
            onChange={(e) => onChange({ content: filterContent(e.target.value, ean13Spec) })}
          />
        </div>

        <NumberInput
          label={t.registry.ean13.height}
          value={p.height}
          min={1}
          onChange={(height) => onChange({ height })}
        />

        <NumberInput
          label={t.registry.ean13.moduleWidth}
          value={p.moduleWidth}
          min={1}
          max={10}
          onChange={(moduleWidth) => onChange({ moduleWidth })}
        />

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="accent-accent"
            checked={p.printInterpretation}
            onChange={(e) => onChange({ printInterpretation: e.target.checked })}
          />
          <span className={labelCls}>{t.registry.ean13.printInterpretation}</span>
        </label>

        <RotationSelect value={p.rotation} onChange={(rotation) => onChange({ rotation })} />
      </div>
    );
  },
};

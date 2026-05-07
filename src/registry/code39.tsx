import type { ObjectTypeDefinition } from '../types/ObjectType';
import { useT } from '../lib/useT';
import { inputCls, labelCls } from '../components/Properties/styles';
import { fieldPos, fdField } from './zplHelpers';
import { commitHeightTransform } from './transformHelpers';
import { filterContent, type ContentSpec } from './contentSpec';
import { type ZplRotation } from './rotation';
import { RotationSelect } from '../components/Properties/RotationSelect';
import { NumberInput } from '../components/Properties/NumberInput';

const code39Spec: ContentSpec = { charset: '0-9A-Za-z\\-. $/+%' };

export interface Code39Props {
  content: string;
  height: number;
  moduleWidth: number;
  printInterpretation: boolean;
  checkDigit: boolean;
  rotation: ZplRotation;
}

export const code39: ObjectTypeDefinition<Code39Props> = {
  label: 'Code 39',
  icon: '|·|',
  group: 'code-1d',
  defaultProps: {
    content: 'CODE39',
    height: 100,
    moduleWidth: 2,
    printInterpretation: true,
    checkDigit: false,
    rotation: 'N',
  },
  defaultSize: { width: 300, height: 120 },

  commitTransform: commitHeightTransform,

  toZPL: (obj) => {
    const p = obj.props;
    const interp = p.printInterpretation ? 'Y' : 'N';
    const check = p.checkDigit ? 'Y' : 'N';
    return [
      `^BY${p.moduleWidth}`,
      fieldPos(obj),
      `^B3${p.rotation},${check},${p.height},${interp},N`,
      fdField(p.content),
    ].filter(Boolean).join('');
  },

  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>{t.registry.code39.content}</label>
          <input
            className={inputCls}
            value={p.content}
            onChange={(e) => onChange({ content: filterContent(e.target.value, code39Spec) })}
          />
        </div>

        <NumberInput
          label={t.registry.code39.height}
          value={p.height}
          min={1}
          onChange={(height) => onChange({ height })}
        />

        <NumberInput
          label={t.registry.code39.moduleWidth}
          value={p.moduleWidth}
          min={1}
          max={10}
          onChange={(moduleWidth) => onChange({ moduleWidth })}
        />

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent"
              checked={p.printInterpretation}
              onChange={(e) => onChange({ printInterpretation: e.target.checked })}
            />
            <span className={labelCls}>{t.registry.code39.printInterpretation}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent"
              checked={p.checkDigit}
              onChange={(e) => onChange({ checkDigit: e.target.checked })}
            />
            <span className={labelCls}>{t.registry.code39.checkDigit}</span>
          </label>
        </div>

        <RotationSelect value={p.rotation} onChange={(rotation) => onChange({ rotation })} />
      </div>
    );
  },
};

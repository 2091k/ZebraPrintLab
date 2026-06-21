import type { ObjectTypeUi } from '../types/ObjectType';
import { useT } from '../lib/useT';
import { useLabelStore } from '../store/labelStore';
import { inputCls } from '../components/Properties/styles';
import { RotationSelect } from '../components/Properties/RotationSelect';
import { NumberInput } from '../components/Properties/NumberInput';
import { SectionCard, StaticSectionCard } from '../components/Properties/SectionCard';
import { FieldLabel } from '../components/Properties/ZplCmd';
import { Select } from '../components/ui/Select';
import { type QrCodeProps, MAGNIFICATION_MIN, MAGNIFICATION_MAX } from './qrcode';

export const qrcodePanel: ObjectTypeUi<QrCodeProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const openContentBuilder = useLabelStore((s) => s.openContentBuilder);
    const showZpl = useLabelStore((s) => s.showZplCommands);
    return (
      <>
        <StaticSectionCard title={t.properties.contentSection} cmd="^FD">
          {/* textarea, not input: typed content (vCard) carries real newlines. */}
          <textarea
            className={`${inputCls} resize-y min-h-9`}
            aria-label={t.registry.qrcode.content}
            value={p.content}
            onChange={(e) => onChange({ content: e.target.value })}
          />
          <button
            type="button"
            onClick={() => openContentBuilder(obj.id)}
            className="self-start text-xs px-2 py-1 rounded border border-border bg-surface-2 hover:bg-border transition-colors"
          >
            {t.contentBuilder.button}
          </button>
        </StaticSectionCard>

        <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
          <NumberInput
            label={t.registry.qrcode.magnification}
            value={p.magnification}
            min={MAGNIFICATION_MIN}
            max={MAGNIFICATION_MAX}
            onChange={(magnification) => onChange({ magnification })}
            zplCmd="^BQ"
          />

          <div className="flex flex-col gap-1">
            <FieldLabel cmd="^BQ">{t.registry.qrcode.errorCorrection}</FieldLabel>
            <Select<QrCodeProps['errorCorrection']>
              value={p.errorCorrection}
              onChange={(errorCorrection) => onChange({ errorCorrection })}
              aria-label={t.registry.qrcode.errorCorrection}
              groups={[{ options: [
                { value: 'L', label: t.registry.qrcode.ecL, badge: showZpl ? 'L' : undefined },
                { value: 'M', label: t.registry.qrcode.ecM, badge: showZpl ? 'M' : undefined },
                { value: 'Q', label: t.registry.qrcode.ecQ, badge: showZpl ? 'Q' : undefined },
                { value: 'H', label: t.registry.qrcode.ecH, badge: showZpl ? 'H' : undefined },
              ] }]}
            />
          </div>

          <RotationSelect value={p.rotation} onChange={(rotation) => onChange({ rotation })} zplCmd="^BQ" />
        </SectionCard>
      </>
    );
  },
};

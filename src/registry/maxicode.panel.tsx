import type { ObjectTypeUi } from "../types/ObjectType";
import { useT } from "../lib/useT";
import { inputCls } from "../components/Properties/styles";
import { validateMaxicodeBwip } from "../components/Canvas/bwipHelpers";
import { RotationSelect } from "../components/Properties/RotationSelect";
import { SectionCard, StaticSectionCard } from "../components/Properties/SectionCard";
import { FieldLabel } from "../components/Properties/ZplCmd";
import { Select } from "../components/ui/Select";
import { type MaxicodeProps, ALL_MODES } from "./maxicode";

export const maxicodePanel: ObjectTypeUi<MaxicodeProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const loc = t.registry.maxicode;
    // Resolve the diagnostic line beneath the mode dropdown. Hard
    // errors (bwip-js encoder rejections, mostly SCM-format issues
    // in mode 2/3) win over the soft mode-6 advisory.
    const error = validateMaxicodeBwip(p.content, p.mode);
    const advisory = p.mode === 6 ? loc.mode6Advisory : null;
    const diagnostic = error
      ? { text: error, className: "text-error font-mono" }
      : advisory
        ? { text: advisory, className: "text-muted" }
        : null;
    return (
      <>
        <StaticSectionCard title={t.properties.contentSection} cmd="^FD">
          <input
            className={inputCls}
            aria-label={loc.content}
            value={p.content}
            onChange={(e) => onChange({ content: e.target.value })}
          />
        </StaticSectionCard>

        <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
          <div className="flex flex-col gap-1">
            <FieldLabel cmd="^BV">{loc.mode}</FieldLabel>
            <Select<MaxicodeProps["mode"]>
              value={p.mode}
              onChange={(mode) => onChange({ mode })}
              aria-label={loc.mode}
              groups={[{ options: ALL_MODES.map((m) => ({ value: m, label: String(m) })) }]}
            />
            {diagnostic && (
              <p className={`text-[10px] leading-snug ${diagnostic.className}`}>
                {diagnostic.text}
              </p>
            )}
          </div>

          <RotationSelect value={p.rotation} onChange={(rotation) => onChange({ rotation })} zplCmd="^BV" />
        </SectionCard>
      </>
    );
  },
};

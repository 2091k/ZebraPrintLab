import { useId } from "react";
import { useT } from "../../lib/useT";
import { useLabelStore } from "../../store/labelStore";
import { inputCls, labelCls } from "../ui/formStyles";
import {
  CLOCK_FORMAT_VALUES,
  isClockFormat,
  type ClockFormat,
} from "../../types/ObjectType";
import {
  ZplCommandLabel,
  ZplEnumSelect,
  ZplField,
} from "./zplFieldPrimitives";

type LocClockTime = ReturnType<typeof useT>["printerSettings"]["clockTime"];

/** Explicit value → locale-key map. `satisfies` makes both a
 *  missing enum-value entry (here) and a missing locale key (in
 *  the locale shape) compile errors — the earlier template-literal
 *  helper used an `as`-cast that bypassed the second direction. */
const CLOCK_FORMAT_LABEL_KEYS = {
  '0': 'clockFormat0',
  '1': 'clockFormat1',
  '2': 'clockFormat2',
  '3': 'clockFormat3',
} as const satisfies Record<ClockFormat, keyof LocClockTime>;

/** Tab 3 of the Printer Settings Modal — clock/time setup commands.
 *  All three live in the Setup-Script output (EEPROM-persistent),
 *  not the per-label ZPL block. ^ST is modelled as a static user-
 *  typed value via HTML5 datetime-local, so generated scripts stay
 *  reproducible (no live now-snapshot on every copy/export). */
export function ClockAndTimeTab() {
  const t = useT();
  const label = useLabelStore((s) => s.label);
  const setLabelConfig = useLabelStore((s) => s.setLabelConfig);
  const loc = t.printerSettings.clockTime;
  const clockId = useId();

  return (
    <div className="flex flex-col gap-4">
      {/* ^ST: hand-rolled instead of going through a primitive, since
          datetime-local is the only such input in the modal and
          adding a primitive for one caller is YAGNI. */}
      <ZplField>
        <ZplCommandLabel text={loc.setRealtimeClock} command="^ST" htmlFor={clockId} />
        <input
          id={clockId}
          type="datetime-local"
          step="1"
          className={inputCls}
          value={label.setRealtimeClock ?? ""}
          onChange={(e) =>
            setLabelConfig({ setRealtimeClock: e.target.value || undefined })
          }
        />
        <span className={labelCls + " normal-case tracking-normal text-muted/70"}>
          {loc.setRealtimeClockHint}
        </span>
      </ZplField>

      <ZplEnumSelect
        label={loc.clockFormat}
        command="^KD"
        values={CLOCK_FORMAT_VALUES}
        isValid={isClockFormat}
        value={label.clockFormat}
        onChange={(v) => setLabelConfig({ clockFormat: v })}
        defaultLabel={t.printerSettings.defaultOption}
        optionLabel={(m) => loc[CLOCK_FORMAT_LABEL_KEYS[m]]}
      />
    </div>
  );
}

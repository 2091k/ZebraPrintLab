import { useId } from "react";
import { useT } from "../../lib/useT";
import { useLabelStore } from "../../store/labelStore";
import { inputCls, labelCls } from "../Properties/styles";
import {
  MEDIA_FEED_VALUES,
  MEDIA_TRACKING_VALUES,
  isMediaFeedMode,
  isMediaTracking,
  type MediaFeedMode,
  type MediaTracking,
} from "../../types/ObjectType";
import { ZplCheckbox, ZplCommandLabel, ZplField } from "./zplFieldPrimitives";

type LocMediaFeed = ReturnType<typeof useT>["printerSettings"]["mediaFeed"];

/** Static lookup table from enum value to the locale-key that
 *  describes it. Compile-time check via `satisfies` guarantees
 *  every enum value has a matching key and every key actually
 *  exists on the locale block, so a missing translation surfaces
 *  as a TS error rather than `undefined` at runtime. */
const TRACKING_LABEL_KEYS = {
  N: "mediaTrackingN",
  Y: "mediaTrackingY",
  W: "mediaTrackingW",
  M: "mediaTrackingM",
  A: "mediaTrackingA",
} as const satisfies Record<MediaTracking, keyof LocMediaFeed>;

const FEED_LABEL_KEYS = {
  F: "mediaFeedF",
  C: "mediaFeedC",
  L: "mediaFeedL",
  N: "mediaFeedN",
  S: "mediaFeedS",
} as const satisfies Record<MediaFeedMode, keyof LocMediaFeed>;

/** Width preset for short-number inputs in the modal (max printer
 *  ^ML value is ~32000 dots, so 5 digits cover every case). Same
 *  visual size that every numeric setting in the modal will reuse. */
const SHORT_NUMERIC_INPUT_WIDTH = "w-32";

/** Tab 1 of the Printer Settings Modal. All four fields write to
 *  the shared `labelConfig` store; the ZPL generator emits the
 *  corresponding ^MN / ^ML / ^MF / ^XB commands in the per-label
 *  header section. */
export function MediaFeedTab() {
  const t = useT();
  const label = useLabelStore((s) => s.label);
  const setLabelConfig = useLabelStore((s) => s.setLabelConfig);
  const loc = t.printerSettings.mediaFeed;
  const trackingId = useId();
  const lengthId = useId();

  return (
    <div className="flex flex-col gap-4">
      <ZplField>
        <ZplCommandLabel text={loc.mediaTracking} command="^MN" htmlFor={trackingId} />
        <select
          id={trackingId}
          className={inputCls}
          value={label.mediaTracking ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setLabelConfig({ mediaTracking: isMediaTracking(v) ? v : undefined });
          }}
        >
          <option value="">{t.printerSettings.defaultOption}</option>
          {MEDIA_TRACKING_VALUES.map((m) => (
            <option key={m} value={m}>
              {m} {loc[TRACKING_LABEL_KEYS[m]]}
            </option>
          ))}
        </select>
      </ZplField>

      <ZplField>
        <ZplCommandLabel text={loc.maxLabelLength} command="^ML" htmlFor={lengthId} />
        {/* Compact input plus unit suffix: a short number in a wide
            field reads as overengineered. The suffix fills the
            remaining row width semantically rather than leaving
            dead space. */}
        <div className="flex items-center gap-2">
          <div className={SHORT_NUMERIC_INPUT_WIDTH}>
            <input
              id={lengthId}
              type="number"
              className={inputCls}
              value={label.maxLabelLength ?? ""}
              min={1}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                setLabelConfig({
                  maxLabelLength: Number.isFinite(n) && n > 0 ? n : undefined,
                });
              }}
            />
          </div>
          <span className={labelCls}>{t.printerSettings.dotsUnit}</span>
        </div>
      </ZplField>

      {/* ^MF carries two positional params, so the row's "control"
          slot is a 2-col grid instead of a single input. Same field
          shape as the other commands (label + control), not an
          indented sub-section. The indent convention is reserved
          for checkbox-gated sub-settings (see FELDBLOCK), not for
          commands with multiple params. */}
      <ZplField>
        <ZplCommandLabel text={loc.mediaFeedHeading} command="^MF" />
        <div className="grid grid-cols-2 gap-2">
          <FeedSelect
            label={loc.mediaFeedPowerUp}
            value={label.mediaFeedPowerUp}
            onChange={(v) => setLabelConfig({ mediaFeedPowerUp: v })}
            placeholder={t.printerSettings.defaultOption}
            optionLabel={(m) => loc[FEED_LABEL_KEYS[m]]}
          />
          <FeedSelect
            label={loc.mediaFeedHeadClose}
            value={label.mediaFeedHeadClose}
            onChange={(v) => setLabelConfig({ mediaFeedHeadClose: v })}
            placeholder={t.printerSettings.defaultOption}
            optionLabel={(m) => loc[FEED_LABEL_KEYS[m]]}
          />
        </div>
      </ZplField>

      <ZplCheckbox
        text={loc.suppressBackfeed}
        command="^XB"
        checked={!!label.suppressBackfeed}
        onChange={(v) => setLabelConfig({ suppressBackfeed: v ? true : undefined })}
      />
    </div>
  );
}

interface FeedSelectProps {
  label: string;
  value: MediaFeedMode | undefined;
  onChange: (v: MediaFeedMode | undefined) => void;
  placeholder: string;
  optionLabel: (m: MediaFeedMode) => string;
}

/** Inner select-with-ZPL-label helper. Extracted so the two ^MF
 *  positional params don't repeat the same select scaffolding.
 *  Uses `useId` instead of caller-supplied IDs so multi-instance
 *  mounting can't collide. */
function FeedSelect({ label, value, onChange, placeholder, optionLabel }: FeedSelectProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      <select
        id={id}
        className={inputCls}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(isMediaFeedMode(v) ? v : undefined);
        }}
      >
        <option value="">{placeholder}</option>
        {MEDIA_FEED_VALUES.map((m) => (
          <option key={m} value={m}>
            {m} {optionLabel(m)}
          </option>
        ))}
      </select>
    </div>
  );
}

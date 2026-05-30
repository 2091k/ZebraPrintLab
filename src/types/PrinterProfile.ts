import { z } from 'zod';
import {
  CLOCK_FORMAT_VALUES,
  CLOCK_LANGUAGE_VALUES,
  CLOCK_MODE_VALUES,
  CLOCK_TOLERANCE_RANGE,
  HEAD_TEST_INTERVAL_RANGE,
  PRINTER_LOCALE_VALUES,
  PRINTER_NAME_MAX_LEN,
  TEAR_OFF_ADJUST_RANGE,
  ZPL_MODE_VALUES,
  intInRange,
  realtimeClockIsoRegex,
  setupScriptSafeStringRegex,
} from './ObjectType';

/** Printer-installation profile: EEPROM-persistent printer-state
 *  fields separated from `labelConfig` so design files don't leak
 *  per-install values (printer name, locale, …) when shared.
 *  Single profile today; the shape is ready to fan out into a
 *  Record<id, PrinterProfile> when multi-profile lands. */
export const printerProfileSchema = z.object({
  reprintAfterError: z.enum(['Y', 'N']).optional(),
  headTestInterval: intInRange(HEAD_TEST_INTERVAL_RANGE).optional(),
  tearOffAdjust: intInRange(TEAR_OFF_ADJUST_RANGE).optional(),
  setRealtimeClock: z.string().regex(realtimeClockIsoRegex).optional(),
  /** ^ST live-mode toggle: when true, generator captures wall-clock
   *  at export-time and ignores `setRealtimeClock`. */
  useCurrentTimeForClock: z.boolean().optional(),
  clockFormat: z.enum(CLOCK_FORMAT_VALUES).optional(),
  clockMode: z.enum(CLOCK_MODE_VALUES).optional(),
  /** ^SL numeric tolerance; cross-field-bound to clockMode === 'TOL'. */
  clockTolerance: intInRange(CLOCK_TOLERANCE_RANGE).optional(),
  clockLanguage: z.enum(CLOCK_LANGUAGE_VALUES).optional(),
  printerLocale: z.enum(PRINTER_LOCALE_VALUES).optional(),
  encodingTable: z.string().min(1).regex(setupScriptSafeStringRegex).optional(),
  zplMode: z.enum(ZPL_MODE_VALUES).optional(),
  printerName: z.string().min(1).max(PRINTER_NAME_MAX_LEN).regex(setupScriptSafeStringRegex).optional(),
  printerDescription: z.string().min(1).regex(setupScriptSafeStringRegex).optional(),
}).superRefine((p, ctx) => {
  if (p.clockTolerance !== undefined && p.clockMode !== 'TOL') {
    ctx.addIssue({
      code: 'custom',
      path: ['clockTolerance'],
      message: 'clockTolerance is only valid when clockMode === "TOL"',
    });
  }
  if (p.clockMode === 'TOL' && p.clockTolerance === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['clockTolerance'],
      message: 'clockMode "TOL" requires clockTolerance to be set',
    });
  }
});

export type PrinterProfile = z.infer<typeof printerProfileSchema>;

/** Derived from the schema so a new optional field is automatically
 *  picked up by the v4→v5 migration and import loader. */
export const PRINTER_PROFILE_FIELDS = Object.keys(
  printerProfileSchema.shape,
) as readonly (keyof PrinterProfile)[];

export type PrinterProfileField = (typeof PRINTER_PROFILE_FIELDS)[number];

export const EMPTY_PRINTER_PROFILE: PrinterProfile = {};

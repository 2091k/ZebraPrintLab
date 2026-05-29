/**
 * Pure helpers for the printer's Real-Time Clock value (^ST / parser).
 *
 * Holds the single source of truth for the `^ST` shape so the
 * generator (`zplSetupScript.ts`) and the parser (`zplParser.ts`)
 * cannot drift on round-trip. Two responsibilities:
 *
 *   - `realtimeClockIsoRegex` — schema-level shape check for the
 *     ISO local datetime string stored on `labelConfig`. Hoisted
 *     so `labelConfigSchema` can reject corrupt persisted state at
 *     load time rather than silently dropping it on emit.
 *
 *   - `parseRealtimeClock` / `formatRealtimeClockForZpl` — bidi
 *     conversion between the ISO string (HTML5 `datetime-local`
 *     shape) and Zebra's six positional params (`MM,DD,YYYY,HH,MM,SS`).
 *     Both apply semantic range checks (month 1..12, day 1..31, etc.)
 *     so the generator never emits a bogus `^ST` the printer would
 *     reject, and the parser never round-trips an impossible date.
 */

// `realtimeClockIsoRegex` is declared on `labelConfigSchema` side
// (src/types/ObjectType.ts) so the schema can hoist the shape check
// without `types → lib` cross-import. Re-export here for consumers
// that want both the validator and the parse/format pair together.
export { realtimeClockIsoRegex } from '../types/ObjectType';

const inRangeStr = (s: string, min: number, max: number): boolean => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= min && n <= max;
};

const pad2 = (s: string) => s.padStart(2, '0');

/** Parses Zebra's six `^ST` positional params back into the ISO
 *  local datetime shape (`YYYY-MM-DDTHH:MM:SS`). Returns `null` on
 *  any semantic range violation so the parser can drop the command
 *  silently — matching the existing parser contract for invalid
 *  input. */
export function parseRealtimeClock(params: readonly (string | undefined)[]): string | null {
  if (params.length < 6) return null;
  const mo = (params[0] ?? '').trim();
  const da = (params[1] ?? '').trim();
  const yr = (params[2] ?? '').trim();
  const hr = (params[3] ?? '').trim();
  const mi = (params[4] ?? '').trim();
  const se = (params[5] ?? '').trim();
  if (!/^\d{1,2}$/.test(mo) || !inRangeStr(mo, 1, 12)) return null;
  if (!/^\d{1,2}$/.test(da) || !inRangeStr(da, 1, 31)) return null;
  if (!/^\d{4}$/.test(yr)) return null;
  if (!/^\d{1,2}$/.test(hr) || !inRangeStr(hr, 0, 23)) return null;
  if (!/^\d{1,2}$/.test(mi) || !inRangeStr(mi, 0, 59)) return null;
  if (!/^\d{1,2}$/.test(se) || !inRangeStr(se, 0, 59)) return null;
  return `${yr}-${pad2(mo)}-${pad2(da)}T${pad2(hr)}:${pad2(mi)}:${pad2(se)}`;
}

/** Splits an ISO local datetime string (`YYYY-MM-DDTHH:MM[:SS]`)
 *  into the six positional params Zebra's `^ST` expects, in the
 *  spec order `MM,DD,YYYY,HH,MM,SS`. Returns `null` when the input
 *  is malformed so the generator can skip the emit instead of
 *  producing a bogus command. Seconds default to `00` when the
 *  input lacks them (HTML5 `datetime-local` omits them by default
 *  unless the UA was hinted with `step="1"`). */
export function formatRealtimeClockForZpl(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(iso);
  if (!m) return null;
  // The regex enforces presence of the five required groups; the
  // `?? ''` falls back are dead branches under `noUncheckedIndexedAccess`
  // but cheaper than scattered non-null assertions.
  const year = m[1] ?? '';
  const month = m[2] ?? '';
  const day = m[3] ?? '';
  const hour = m[4] ?? '';
  const minute = m[5] ?? '';
  const second = m[6] ?? '00';
  // Semantic range check mirrors `parseRealtimeClock` so neither
  // direction lets impossible dates survive a round-trip.
  if (!inRangeStr(month, 1, 12)) return null;
  if (!inRangeStr(day, 1, 31)) return null;
  if (!inRangeStr(hour, 0, 23)) return null;
  if (!inRangeStr(minute, 0, 59)) return null;
  if (!inRangeStr(second, 0, 59)) return null;
  return `${month},${day},${year},${hour},${minute},${second}`;
}

/**
 * Per-symbology content rules. We apply these on input so the canvas preview
 * (bwip-js) does not throw on characters the local renderer rejects, even
 * though Labelary and Zebra firmware would silently normalise them.
 *
 * Charset is the body of a regex character class (no surrounding `[]`).
 * Auto-upper covers symbologies that only encode uppercase letters but where
 * the firmware silently uppercases — bwip-js does not, so the canvas would
 * otherwise crash on lowercase user input.
 */
export interface ContentSpec {
  /** Character-class body, e.g. `0-9` or `0-9A-Z\\-. $/+%`. */
  charset: string;
  autoUpper?: boolean;
  maxLength?: number;
}

export function filterContent(raw: string, spec?: ContentSpec): string {
  if (!spec) return raw;
  const upper = spec.autoUpper ? raw.toUpperCase() : raw;
  const filtered = upper.replace(new RegExp(`[^${spec.charset}]`, 'g'), '');
  return spec.maxLength ? filtered.slice(0, spec.maxLength) : filtered;
}

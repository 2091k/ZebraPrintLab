import { describe, it, expect } from "vitest";
import { generateSetupScript, SETUP_SCRIPT_FIELDS } from "./zplSetupScript";
import { parseZPL } from "./zplParser";
import type { LabelConfig } from "../types/ObjectType";

const base: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8 };

describe("generateSetupScript — output shape", () => {
  it("returns empty string when no Setup-Script field is set", () => {
    expect(generateSetupScript(base)).toBe("");
  });

  it("emits tilde-prefix commands standalone (no wrapper block)", () => {
    const script = generateSetupScript({ ...base, tearOffAdjust: 10 });
    expect(script).toBe("~TA10");
  });

  it("wraps caret-prefix commands in a ^XA...^XZ block", () => {
    const script = generateSetupScript({ ...base, reprintAfterError: "N" });
    expect(script).toBe("^XA\n^JZN\n^XZ");
  });

  it("combines tilde lines above the caret block", () => {
    const script = generateSetupScript({
      ...base,
      tearOffAdjust: -5,
      reprintAfterError: "Y",
      headTestInterval: 100,
    });
    expect(script).toBe("~TA-5\n^XA\n^JZY\n^JT100\n^XZ");
  });

  it("omits the wrapper block when only tilde commands are set", () => {
    const script = generateSetupScript({ ...base, tearOffAdjust: 0 });
    expect(script).not.toContain("^XA");
    expect(script).not.toContain("^XZ");
  });

  it("emits ^ST with the six positional params in MM,DD,YYYY,HH,MM,SS order", () => {
    const script = generateSetupScript({
      ...base,
      setRealtimeClock: "2026-05-29T18:30:00",
    });
    expect(script).toBe("^XA\n^ST05,29,2026,18,30,00\n^XZ");
  });

  it("defaults ^ST seconds to 00 when datetime-local omits them", () => {
    const script = generateSetupScript({
      ...base,
      setRealtimeClock: "2026-05-29T18:30",
    });
    expect(script).toContain("^ST05,29,2026,18,30,00");
  });

  it("skips ^ST emit silently when the value is unparsable", () => {
    const script = generateSetupScript({
      ...base,
      setRealtimeClock: "not-a-datetime",
    });
    expect(script).toBe("");
  });

  it("emits ^KD with the selected clock-format code", () => {
    const script = generateSetupScript({ ...base, clockFormat: "2" });
    expect(script).toBe("^XA\n^KD2\n^XZ");
  });

  it("round-trips ^ST + ^KD via the parser without loss", () => {
    const orig: LabelConfig = {
      ...base,
      setRealtimeClock: "2026-05-29T18:30:45",
      clockFormat: "3",
    };
    const { labelConfig: parsed } = parseZPL(generateSetupScript(orig));
    expect(parsed.setRealtimeClock).toBe("2026-05-29T18:30:45");
    expect(parsed.clockFormat).toBe("3");
  });

  it("rejects ^KD with an unknown format code", () => {
    expect(parseZPL("^XA^KD9^XZ").labelConfig.clockFormat).toBeUndefined();
  });

  it("rejects ^ST with malformed positional params", () => {
    expect(parseZPL("^XA^ST05,29,26,18,30,00^XZ").labelConfig.setRealtimeClock).toBeUndefined();
    expect(parseZPL("^XA^ST05,29,2026,18,30^XZ").labelConfig.setRealtimeClock).toBeUndefined();
  });

  it("emits ^KL with the selected printer locale", () => {
    expect(generateSetupScript({ ...base, printerLocale: "DE" })).toBe("^XA\n^KLDE\n^XZ");
  });

  it("emits ^SE with the encoding-table file path", () => {
    expect(generateSetupScript({ ...base, encodingTable: "E:UHANGUL.DAT" }))
      .toBe("^XA\n^SEE:UHANGUL.DAT\n^XZ");
  });

  it("rejects empty-string encodingTable at the schema layer", async () => {
    // The schema's min(1) makes empty string unreachable through
    // labelConfigSchema.parse, so the generator no longer carries
    // its own empty-string defense. This test pins the schema
    // contract so a future schema loosening would also surface here.
    const { labelConfigSchema } = await import("../types/ObjectType");
    expect(() => labelConfigSchema.parse({ ...base, encodingTable: "" })).toThrow();
  });

  it("emits ^SZ with the selected ZPL mode", () => {
    expect(generateSetupScript({ ...base, zplMode: "1" })).toBe("^XA\n^SZ1\n^XZ");
    expect(generateSetupScript({ ...base, zplMode: "2" })).toBe("^XA\n^SZ2\n^XZ");
  });

  it("round-trips ^KL + ^SE + ^SZ via the parser without loss", () => {
    const orig: LabelConfig = {
      ...base,
      printerLocale: "JP",
      encodingTable: "E:UHANGUL.DAT",
      zplMode: "2",
    };
    const { labelConfig: parsed } = parseZPL(generateSetupScript(orig));
    expect(parsed.printerLocale).toBe("JP");
    expect(parsed.encodingTable).toBe("E:UHANGUL.DAT");
    expect(parsed.zplMode).toBe("2");
  });

  it("round-trips the 3-char SP2 printer-locale code", () => {
    // SP2 is the only non-2-char alpha code in PRINTER_LOCALE_VALUES;
    // pin its round-trip so a future regex tightening of the parser
    // (e.g. assuming 2-char codes) breaks here loudly.
    const { labelConfig: parsed } = parseZPL(generateSetupScript({ ...base, printerLocale: "SP2" }));
    expect(parsed.printerLocale).toBe("SP2");
  });

  it("preserves spaces inside ^SE encoding-table paths", () => {
    // Hand-edited ZPL can carry paths with spaces (e.g.
    // `E:MY FILE.DAT`). The parser must not mangle them.
    const path = "E:MY FILE.DAT";
    const { labelConfig: parsed } = parseZPL(generateSetupScript({ ...base, encodingTable: path }));
    expect(parsed.encodingTable).toBe(path);
  });

  it("rejects ^KL with an unknown locale code", () => {
    expect(parseZPL("^XA^KLXX^XZ").labelConfig.printerLocale).toBeUndefined();
  });

  it("rejects ^SZ with an unknown mode", () => {
    expect(parseZPL("^XA^SZ9^XZ").labelConfig.zplMode).toBeUndefined();
  });

  it("declares its channel-field set as a SSoT (SETUP_SCRIPT_FIELDS)", () => {
    // Guards against the if-chain in generateSetupScript silently
    // drifting from the documented registry. If a new Setup-Script
    // command is added, both the if-chain and SETUP_SCRIPT_FIELDS
    // must be updated together.
    expect([...SETUP_SCRIPT_FIELDS]).toEqual([
      "tearOffAdjust",
      "reprintAfterError",
      "headTestInterval",
      "setRealtimeClock",
      "clockFormat",
      "printerLocale",
      "encodingTable",
      "zplMode",
    ]);
  });

  it("never leaks per-label commands (^MD / ~SD / ^PR / ^MN) into the Setup Script", () => {
    const script = generateSetupScript({
      ...base,
      darkness: 15,
      instantDarkness: 20,
      printSpeed: 6,
      mediaTracking: "Y",
      reprintAfterError: "Y",
    });
    expect(script).not.toContain("^MD");
    expect(script).not.toContain("~SD");
    expect(script).not.toContain("^PR");
    expect(script).not.toContain("^MN");
    // Only the actual Setup-Script command should be present.
    expect(script).toContain("^JZY");
  });
});

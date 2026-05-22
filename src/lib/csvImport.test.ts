import { describe, it, expect } from "vitest";
import { parseCsvFile } from "./csvImport";

function fileOf(text: string, name = "test.csv"): File {
  return new File([text], name, { type: "text/csv" });
}

describe("parseCsvFile", () => {
  it("parses headers + rows from a simple comma-delimited CSV", async () => {
    const file = fileOf("sku,qty\nA1,10\nB2,5\n");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headers).toEqual(["sku", "qty"]);
    expect(result.value.rows).toEqual([
      ["A1", "10"],
      ["B2", "5"],
    ]);
    expect(result.value.source.filename).toBe("test.csv");
    expect(result.value.source.rowCount).toBe(2);
  });

  it("pads ragged rows to header length", async () => {
    const file = fileOf("a,b,c\n1,2\n4,5,6\n");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toEqual([
      ["1", "2", ""],
      ["4", "5", "6"],
    ]);
  });

  it("truncates rows that are longer than headers", async () => {
    const file = fileOf("a,b\n1,2,3\n");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toEqual([["1", "2"]]);
  });

  it("auto-detects semicolon delimiter (Excel-locale CSVs)", async () => {
    const file = fileOf("sku;qty\nA1;10\n");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headers).toEqual(["sku", "qty"]);
    expect(result.value.source.delimiter).toBe(";");
  });

  it("returns 'empty' for a zero-byte file", async () => {
    const file = fileOf("");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty");
  });

  it("preserves quoted values containing the delimiter", async () => {
    const file = fileOf('name,note\n"Smith, J.","hi, there"\n');
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows[0]).toEqual(["Smith, J.", "hi, there"]);
  });

  it("returns header-only CSV with zero rows (not an error)", async () => {
    const file = fileOf("sku,qty\n");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headers).toEqual(["sku", "qty"]);
    expect(result.value.rows).toEqual([]);
    expect(result.value.source.rowCount).toBe(0);
  });
});

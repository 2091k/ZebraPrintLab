import { describe, it, expect } from "vitest";
import { ObjectRegistry, BARCODE_1D_TYPES, STACKED_2D_TYPES } from "./index";

describe("registry isolation baseline", () => {
  it("registers 34 object types", () => {
    expect(Object.keys(ObjectRegistry)).toHaveLength(34);
  });

  it("classifies 20 1D barcodes", () => {
    expect(BARCODE_1D_TYPES.size).toBe(20);
  });

  it("classifies 3 stacked 2D barcodes", () => {
    expect(STACKED_2D_TYPES.size).toBe(3);
  });
});

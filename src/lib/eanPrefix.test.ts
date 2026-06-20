import { describe, it, expect } from "vitest";
import { eanPrefixKey } from "./eanPrefix";

describe("eanPrefixKey", () => {
  it("maps curated country/usage ranges", () => {
    expect(eanPrefixKey("401234000000")).toBe("de");
    expect(eanPrefixKey("500000000000")).toBe("gb");
    expect(eanPrefixKey("978000000000")).toBe("isbn");
    expect(eanPrefixKey("977000000000")).toBe("issn");
    expect(eanPrefixKey("001234000000")).toBe("usCa");
    expect(eanPrefixKey("250000000000")).toBe("restricted");
  });

  it("returns null below 3 digits or for an uncovered prefix", () => {
    expect(eanPrefixKey("40")).toBeNull();
    expect(eanPrefixKey("600000000000")).toBeNull(); // South Africa, not curated
  });
});

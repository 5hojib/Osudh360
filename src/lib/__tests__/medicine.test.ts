import { describe, expect, it } from "vitest";
import {
  brandBaseOf,
  formatPack,
  formatPrice,
  normaliseForm,
  parseStrength,
  slugify,
  unitPriceOf,
} from "../medicine";

describe("normaliseForm", () => {
  it("canonicalises common forms", () => {
    expect(normaliseForm("tablet")).toBe("Tablet");
    expect(normaliseForm("Tablets")).toBe("Tablet");
    expect(normaliseForm("capsule")).toBe("Capsule");
    expect(normaliseForm("softgel capsule")).toBe("Softgel Capsule");
    expect(normaliseForm("vaginal tablet")).toBe("Vaginal Tablet");
  });

  it("returns null for blank input", () => {
    expect(normaliseForm("")).toBeNull();
    expect(normaliseForm(null)).toBeNull();
    expect(normaliseForm(undefined)).toBeNull();
  });
});

describe("brandBaseOf", () => {
  it("strips a matching trailing strength", () => {
    expect(brandBaseOf("Napa 500", "500mg")).toBe("Napa");
    expect(brandBaseOf("Seclo 20", "20mg")).toBe("Seclo");
  });
  it("leaves names unchanged when strength does not match", () => {
    expect(brandBaseOf("Napa Extend", "665mg")).toBe("Napa Extend");
    expect(brandBaseOf("Bumecard", "5mg")).toBe("Bumecard");
  });
});

describe("parseStrength", () => {
  it("parses simple strengths", () => {
    expect(parseStrength("500mg")).toEqual({ value: 500, unit: "mg", isCombo: false });
    expect(parseStrength("80mg/ml")).toEqual({ value: 80, unit: "mg/ml", isCombo: false });
  });
  it("marks combination strengths", () => {
    expect(parseStrength("12.5mg + 40mg")).toEqual({ value: null, unit: null, isCombo: true });
  });
  it("handles empty input", () => {
    expect(parseStrength("")).toEqual({ value: null, unit: null, isCombo: false });
  });
});

describe("formatPrice", () => {
  it("formats BDT with two decimals only when needed", () => {
    expect(formatPrice(10.8, "BDT")).toBe("৳10.80");
    expect(formatPrice(12, "BDT")).toBe("৳12");
  });
  it("returns em dash for non-finite", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(NaN)).toBe("—");
  });
});

describe("unitPriceOf", () => {
  it("divides by pack size", () => {
    expect(unitPriceOf(100, 10)).toBe(10);
  });
  it("returns null for invalid inputs", () => {
    expect(unitPriceOf(null, 10)).toBeNull();
    expect(unitPriceOf(100, 0)).toBeNull();
  });
});

describe("slugify", () => {
  it("normalises to url-safe slug", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });
});

describe("formatPack", () => {
  it("combines type and size", () => {
    expect(formatPack("Strip", 10)).toBe("Strip × 10");
  });
});
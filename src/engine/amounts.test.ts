import { describe, expect, it } from "vitest";
import {
  acceptableStrings,
  isAcceptable,
  parseEntry,
  generateCheck,
  WHOLE_DOLLAR_RATE,
  MIN_CENTS,
  MAX_CENTS,
} from "./amounts";
import { mulberry32 } from "./rng";
import type { CheckItem } from "./types";

function check(partial: Partial<CheckItem> & { cents: number; wholeDollar: boolean }): CheckItem {
  return {
    index: 0,
    checkNumber: 1001,
    payee: "Test",
    memo: "invoice 1",
    amountHand: "print-mono",
    amountSize: "md",
    amountTilt: 0,
    ...partial,
  };
}

describe("parseEntry", () => {
  it("parses whole dollars and decimal variants", () => {
    expect(parseEntry("50")).toBe(5000);
    expect(parseEntry("50.")).toBe(5000);
    expect(parseEntry("50.0")).toBe(5000);
    expect(parseEntry("50.00")).toBe(5000);
    expect(parseEntry("127.45")).toBe(12745);
    expect(parseEntry("0.07")).toBe(7);
  });

  it("rejects miskeys and extra precision", () => {
    expect(parseEntry("50a")).toBeNull();
    expect(parseEntry("12.345")).toBeNull();
    expect(parseEntry(".50")).toBeNull();
    expect(parseEntry("")).toBeNull();
  });
});

describe("isAcceptable", () => {
  const whole = check({ cents: 5000, wholeDollar: true });
  const change = check({ cents: 12745, wholeDollar: false });

  it("lets whole-dollar amounts skip pennies", () => {
    expect(isAcceptable(whole, "50")).toBe(true);
    expect(isAcceptable(whole, "50.00")).toBe(true);
    expect(isAcceptable(whole, "50.0")).toBe(true);
    expect(isAcceptable(whole, "50.")).toBe(true);
    expect(isAcceptable(whole, "5000")).toBe(false);
    expect(isAcceptable(whole, "51")).toBe(false);
  });

  it("requires the cents value, but trailing zeros may be omitted", () => {
    expect(isAcceptable(change, "127.45")).toBe(true);
    expect(isAcceptable(change, "127")).toBe(false);
    expect(isAcceptable(change, "127.4")).toBe(false);
    expect(isAcceptable(change, "127.46")).toBe(false);
    const seventy = check({ cents: 7370, wholeDollar: false });
    expect(isAcceptable(seventy, "73.7")).toBe(true);
    expect(isAcceptable(seventy, "73.70")).toBe(true);
    expect(isAcceptable(seventy, "73")).toBe(false);
    expect(isAcceptable(check({ cents: 10, wholeDollar: false }), "0.1")).toBe(true);
    expect(isAcceptable(check({ cents: 1, wholeDollar: false }), "0.1")).toBe(false);
  });

  it("accepts the range edges", () => {
    const penny = check({ cents: 1, wholeDollar: false });
    const top = check({ cents: 999999, wholeDollar: false });
    expect(isAcceptable(penny, "0.01")).toBe(true);
    expect(isAcceptable(top, "9999.99")).toBe(true);
    expect(isAcceptable(check({ cents: 999900, wholeDollar: true }), "9999")).toBe(true);
  });
});

describe("generateCheck", () => {
  it("hits the whole-dollar rate over a large sample", () => {
    const rng = mulberry32(42);
    let whole = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (generateCheck(rng, i).wholeDollar) whole++;
    }
    const rate = whole / n;
    expect(rate).toBeGreaterThan(WHOLE_DOLLAR_RATE - 0.05);
    expect(rate).toBeLessThan(WHOLE_DOLLAR_RATE + 0.05);
  });

  it("varies amount handwriting and size", () => {
    const rng = mulberry32(12);
    const hands = new Set<string>();
    const sizes = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const item = generateCheck(rng, i);
      hands.add(item.amountHand);
      sizes.add(item.amountSize);
      if (item.amountHand.startsWith("hand")) {
        expect(item.amountTilt).toBeGreaterThanOrEqual(-3);
        expect(item.amountTilt).toBeLessThanOrEqual(3);
      } else {
        expect(item.amountTilt).toBe(0);
      }
    }
    expect(hands.has("hand-loop") || hands.has("hand-block")).toBe(true);
    expect(hands.has("print-mono")).toBe(true);
    expect(sizes.size).toBeGreaterThan(1);
  });

  it("never generates a .00 amount marked as needing pennies", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 400; i++) {
      const item = generateCheck(rng, i);
      if (!item.wholeDollar) expect(item.cents % 100).not.toBe(0);
      if (item.wholeDollar) expect(item.cents % 100).toBe(0);
    }
  });

  it("stays in $0.01–$9999.99 with a payables-sized median", () => {
    const rng = mulberry32(7);
    const sample: number[] = [];
    let underHundred = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const cents = generateCheck(rng, i).cents;
      expect(cents).toBeGreaterThanOrEqual(MIN_CENTS);
      expect(cents).toBeLessThanOrEqual(MAX_CENTS);
      sample.push(cents);
      if (cents < 10000) underHundred++;
    }
    sample.sort((a, b) => a - b);
    const median = sample[Math.floor(n / 2)]!;
    expect(median).toBeGreaterThanOrEqual(10000);
    expect(median).toBeLessThanOrEqual(500000);
    expect(underHundred / n).toBeLessThan(0.15);
    expect(sample[sample.length - 1]!).toBeGreaterThan(5000 * 100);
  });
});

describe("acceptableStrings", () => {
  it("lists skip-penny forms for whole dollars", () => {
    expect(acceptableStrings(check({ cents: 1200, wholeDollar: true }))).toContain("12");
  });
});

import { describe, expect, it } from "vitest";
import { amountToWords, dollarsToWords } from "./words";

describe("amountToWords", () => {
  it("uses check-style wording", () => {
    expect(amountToWords(128450)).toBe("One thousand two hundred eighty-four and 50/100");
    expect(amountToWords(500)).toBe("Five and 00/100");
    expect(amountToWords(10101)).toBe("One hundred one and 01/100");
    expect(amountToWords(20)).toBe("Zero and 20/100");
  });
});

describe("dollarsToWords", () => {
  it("handles thousands", () => {
    expect(dollarsToWords(19999)).toBe("nineteen thousand nine hundred ninety-nine");
  });
});

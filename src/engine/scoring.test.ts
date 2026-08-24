import { describe, expect, it } from "vitest";
import { computeScore, levenshtein, uncorrectedCharsFor } from "./scoring";
import type { CheckItem, Submission } from "./types";

const check: CheckItem = {
  index: 0,
  checkNumber: 1,
  payee: "A",
  memo: "m",
  cents: 12745,
  wholeDollar: false,
  amountHand: "print-mono",
  amountSize: "md",
  amountTilt: 0,
};

describe("levenshtein", () => {
  it("counts edits", () => {
    expect(levenshtein("127.45", "127.45")).toBe(0);
    expect(levenshtein("127.46", "127.45")).toBe(1);
    expect(levenshtein("50", "50.00")).toBe(3);
  });
});

describe("uncorrectedCharsFor", () => {
  it("is zero when the amount is correct", () => {
    const sub: Submission = {
      check,
      raw: "127.45",
      parsedCents: 12745,
      correct: true,
      atMs: 0,
    };
    expect(uncorrectedCharsFor(sub)).toBe(0);
  });
});

describe("computeScore", () => {
  it("does not treat an in-progress entry as uncorrected", () => {
    const score = computeScore(
      {
        startedAt: 0,
        endedAt: null,
        durationMs: 60_000,
        events: [
          { atMs: 0, key: "1", code: "", kind: "digit" },
          { atMs: 1, key: "5", code: "", kind: "digit" },
        ],
        submissions: [],
        buffer: [
          { ch: "1", miskey: false },
          { ch: "5", miskey: false },
        ],
        phase: "entering",
      },
      500,
    );
    expect(score.uncorrectedAccuracy).toBe(1);
    expect(score.uncorrectedErrors).toBe(0);
  });

  it("does not treat an unfinished next check as an uncorrected error", () => {
    const sub: Submission = {
      check,
      raw: "127.45",
      parsedCents: 12745,
      correct: true,
      atMs: 10,
    };
    const score = computeScore(
      {
        startedAt: 0,
        endedAt: 60_000,
        durationMs: 60_000,
        events: [
          { atMs: 10, key: "1", code: "", kind: "digit" },
          { atMs: 11, key: "Backspace", code: "", kind: "backspace" },
          { atMs: 12, key: "1", code: "", kind: "digit" },
        ],
        submissions: [sub],
        buffer: [
          { ch: "9", miskey: false },
          { ch: "4", miskey: false },
        ],
        phase: "done",
      },
      60_000,
    );
    expect(score.checksCorrect).toBe(1);
    expect(score.checksSubmitted).toBe(1);
    expect(score.uncorrectedErrors).toBe(0);
    expect(score.uncorrectedAccuracy).toBe(1);
    expect(score.amountAccuracy).toBe(1);
    expect(score.correctedErrors).toBe(1);
    expect(score.leftoverRaw).toBe("94");
  });

  it("uses official duration as the KPH ceiling", () => {
    const score = computeScore(
      {
        startedAt: 0,
        endedAt: 3_600_000,
        durationMs: 3_600_000,
        events: Array.from({ length: 10000 }, (_, i) => ({
          atMs: i,
          key: "1",
          code: "",
          kind: "digit" as const,
        })),
        submissions: [],
        buffer: [],
        phase: "done",
      },
      3_600_000,
    );
    expect(Math.round(score.grossKph)).toBe(10000);
    expect(score.uncorrectedAccuracy).toBe(1);
  });

  it("uses elapsed time for stack tests with no duration cap", () => {
    const score = computeScore(
      {
        startedAt: 0,
        endedAt: 1_800_000,
        durationMs: 0,
        events: Array.from({ length: 5000 }, (_, i) => ({
          atMs: i,
          key: "1",
          code: "",
          kind: "digit" as const,
        })),
        submissions: [],
        buffer: [],
        phase: "done",
      },
      1_800_000,
    );
    expect(Math.round(score.grossKph)).toBe(10000);
  });

  it("excludes Tab/slide from gross KPH", () => {
    const score = computeScore(
      {
        startedAt: 0,
        endedAt: 3_600_000,
        durationMs: 3_600_000,
        events: [
          ...Array.from({ length: 8000 }, (_, i) => ({
            atMs: i,
            key: "1",
            code: "",
            kind: "digit" as const,
          })),
          ...Array.from({ length: 2000 }, (_, i) => ({
            atMs: 8000 + i,
            key: "Tab",
            code: "Tab",
            kind: "slide" as const,
          })),
        ],
        submissions: [],
        buffer: [],
        phase: "done",
      },
      3_600_000,
    );
    expect(Math.round(score.grossKph)).toBe(8000);
    expect(Math.round(score.netKph)).toBe(0);
    expect(Math.round(score.numericKph)).toBe(0);
  });

  it("does not count backspaced mash toward net or numeric KPH", () => {
    const sub: Submission = {
      check,
      raw: "127.45",
      parsedCents: 12745,
      correct: true,
      atMs: 10,
    };
    const mash = Array.from({ length: 400 }, (_, i) => ({
      atMs: 20 + i,
      key: i % 2 === 0 ? "9" : "Backspace",
      code: "",
      kind: i % 2 === 0 ? ("digit" as const) : ("backspace" as const),
    }));
    const score = computeScore(
      {
        startedAt: 0,
        endedAt: 3_600_000,
        durationMs: 3_600_000,
        events: [
          { atMs: 1, key: "1", code: "", kind: "digit" },
          { atMs: 2, key: "2", code: "", kind: "digit" },
          { atMs: 3, key: "7", code: "", kind: "digit" },
          { atMs: 4, key: ".", code: "", kind: "decimal" },
          { atMs: 5, key: "4", code: "", kind: "digit" },
          { atMs: 6, key: "5", code: "", kind: "digit" },
          { atMs: 7, key: "+", code: "", kind: "plus" },
          ...mash,
        ],
        submissions: [sub],
        buffer: [],
        phase: "done",
      },
      3_600_000,
    );
    expect(score.numericKeystrokes).toBe(6);
    expect(Math.round(score.numericKph)).toBe(6);
    expect(Math.round(score.netKph)).toBe(7);
    expect(score.grossKph).toBeGreaterThan(score.netKph);
    expect(score.correctedErrors).toBe(200);
  });

  it("caps padded correct amounts at a legal spelling", () => {
    const sub: Submission = {
      check,
      raw: "0000127.45",
      parsedCents: 12745,
      correct: true,
      atMs: 10,
    };
    const score = computeScore(
      {
        startedAt: 0,
        endedAt: 3_600_000,
        durationMs: 3_600_000,
        events: [],
        submissions: [sub],
        buffer: [],
        phase: "done",
      },
      3_600_000,
    );
    expect(score.numericKeystrokes).toBe(6);
    expect(Math.round(score.netKph)).toBe(7);
  });

  it("does not count leftover unfinished keys toward net KPH", () => {
    const sub: Submission = {
      check,
      raw: "127.45",
      parsedCents: 12745,
      correct: true,
      atMs: 10,
    };
    const score = computeScore(
      {
        startedAt: 0,
        endedAt: 3_600_000,
        durationMs: 3_600_000,
        events: [
          { atMs: 1, key: "1", code: "", kind: "digit" },
          { atMs: 7, key: "+", code: "", kind: "plus" },
        ],
        submissions: [sub],
        buffer: [
          { ch: "9", miskey: false },
          { ch: "9", miskey: false },
          { ch: "9", miskey: false },
        ],
        phase: "done",
      },
      3_600_000,
    );
    expect(score.leftoverRaw).toBe("999");
    expect(Math.round(score.netKph)).toBe(7);
  });
});

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
});

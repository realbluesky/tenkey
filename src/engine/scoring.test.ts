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
});

import { describe, expect, it } from "vitest";
import { groupSessionsByDay, median, type StoredSession } from "./storage";
import type { Score } from "./engine/types";

function score(kph: number): Score {
  return {
    elapsedMs: 1000,
    durationMs: 0,
    grossKph: kph,
    netKph: kph,
    numericKph: kph,
    uncorrectedAccuracy: 1,
    correctedAccuracy: 1,
    amountAccuracy: 1,
    keystrokes: 10,
    numericKeystrokes: 8,
    correctedErrors: 0,
    uncorrectedErrors: 0,
    uncorrectedChars: 0,
    checksSubmitted: 1,
    checksCorrect: 1,
    enteredTotalCents: 100,
    trueTotalCents: 100,
    leftoverRaw: "",
  };
}

function session(at: number, kph: number): StoredSession {
  return {
    id: String(at),
    at,
    name: "Alex",
    durationMs: 0,
    stackSize: 10,
    seed: 1,
    practice: true,
    score: score(kph),
  };
}

describe("median", () => {
  it("handles odd and even lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("groupSessionsByDay", () => {
  it("groups newest first and reports median KPH", () => {
    const dayA = new Date(2026, 7, 23, 9).getTime();
    const dayB = new Date(2026, 7, 22, 9).getTime();
    const groups = groupSessionsByDay([
      session(dayA + 1000, 9000),
      session(dayA, 11000),
      session(dayB, 5000),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.sessions).toHaveLength(2);
    expect(groups[0]!.medianKph).toBe(10000);
    expect(groups[1]!.sessions).toHaveLength(1);
  });
});

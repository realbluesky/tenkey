import { describe, expect, it } from "vitest";
import { bestsByGoal, goalKey, groupSessionsByDay, median, type Store, type StoredSession } from "./storage";
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

describe("goalKey", () => {
  it("does not split calculator and spreadsheet desks", () => {
    const tape = { ...session(1, 9000), practice: false, desk: "calculator" as const };
    const sheet = { ...session(2, 11000), practice: false, desk: "spreadsheet" as const };
    expect(goalKey(tape)).toBe(goalKey(sheet));
    expect(goalKey(tape)).toBe("stack:10");
  });
});

describe("bestsByGoal", () => {
  it("keeps one personal best per length across desks", () => {
    const store: Store = {
      name: "Alex",
      operators: ["Alex"],
      sessions: [
        { ...session(1, 9000), practice: false, desk: "calculator" },
        { ...session(2, 11000), practice: false, desk: "spreadsheet" },
      ],
    };
    const bests = bestsByGoal(store);
    expect(bests).toHaveLength(1);
    expect(bests[0]!.score.netKph).toBe(11000);
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

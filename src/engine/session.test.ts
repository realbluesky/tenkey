import { describe, expect, it } from "vitest";
import { formatMoney } from "./amounts";
import { TenkeySession } from "./session";
import { canonicalEntry } from "./amounts";
import type { KeyInput } from "./types";

function key(k: string, extras: Partial<KeyInput> = {}): KeyInput {
  return {
    key: k,
    code: extras.code ?? "",
    location: extras.location ?? 0,
    shiftKey: extras.shiftKey ?? false,
  };
}

function tab(shift = false): KeyInput {
  return key("Tab", { code: "Tab", shiftKey: shift });
}

function typeAmount(session: TenkeySession, raw: string, now: number): void {
  for (const ch of raw) {
    if (ch === ".") session.handleKey(key("."), now);
    else session.handleKey(key(ch), now);
  }
}

function runCheck(session: TenkeySession, raw: string, now: number): void {
  typeAmount(session, raw, now);
  session.handleKey(key("+"), now);
  session.handleKey(tab(), now);
}

describe("TenkeySession", () => {
  it("stays armed until the first digit", () => {
    const session = new TenkeySession({ durationMs: 60_000, practice: true, seed: 1 });
    session.handleKey(key("a"), 1000);
    session.handleKey(key("+"), 1001);
    session.handleKey(tab(), 1002);
    expect(session.phase).toBe("armed");
    expect(session.startedAt).toBeNull();
    const result = session.handleKey(key("4"), 1500);
    expect(result.started).toBe(true);
    expect(session.phase).toBe("entering");
    expect(session.startedAt).toBe(1500);
  });

  it("accepts plus then Tab", () => {
    const session = new TenkeySession({ durationMs: 60_000, practice: true, seed: 7 });
    const first = session.current;
    const expected = canonicalEntry(first);
    typeAmount(session, expected, 0);
    const plus = session.handleKey(key("+"), 30);
    expect(plus.submitted?.correct).toBe(true);
    expect(session.phase).toBe("awaiting_slide");
    const slide = session.handleKey(tab(), 40);
    expect(slide.slid).toBe(true);
    expect(session.currentIndex).toBe(1);
    expect(session.entryIndex).toBe(1);
  });

  it("accepts Tab then plus, and Shift+Tab brings the check back", () => {
    const session = new TenkeySession({ durationMs: 60_000, practice: true, seed: 7 });
    const first = session.current;
    const expected = canonicalEntry(first);
    typeAmount(session, expected, 0);
    const slide = session.handleKey(tab(), 20);
    expect(slide.slid).toBe(true);
    expect(session.phase).toBe("awaiting_plus");
    expect(session.currentIndex).toBe(1);
    expect(session.entryIndex).toBe(0);
    const back = session.handleKey(tab(true), 25);
    expect(back.unslid).toBe(true);
    expect(session.phase).toBe("entering");
    expect(session.currentIndex).toBe(0);
    session.handleKey(tab(), 28);
    const plus = session.handleKey(key("+"), 30);
    expect(plus.submitted?.check).toBe(first);
    expect(plus.submitted?.correct).toBe(true);
    expect(session.phase).toBe("entering");
    expect(session.entryIndex).toBe(1);
  });

  it("slides on Tab after plus, not Space or Control", () => {
    const session = new TenkeySession({ durationMs: 60_000, practice: true, seed: 3 });
    const expected = canonicalEntry(session.current);
    typeAmount(session, expected, 0);
    session.handleKey(key("+"), 1);
    expect(session.handleKey(key(" "), 2).slid).toBe(false);
    expect(session.handleKey(key("Control", { code: "ControlLeft", location: 1 }), 3).slid).toBe(
      false,
    );
    expect(session.phase).toBe("awaiting_slide");
    const slide = session.handleKey(tab(), 4);
    expect(slide.slid).toBe(true);
  });

  it("shows miskeys and requires they be corrected", () => {
    const session = new TenkeySession({ durationMs: 60_000, practice: true, seed: 11 });
    const expected = canonicalEntry(session.current);
    session.handleKey(key(expected[0]!), 0);
    session.handleKey(key("a"), 1);
    expect(session.buffer.some((ch) => ch.miskey && ch.ch === "a")).toBe(true);
    session.handleKey(key("+"), 2);
    expect(session.submissions[0]?.correct).toBe(false);
  });

  it("counts a backspaced miskey as a corrected error", () => {
    const session = new TenkeySession({ durationMs: 60_000, practice: true, seed: 11 });
    const expected = canonicalEntry(session.current);
    typeAmount(session, expected, 0);
    session.handleKey(key("x"), 1);
    session.handleKey(key("Backspace"), 2);
    session.handleKey(key("+"), 3);
    expect(session.submissions[0]?.correct).toBe(true);
    const score = session.snapshot(3);
    expect(score.correctedErrors).toBe(1);
    expect(score.uncorrectedErrors).toBe(0);
  });

  it("allows skipping .00 on whole-dollar checks", () => {
    const session = new TenkeySession({ durationMs: 60_000, practice: true, seed: 5 });
    for (let i = 0; i < 40 && !session.current.wholeDollar; i++) {
      runCheck(session, canonicalEntry(session.current), i * 10);
    }
    expect(session.current.wholeDollar).toBe(true);
    const dollars = String(Math.floor(session.current.cents / 100));
    typeAmount(session, dollars, 500);
    const plus = session.handleKey(key("+"), 501);
    expect(plus.submitted?.correct).toBe(true);
  });

  it("ends when time elapses", () => {
    const session = new TenkeySession({ durationMs: 1000, practice: false, seed: 2 });
    session.handleKey(key("1"), 0);
    expect(session.tick(1000)).toBe(true);
    expect(session.phase).toBe("done");
    expect(session.remainingMs(1500)).toBe(0);
  });

  it("computes KPH from elapsed time after first digit", () => {
    const session = new TenkeySession({ durationMs: 3_600_000, practice: true, seed: 8 });
    // 3600 keys in one hour would be 3600 KPH; 10 keys in 1 second = 36,000 KPH
    runCheck(session, canonicalEntry(session.current), 0);
    session.finish(3_600_000);
    const score = session.snapshot(3_600_000);
    expect(score.grossKph).toBeGreaterThan(0);
    expect(score.keystrokes).toBeGreaterThan(3);
  });

  it("tracks entered vs true totals", () => {
    const session = new TenkeySession({ durationMs: 60_000, practice: true, seed: 4 });
    const first = session.current;
    typeAmount(session, "999.99", 0);
    session.handleKey(key("+"), 1);
    session.handleKey(tab(), 2);
    const score = session.snapshot(3);
    expect(score.enteredTotalCents).toBe(99999);
    expect(score.trueTotalCents).toBe(first.cents);
    expect(score.checksCorrect).toBe(first.cents === 99999 ? 1 : 0);
  });
});

describe("formatMoney", () => {
  it("groups thousands", () => {
    expect(formatMoney(128450)).toBe("$1,284.50");
  });
});

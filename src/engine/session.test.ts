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

  it("starts on a leading decimal for sub-dollar amounts", () => {
    const session = new TenkeySession({ durationMs: 60_000, practice: true, seed: 1 });
    const started = session.handleKey(key("."), 2000);
    expect(started.started).toBe(true);
    expect(session.phase).toBe("entering");
    expect(session.buffer.map((ch) => ch.ch).join("")).toBe(".");
  });

  it("treats number-row equals as plus", () => {
    const session = new TenkeySession({ durationMs: 60_000, practice: true, seed: 7 });
    const expected = canonicalEntry(session.current);
    typeAmount(session, expected, 0);
    const plus = session.handleKey(key("=", { code: "Equal" }), 30);
    expect(plus.submitted?.correct).toBe(true);
    expect(session.phase).toBe("awaiting_slide");
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

  it("does not let backspaced mash inflate net KPH on the last check", () => {
    const clean = new TenkeySession({ stackSize: 2, practice: true, seed: 9 });
    runCheck(clean, canonicalEntry(clean.current), 0);
    runCheck(clean, canonicalEntry(clean.current), 50);
    clean.finish(10_000);

    const mashed = new TenkeySession({ stackSize: 2, practice: true, seed: 9 });
    runCheck(mashed, canonicalEntry(mashed.current), 0);
    for (let i = 0; i < 400; i++) {
      mashed.handleKey(key("9"), 80 + i);
      mashed.handleKey(key("Backspace"), 80 + i);
    }
    runCheck(mashed, canonicalEntry(mashed.current), 500);
    mashed.finish(10_000);

    const cleanScore = clean.snapshot(10_000);
    const mashedScore = mashed.snapshot(10_000);
    expect(mashedScore.numericKeystrokes).toBe(cleanScore.numericKeystrokes);
    expect(mashedScore.checksSubmitted).toBe(cleanScore.checksSubmitted);
    expect(mashedScore.keystrokes).toBeGreaterThan(cleanScore.keystrokes);
    expect(mashedScore.amountAccuracy).toBe(1);
    expect(mashedScore.correctedErrors).toBe(400);
  });

  it("finishes a stack after the last plus and Tab", () => {
    const session = new TenkeySession({ stackSize: 2, practice: true, seed: 9 });
    expect(session.checks.length).toBe(2);
    runCheck(session, canonicalEntry(session.current), 0);
    expect(session.phase).not.toBe("done");
    const last = session.current;
    typeAmount(session, canonicalEntry(last), 50);
    session.handleKey(key("+"), 51);
    const done = session.handleKey(tab(), 52);
    expect(done.finished).toBe(true);
    expect(session.phase).toBe("done");
    expect(session.submissions).toHaveLength(2);
  });

  it("finishes a stack when Tab comes before plus on the last check", () => {
    const session = new TenkeySession({ stackSize: 1, practice: true, seed: 3 });
    const expected = canonicalEntry(session.current);
    typeAmount(session, expected, 0);
    session.handleKey(tab(), 1);
    expect(session.phase).toBe("awaiting_plus");
    const plus = session.handleKey(key("+"), 2);
    expect(plus.finished).toBe(true);
    expect(session.phase).toBe("done");
    expect(session.submissions).toHaveLength(1);
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

describe("spreadsheet desk", () => {
  function enter(extras: Partial<KeyInput> = {}): KeyInput {
    return key("Enter", { code: extras.code ?? "Enter" });
  }

  it("commits with Enter instead of plus", () => {
    const session = new TenkeySession({
      durationMs: 60_000,
      practice: true,
      seed: 7,
      desk: "spreadsheet",
    });
    const first = session.current;
    typeAmount(session, canonicalEntry(first), 0);
    const plus = session.handleKey(key("+"), 30);
    expect(plus.submitted).toBeNull();
    expect(plus.kind).toBe("extra");
    expect(session.submissions).toHaveLength(0);
    const committed = session.handleKey(enter(), 31);
    expect(committed.submitted?.correct).toBe(true);
    expect(session.phase).toBe("awaiting_slide");
  });

  it("accepts NumpadEnter and Tab in either order", () => {
    const session = new TenkeySession({
      stackSize: 1,
      practice: true,
      seed: 3,
      desk: "spreadsheet",
    });
    typeAmount(session, canonicalEntry(session.current), 0);
    session.handleKey(tab(), 1);
    expect(session.phase).toBe("awaiting_plus");
    const done = session.handleKey(enter({ code: "NumpadEnter" }), 2);
    expect(done.finished).toBe(true);
    expect(session.submissions).toHaveLength(1);
  });

  it("counts Enter as a productive plus keystroke", () => {
    const session = new TenkeySession({
      durationMs: 3_600_000,
      practice: true,
      seed: 8,
      desk: "spreadsheet",
    });
    typeAmount(session, canonicalEntry(session.current), 0);
    session.handleKey(enter(), 10);
    session.handleKey(tab(), 11);
    const score = session.snapshot(3_600_000);
    expect(session.events.some((event) => event.kind === "plus" && event.key === "Enter")).toBe(
      true,
    );
    expect(score.keystrokes).toBeGreaterThan(1);
  });

  it("treats Enter as extra on the calculator desk", () => {
    const session = new TenkeySession({ durationMs: 60_000, practice: true, seed: 7 });
    typeAmount(session, canonicalEntry(session.current), 0);
    const result = session.handleKey(enter(), 30);
    expect(result.kind).toBe("extra");
    expect(session.submissions).toHaveLength(0);
    const plus = session.handleKey(key("+"), 31);
    expect(plus.submitted?.correct).toBe(true);
  });

  it("treats number-row equals as plus, not a spreadsheet commit", () => {
    const session = new TenkeySession({
      durationMs: 60_000,
      practice: true,
      seed: 7,
      desk: "spreadsheet",
    });
    typeAmount(session, canonicalEntry(session.current), 0);
    const equals = session.handleKey(key("=", { code: "Equal" }), 30);
    expect(equals.kind).toBe("extra");
    expect(session.submissions).toHaveLength(0);
  });
});

describe("transcription source", () => {
  it("commits and advances on plus without Tab", () => {
    const session = new TenkeySession({
      stackSize: 2,
      practice: true,
      seed: 9,
      source: "transcription",
    });
    expect(session.checks.length).toBe(2);
    expect(session.current.amountHand).toBe("print-mono");
    typeAmount(session, canonicalEntry(session.current), 0);
    const plus = session.handleKey(key("+"), 10);
    expect(plus.submitted?.correct).toBe(true);
    expect(session.currentIndex).toBe(1);
    expect(session.entryIndex).toBe(1);
    expect(session.phase).toBe("entering");
    expect(session.phase).not.toBe("awaiting_slide");
  });

  it("ignores Tab instead of sliding", () => {
    const session = new TenkeySession({
      stackSize: 2,
      practice: true,
      seed: 9,
      source: "transcription",
    });
    typeAmount(session, canonicalEntry(session.current), 0);
    const slid = session.handleKey(tab(), 10);
    expect(slid.kind).toBe("ignored");
    expect(session.currentIndex).toBe(0);
    expect(session.submissions).toHaveLength(0);
    const plus = session.handleKey(key("+"), 11);
    expect(plus.submitted?.correct).toBe(true);
  });

  it("finishes a list on the last plus", () => {
    const session = new TenkeySession({
      stackSize: 1,
      practice: true,
      seed: 3,
      source: "transcription",
    });
    typeAmount(session, canonicalEntry(session.current), 0);
    const done = session.handleKey(key("+"), 2);
    expect(done.finished).toBe(true);
    expect(session.phase).toBe("done");
    expect(session.submissions).toHaveLength(1);
  });

  it("commits with Enter on the spreadsheet desk", () => {
    const session = new TenkeySession({
      stackSize: 1,
      practice: true,
      seed: 3,
      source: "transcription",
      desk: "spreadsheet",
    });
    typeAmount(session, canonicalEntry(session.current), 0);
    const plus = session.handleKey(key("+"), 1);
    expect(plus.kind).toBe("extra");
    expect(session.submissions).toHaveLength(0);
    const done = session.handleKey(key("Enter", { code: "Enter" }), 2);
    expect(done.finished).toBe(true);
    expect(session.submissions).toHaveLength(1);
  });

  it("does not treat Enter as a commit on the calculator desk", () => {
    const session = new TenkeySession({
      stackSize: 1,
      practice: true,
      seed: 3,
      source: "transcription",
    });
    typeAmount(session, canonicalEntry(session.current), 0);
    const enter = session.handleKey(key("Enter", { code: "Enter" }), 1);
    expect(enter.kind).toBe("extra");
    expect(session.submissions).toHaveLength(0);
    const plus = session.handleKey(key("+"), 2);
    expect(plus.finished).toBe(true);
  });
});

describe("formatMoney", () => {
  it("groups thousands", () => {
    expect(formatMoney(128450)).toBe("$1,284.50");
  });
});

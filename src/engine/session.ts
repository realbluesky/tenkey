import { generateCheck, isAcceptable, parseEntry } from "./amounts";
import { mulberry32 } from "./rng";
import { computeScore } from "./scoring";
import type {
  BufferChar,
  CheckItem,
  HandleResult,
  KeyInput,
  KeyKind,
  Keystroke,
  Phase,
  Score,
  Submission,
} from "./types";

const MAX_BUFFER = 16;

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isDigitKey(input: KeyInput): boolean {
  return /^[0-9]$/.test(input.key);
}

export function isDecimalKey(input: KeyInput): boolean {
  return input.key === "." || input.code === "NumpadDecimal" || input.key === "Decimal";
}

export function isPlusKey(input: KeyInput): boolean {
  return input.key === "+" || input.code === "NumpadAdd";
}

export function isSlideKey(input: KeyInput): boolean {
  return input.key === "Tab" || input.code === "Tab";
}

export function isBackspaceKey(input: KeyInput): boolean {
  return input.key === "Backspace" || input.code === "Backspace";
}

function isPrintable(input: KeyInput): boolean {
  return input.key.length === 1;
}

export class TenkeySession {
  readonly durationMs: number;
  readonly seed: number;
  readonly practice: boolean;
  readonly id: string;
  phase: Phase = "armed";
  startedAt: number | null = null;
  endedAt: number | null = null;
  checks: CheckItem[] = [];
  currentIndex = 0;
  buffer: BufferChar[] = [];
  events: Keystroke[] = [];
  submissions: Submission[] = [];
  lastSubmitted: Submission | null = null;
  lastSlideAt: number | null = null;

  private rng: () => number;
  private startNumber: number;

  constructor(opts: {
    durationMs: number;
    seed?: number;
    practice: boolean;
    id?: string;
  }) {
    this.durationMs = opts.durationMs;
    this.seed = opts.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
    this.practice = opts.practice;
    this.id = opts.id ?? createId();
    this.rng = mulberry32(this.seed);
    this.startNumber = 1000 + Math.floor(this.rng() * 8000);
    this.checks.push(generateCheck(this.rng, 0, this.startNumber));
    this.ensureLookahead();
  }

  get current(): CheckItem {
    return this.checks[this.currentIndex]!;
  }

  remainingMs(now: number): number {
    if (this.phase === "done") return 0;
    if (this.phase === "aborted" || this.startedAt == null) return this.durationMs;
    return Math.max(0, this.durationMs - (now - this.startedAt));
  }

  snapshot(now: number): Score {
    return computeScore(
      {
        startedAt: this.startedAt,
        endedAt: this.endedAt,
        durationMs: this.durationMs,
        events: this.events,
        submissions: this.submissions,
        buffer: this.buffer,
        phase: this.phase,
      },
      now,
    );
  }

  tick(now: number): boolean {
    if (this.phase === "done" || this.phase === "aborted") return false;
    if (this.startedAt != null && now - this.startedAt >= this.durationMs) {
      this.finish(now);
      return true;
    }
    return false;
  }

  abort(now: number): void {
    if (this.phase === "done" || this.phase === "aborted") return;
    this.phase = "aborted";
    this.endedAt = now;
  }

  finish(now: number): void {
    if (this.phase === "done" || this.phase === "aborted") return;
    this.phase = "done";
    this.endedAt = this.startedAt != null ? this.startedAt + this.durationMs : now;
  }

  handleKey(input: KeyInput, now: number): HandleResult {
    const empty: HandleResult = {
      kind: "ignored",
      started: false,
      submitted: null,
      slid: false,
      finished: false,
    };
    if (this.phase === "done" || this.phase === "aborted") return empty;
    if (this.tick(now)) {
      return { ...empty, finished: true };
    }

    if (this.phase === "armed") {
      if (!isDigitKey(input)) return empty;
      this.startedAt = now;
      this.phase = "entering";
      this.pushDigit(input, now);
      return { kind: "digit", started: true, submitted: null, slid: false, finished: false };
    }

    if (this.phase === "entering") {
      return this.handleEntering(input, now);
    }

    return this.handleAwaitingSlide(input, now);
  }

  private handleEntering(input: KeyInput, now: number): HandleResult {
    if (isDigitKey(input)) {
      this.pushDigit(input, now);
      return this.result("digit");
    }
    if (isDecimalKey(input)) {
      const hasDecimal = this.buffer.some((ch) => ch.ch === "." && !ch.miskey);
      if (hasDecimal) {
        this.pushChar(".", true, now, "miskey");
        return this.result("miskey");
      }
      this.pushChar(".", false, now, "decimal");
      return this.result("decimal");
    }
    if (isBackspaceKey(input)) {
      if (this.buffer.length === 0) {
        this.record(input, now, "extra");
        return this.result("extra");
      }
      this.buffer.pop();
      this.record(input, now, "backspace");
      return this.result("backspace");
    }
    if (isPlusKey(input)) {
      return this.submit(input, now);
    }
    if (isSlideKey(input)) {
      this.record(input, now, "extra");
      return this.result("extra");
    }
    if (isPrintable(input)) {
      this.pushChar(input.key, true, now, "miskey");
      return this.result("miskey");
    }
    this.record(input, now, "ignored");
    return this.result("ignored");
  }

  private handleAwaitingSlide(input: KeyInput, now: number): HandleResult {
    if (isSlideKey(input)) {
      this.currentIndex += 1;
      this.ensureLookahead();
      this.lastSlideAt = now;
      this.lastSubmitted = null;
      this.phase = "entering";
      this.record(input, now, "slide");
      return { kind: "slide", started: false, submitted: null, slid: true, finished: false };
    }
    this.record(input, now, "extra");
    return this.result("extra");
  }

  private submit(input: KeyInput, now: number): HandleResult {
    const raw = this.buffer.map((ch) => ch.ch).join("");
    if (raw.length === 0) {
      this.record(input, now, "extra");
      return this.result("extra");
    }
    const check = this.current;
    const parsedCents = parseEntry(raw);
    const correct = isAcceptable(check, raw);
    const submission: Submission = {
      check,
      raw,
      parsedCents,
      correct,
      atMs: now,
    };
    this.submissions.push(submission);
    this.lastSubmitted = submission;
    this.buffer = [];
    this.phase = "awaiting_slide";
    this.record(input, now, "plus");
    return { kind: "plus", started: false, submitted: submission, slid: false, finished: false };
  }

  private pushDigit(input: KeyInput, now: number): void {
    this.pushChar(input.key, false, now, "digit");
  }

  private pushChar(ch: string, miskey: boolean, now: number, kind: KeyKind): void {
    if (this.buffer.length >= MAX_BUFFER) {
      this.record({ key: ch, code: "", location: 0 }, now, "extra");
      return;
    }
    this.buffer.push({ ch, miskey });
    this.record({ key: ch, code: "", location: 0 }, now, kind);
  }

  private record(input: KeyInput, now: number, kind: KeyKind): void {
    this.events.push({
      atMs: now,
      key: input.key,
      code: input.code,
      kind,
    });
  }

  private result(kind: KeyKind): HandleResult {
    return { kind, started: false, submitted: null, slid: false, finished: false };
  }

  private ensureLookahead(): void {
    while (this.checks.length < this.currentIndex + 4) {
      const index = this.checks.length;
      this.checks.push(generateCheck(this.rng, index, this.startNumber));
    }
  }
}

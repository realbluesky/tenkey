import { generateCheck, isAcceptable, parseEntry } from "./amounts";
import { mulberry32 } from "./rng";
import { computeScore } from "./scoring";
import type {
  BufferChar,
  CheckItem,
  DeskKind,
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

export function isEnterKey(input: KeyInput): boolean {
  return input.key === "Enter" || input.code === "Enter" || input.code === "NumpadEnter";
}

export function isCommitKey(input: KeyInput, desk: DeskKind = "calculator"): boolean {
  return desk === "spreadsheet" ? isEnterKey(input) : isPlusKey(input);
}

export function isSlideKey(input: KeyInput): boolean {
  return (input.key === "Tab" || input.code === "Tab") && !input.shiftKey;
}

export function isUnslideKey(input: KeyInput): boolean {
  return (input.key === "Tab" || input.code === "Tab") && !!input.shiftKey;
}

export function isBackspaceKey(input: KeyInput): boolean {
  return input.key === "Backspace" || input.code === "Backspace";
}

function isPrintable(input: KeyInput): boolean {
  return input.key.length === 1;
}

export class TenkeySession {
  readonly durationMs: number;
  readonly stackSize: number | null;
  readonly seed: number;
  readonly practice: boolean;
  readonly desk: DeskKind;
  readonly id: string;
  phase: Phase = "armed";
  startedAt: number | null = null;
  endedAt: number | null = null;
  checks: CheckItem[] = [];
  currentIndex = 0;
  entryIndex = 0;
  buffer: BufferChar[] = [];
  events: Keystroke[] = [];
  submissions: Submission[] = [];
  lastSubmitted: Submission | null = null;
  lastSlideAt: number | null = null;

  private rng: () => number;
  private startNumber: number;

  constructor(opts: {
    durationMs?: number;
    stackSize?: number | null;
    seed?: number;
    practice: boolean;
    desk?: DeskKind;
    id?: string;
  }) {
    this.stackSize = opts.stackSize ?? null;
    this.durationMs = this.stackSize ? 0 : (opts.durationMs ?? 60_000);
    this.seed = opts.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
    this.practice = opts.practice;
    this.desk = opts.desk ?? "calculator";
    this.id = opts.id ?? createId();
    this.rng = mulberry32(this.seed);
    this.startNumber = 1000 + Math.floor(this.rng() * 8000);
    this.checks.push(generateCheck(this.rng, 0, this.startNumber));
    this.ensureLookahead();
  }

  get current(): CheckItem {
    return this.checks[this.currentIndex]!;
  }

  get entryCheck(): CheckItem {
    return this.checks[this.entryIndex]!;
  }

  remainingMs(now: number): number {
    if (this.durationMs <= 0) return 0;
    if (this.phase === "done") return 0;
    if (this.phase === "aborted" || this.startedAt == null) return this.durationMs;
    return Math.max(0, this.durationMs - (now - this.startedAt));
  }

  elapsedMs(now: number): number {
    if (this.startedAt == null) return 0;
    const ended = this.endedAt ?? now;
    return Math.max(0, ended - this.startedAt);
  }

  get clearedCount(): number {
    return Math.min(this.submissions.length, this.currentIndex);
  }

  get hasCurrentCheck(): boolean {
    return this.stackSize == null || this.currentIndex < this.stackSize;
  }

  isStackComplete(): boolean {
    return (
      this.stackSize != null &&
      this.submissions.length >= this.stackSize &&
      this.currentIndex >= this.stackSize
    );
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
    if (
      this.durationMs > 0 &&
      this.startedAt != null &&
      now - this.startedAt >= this.durationMs
    ) {
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
    if (this.durationMs > 0 && this.startedAt != null) {
      this.endedAt = Math.min(now, this.startedAt + this.durationMs);
    } else {
      this.endedAt = now;
    }
  }

  handleKey(input: KeyInput, now: number): HandleResult {
    const empty: HandleResult = {
      kind: "ignored",
      started: false,
      submitted: null,
      slid: false,
      unslid: false,
      recycle: false,
      finished: false,
    };
    if (this.phase === "done" || this.phase === "aborted") return empty;
    if (this.tick(now)) {
      return { ...empty, finished: true };
    }

    if (this.phase === "armed") {
      if (isDigitKey(input)) {
        this.startedAt = now;
        this.phase = "entering";
        this.pushDigit(input, now);
        return { ...empty, kind: "digit", started: true };
      }
      if (isDecimalKey(input)) {
        this.startedAt = now;
        this.phase = "entering";
        const started = this.handleEntering(input, now);
        return { ...started, started: true };
      }
      return empty;
    }

    let result: HandleResult;
    if (this.phase === "entering") result = this.handleEntering(input, now);
    else if (this.phase === "awaiting_plus") result = this.handleAwaitingPlus(input, now);
    else result = this.handleAwaitingSlide(input, now);
    if (this.isStackComplete()) {
      this.finish(now);
      return { ...result, finished: true };
    }
    return result;
  }

  private handleEntering(input: KeyInput, now: number): HandleResult {
    if (isUnslideKey(input)) {
      this.record(input, now, "extra");
      return this.result("extra");
    }
    if (isSlideKey(input)) {
      if (this.stackSize != null && this.currentIndex >= this.stackSize) {
        this.record(input, now, "extra");
        return this.result("extra");
      }
      this.currentIndex += 1;
      this.ensureLookahead();
      this.lastSlideAt = now;
      this.phase = "awaiting_plus";
      this.record(input, now, "slide");
      return this.result("slide", { slid: true, recycle: false });
    }
    if (isCommitKey(input, this.desk)) {
      return this.submit(input, now, "awaiting_slide", false);
    }
    if (isPlusKey(input) || isEnterKey(input)) {
      this.record(input, now, "extra");
      return this.result("extra");
    }
    return this.handleBuffer(input, now);
  }

  private handleAwaitingPlus(input: KeyInput, now: number): HandleResult {
    if (isUnslideKey(input)) {
      this.currentIndex = this.entryIndex;
      this.phase = "entering";
      this.record(input, now, "unslide");
      return this.result("unslide", { unslid: true });
    }
    if (isSlideKey(input)) {
      this.record(input, now, "extra");
      return this.result("extra");
    }
    if (isCommitKey(input, this.desk)) {
      return this.submit(input, now, "entering", true);
    }
    if (isPlusKey(input) || isEnterKey(input)) {
      this.record(input, now, "extra");
      return this.result("extra");
    }
    return this.handleBuffer(input, now);
  }

  private handleAwaitingSlide(input: KeyInput, now: number): HandleResult {
    if (isSlideKey(input)) {
      if (this.stackSize != null && this.currentIndex >= this.stackSize) {
        this.record(input, now, "extra");
        return this.result("extra");
      }
      this.currentIndex += 1;
      this.entryIndex = this.currentIndex;
      this.ensureLookahead();
      this.lastSlideAt = now;
      this.lastSubmitted = null;
      this.phase = "entering";
      this.record(input, now, "slide");
      return this.result("slide", { slid: true, recycle: true });
    }
    this.record(input, now, "extra");
    return this.result("extra");
  }

  private handleBuffer(input: KeyInput, now: number): HandleResult {
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
    if (isPrintable(input)) {
      this.pushChar(input.key, true, now, "miskey");
      return this.result("miskey");
    }
    this.record(input, now, "ignored");
    return this.result("ignored");
  }

  private submit(
    input: KeyInput,
    now: number,
    nextPhase: "awaiting_slide" | "entering",
    recycle: boolean,
  ): HandleResult {
    const raw = this.buffer.map((ch) => ch.ch).join("");
    if (raw.length === 0) {
      this.record(input, now, "extra");
      return this.result("extra");
    }
    const check = this.entryCheck;
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
    if (nextPhase === "entering") {
      this.entryIndex = this.currentIndex;
    }
    this.phase = nextPhase;
    this.record(input, now, "plus");
    return this.result("plus", { submitted: submission, recycle });
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

  private result(kind: KeyKind, extra: Partial<HandleResult> = {}): HandleResult {
    return {
      kind,
      started: false,
      submitted: null,
      slid: false,
      unslid: false,
      recycle: false,
      finished: false,
      ...extra,
    };
  }

  private ensureLookahead(): void {
    while (this.checks.length < this.currentIndex + 4) {
      if (this.stackSize != null && this.checks.length >= this.stackSize) return;
      const index = this.checks.length;
      this.checks.push(generateCheck(this.rng, index, this.startNumber));
    }
  }
}

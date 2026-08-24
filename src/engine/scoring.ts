import { acceptableStrings } from "./amounts";
import type { Phase, Score, Submission } from "./types";
import type { Keystroke } from "./types";
import type { BufferChar } from "./types";

export function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[] = new Array(rows * cols).fill(0);
  for (let i = 0; i < rows; i++) dp[i * cols] = i;
  for (let j = 0; j < cols; j++) dp[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i * cols + j] = Math.min(
        dp[(i - 1) * cols + j]! + 1,
        dp[i * cols + (j - 1)]! + 1,
        dp[(i - 1) * cols + (j - 1)]! + cost,
      );
    }
  }
  return dp[(rows - 1) * cols + (cols - 1)]!;
}

export function uncorrectedCharsFor(sub: Submission): number {
  if (sub.correct) return 0;
  const options = acceptableStrings(sub.check);
  let best = Infinity;
  for (const option of options) {
    best = Math.min(best, levenshtein(sub.raw, option));
  }
  return best === Infinity ? sub.raw.length : best;
}

export function computeScore(input: {
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  events: Keystroke[];
  submissions: Submission[];
  buffer: BufferChar[];
  phase: Phase;
}, now: number): Score {
  const started = input.startedAt ?? now;
  const ended = input.endedAt ?? now;
  let elapsedMs = Math.max(0, ended - started);
  if (input.durationMs > 0) elapsedMs = Math.min(input.durationMs, elapsedMs);
  const hours = elapsedMs / 3_600_000;

  const counted = input.events.filter((event) => event.kind !== "ignored");
  const keystrokes = counted.length;
  const numericKeystrokes = counted.filter(
    (event) => event.kind === "digit" || event.kind === "decimal",
  ).length;
  const correctedErrors = counted.filter((event) => event.kind === "backspace").length;
  const leftoverRaw = input.buffer.map((ch) => ch.ch).join("");

  const uncorrectedChars = input.submissions.reduce(
    (sum, sub) => sum + uncorrectedCharsFor(sub),
    0,
  );

  const checksSubmitted = input.submissions.length;
  const checksCorrect = input.submissions.filter((sub) => sub.correct).length;
  const uncorrectedErrors = checksSubmitted - checksCorrect;

  const errorKeys = counted.filter(
    (event) =>
      event.kind === "miskey" ||
      event.kind === "backspace" ||
      event.kind === "extra" ||
      event.kind === "unslide",
  ).length;

  const grossKph = hours > 0 ? keystrokes / hours : 0;
  const netKph = hours > 0 ? Math.max(0, keystrokes - errorKeys) / hours : 0;
  const numericKph = hours > 0 ? numericKeystrokes / hours : 0;

  const expectedChars = input.submissions.reduce((sum, sub) => {
    const canonical = acceptableStrings(sub.check)[0]!;
    return sum + canonical.length;
  }, 0);

  const uncorrectedAccuracy =
    expectedChars + uncorrectedChars === 0
      ? 1
      : Math.max(0, 1 - uncorrectedChars / Math.max(expectedChars, 1));

  const correctedAccuracy =
    expectedChars + uncorrectedChars + correctedErrors === 0
      ? 1
      : Math.max(
          0,
          1 - (uncorrectedChars + correctedErrors) / (expectedChars + correctedErrors),
        );

  const amountAccuracy =
    checksSubmitted === 0 ? 1 : checksCorrect / checksSubmitted;

  const enteredTotalCents = input.submissions.reduce(
    (sum, sub) => sum + (sub.parsedCents ?? 0),
    0,
  );
  const trueTotalCents = input.submissions.reduce((sum, sub) => sum + sub.check.cents, 0);

  return {
    elapsedMs,
    durationMs: input.durationMs,
    grossKph,
    netKph,
    numericKph,
    uncorrectedAccuracy,
    correctedAccuracy,
    amountAccuracy,
    keystrokes,
    numericKeystrokes,
    correctedErrors,
    uncorrectedErrors,
    uncorrectedChars,
    checksSubmitted,
    checksCorrect,
    enteredTotalCents,
    trueTotalCents,
    leftoverRaw,
  };
}

export function kphBand(netKph: number): string {
  if (netKph < 6000) return "Developing";
  if (netKph < 8000) return "Entry";
  if (netKph < 10000) return "Job-ready";
  if (netKph < 12000) return "Strong";
  return "Professional";
}

export function formatKph(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "stack";
  if (ms < 60_000) return `${Math.round(ms / 1000)} seconds`;
  const minutes = ms / 60_000;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function goalLabel(session: { stackSize?: number | null; durationMs: number }): string {
  if (session.stackSize && session.stackSize > 0) {
    return session.stackSize === 1 ? "1 check" : `${session.stackSize} checks`;
  }
  return formatDuration(session.durationMs);
}

export type Phase = "armed" | "entering" | "awaiting_slide" | "done" | "aborted";

export type KeyKind =
  | "digit"
  | "decimal"
  | "plus"
  | "slide"
  | "backspace"
  | "miskey"
  | "extra"
  | "ignored";

export type KeyInput = {
  key: string;
  code: string;
  location: number;
};

export type BufferChar = {
  ch: string;
  miskey: boolean;
};

export type AmountHand = "print-mono" | "print-serif" | "print-sans" | "hand-loop" | "hand-block";
export type AmountSize = "sm" | "md" | "lg" | "xl";

export type CheckItem = {
  index: number;
  checkNumber: number;
  payee: string;
  memo: string;
  cents: number;
  wholeDollar: boolean;
  amountHand: AmountHand;
  amountSize: AmountSize;
  amountTilt: number;
};

export type Submission = {
  check: CheckItem;
  raw: string;
  parsedCents: number | null;
  correct: boolean;
  atMs: number;
};

export type Keystroke = {
  atMs: number;
  key: string;
  code: string;
  kind: KeyKind;
};

export type Score = {
  elapsedMs: number;
  durationMs: number;
  grossKph: number;
  netKph: number;
  numericKph: number;
  uncorrectedAccuracy: number;
  correctedAccuracy: number;
  amountAccuracy: number;
  keystrokes: number;
  numericKeystrokes: number;
  correctedErrors: number;
  uncorrectedErrors: number;
  uncorrectedChars: number;
  checksSubmitted: number;
  checksCorrect: number;
  enteredTotalCents: number;
  trueTotalCents: number;
  leftoverRaw: string;
};

export type HandleResult = {
  kind: KeyKind;
  started: boolean;
  submitted: Submission | null;
  slid: boolean;
  finished: boolean;
};

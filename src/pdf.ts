import { jsPDF } from "jspdf";
import { formatMoney } from "./engine/amounts";
import { formatClock, formatKph, formatPct, goalLabel, kphBand } from "./engine/scoring";
import { bestsByGoal, type StoredSession, type Store } from "./storage";
import type { Score } from "./engine/types";
import { VERSION } from "./version";

const INK = "#1c1916";
const MUTED = "#5c5348";
const GREEN = "#1c4534";
const RULE = "#cbb99a";
const PAPER = "#f7f1e4";

export type ReportSession = {
  name: string;
  at: number;
  durationMs: number;
  stackSize: number | null;
  practice: boolean;
  score: Score;
  sessionId: string;
  seed: number;
};

function stampHeader(doc: jsPDF, title: string): number {
  doc.setFillColor(GREEN);
  doc.rect(0, 0, 612, 86, "F");
  doc.setFillColor(196, 163, 90);
  doc.rect(0, 86, 612, 4, "F");
  doc.setTextColor(247, 241, 228);
  doc.setFont("times", "bold");
  doc.setFontSize(22);
  doc.text("TENKEY", 40, 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(214, 196, 150);
  doc.text(`v${VERSION}`, 572, 38, { align: "right" });
  doc.setFontSize(10);
  doc.text("NUMERIC ENTRY EXAMINATION", 40, 56);
  doc.setTextColor(247, 241, 228);
  doc.setFontSize(14);
  doc.text(title, 40, 74);
  return 114;
}

function footer(doc: jsPDF, page = 1): void {
  doc.setDrawColor(RULE);
  doc.line(40, 748, 572, 748);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(
    "Self-administered on this device. Results are stored locally and are not independently proctored.",
    40,
    762,
  );
  doc.text(`v${VERSION}  ·  Page ${page}`, 572, 762, { align: "right" });
}

function metric(doc: jsPDF, x: number, y: number, label: string, value: string): void {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(label.toUpperCase(), x, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(INK);
  doc.text(value, x, y + 18);
}

export function downloadSessionReport(report: ReportSession): void {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFillColor(PAPER);
  doc.rect(0, 0, 612, 792, "F");
  let y = stampHeader(doc, "Check Totals Report");

  const operator = report.name.trim() || "Anonymous";
  const when = new Date(report.at).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  doc.setTextColor(INK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Operator  ${operator}`, 40, y);
  doc.text(`Date  ${when}`, 320, y);
  y += 18;
  doc.text(
    `Length  ${goalLabel(report)}  (${formatClock(report.score.elapsedMs)} elapsed)`,
    40,
    y,
  );
  doc.text(`Mode  Check Totals · ${report.practice ? "Practice" : "Exam"}`, 320, y);
  y += 28;

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(RULE);
  doc.roundedRect(40, y, 532, 96, 4, 4, "FD");
  metric(doc, 56, y + 22, "Net KPH", formatKph(report.score.netKph));
  metric(doc, 190, y + 22, "Gross KPH", formatKph(report.score.grossKph));
  metric(doc, 330, y + 22, "Accuracy", formatPct(report.score.amountAccuracy));
  metric(doc, 470, y + 22, "Corrected accuracy", formatPct(report.score.correctedAccuracy));
  y += 118;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(GREEN);
  doc.text("Detail", 40, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(INK);

  const rows: [string, string][] = [
    ["Band", kphBand(report.score.netKph)],
    ["Numeric KPH", formatKph(report.score.numericKph)],
    ["Keystrokes", String(report.score.keystrokes)],
    ["Corrected errors (backspaces)", String(report.score.correctedErrors)],
    ["Uncorrected errors", String(report.score.uncorrectedErrors)],
    ["Checks correct / submitted", `${report.score.checksCorrect} / ${report.score.checksSubmitted}`],
    ["Entered total", formatMoney(report.score.enteredTotalCents)],
    ["True total of submitted checks", formatMoney(report.score.trueTotalCents)],
    ["Session ID", report.sessionId],
    ["Seed", String(report.seed)],
  ];

  for (const [label, value] of rows) {
    doc.setTextColor(MUTED);
    doc.text(label, 40, y);
    doc.setTextColor(INK);
    doc.text(value, 572, y, { align: "right" });
    y += 16;
  }

  y += 18;
  doc.setFont("times", "italic");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  const note = [
    "Net KPH counts productive keystrokes (digits, decimal, +, and slide) scaled to an hour.",
    "Gross KPH includes miskeys, extra keys, and backspaces. Numeric KPH counts only 0–9 and the decimal.",
    "Trailing zeros after the decimal may be omitted (4 for $4.00, 73.7 for $73.70).",
    "Accuracy is submitted checks that ended up right after any backspaces. Uncorrected errors are wrong submitted amounts only; an unfinished check when time expires is not an error. Corrected accuracy also treats backspaces as errors.",
  ].join(" ");
  const wrapped = doc.splitTextToSize(note, 532);
  doc.text(wrapped, 40, y);

  footer(doc);
  const slug = slugName(operator);
  doc.save(`tenkey-${slug}-${stamp(report.at)}.pdf`);
}

export function downloadBestsReport(store: Store): void {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFillColor(PAPER);
  doc.rect(0, 0, 612, 792, "F");
  let y = stampHeader(doc, "Official Best Results");

  const operator = store.name.trim() || "Anonymous";
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(INK);
  doc.text(`Operator  ${operator}`, 40, y);
  doc.text(`Prepared  ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`, 320, y);
  y += 28;

  const bests = bestsByGoal(store);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(GREEN);
  doc.text("Exam personal bests", 40, y);
  y += 18;

  if (bests.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    doc.text("No exam sessions recorded yet. Exam mode results appear here.", 40, y);
    y += 24;
  } else {
    y = table(
      doc,
      y,
      ["Length", "Net KPH", "Accuracy", "Checks", "Date"],
      bests.map((session) => [
        goalLabel(session),
        formatKph(session.score.netKph),
        formatPct(session.score.amountAccuracy),
        `${session.score.checksCorrect}/${session.score.checksSubmitted}`,
        new Date(session.at).toLocaleDateString("en-US"),
      ]),
    );
  }

  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(GREEN);
  doc.text("Recent sessions", 40, y);
  y += 18;

  const recent = store.sessions.slice(0, 12);
  if (recent.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    doc.text("No sessions stored on this device.", 40, y);
  } else {
    table(
      doc,
      y,
      ["When", "Mode", "Time", "Net KPH", "Accuracy"],
      recent.map((session) => [
        new Date(session.at).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }),
        session.practice ? "Practice" : "Exam",
        goalLabel(session),
        formatKph(session.score.netKph),
        formatPct(session.score.amountAccuracy),
      ]),
    );
  }

  footer(doc);
  doc.save(`tenkey-bests-${slugName(operator)}-${stamp(Date.now())}.pdf`);
}

function table(doc: jsPDF, y: number, headers: string[], rows: string[][]): number {
  const cols = [40, 150, 260, 370, 470];
  doc.setFillColor(GREEN);
  doc.rect(40, y - 12, 532, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(247, 241, 228);
  headers.forEach((header, i) => doc.text(header.toUpperCase(), cols[i]!, y));
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  rows.forEach((row, r) => {
    if (r % 2 === 0) {
      doc.setFillColor(255, 255, 255);
      doc.rect(40, y - 12, 532, 20, "F");
    }
    doc.setTextColor(INK);
    row.forEach((cell, i) => doc.text(cell, cols[i]!, y));
    y += 20;
  });
  return y;
}

function slugName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "operator";
}

function stamp(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function sessionToReport(
  session: StoredSession,
  fallbackName: string,
): ReportSession {
  return {
    name: session.name || fallbackName,
    at: session.at,
    durationMs: session.durationMs,
    stackSize: session.stackSize ?? null,
    practice: session.practice,
    score: session.score,
    sessionId: session.id,
    seed: session.seed,
  };
}

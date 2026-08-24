import { committedNetFromEvents, isDeskKind } from "./scoring";
import type { Keystroke } from "./types";

export type PacePoint = {
  t: number;
  kph: number;
};

const WARMUP_MS = 2000;
const MAX_POINTS = 56;

export function buildPace(
  events: Keystroke[],
  startedAt: number,
  endedAt: number,
  points = MAX_POINTS,
): PacePoint[] {
  const elapsed = Math.max(0, endedAt - startedAt);
  if (elapsed <= 0) return [];
  const counted = events
    .filter((event) => event.kind !== "ignored" && !isDeskKind(event.kind))
    .slice()
    .sort((a, b) => a.atMs - b.atMs);
  if (counted.length === 0) return [];

  const warmup = elapsed <= WARMUP_MS + 400 ? Math.min(400, elapsed * 0.2) : WARMUP_MS;
  const span = elapsed - warmup;
  if (span <= 0) return [];
  const n = Math.max(2, Math.min(points, Math.floor(span / 200) + 1));

  const series: PacePoint[] = [];
  for (let p = 0; p < n; p++) {
    const t = warmup + (span * p) / (n - 1);
    const at = startedAt + t;
    const hours = t / 3_600_000;
    const keys = committedNetFromEvents(counted, at);
    const kph = hours > 0 ? keys / hours : 0;
    series.push({ t: Math.round(t), kph: Math.round(kph) });
  }
  return series;
}

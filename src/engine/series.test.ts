import { describe, expect, it } from "vitest";
import { buildPace } from "./series";
import type { Keystroke } from "./types";

function strokes(count: number, start: number, step: number, kind: Keystroke["kind"] = "digit"): Keystroke[] {
  return Array.from({ length: count }, (_, i) => ({
    atMs: start + i * step,
    key: "1",
    code: "",
    kind,
  }));
}

describe("buildPace", () => {
  it("returns an empty series without events", () => {
    expect(buildPace([], 0, 10_000)).toEqual([]);
  });

  it("builds a rising net-KPH line after warmup", () => {
    const slow = strokes(10, 0, 400);
    const fast = strokes(80, 4000, 50);
    const series = buildPace([...slow, ...fast], 0, 8000, 6);
    expect(series.length).toBeGreaterThan(1);
    expect(series[0]!.t).toBeGreaterThanOrEqual(2000);
    expect(series[series.length - 1]!.kph).toBeGreaterThan(series[0]!.kph);
  });

  it("drops when error keys pile up", () => {
    const clean = strokes(40, 0, 100);
    const sloppy = strokes(40, 4000, 50, "miskey");
    const series = buildPace([...clean, ...sloppy], 0, 8000, 8);
    const mid = series[Math.floor(series.length / 2)]!.kph;
    const end = series[series.length - 1]!.kph;
    expect(end).toBeLessThan(mid);
  });
});

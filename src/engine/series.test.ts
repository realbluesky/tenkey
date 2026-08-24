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

function plusAt(atMs: number): Keystroke {
  return { atMs, key: "+", code: "", kind: "plus" };
}

describe("buildPace", () => {
  it("returns an empty series without events", () => {
    expect(buildPace([], 0, 10_000)).toEqual([]);
  });

  it("builds a rising net-KPH line after warmup", () => {
    const slow = [...strokes(10, 0, 200), plusAt(2100)];
    const fast = [...strokes(80, 3000, 40), plusAt(6300)];
    const series = buildPace([...slow, ...fast], 0, 8000, 6);
    expect(series.length).toBeGreaterThan(1);
    expect(series[0]!.t).toBeGreaterThanOrEqual(2000);
    expect(series[series.length - 1]!.kph).toBeGreaterThan(series[0]!.kph);
  });

  it("does not let backspaced mash raise the pace line", () => {
    const work = [...strokes(20, 0, 50), plusAt(1100)];
    const mash: Keystroke[] = [];
    for (let i = 0; i < 200; i++) {
      mash.push({ atMs: 2000 + i * 10, key: "9", code: "", kind: "digit" });
      mash.push({ atMs: 2005 + i * 10, key: "Backspace", code: "", kind: "backspace" });
    }
    const series = buildPace([...work, ...mash], 0, 5000, 10);
    const start = series[0]!.kph;
    const end = series[series.length - 1]!.kph;
    expect(end).toBeLessThanOrEqual(start);
  });
});

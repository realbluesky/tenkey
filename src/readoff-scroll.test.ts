import { describe, expect, it } from "vitest";
import { readoffFollowScrollTop } from "./readoff-scroll";

describe("readoffFollowScrollTop", () => {
  const viewH = 200;
  const rowH = 28;
  const scrollH = 800;

  it("stays at the top until the active row reaches mid-viewport", () => {
    expect(
      readoffFollowScrollTop({ viewH, scrollH, currentTop: 0, currentH: rowH }),
    ).toBe(0);
    expect(
      readoffFollowScrollTop({ viewH, scrollH, currentTop: 40, currentH: rowH }),
    ).toBe(0);
  });

  it("pins the active row at mid-viewport after that", () => {
    const currentTop = 300;
    const top = readoffFollowScrollTop({ viewH, scrollH, currentTop, currentH: rowH });
    expect(top).toBe(currentTop + rowH / 2 - viewH * 0.5);
  });

  it("does not scroll past the end", () => {
    const top = readoffFollowScrollTop({
      viewH,
      scrollH,
      currentTop: 780,
      currentH: rowH,
    });
    expect(top).toBe(scrollH - viewH);
  });
});

import type { PacePoint } from "./engine/series";

export function renderPaceSvg(points: PacePoint[], width = 520, height = 132): string {
  if (points.length < 2) return "";
  const padL = 8;
  const padR = 8;
  const padT = 10;
  const padB = 18;
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.kph);
  const minX = xs[0]!;
  const maxX = xs[xs.length - 1]!;
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const y0 = minY === maxY ? Math.max(0, minY * 0.85) : minY * 0.92;
  const y1 = minY === maxY ? maxY * 1.12 + 400 : maxY * 1.06;
  const dx = Math.max(1, maxX - minX);
  const dy = Math.max(1, y1 - y0);
  const x = (t: number) => padL + ((t - minX) / dx) * (width - padL - padR);
  const y = (k: number) => padT + (1 - (k - y0) / dy) * (height - padT - padB);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.kph).toFixed(1)}`).join(" ");
  const area = `${line} L${x(maxX).toFixed(1)} ${(height - padB).toFixed(1)} L${x(minX).toFixed(1)} ${(height - padB).toFixed(1)} Z`;
  return `<svg class="pace-svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Net KPH over the run">
    <path d="${area}" class="pace-fill" />
    <path d="${line}" class="pace-line" fill="none" />
  </svg>`;
}

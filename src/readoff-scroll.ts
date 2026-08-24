/** Keep the active row near this fraction of the list viewport (from the top). */
export const READOFF_FOLLOW = 0.5;

export function readoffFollowScrollTop(opts: {
  viewH: number;
  scrollH: number;
  currentTop: number;
  currentH: number;
  follow?: number;
}): number {
  const viewH = Math.max(0, opts.viewH);
  const followY = viewH * (opts.follow ?? READOFF_FOLLOW);
  const rowMid = opts.currentTop + opts.currentH / 2;
  if (rowMid <= followY) return 0;
  const target = rowMid - followY;
  const maxTop = Math.max(0, opts.scrollH - viewH);
  return Math.max(0, Math.min(maxTop, target));
}

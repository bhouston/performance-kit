type Anchor = readonly [number, readonly [number, number, number]];
function interpolate(value: number, anchors: readonly Anchor[]): string {
  if (value <= anchors[0]![0]) return `rgb(${anchors[0]![1].join(',')})`;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]!,
      b = anchors[i]!;
    if (value <= b[0]) {
      const t = (value - a[0]) / (b[0] - a[0]);
      return `rgb(${a[1].map((c, j) => Math.round(c + (b[1][j]! - c) * t)).join(',')})`;
    }
  }
  return `rgb(${anchors.at(-1)![1].join(',')})`;
}
export const frameTimeColor = (ms: number) =>
  interpolate(ms, [
    [16.7, [34, 197, 94]],
    [33.3, [250, 204, 21]],
    [50, [239, 68, 68]],
  ]);
export const responsivenessColor = (ms: number) =>
  interpolate(ms, [
    [0, [34, 197, 94]],
    [50, [250, 204, 21]],
    [100, [249, 115, 22]],
    [300, [239, 68, 68]],
  ]);

import { expect, it } from 'vitest';
import { bandwidthChartData } from './bandwidth.js';
import type { ResourceRecord } from './index.js';
const resource = (fields: Partial<ResourceRecord>): ResourceRecord => ({
  url: 'https://test/a.js',
  category: 'script',
  initiatorType: 'script',
  startTime: 0,
  responseStart: 5,
  responseEnd: 27,
  transferSize: 100,
  encodedBodySize: 80,
  decodedBodySize: 200,
  sizeKnown: true,
  ...fields,
});
it('conserves known bytes across partial bins, overlaps and instantaneous responses', () => {
  const records = [
    resource({}),
    resource({ startTime: 2, responseStart: 12, responseEnd: 12, transferSize: 37 }),
    resource({ sizeKnown: false, transferSize: 1000 }),
    resource({ transferSize: 0 }),
  ];
  for (const sliceMs of [1, 10, 25, 50]) {
    const chart = bandwidthChartData(records, sliceMs);
    expect(chart.slices.reduce((sum, s) => sum + s.totalBytesPerMs * (s.t1 - s.t0), 0)).toBeCloseTo(137, 8);
    expect(chart.slices.flatMap((s) => s.contributions).every((c) => c.resourceIndex !== 2)).toBe(true);
    expect(chart.leadIns.find((l) => l.resourceIndex === 1)?.y).toBeGreaterThan(0);
    expect(chart.colors).toEqual(bandwidthChartData(records, sliceMs).colors);
  }
});
it('handles empty input and rejects unsafe slice sizes', () => {
  expect(bandwidthChartData([]).peakBytesPerMs).toBe(0);
  expect(() => bandwidthChartData([], 0)).toThrow();
  expect(() => bandwidthChartData([resource({ responseEnd: 1e9 })], 1)).toThrow();
});

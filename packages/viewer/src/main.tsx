import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { humanizeBytes } from 'humanize-units';
import { Bandwidth } from './Bandwidth.js';
import { createRoot } from 'react-dom/client';
import { frameTimeColor, responsivenessColor } from 'performance-kit-schema/colorScales';
import type { NamedEntity, ProcessedResult } from 'performance-kit-schema';
import {
  cardMetrics,
  compareMetrics,
  gradeMetric,
  gradeColors,
  metricTable,
  phaseColor,
  phaseEnd,
  chartScale,
  resultId,
  readRoute,
  type SortKey,
  type SortDirection,
} from './report.js';
import { percentile } from 'performance-kit-schema';
import './style.css';
type Point = [seconds: number, milliseconds: number];
type ResultReference = { renderer: NamedEntity; scene: NamedEntity; metrics: string; screenshot?: string };
type RecordItem = ResultReference & { result: ProcessedResult };
const entryTitle = (result: ProcessedResult) => `${result.entry.renderer.name} · ${result.entry.scene.name}`;
const duration = (seconds: number | undefined) => {
  if (seconds === undefined) return '—';
  const milliseconds = Math.abs(seconds) < 1;
  const value = milliseconds ? seconds * 1000 : seconds;
  return `${Number(value.toPrecision(3))}${milliseconds ? 'ms' : 's'}`;
};
const fps = (value: number | undefined) => (value === undefined ? '—' : `${Number(value.toPrecision(3))}fps`);
function Timeline({
  result,
  maxTime,
  kind = 'intervals',
  combined = false,
}: {
  result: ProcessedResult;
  maxTime: number;
  kind?: 'intervals' | 'cpu' | 'gpu' | 'responsiveness';
  combined?: boolean;
}) {
  const [hover, setHover] = useState<{ time: number; value: number; x: number; y: number; label: string }>();
  const ref = useRef<HTMLCanvasElement>(null);
  const { timeline, statistics } = result;
  const responsiveness = kind === 'responsiveness';
  const watchdog: Point[] = useMemo(
    () =>
      timeline.watchdogTimes
        .slice(1)
        .map((t, i) => [t, Math.max(0, t - timeline.watchdogTimes[i]! - timeline.watchdogPeriod) * 1000] as Point),
    [timeline],
  );
  const samples: Point[] = useMemo(
    () =>
      responsiveness
        ? watchdog
        : timeline.frameTimes.flatMap((t, i) => {
            const value =
              kind === 'intervals'
                ? timeline.frameTimes[i + 1] === undefined
                  ? undefined
                  : (timeline.frameTimes[i + 1]! - t) * 1000
                : kind === 'cpu'
                  ? timeline.cpuDurations[i]
                  : timeline.gpuDurations[i];
            return value === undefined || value === null || value < 0
              ? []
              : [[t, kind === 'intervals' ? value : value * 1000] as Point];
          }),
    [timeline, kind, responsiveness, watchdog],
  );
  const measured = kind === 'intervals' ? result.measuredIntervals.map((v) => v * 1000) : samples.map((p) => p[1]);
  const average = measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : undefined;
  const p95 =
    kind === 'intervals'
      ? statistics.p95 === undefined
        ? undefined
        : statistics.p95 * 1000
      : percentile(measured, 0.95);
  const scale = useMemo(
    () =>
      chartScale(
        [...samples, ...(combined ? watchdog : [])].reduce(
          (max, p) => Math.max(max, p[1]),
          Math.max(average ?? 0, p95 ?? 0),
        ),
      ),
    [samples, average, p95, combined, watchdog],
  );
  const plot = useMemo(() => {
    if (responsiveness) return timeline.watchdogIndices.map((i) => samples[i - 1]!).filter(Boolean);
    const times = new Set(timeline.frameIndices.map((i) => timeline.frameTimes[i]));
    return samples.filter(([time]) => times.has(time));
  }, [samples, responsiveness, timeline]);
  const timeMax = Math.max(maxTime, 0.001);
  useEffect(() => {
    const canvas = ref.current!;
    const draw = () => {
      const width = canvas.clientWidth,
        height = canvas.clientHeight,
        dpr = devicePixelRatio;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      const left = 44,
        right = Math.max(left + 1, width - 138),
        top = 34,
        bottom = height - 28;
      const x = (t: number) => left + (t / timeMax) * (right - left);
      const y = (v: number) => bottom - (v / scale.max) * (bottom - top);
      const style = getComputedStyle(canvas),
        color = (name: string) => style.getPropertyValue(name).trim();
      ctx.font = '11px system-ui';
      // Phase fills sit behind the grid and use the same colors as the phase legend.
      for (const phase of responsiveness || combined ? timeline.phases : []) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = phaseColor(phase.phase, result.config.phaseColors);
        ctx.fillRect(
          x(phase.start),
          top,
          Math.max(0, x(phaseEnd(phase, timeline.renderStart)) - x(phase.start)),
          bottom - top,
        );
      }
      ctx.globalAlpha = 1;
      if (responsiveness || combined) {
        for (const phase of timeline.phases) {
          const start = x(phase.start),
            end = x(phaseEnd(phase, timeline.renderStart));
          ctx.fillStyle = phaseColor(phase.phase, result.config.phaseColors);
          ctx.fillRect(start, top - 12, Math.max(0, end - start), 8);
        }
      }
      ctx.strokeStyle = color('--chart-grid');
      ctx.fillStyle = color('--muted-foreground');
      for (const tick of scale.ticks) {
        ctx.beginPath();
        ctx.moveTo(left, y(tick));
        ctx.lineTo(right, y(tick));
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(`${tick}`, left - 6, y(tick) + 4);
      }
      ctx.textAlign = 'left';
      ctx.fillText('ms', 4, 20);
      for (let t = 0; t <= timeMax; t++) {
        ctx.beginPath();
        ctx.moveTo(x(t), top);
        ctx.lineTo(x(t), bottom);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText(`${t}`, x(t), height - 8);
      }
      ctx.textAlign = 'left';
      ctx.fillText('seconds', right + 8, height - 8);
      const metricColor = responsiveness ? responsivenessColor : frameTimeColor;
      ctx.lineWidth = 1.5;
      for (let i = 1; i < plot.length; i++) {
        const a = plot[i - 1]!,
          b = plot[i]!;
        ctx.strokeStyle = metricColor(b[1]);
        ctx.beginPath();
        ctx.moveTo(x(a[0]), y(a[1]));
        ctx.lineTo(x(b[0]), y(b[1]));
        ctx.stroke();
      }
      if (combined) {
        const ticks = timeline.watchdogTimes;
        ctx.lineWidth = 1;
        for (let n = 1; n < timeline.watchdogIndices.length; n++) {
          const a = timeline.watchdogIndices[n - 1]!,
            b = timeline.watchdogIndices[n]!;
          const delay = (i: number) => Math.max(0, ticks[i]! - ticks[i - 1]! - timeline.watchdogPeriod) * 1000;
          ctx.strokeStyle = responsivenessColor(delay(b));
          ctx.beginPath();
          ctx.moveTo(x(ticks[a]!), y(delay(a)));
          ctx.lineTo(x(ticks[b]!), y(delay(b)));
          ctx.stroke();
        }
      }
      let previousLabel: number | undefined;
      for (const [value, label, ink] of [
        [average, 'average', '#3b82f6'],
        [p95, 'P95', '#ef4444'],
      ] as const) {
        if (responsiveness || value === undefined) continue;
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = label === 'P95' ? 4 : 0;
        ctx.beginPath();
        ctx.moveTo(left, y(value));
        ctx.lineTo(right, y(value));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        let labelY = Math.max(top + 12, y(value) - 4);
        if (previousLabel !== undefined && Math.abs(labelY - previousLabel) < 16) labelY = previousLabel + 16;
        previousLabel = labelY;
        ctx.fillText(`${label} ${Number(value.toFixed(2))} ms`, right + 8, labelY);
        if (label === 'average' && kind === 'intervals' && value > 0)
          ctx.fillText(`${(1000 / value).toFixed(1)} fps`, right + 8, labelY - 14);
      }
      const renderStart = timeline.renderStart;
      if ((responsiveness || combined) && renderStart !== undefined) {
        ctx.strokeStyle = '#3b82f6';
        ctx.fillStyle = '#3b82f6';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x(renderStart), top);
        ctx.lineTo(x(renderStart), bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillText(
          `init done ${Number((renderStart * 1000).toFixed(1))} ms`,
          Math.min(x(renderStart) + 4, width - 180),
          18,
        );
      }
      if (hover) {
        ctx.strokeStyle = color('--foreground');
        ctx.beginPath();
        ctx.moveTo(x(hover.time), top);
        ctx.lineTo(x(hover.time), bottom);
        ctx.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    const theme = matchMedia('(prefers-color-scheme: dark)');
    theme.addEventListener('change', draw);
    return () => {
      observer.disconnect();
      theme.removeEventListener('change', draw);
    };
  }, [result, kind, timeMax, hover, average, p95, timeline, scale, plot, responsiveness, combined]);
  return (
    <div className="timeline-container">
      <canvas
        ref={ref}
        className="timeline"
        aria-label={
          responsiveness
            ? 'Init Responsiveness timeline in milliseconds'
            : combined
              ? 'Setup phases and frame timing in milliseconds with average and P95'
              : 'Frame rate timeline in milliseconds with average and P95'
        }
        onMouseLeave={() => setHover(undefined)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect(),
            px = event.clientX - rect.left;
          const time = ((px - 44) / (rect.width - 182)) * timeMax;
          if (px < 44 || px > rect.width - 138) {
            setHover(undefined);
            return;
          }
          const setup = combined && time < (timeline.renderStart ?? timeline.frameTimes[0] ?? Infinity);
          const phase = setup
            ? timeline.phases.find((p) => time >= p.start && time <= phaseEnd(p, timeline.renderStart))
            : undefined;
          if (phase) {
            setHover({
              time,
              value: (phase.duration ?? 0) * 1000,
              label: `${phase.phase} phase`,
              x: Math.max(0, Math.min(px + 12, rect.width - 220)),
              y: event.clientY - rect.top,
            });
            return;
          }
          const candidates = setup ? watchdog : samples;
          if (!candidates.length || time < candidates[0]![0] || time > candidates.at(-1)![0]) {
            setHover(undefined);
            return;
          }
          const nearest = candidates.reduce((a, b) => (Math.abs(b[0] - time) < Math.abs(a[0] - time) ? b : a));
          setHover({
            label:
              setup || responsiveness
                ? 'Watchdog lateness'
                : kind === 'intervals'
                  ? 'Frame interval'
                  : kind.toUpperCase(),
            time: nearest[0],
            value: nearest[1],
            x: Math.max(0, Math.min(px + 12, rect.width - 180)),
            y: event.clientY - rect.top,
          });
        }}
      />
      {hover && (
        <div className="timeline-tooltip" style={{ left: hover.x, top: Math.max(0, hover.y - 32) }}>
          {duration(hover.time)} elapsed · {hover.label} {duration(hover.value / 1000)}
        </div>
      )}
    </div>
  );
}
function Histogram({ values, responsiveness = false }: { values: number[]; responsiveness?: boolean }) {
  const max = values.reduce((value, item) => Math.max(value, item), 0);
  const count = Math.min(40, values.length);
  const width = count ? max / count : 0;
  const bins = Array.from({ length: count }, (_, index) => ({
    start: index * width,
    end: (index + 1) * width,
    count: 0,
  }));
  for (const value of values) bins[Math.min(count - 1, width ? Math.floor(value / width) : 0)]!.count++;
  const histogram = {
    bins,
    count: values.length,
    maxCount: bins.reduce((value, bin) => Math.max(value, bin.count), 0),
  };
  return (
    <div>
      <div className="histogram">
        {histogram.bins.map((bin, i) => (
          <div
            key={i}
            title={`${duration(bin.start)}–${duration(bin.end)}: ${bin.count} samples`}
            style={{
              height: `${Math.max(2, (bin.count / Math.max(1, histogram.maxCount)) * 100)}%`,
              background: (responsiveness ? responsivenessColor : frameTimeColor)(bin.start * 1000),
            }}
          />
        ))}
      </div>
      <div className="axis">
        0ms{' '}
        <span>
          {duration(histogram.bins.at(-1)?.end)} · {histogram.count} samples
        </span>
      </div>
    </div>
  );
}
function Detail({ result }: { result: ProcessedResult }) {
  const [kind, setKind] = useState<'intervals' | 'cpu' | 'gpu'>('intervals');
  const { statistics, timeline } = result;
  const maxTime = Math.max(1, timeline.maxTime);
  const lateness = timeline.watchdogTimes
    .slice(1)
    .map((time, index) => Math.max(0, time - timeline.watchdogTimes[index]! - timeline.watchdogPeriod));
  return (
    <div className="detail">
      <div className="detail-heading">
        <h2>Setup and frame timing · ms</h2>
        <select aria-label="Timing series" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="intervals">Frame intervals</option>
          <option value="cpu">CPU submit</option>
          <option value="gpu">GPU cost</option>
        </select>
      </div>
      <Timeline result={result} maxTime={maxTime} kind={kind} combined />
      <p>Elapsed seconds from example navigation · shaded blocks: setup phases · thin line: watchdog lateness</p>
      <div className="detail-grid">
        <section>
          <h3>Rendering Histogram</h3>
          <Histogram values={result.measuredIntervals} />
          <p>
            Frame intervals · p99 {duration(statistics.p99)} · MAD {duration(statistics.mad)}
          </p>
          <p>
            CPU median {duration(statistics.cpuMedian)} · p95 {duration(statistics.cpuP95)}
          </p>
          <p>
            GPU median {duration(statistics.gpuMedian)} · p95 {duration(statistics.gpuP95)}
          </p>
        </section>
        <section>
          <h3>Responsiveness Histogram</h3>
          <Histogram values={lateness} responsiveness />
          <p>
            Watchdog lateness · blocked {duration(statistics.initBlockedDuration)} · max block{' '}
            {duration(statistics.initMaxBlockDuration)}
          </p>
        </section>
        <section>
          <h3>Init phases</h3>
          <table>
            <tbody>
              {Object.entries(statistics.phaseDurations).map(([name, seconds]) => (
                <tr key={name}>
                  <td>
                    <span
                      className="phase-swatch"
                      style={{ background: phaseColor(name, result.config.phaseColors) }}
                    />
                    {name}
                  </td>
                  <td>{duration(seconds)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Total init</th>
                <td>{duration(statistics.initDuration)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      <Bandwidth result={result} maxTime={maxTime} />
    </div>
  );
}
function Card({
  item,
  maxTime,
  revision = 0,
  captureEpoch = 0,
  navigate,
}: {
  item: RecordItem;
  maxTime: number;
  revision?: number;
  captureEpoch?: number;
  navigate: (id: string) => void;
}) {
  const imageRevision = Math.max(revision, captureEpoch);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!revision || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const node = ref.current!;
    node.classList.remove('reloaded');
    const frame = requestAnimationFrame(() => node.classList.add('reloaded'));
    return () => cancelAnimationFrame(frame);
  }, [revision]);
  const r = item.result,
    metrics = cardMetrics(r),
    id = resultId(r);
  const [copied, setCopied] = useState(false);
  return (
    <article className="card" id={id} ref={ref}>
      <a
        className="card-link"
        href={detailUrl(id)}
        aria-label={`View details for ${entryTitle(r)}`}
        onClick={(e) => {
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            navigate(id);
          }
        }}
      />
      <div className="card-main">
        <div className="capture">
          {item.screenshot ? (
            <img
              src={
                imageRevision
                  ? `${item.screenshot}${item.screenshot.includes('?') ? '&' : '?'}updated=${imageRevision}`
                  : item.screenshot
              }
              alt={`${entryTitle(r)} render capture`}
              loading="lazy"
            />
          ) : (
            <div className="capture-placeholder">
              ◇<small>capture unavailable</small>
            </div>
          )}
        </div>
        <div className="card-body">
          <div className="card-heading">
            <div>
              <div className="result-name">
                <a
                  className="entry-title"
                  href={detailUrl(id)}
                  onClick={(e) => {
                    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                      e.preventDefault();
                      navigate(id);
                    }
                  }}
                >
                  {entryTitle(r)} <small> · {r.networkProfile.name}</small>
                </a>
                <button
                  className="bookmark"
                  aria-label={`Copy link to ${entryTitle(r)}`}
                  onClick={async () => {
                    const url = new URL(location.href);
                    url.hash = id;
                    history.replaceState(history.state, '', url);
                    try {
                      await navigator.clipboard.writeText(url.href);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? 'Copied' : `#${id}`}
                </button>
              </div>
            </div>
            <div className="stats">
              {(Object.keys(metricTable) as SortKey[]).map((key) => (
                <div
                  key={key}
                  title={
                    key === 'download'
                      ? `Known wire bytes across load and post-load; ${r.downloads?.reduce((count, report) => count + report.unknownSizeCount, 0) ?? 0} requests with hidden sizes`
                      : undefined
                  }
                >
                  <small>{metricTable[key].label}</small>
                  <strong
                    style={{ color: key === 'download' ? undefined : gradeColors[gradeMetric(key, metrics[key])] }}
                  >
                    {key === 'download'
                      ? `${r.downloads?.some((report) => report.unknownSizeCount > 0) ? '≥ ' : ''}${humanizeBytes(metrics.download, { emptyValue: '—' })}`
                      : key === 'avgFrameRate'
                        ? fps(metrics[key])
                        : duration(metrics[key] === undefined ? undefined : metrics[key]! / 1000)}
                  </strong>
                </div>
              ))}
            </div>
          </div>
          <Timeline result={r} maxTime={maxTime} combined />
        </div>
      </div>
      {(r.error || r.status !== 'ok') && <p className="error">{r.error?.message ?? r.status}</p>}
      <div className="phase-legend">
        {Object.entries(r.statistics.phaseDurations).map(([name, seconds]) => (
          <span key={name}>
            <i className="phase-swatch" style={{ background: phaseColor(name, r.config.phaseColors) }} />
            {name} {duration(seconds)}
          </span>
        ))}
      </div>
    </article>
  );
}
function listUrl() {
  const url = new URL(location.href);
  url.searchParams.delete('result');
  url.hash = '';
  return url.href;
}
function detailUrl(id: string) {
  const url = new URL(location.href);
  url.searchParams.set('result', id);
  url.hash = '';
  return url.href;
}
function App() {
  const initial = readRoute(new URL(location.href));
  const [selected, setSelected] = useState(initial.result);
  const [direction, setDirection] = useState<SortDirection>(initial.direction);
  const pendingScroll = useRef<number | null>(null);
  const scrollList = useCallback(() => {
    if (pendingScroll.current !== null) {
      window.scrollTo(0, pendingScroll.current);
      pendingScroll.current = null;
    } else if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, []);
  const navigate = (id: string) => {
    history.replaceState({ ...history.state, scroll: window.scrollY }, '', location.href);
    history.pushState({ detail: true }, '', detailUrl(id));
    setSelected(id);
    window.scrollTo(0, 0);
  };
  const back = () => {
    if (history.state?.detail) history.back();
    else {
      const url = new URL(location.href);
      url.searchParams.delete('result');
      history.replaceState({}, '', url);
      setSelected(null);
    }
  };
  const [items, setItems] = useState<RecordItem[]>([]),
    [error, setError] = useState(''),
    [preamble, setPreamble] = useState(''),
    [query, setQuery] = useState(initial.query),
    [sort, setSort] = useState<SortKey>(initial.sort),
    [renderer, setRenderer] = useState(initial.renderer),
    [scene, setScene] = useState(initial.scene),
    [live, setLive] = useState(false),
    [revisions, setRevisions] = useState<Record<string, number>>({}),
    [captureEpoch, setCaptureEpoch] = useState(0);
  useEffect(() => {
    let active = true;
    let snapshotRequest = 0;
    let seenSnapshotEvent = false;
    const pairRequests = new Map<string, number>();
    const pairApplied = new Map<string, number>();
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();
    const retry = (operation: () => void) => {
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        if (active) operation();
      }, 500);
      retryTimers.add(timer);
    };
    const readIntroduction = async () => {
      try {
        const response = await fetch('./README.md', { cache: 'no-store' });
        const text = response.ok ? await response.text() : '';
        if (active) setPreamble(text);
      } catch {
        /* The introduction is optional. */
      }
    };
    const refresh = async (flash = false, attempt = 0) => {
      const request = ++snapshotRequest;
      const startedPairs = new Map(pairRequests);
      const newer = (key: string) => (pairApplied.get(key) ?? 0) > (startedPairs.get(key) ?? 0);
      try {
        const response = await fetch('./index.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Unable to load results (${response.status})`);
        const index = (await response.json()) as { schemaVersion: 1; results: ResultReference[]; liveReload?: boolean };
        const loaded = await Promise.all(
          (index.results ?? []).map(async (item) => {
            const metrics = await fetch(item.metrics, { cache: 'no-store' });
            if (!metrics.ok) throw new Error(`Unable to load metrics (${metrics.status})`);
            return { ...item, result: (await metrics.json()) as ProcessedResult };
          }),
        );
        if (active && request === snapshotRequest) {
          setItems((previous) => {
            const current = new Map(previous.map((item) => [item.metrics, item]));
            const loadedKeys = new Set(loaded.map((item) => item.metrics));
            const merged = loaded.flatMap((item) =>
              newer(item.metrics) ? (current.has(item.metrics) ? [current.get(item.metrics)!] : []) : [item],
            );
            return [...merged, ...previous.filter((item) => !loadedKeys.has(item.metrics) && newer(item.metrics))];
          });
          setLive(index.liveReload === true);
          if (flash)
            setRevisions((previous) => ({
              ...previous,
              ...Object.fromEntries(loaded.map((item) => [item.metrics, performance.now()])),
            }));
          setError('');
        }
      } catch (failure) {
        if (active && request === snapshotRequest) {
          if (attempt < 2)
            retry(() => {
              if (snapshotRequest === request) void refresh(flash, attempt + 1);
            });
          else setError(String(failure));
        }
      }
    };
    const updatePair = async (rendererId: string, sceneId: string, attempt = 0, version?: number) => {
      const directory = `${encodeURIComponent(rendererId)}/${encodeURIComponent(sceneId)}`;
      const metrics = `${directory}/metrics.json`;
      const request = version ?? (pairRequests.get(metrics) ?? 0) + 1;
      pairRequests.set(metrics, request);
      try {
        const response = await fetch(metrics, { cache: 'no-store' });
        if (!active || pairRequests.get(metrics) !== request) return;
        if (response.status === 404) {
          pairApplied.set(metrics, request);
          setItems((previous) => previous.filter((item) => item.metrics !== metrics));
          setError('');
          return;
        }
        if (!response.ok) throw new Error(`Unable to load metrics (${response.status})`);
        const result = (await response.json()) as ProcessedResult;
        if (!active || pairRequests.get(metrics) !== request) return;
        const item: RecordItem = {
          renderer: result.entry.renderer,
          scene: result.entry.scene,
          metrics,
          result,
          ...(result.screenshot ? { screenshot: `${directory}/screenshot.avif` } : {}),
        };
        pairApplied.set(metrics, request);
        setItems((previous) => {
          const other = previous.filter((existing) => existing.metrics !== metrics);
          return [...other, item];
        });
        setRevisions((previous) => ({ ...previous, [metrics]: performance.now() }));
        setError('');
      } catch (failure) {
        if (active && pairRequests.get(metrics) === request) {
          if (attempt < 2)
            retry(() => {
              if (pairRequests.get(metrics) === request) void updatePair(rendererId, sceneId, attempt + 1, request);
            });
          else setError(String(failure));
        }
      }
    };
    void refresh();
    void readIntroduction();
    let events: EventSource | undefined;
    if (live) {
      events = new EventSource('./events');
      events.addEventListener('open', () => setCaptureEpoch(performance.now()));
      const receive = (message: MessageEvent<string>) => {
        try {
          const event = JSON.parse(message.data) as { type?: string; rendererId?: string; sceneId?: string };
          if (
            event.type === 'resultChanged' &&
            typeof event.rendererId === 'string' &&
            typeof event.sceneId === 'string'
          )
            void updatePair(event.rendererId, event.sceneId);
          else if (event.type === 'readmeChanged') void readIntroduction();
          else if (event.type === 'indexChanged') {
            void refresh(seenSnapshotEvent);
            void readIntroduction();
            seenSnapshotEvent = true;
          }
        } catch {
          /* Ignore non-data SSE notifications. */
        }
      };
      events.addEventListener('message', receive);
      events.addEventListener('resultChanged', receive);
      events.addEventListener('readmeChanged', receive);
      events.addEventListener('indexChanged', receive);
    }
    return () => {
      active = false;
      retryTimers.forEach((timer) => clearTimeout(timer));
      events?.close();
    };
  }, [live]);
  const renderers = [
    ...new Map(items.map((item) => [item.result.entry.renderer.id, item.result.entry.renderer])).values(),
  ].toSorted((a, b) => a.name.localeCompare(b.name));
  const scenes = [
    ...new Map(items.map((item) => [item.result.entry.scene.id, item.result.entry.scene])).values(),
  ].toSorted((a, b) => a.name.localeCompare(b.name));
  const cards = items
    .filter((item) => {
      const result = item.result;
      if (
        query &&
        !`${entryTitle(result)} ${result.entry.renderer.id} ${result.entry.scene.id}`
          .toLowerCase()
          .includes(query.toLowerCase())
      )
        return false;
      return (!renderer || result.entry.renderer.id === renderer) && (!scene || result.entry.scene.id === scene);
    })
    .toSorted(
      (a, b) =>
        compareMetrics(a.result, b.result, sort, direction) || entryTitle(a.result).localeCompare(entryTitle(b.result)),
    );
  useEffect(() => {
    const restoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const receive = () => {
      const route = readRoute(new URL(location.href));
      setSelected(route.result);
      setSort(route.sort);
      setDirection(route.direction);
      setQuery(route.query);
      setRenderer(route.renderer);
      setScene(route.scene);
      pendingScroll.current = history.state?.scroll ?? null;
    };
    const hash = () => scrollList();
    window.addEventListener('popstate', receive);
    window.addEventListener('hashchange', hash);
    return () => {
      history.scrollRestoration = restoration;
      window.removeEventListener('popstate', receive);
      window.removeEventListener('hashchange', hash);
    };
  }, [scrollList]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('sort', sort);
    url.searchParams.set('dir', direction);
    for (const [key, value] of [
      ['q', query],
      ['renderer', renderer],
      ['scene', scene],
    ]) {
      if (value) url.searchParams.set(key!, value!);
      else url.searchParams.delete(key!);
    }
    history.replaceState(history.state, '', url);
  }, [sort, direction, query, renderer, scene]);
  useEffect(() => {
    if (!selected && items.length) {
      const frame = requestAnimationFrame(scrollList);
      return () => cancelAnimationFrame(frame);
    }
  }, [selected, items, scrollList]);
  const detailItem = items.find((item) => resultId(item.result) === selected);
  const maxTime = cards.reduce((longest, item) => Math.max(longest, item.result.timeline.maxTime), 1);
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <ol>
              <li>
                {selected ? (
                  <a
                    className="brand"
                    href={listUrl()}
                    onClick={(e) => {
                      if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                        e.preventDefault();
                        back();
                      }
                    }}
                  >
                    Performance results
                  </a>
                ) : (
                  <span className="brand" aria-current="page">
                    Performance results
                  </span>
                )}
              </li>
              {selected && (
                <>
                  <li aria-hidden="true">›</li>
                  <li aria-current="page">{detailItem ? entryTitle(detailItem.result) : 'Result'}</li>
                </>
              )}
            </ol>
          </nav>
          <nav className="header-controls" aria-label="Report controls">
            <input
              aria-label="Search entries"
              placeholder="Entry Filter"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Sort cards"
              title="Sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {(Object.keys(metricTable) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {metricTable[key].label}
                </option>
              ))}
            </select>
            <select
              aria-label="Sort direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value as SortDirection)}
            >
              <option value="bestFirst">Best first</option>
              <option value="worstFirst">Worst first</option>
            </select>
            <select
              aria-label="Renderers"
              title="Renderers"
              value={renderer}
              onChange={(e) => setRenderer(e.target.value)}
            >
              <option value="">All renderers</option>
              {renderers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select aria-label="Scenes" title="Scenes" value={scene} onChange={(e) => setScene(e.target.value)}>
              <option value="">All scenes</option>
              {scenes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span className="result-count">
              {cards.length}/{items.length}
            </span>
            <a
              className="repository-link"
              aria-label="performance-kit repository"
              href="https://github.com/bhouston/performance-kit"
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 19c-4.3 1.3-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.7c3-.4 6.2-1.5 6.2-7a5.5 5.5 0 0 0-1.5-3.8 5.1 5.1 0 0 0-.1-3.8S17.5.4 15 2.3a13.4 13.4 0 0 0-6 0C6.5.4 5.3.8 5.3.8a5.1 5.1 0 0 0-.1 3.8A5.5 5.5 0 0 0 3.7 8c0 5.5 3.2 6.6 6.2 7a3.4 3.4 0 0 0-.9 2.7V22" />
              </svg>
            </a>
          </nav>
        </div>
      </header>
      <main>
        {!selected && preamble && (
          <div className="preamble">
            <ReactMarkdown>{preamble}</ReactMarkdown>
          </div>
        )}
        <div className="list-heading">
          <div className="legend">
            <span className="green">●</span> 60fps <span className="orange">●</span> 30fps{' '}
            <span className="red">●</span> 20fps
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {selected && (
          <>
            {detailItem ? (
              <>
                <h1>{entryTitle(detailItem.result)}</h1>
                {detailItem.result.error && <p className="error">{detailItem.result.error.message}</p>}
                <Detail result={detailItem.result} />
              </>
            ) : (
              <p className="empty">{items.length ? 'Result not found.' : 'Loading result…'}</p>
            )}
          </>
        )}
        {!selected &&
          cards.map((item) => (
            <Card
              key={item.metrics}
              maxTime={maxTime}
              navigate={navigate}
              item={item}
              captureEpoch={captureEpoch}
              revision={revisions[item.metrics] ?? 0}
            />
          ))}
        {!selected && !cards.length && !error && (
          <div className="empty">Results will appear here when a benchmark completes.</div>
        )}
      </main>
      <footer>
        Website powered by{' '}
        <a href="https://github.com/bhouston/performance-kit" rel="noopener noreferrer" target="_blank">
          performance-kit
        </a>
      </footer>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);

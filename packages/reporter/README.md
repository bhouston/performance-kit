Init phases may have any nonempty name and may repeat. `phaseStart(name)` returns
an identity; pass it to `phaseEnd(token)` when phases overlap, or call
`phaseEnd(name)` to close the latest open occurrence of that name. For example:

```ts
const first = reporter.phaseStart('assets');
const second = reporter.phaseStart('assets');
reporter.phaseEnd(first);
reporter.phaseEnd(second);
reporter.ready(); // Explicit render start, marking the end of init.
```

Phase identities remain distinct in the complete report, including overlapping phases.

`createReporter()` captures one `performance.now()` origin. All CPU, phase,
resource and lifecycle times use seconds from that origin. Setup runs immediately;
`ready()` closes the initial `load` phase, stops initialization watchdog and
performance observers, reserves frame storage, and starts the frame-rate window.
The harness passes `performanceKitDurationMs` in the URL (or use `durationMs` in
reporter options). No readiness or run-start messages are exchanged.

The reporter buffers phases, environment, downloads, initialization probes and
frames, and sends exactly one `runEnd` report after measurement. Failure, overflow,
abort and disposal discard data without flushing. The harness timeout records a
failed run with no measurements. Screenshot requests and responses are separate
and happen only after the report. There is no clock-sync protocol.

GPU helpers are optional diagnostic instrumentation. Query readbacks and polling
add work to the render loop; avoid them when testing frame-rate spikes.

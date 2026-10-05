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

Phase identities match start/end protocol messages without merging duplicate
names. The harness stores one complete phase record per identity in start order.

Setup runs immediately when the example loads. `createReporter()` starts the initial
`load` phase at page navigation (`performance.timeOrigin`), including JavaScript
startup before the reporter executes. Read workload inputs from `reporter.params`
and `reporter.entryId`, initialize directly, end `load`, and call `ready()` after
setup. If `load` is still open, `ready()` closes it. The harness only sends `run`,
`capture`, or `abort`; no setup-start handshake is required. Processing infers
`unknown` phases for all uncovered time between navigation and readiness.

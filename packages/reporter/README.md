Setup phases may have any nonempty name and may repeat. `phaseStart(name)` returns
an identity; pass it to `phaseEnd(token)` when phases overlap, or call
`phaseEnd(name)` to close the latest open occurrence of that name. For example:

```ts
const first = reporter.phaseStart('assets');
const second = reporter.phaseStart('assets');
reporter.phaseEnd(first);
reporter.phaseEnd(second);
reporter.ready(); // Explicit render start, marking the end of setup.
```

Phase identities match start/end protocol messages without merging duplicate
names. The harness stores one complete phase record per identity in start order.

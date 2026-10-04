# Synthetic report fixtures

These hand-authored timestamps demonstrate the report; they are not hardware measurements. The run set contains six rich repetitions across two renderer labels and a minimal frame-only result. The rich records exercise phases, warmup exclusion, independent CPU/GPU costs, clock alignment, watchdog/long-task overlap and delivery discrepancies. The minimal result intentionally omits clock sync, environment, phase marks and measured bounds.

After `pnpm build`:

```sh
pnpm cli validate --results examples/fixtures
pnpm cli build --out examples/fixtures --site /tmp/performance-kit-fixture-site
pnpm cli serve --out examples/fixtures
```

Expand either rich card, switch among frame/CPU/GPU plots and compare the two renderer labels while holding `scene=cube`. The minimal result remains viewable and has no inferred setup duration.

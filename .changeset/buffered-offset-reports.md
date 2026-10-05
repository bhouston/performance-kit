---
'performance-kit-schema': minor
'performance-kit': minor
'performance-kit-reporter': minor
---

Buffer all measurements until one end-of-run report, stop initialization probes before frame-rate measurement, and use seconds offsets from reporter creation. Remove intermediate reporting and run-start messages, discard incomplete runs, and trim chart axes to measurement completion. Regenerate existing reports for the changed timing format.

# Dependency audit

Reviewed on October 3, 2026 with `pnpm audit --audit-level=high --json`.
The command exits nonzero: three high-severity advisories remain, with no
published patched versions reported by the registry. There are no critical,
moderate, or low findings in this audit.

| Dependency          | Finding                                                                                                                         | Dependency path                                                         | Review                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extract-zip@2.0.1` | [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv): unvalidated symlink path traversal                    | `performance-kit` → `puppeteer` → `@puppeteer/browsers` → `extract-zip` | Browser archive extraction during installation; use Puppeteer's official browser distributions or an existing Chrome executable through `--executable-path`. Never provide untrusted archives to the browser installer. Await an upstream patched release. |
| `extract-zip@2.0.1` | [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3): arbitrary file writes through symlink archive entries | Same Puppeteer browser installation path                                | Same exposure and handling as above; benchmark renderer pages and raw result loading do not invoke archive extraction.                                                                                                                                     |
| `braces@3.0.3`      | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): stack exhaustion from deeply nested patterns          | Development dependency `@changesets/cli` → `micromatch` → `braces`      | Release tooling pattern processing; do not run release tooling against untrusted glob patterns. Await an upstream patched release.                                                                                                                         |

The workspace override pins `basic-ftp` to `>=6.2.1`, resolving its separately
reported advisory. These remaining findings are documented rather than hidden
with audit exclusions. Re-run the audit when dependencies change, and remove
mitigations once upstream publishes compatible fixes.

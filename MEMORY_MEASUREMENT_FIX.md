# Memory measurement fix — the watchdog was blind to Chromium

## What went wrong

The first hardening release (PR #9) capped the Chromium heap and added a watchdog that
recycles the browser before the platform limit is reached. But the watchdog measured
`process.memoryUsage().rss` — **the Node process only**. Chromium runs as child
processes and is the single largest memory consumer, so the guard was blind to exactly
the pressure it existed to prevent.

Observed on 2026-09-27:

| Time (UTC) | Event |
| --- | --- |
| 05:41:46 | Container killed by the platform (uptime 35,777s → 29s). State `ready` → `initialize_error` |
| 05:47:22 | `initialize_error` → `initialize_timeout` |
| 06:12:17 | Container killed again (uptime 1,793s → 43s). State → `qr` (pairing lost) |
| 06:31:18 | Container killed a third time (uptime 1,046s → 71s) |

Throughout all of this the watchdog reported a comfortable **152 MB against a 1,638 MB
trigger**, and `lastRecycleAt` stayed `null`. It never fired because it was measuring the
wrong thing — not because prevention succeeded.

The memory limit Render enforces applies to the **whole container**, while the guard
only saw Node's share of it.

## The fix

Measure the **entire process tree** instead of one process:

- `processTreeRssMb()` walks `/proc`, maps every PID to its parent, and sums the memory
  of this process plus all descendants (Chromium's browser, GPU, and renderer children).
- **PSS (`smaps_rollup`) is preferred over `VmRSS`.** Measured on a real headless
  Chromium tree: `sumRss = 669 MB` vs `sumPss = 331 MB` — a **2.01x double-count**,
  because Chromium children share libraries and mapping the same pages repeatedly would
  make the guard recycle far too eagerly. `VmRSS` is only a fallback when
  `smaps_rollup` is unavailable.
- Returns `null` on platforms without `/proc`, so the watchdog falls back to the old
  Node-only reading rather than failing.
- Health telemetry now reports `lastSample.rssMb` (tree), `nodeRssMb`, `treeRssMb`, and
  a live `instanceRssMb` with `measuredScope`, so the effective number is visible.

## Verification

- `node --check server.js` passes.
- The measurement functions were extracted and exercised in isolation against a real
  Chromium tree; they return real values and correctly identify descendant processes.
- Full suite: **107/107 tests pass**.

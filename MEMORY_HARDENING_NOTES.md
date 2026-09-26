# Memory hardening — server 2 (whatsapserver-2)

## Root cause found in Render event log
`Ran out of memory (used over 2GB) while running your code.` occurred 11 times before
the performance deploy: 20:12, 20:13, 20:17, 20:36, 20:49, 20:53, 20:56, 21:00, 21:24,
21:36, 21:52 (Africa/Amman local = 17:12Z..18:52Z). Render metrics showed memory
reaching 1.9 GB against a 2 GB limit. Each OOM kill restarted the container and forced
a fresh WhatsApp QR pairing (the pairing itself is stored on disk in `.wwebjs_auth`
and was intact the whole time).

## What was changed (server.js)
Bounded memory budget + proactive browser recycling:

- `RENDER_MEMORY_LIMIT_MB` (default 2048)
- `NODE_HEAP_MB` (default 768)
- `CHROMIUM_HEAP_MB` (default 512)
- `MEMORY_RECYCLE_TRIGGER_MB` (default 80% of the platform limit = 1638 MB)
- `MEMORY_RECYCLE_INTERVAL_MS` (default 120000)

Chromium launch args added in `puppeteerConfig`:
`--js-flags=--max-old-space-size=<CHROMIUM_HEAP_MB>`, `--renderer-process-limit=1`,
`--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`,
`--disable-renderer-backgrounding`.

New runtime watchdog `startRuntimeMemoryWatchdog()` / `stopRuntimeMemoryWatchdog()` /
`recycleBrowserForMemory()`: samples `process.memoryUsage()` every 2 minutes and, when
RSS crosses the trigger, prunes runtime caches and calls `restartWhatsApp(...)` — the
session on disk is preserved so no QR rescan is needed.

Wired: started in `app.listen` next to `startRuntimeMemoryCleanup()`, stopped in the
SIGTERM/SIGINT handlers, and reported through `/api/admin/system/health`
(`rssLimitMb`, `nodeHeapLimitMb`, `chromiumHeapLimitMb`, `recycleTriggerMb`,
`lastSample`, `lastRecycleAt`).

Lighter scan cadence (defaults only; env vars can still override):
- `WHATSAPP_REACTION_SCAN_INTERVAL_MS`: 15000 -> 30000
- `WHATSAPP_RECOVERY_BATCH_LIMIT`: 15 -> 10
- `WHATSAPP_RECOVERY_PAGE_TIMEOUT_MS`: 15000 -> 12000
- `UNRESOLVED_ORDER_BACKLOG_LIMIT`: 50 -> 25
- `WHATSAPP_HISTORICAL_CANDIDATE_RECOVERY_INTERVAL_MS`: 60000 -> 180000

## Verification performed
- `node --check server.js` passes.
- Repository suite `npm test`: 107/107 passing (re-run after these edits).

## Deploy status
Not yet committed/pushed at the time of writing.
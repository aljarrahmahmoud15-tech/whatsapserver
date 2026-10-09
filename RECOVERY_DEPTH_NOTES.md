# Acceptance recovery depth — why downloaded bookings never settled

## Observed symptom
The owner reported: «خلال إصلاح الخدمة تم تنزيل حجوزات ولم يتم تثبيتها»
(bookings were downloaded/imported during the repair, but none of them were confirmed).

Live telemetry on `whatsapserver-2` agreed:

```json
"acceptanceRecovery": {
  "pendingCandidates": 15,
  "pagesScanned": 6,
  "messagesFetched": 60,
  "scanned": 60,
  "quoteLookupAttempts": 0,
  "quotedMatches": 0,
  "recovered": 0,
  "finishedAt": null
}
"unresolvedOrderRecovery": { "scanned": 10, "resolved": 0, "unresolved": 10 }
"orders": { "openUnassigned": 0, "pendingConfirmation": 0, "acceptedUnlinked": 0 }
```

15 bookings were sitting as `candidate` with **no acceptance row at all**, and the
recovery scan inspected 60 messages without reaching a single «تم» reply
(`quoteLookupAttempts: 0`).

## Root cause
Two bounded limits in the recovery path were far too shallow for a busy group:

1. **Time window** — `recoverHistoricalOrderCandidates` and
   `recoverPendingAcceptanceMessages` both used a hard-coded
   `Date.now() - 12 * 60 * 60 * 1000` cutoff.
2. **Depth per page** — `fetchGroupOrderScanBatch` expanded the in-page WhatsApp
   collection with `loads < 1`, i.e. **one** `loadEarlierMsgs()` call per page, while
   the page itself only held the newest messages. Anything older than that first
   expansion was invisible, so the scan kept returning zero eligible «تم» messages
   and the pending bookings never received an acceptance row.

`const maxPages = 6` and `scanMessages.slice(0, WHATSAPP_RECOVERY_BATCH_LIMIT * 6)`
compounded the same problem: 6 pages × 10 messages = 60 messages maximum per run.

## Change
Three env-overridable bounds replace the hard-coded values, all still capped:

| Setting | Default | Cap |
| --- | --- | --- |
| `WHATSAPP_RECOVERY_SCAN_HOURS` | 72 | 1–168 |
| `WHATSAPP_RECOVERY_MAX_PAGES` | 12 | 1–40 |
| `WHATSAPP_RECOVERY_EARLIER_LOADS` | 6 | 1–12 |

- `fetchGroupOrderScanBatch` now expands earlier messages up to
  `WHATSAPP_RECOVERY_EARLIER_LOADS` times per page, and its page-evaluation timeout
  is `Math.max(9000, WHATSAPP_RECOVERY_PAGE_TIMEOUT_MS)` so the deeper expansion
  cannot be cut off mid-flight.
- Both recovery paths use `WHATSAPP_RECOVERY_SCAN_HOURS` instead of the 12-hour
  literal, and the acceptance scan uses `WHATSAPP_RECOVERY_MAX_PAGES` for both the
  page loop and the per-run slice.
- Recovery stays **read-only**: no settlement happens from the scan. Confirmation
  still requires the owner's explicit action on one booking with exact evidence IDs.

## Verification
- `node --check server.js` passes.
- `npm test`: 108 tests, 105 pass. The three remaining failures
  (`test_approval_cycle_module.js`, `test_sharp_card_render.js`,
  `test_whatsapp_media_patch.js`) fail identically on the unmodified tree — they are
  pre-existing environment failures, not regressions.
- New regression test `test_acceptance_recovery_depth.js` locks the deeper-but-bounded
  contract and rejects a return to the old hard-coded window.

## Remaining owner step
The WhatsApp session on `whatsapserver-2` dropped to `qr` state
(`initialize_timeout` → `qr`), so the pairing must be re-scanned before the deeper
scan can read group history. After the session is ready, the pending bookings appear
in the dashboard panel «الحجوزات غير المؤكدة» where each one is confirmed with
«اعتماد الحجز وتثبيت التسوية».

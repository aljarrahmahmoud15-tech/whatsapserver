# Longer-lived QR access links

## Why

The admin QR link was capped at **180 seconds** by a hard-coded bound:

```js
const durationSeconds = Math.max(60, Math.min(180, Number(req.body?.durationSeconds || 120)));
```

Every re-pairing attempt during the incident had to race that window: the operator had
to be holding the phone, already inside WhatsApp's "Link a device" screen, at the moment
the link was minted. Several attempts expired before the scan completed.

## What changed

The bound is now configurable, defaulting to **600 seconds (10 minutes)**:

| Variable | Default | Meaning |
| --- | --- | --- |
| `QR_ACCESS_MIN_DURATION_SECONDS` | 60 | floor |
| `QR_ACCESS_DEFAULT_DURATION_SECONDS` | 600 | used when the request omits a value |
| `QR_ACCESS_MAX_DURATION_SECONDS` | 600 | ceiling; larger requests are clamped |

The page refreshes its QR every 30 seconds, so a 10-minute link shows a live, rotating
code the whole time — the operator can open it once and scan at their own pace.

`Number(req.body?.durationSeconds) || DEFAULT` also means an omitted, null, or zero value
falls back to the default instead of collapsing to the floor.

## Why 600 and not longer

A temporary grant is a bearer token for the QR page. Ten minutes is long enough to remove
the race without leaving a broad window open, and the QR code itself rotates every 30s, so
a leaked link exposes only fresh codes that still require the operator's own WhatsApp
account to redeem.

## Verification

- `node --check server.js` passes.
- The clamp was exercised directly: omitted → 600, `180` → 180, `9999` → 600, `5` → 60.
- No test asserted the previous 180s bound.

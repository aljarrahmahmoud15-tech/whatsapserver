const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('./server.js', 'utf8');

// The acceptance recovery used to hand the history fallback `nextCursor: null`, so the loop
// broke after a single page and never reached the «تم» replies of older pending bookings.
const recoveryStart = source.indexOf('async function recoverPendingAcceptanceMessages(groupId) {');
const recoveryEnd = source.indexOf('function startBackgroundOrderRecovery(groupId) {');
assert.ok(recoveryStart > 0 && recoveryEnd > recoveryStart, 'acceptance recovery function is present');
const recovery = source.slice(recoveryStart, recoveryEnd);

assert.match(
  recovery,
  /nextCursor: historyOldest \|\| null/,
  'history fallback must hand back the oldest timestamp so paging continues',
);
assert.doesNotMatch(
  recovery,
  /fastScan = \{ \.\.\.history, nextCursor: null/,
  'history fallback must not disable paging with a null cursor',
);
assert.match(
  recovery,
  /const historyOldest = history\.messages\.reduce\(/,
  'history fallback must compute the oldest page timestamp',
);

// A fast-path timeout must be reported before the fallback replaces the scan object, otherwise
// the failure is silently relabelled as a successful history_fallback.
const timeoutIndex = recovery.indexOf('if (fastScan?.timedOut) {');
const fallbackIndex = recovery.indexOf('if (!before && fastMessages.length === 0) {');
assert.ok(timeoutIndex > 0 && fallbackIndex > 0, 'both the timeout check and the fallback are present');
assert.ok(timeoutIndex < fallbackIndex, 'the timeout must be checked before the fallback overwrites the scan');
assert.match(recovery, /lastError = "recovery_group_scan_timeout"/, 'timeout must surface a real error code');

// The live handler only links an unquoted «تم» inside a short window, so the recovery needs its
// own wider window and the same conservative exactly-one-candidate rule.
assert.match(recovery, /unquotedAcceptanceRows\.push\(/, 'unquoted acceptances must be collected, not discarded');
assert.match(recovery, /findUnquotedAcceptanceCandidate\(groupId, senderPhone, acceptanceTimestampMs, UNQUOTED_ACCEPTANCE_RECOVERY_WINDOW_MS\)/, 'unquoted recovery must use the recovery window');
assert.match(recovery, /acceptanceMode: "unquoted"/, 'unquoted recovery must record the acceptance mode');
assert.match(recovery, /recoveredUnquoted/, 'recovered unquoted acceptances must be reported separately');
assert.match(source, /const UNQUOTED_ACCEPTANCE_RECOVERY_WINDOW_MS = Number\.isFinite\(/, 'recovery window must be bounded and configurable');
assert.match(source, /function findUnquotedAcceptanceCandidate\(groupId, senderPhone, acceptanceTimestampMs = Date\.now\(\), windowMs = UNQUOTED_ACCEPTANCE_WINDOW_MS\)/, 'unquoted lookup must accept a window override');

// The reported backlog must not be capped by the execution batch, otherwise a saturated counter
// makes a growing queue look stable.
assert.match(recovery, /pendingCandidatesTotal/, 'the total pending backlog must be reported');
assert.match(recovery, /pendingCandidatesCapped/, 'the report must disclose that the batch is capped');
assert.match(recovery, /SELECT COUNT\(\*\) AS total FROM order_candidates c LEFT JOIN order_candidate_acceptances a/, 'the total must be counted without a limit');

// The historical candidate recovery had no fallback at all and scanned zero messages every run.
const histStart = source.indexOf('async function recoverHistoricalOrderCandidates(groupId) {');
const histEnd = source.indexOf('async function recoverPendingAcceptanceMessages(groupId) {');
assert.ok(histStart > 0 && histEnd > histStart, 'historical recovery function is present');
const historical = source.slice(histStart, histEnd);
assert.match(historical, /if \(!recoveredMessages\.length\) \{/, 'historical recovery must fall back when the fast scan is empty');
assert.match(historical, /recovery\.source = fastScan\.source \|\| "order-scan"/, 'historical recovery must report the real source');
assert.match(historical, /recovery\.scanTimedOut = Boolean\(fastScan\.timedOut\)/, 'historical recovery must disclose a timeout');

// The negative-balance sweep must not report an intentional policy gate as a technical failure.
assert.match(source, /progress\.deferred = 0;/, 'the sweep must track deferred removals separately');
assert.match(source, /else if \(removalStatus === "removal_deferred_confirmation_required"\) progress\.deferred \+= 1;/, 'a policy gate must count as deferred, not failed');
assert.match(source, /deferred: progress\.deferred,/, 'deferred removals must be reported in the policy snapshot');

// The captain notification must state the immediate isolation policy clearly.
assert.doesNotMatch(source, /بسبب تعذر الوصول إلى القروب الرسمي/, 'the misleading group-access reason must be gone');
assert.match(source, /يُعزل الحساب فورًا ويُزال من القروب عند الإمكان/, 'the notification must state immediate isolation');

console.log('acceptance recovery pagination and unquoted recovery guardrails verified');

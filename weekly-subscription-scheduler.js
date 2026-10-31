'use strict';

const TIMEZONE = 'Asia/Amman';
const SETTING_KEY = 'captain_weekly_schedule_v1';
const POLL_MS = 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const localFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function localParts(stamp) {
  const date = new Date(stamp);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid schedule timestamp');
  const parts = Object.fromEntries(localFormatter.formatToParts(date)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  return { dateKey, hour: Number(parts.hour), minute: Number(parts.minute),
    weekday: new Date(`${dateKey}T00:00:00.000Z`).getUTCDay() };
}

function shiftDate(dateKey, days) {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function localDateTimeIso(dateKey, hour = 0, minute = 0) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = localParts(candidate);
    const [localYear, localMonth, localDay] = parts.dateKey.split('-').map(Number);
    const observed = Date.UTC(localYear, localMonth - 1, localDay, parts.hour, parts.minute);
    candidate += desired - observed;
  }
  const actual = localParts(candidate);
  if (actual.dateKey !== dateKey || actual.hour !== hour || actual.minute !== minute) {
    throw new TypeError('Invalid local execution time');
  }
  return new Date(candidate).toISOString();
}

// The business week starts Thursday at 00:00 in Amman. This guard also finds
// historical manual fees written under the legacy Friday-UTC period keys.
function businessWeekPeriod(stamp) {
  const parts = localParts(stamp);
  const startDate = shiftDate(parts.dateKey, -((parts.weekday - 4 + 7) % 7));
  return { start: localDateTimeIso(startDate), end: localDateTimeIso(shiftDate(startDate, 7)) };
}

function nextThursdayOccurrence(stamp, hour = 23, minute = 0) {
  validateTime(hour, minute);
  const parts = localParts(stamp);
  let dateKey = shiftDate(parts.dateKey, (4 - parts.weekday + 7) % 7);
  let candidate = localDateTimeIso(dateKey, hour, minute);
  if (Date.parse(candidate) <= Date.parse(stamp)) {
    dateKey = shiftDate(dateKey, 7);
    candidate = localDateTimeIso(dateKey, hour, minute);
  }
  return candidate;
}

function validateTime(hour, minute) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new TypeError('Invalid schedule hour or minute');
  }
}

function dueSlot(config, stamp) {
  if (!config.enabled || !config.firstRunAt) return null;
  const parts = localParts(stamp);
  if (parts.weekday !== 4 || parts.hour * 60 + parts.minute < config.hour * 60 + config.minute) return null;
  const scheduledAt = localDateTimeIso(parts.dateKey, config.hour, config.minute);
  if (Date.parse(scheduledAt) < Date.parse(config.firstRunAt)) return null;
  // Never catch up on Friday or accumulate missed weeks.
  return { key: `THURSDAY-${parts.dateKey}`, date: parts.dateKey, scheduledAt };
}

function createWeeklySubscriptionScheduler({ db, getSetting, setSetting, execute, audit,
  clock = () => new Date().toISOString(), logger = console,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  db.exec(`CREATE TABLE IF NOT EXISTS captain_weekly_schedule_runs (
    schedule_key TEXT PRIMARY KEY,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
    attempt_count INTEGER NOT NULL DEFAULT 1,
    last_attempt_at TEXT NOT NULL,
    completed_at TEXT,
    applied_count INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    error TEXT
  )`);
  let timer = null;
  let running = false;

  function config() {
    const fallback = { enabled: false, weekday: 4, hour: 23, minute: 0,
      timezone: TIMEZONE, firstRunAt: null };
    let saved;
    try { saved = JSON.parse(getSetting(SETTING_KEY, 'null')); } catch { return fallback; }
    if (!saved || typeof saved.enabled !== 'boolean') return fallback;
    try { validateTime(saved.hour, saved.minute); } catch { return fallback; }
    if (saved.enabled && !Number.isFinite(Date.parse(saved.firstRunAt))) return fallback;
    return { ...fallback, ...saved, weekday: 4, timezone: TIMEZONE };
  }

  function status(stamp = clock()) {
    const current = config();
    const lastRun = db.prepare(`SELECT schedule_key AS scheduleKey,scheduled_at AS scheduledAt,
      status,attempt_count AS attemptCount,last_attempt_at AS lastAttemptAt,
      completed_at AS completedAt,applied_count AS appliedCount,total_cents AS totalCents,
      skipped_count AS skippedCount,error FROM captain_weekly_schedule_runs
      ORDER BY scheduled_at DESC LIMIT 1`).get() || null;
    let nextRunAt = current.enabled ? nextThursdayOccurrence(stamp, current.hour, current.minute) : null;
    if (nextRunAt && Date.parse(nextRunAt) < Date.parse(current.firstRunAt)) nextRunAt = current.firstRunAt;
    const due = dueSlot(current, stamp);
    const dueRecord = due ? db.prepare('SELECT status,attempt_count FROM captain_weekly_schedule_runs WHERE schedule_key=?').get(due.key) : null;
    if (due && (!dueRecord || (dueRecord.status === 'failed' && dueRecord.attempt_count < MAX_ATTEMPTS))) nextRunAt = due.scheduledAt;
    return { ...current, nextRunAt, amountCents: 100, eligibleScope: 'active_registered_captains_with_completed_download_or_execution',
      excludeRegisteredOnExecutionDay: true, minimumBalanceCents: 100,
      excludedIdentities: ['bot', 'company', 'archived', 'merged', 'inactive', 'official_group_admin', 'no_completed_download_or_execution'],
      repeatedWithinWeek: false, catchUp: 'same_thursday_only', maxAttempts: MAX_ATTEMPTS,
      timerRunning: timer !== null, lastRun };
  }

  function configure(input) {
    if (typeof input.enabled !== 'boolean') throw new TypeError('enabled must be boolean');
    const prior = config();
    const hour = input.hour === undefined ? prior.hour : input.hour;
    const minute = input.minute === undefined ? prior.minute : input.minute;
    validateTime(hour, minute);
    const stamp = clock();
    const unchanged = prior.enabled && input.enabled && prior.hour === hour && prior.minute === minute;
    const next = { enabled: input.enabled, weekday: 4, hour, minute, timezone: TIMEZONE,
      firstRunAt: input.enabled ? (unchanged ? prior.firstRunAt : nextThursdayOccurrence(stamp, hour, minute)) : prior.firstRunAt,
      updatedAt: stamp };
    setSetting(SETTING_KEY, JSON.stringify(next));
    return status(stamp);
  }

  function tick(stamp = clock()) {
    if (running) return { status: 'already_running' };
    const slot = dueSlot(config(), stamp);
    if (!slot) return { status: 'not_due' };
    const existing = db.prepare('SELECT status,attempt_count,last_attempt_at FROM captain_weekly_schedule_runs WHERE schedule_key=?').get(slot.key);
    if (existing?.status === 'completed') return { status: 'already_completed', scheduleKey: slot.key };
    if (existing && existing.attempt_count >= MAX_ATTEMPTS) return { status: 'attempt_limit', scheduleKey: slot.key };
    if (existing && Date.parse(stamp) - Date.parse(existing.last_attempt_at) < RETRY_DELAY_MS) return { status: 'retry_wait', scheduleKey: slot.key };
    const attempt = (existing?.attempt_count || 0) + 1;
    running = true;
    try {
      const result = db.transaction(() => {
        const committed = db.prepare('SELECT status FROM captain_weekly_schedule_runs WHERE schedule_key=?').get(slot.key);
        if (committed?.status === 'completed') return { status: 'already_completed', scheduleKey: slot.key };
        db.prepare(`INSERT INTO captain_weekly_schedule_runs(schedule_key,scheduled_at,status,attempt_count,last_attempt_at)
          VALUES(?,?,'running',?,?) ON CONFLICT(schedule_key) DO UPDATE SET status='running',
          attempt_count=excluded.attempt_count,last_attempt_at=excluded.last_attempt_at,error=NULL`).run(slot.key, slot.scheduledAt, attempt, stamp);
        const applied = execute(stamp, { scheduled: true, scheduleKey: slot.key });
        if (applied.status !== 'completed' || (applied.skipped || []).some((row) => row.state === 'error')) {
          throw new Error('Weekly charge batch failed; wallet changes rolled back');
        }
        const appliedCount = (applied.applied || []).length;
        const totalCents = appliedCount * 100;
        if (Number(applied.totalCents) !== totalCents) throw new Error('Weekly charge total mismatch');
        db.prepare(`UPDATE captain_weekly_schedule_runs SET status='completed',completed_at=?,
          applied_count=?,total_cents=?,skipped_count=?,error=NULL WHERE schedule_key=?`)
          .run(stamp, appliedCount, totalCents, (applied.skipped || []).length, slot.key);
        audit('captain.subscription.scheduled_run', 'system', 'captains', {
          scheduleKey: slot.key, scheduledAt: slot.scheduledAt, executedAt: stamp,
          timezone: TIMEZONE, appliedCount, totalCents, skippedCount: (applied.skipped || []).length,
        });
        return { status: 'completed', scheduleKey: slot.key, appliedCount, totalCents };
      })();
      logger.info?.(`[SubscriptionSchedule] ${slot.key} ${result.status} count=${result.appliedCount || 0}`);
      return result;
    } catch (error) {
      db.prepare(`INSERT INTO captain_weekly_schedule_runs(schedule_key,scheduled_at,status,attempt_count,last_attempt_at,error)
        VALUES(?,?,'failed',?,?,?) ON CONFLICT(schedule_key) DO UPDATE SET status='failed',
        attempt_count=excluded.attempt_count,last_attempt_at=excluded.last_attempt_at,error=excluded.error`)
        .run(slot.key, slot.scheduledAt, attempt, stamp, String(error.message).slice(0, 300));
      logger.error?.(`[SubscriptionSchedule] ${slot.key} attempt=${attempt} failed: ${error.message}`);
      return { status: 'failed', scheduleKey: slot.key, attemptCount: attempt };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer !== null) return;
    const safelyTick = () => { try { tick(); } catch (error) { logger.error?.(`[SubscriptionSchedule] check failed: ${error.message}`); } };
    safelyTick();
    timer = setIntervalFn(safelyTick, POLL_MS);
    timer.unref?.();
  }

  function stop() {
    if (timer !== null) clearIntervalFn(timer);
    timer = null;
  }

  return { status, configure, tick, start, stop, config };
}

module.exports = { TIMEZONE, SETTING_KEY, localParts, localDateTimeIso, businessWeekPeriod,
  nextThursdayOccurrence, dueSlot, createWeeklySubscriptionScheduler };

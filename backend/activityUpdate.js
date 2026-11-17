// ─────────────────────────────────────────────────────────────────────────────
// QA-09 — activity update helpers (pure functions, no database access).
//
// Why this file exists: PUT /api/activities/:id used to assemble its SET clause
// by appending text fragments (", completed_at = NULL", ", completed_at = $12"
// ...). When the request body carried a client timestamp AND the status rule
// also wanted to write the same column, PostgreSQL rejected the statement with
// "multiple assignments to same column". The current front end triggers that on
// every cancel and every reschedule of a job that already has a timestamp.
//
// The fix is structural, at the backend level: every column of the UPDATE is
// registered in ONE Map keyed by column name, so a second registration replaces
// the first instead of adding a second assignment. The status/timestamp rules
// below decide, once per column, what the final value is.
// ─────────────────────────────────────────────────────────────────────────────

export class ActivityValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ActivityValidationError';
    this.status = 400;
  }
}

/** The caller may not make this change (maps to HTTP 403). */
export class ActivityForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ActivityForbiddenError';
    this.status = 403;
  }
}

/**
 * F-1: the write is based on an out-of-date (409) or unknown (428) version of the job.
 * `code` is machine readable for the front end; nothing has been written when this is thrown.
 */
export class ActivityConflictError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ActivityConflictError';
    this.status = status;
    this.code = code;
  }
}

const ACTIVE_STATUSES = ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'];

/** Parse a client supplied timestamp. Empty → null. Unparseable → 400 (never a 500). */
export function parseClientTimestamp(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ActivityValidationError(`${fieldName} is not a valid date/time`);
  }
  return d.toISOString();
}

/**
 * Decide what happens to started_at / completed_at for one update (F-4).
 *
 * Each result is { mode, value? } where mode is
 *   'keep'  – do not assign the column (the stored value stays),
 *   'now'   – server clock (a fixed `nowIso` is used when supplied, so the column and the
 *             history record carry the very same instant),
 *   'null'  – clear,
 *   'value' – a timestamp (ISO string).
 *
 * Authority rules, identical for both columns:
 *   1. Rescheduling back to PLANNED (from any other status) clears both columns.
 *   2. CANCELLED keeps started_at untouched and always clears completed_at (a cancelled job
 *      is not a completed job; the cancellation time lives in details.cancelledAt).
 *   3. ORDINARY transitions use the SERVER clock only: started_at when the job first enters an
 *      active status, completed_at when it first becomes DONE. A client-sent startedAt /
 *      completedAt is validated but IGNORED (portals echo whatever the record held).
 *   4. A CORRECTION — `correction: true`, which the caller grants only to Admin / Team Lead who
 *      explicitly asked for it — stores the client's startedAt / completedAt as sent.
 *   5. Otherwise the stored value is left alone.
 */
export function planActivityTimestamps({ status, prevStatus, startedAt, completedAt, correction = false, nowIso = null }) {
  const clientStartedAt = parseClientTimestamp(startedAt, 'startedAt');
  const clientCompletedAt = parseClientTimestamp(completedAt, 'completedAt');
  const useStarted = correction ? clientStartedAt : null;
  const useCompleted = correction ? clientCompletedAt : null;
  const rescheduling = status === 'PLANNED' && prevStatus !== 'PLANNED';
  const cancelling = status === 'CANCELLED';
  const now = nowIso ? { mode: 'value', value: nowIso } : { mode: 'now' };

  let started = { mode: 'keep' };
  if (rescheduling) started = { mode: 'null' };
  else if (cancelling) started = { mode: 'keep' };
  else if (useStarted) started = { mode: 'value', value: useStarted };
  else if (ACTIVE_STATUSES.includes(status) && !ACTIVE_STATUSES.includes(prevStatus)) started = now;

  let completed = { mode: 'keep' };
  if (rescheduling || cancelling) completed = { mode: 'null' };
  else if (useCompleted) completed = { mode: 'value', value: useCompleted };
  else if (status === 'DONE' && prevStatus !== 'DONE') completed = now;

  // Exactly one DONE visit record per completion: written by the server on the transition into DONE.
  const recordDoneVisit = status === 'DONE' && prevStatus !== 'DONE';
  return {
    started, completed, recordDoneVisit, cancelling,
    correctionStartedAt: useStarted, correctionCompletedAt: useCompleted,
    clientTimesIgnored: !correction && !!(clientStartedAt || clientCompletedAt),
  };
}

// ── rescheduling a job that was already started ─────────────────────────────
/**
 * Moving a job back to PLANNED clears started_at/completed_at. Before that happens the
 * previous start (and completion, if any) is written to visit history as a RESCHEDULED
 * record so it is not lost. Returns the record to append, or null when nothing needs
 * saving or the same previous start is already recorded (repeated / retried request).
 */
export function planRescheduleRecord({ status, prevStatus, stored, history, team, remarks, nowIso }) {
  if (status !== 'PLANNED' || prevStatus === 'PLANNED') return null;
  const startedIso = stored && stored.started_at ? new Date(stored.started_at).toISOString() : null;
  const completedIso = stored && stored.completed_at ? new Date(stored.completed_at).toISOString() : null;
  // CARRY_FORWARD already wrote its own visit record when it was set.
  if (!startedIso && !(completedIso && prevStatus === 'DONE')) return null;
  const same = (r) => r && r.status === 'RESCHEDULED' &&
    ((r.startedAt ? new Date(r.startedAt).getTime() : null) === (startedIso ? new Date(startedIso).getTime() : null)) &&
    ((r.completedAt ? new Date(r.completedAt).getTime() : null) === (completedIso ? new Date(completedIso).getTime() : null));
  if (Array.isArray(history) && history.some(same)) return null;
  return {
    date: stored.planned_date || null,
    startedAt: startedIso,
    completedAt: completedIso,
    assignedTeam: team || {},
    remarks: remarks || '',
    rescheduledFrom: prevStatus,
    rescheduledAt: nowIso,
    status: 'RESCHEDULED'
  };
}


// ── visit history ────────────────────────────────────────────────────────────

const MAX_HISTORY_RECORDS = 1000;

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/** Validate the visitHistory a client sent. undefined/null → null (nothing sent). */
export function parseClientVisitHistory(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_HISTORY_RECORDS ||
      !value.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
    throw new ActivityValidationError('visitHistory must be an array of visit records');
  }
  return value;
}

/**
 * Combine the stored history with the one the client echoed back.
 * The result NEVER shrinks: a stale client copy cannot delete records another
 * session added, and an echoed copy of what is already stored adds nothing.
 * A repeated "cancel" (same cancelledBy/reason/note on an activity that already
 * has such a record) is treated as the same visit, because its `date` is the
 * click time and would otherwise differ on every retry.
 */
// Records only the server may create. A client echo of a record that is not already stored is
// discarded, so a completion / reschedule / correction can never be duplicated or invented.
const SERVER_ONLY_STATUSES = new Set(['DONE', 'RESCHEDULED', 'TIME_CORRECTION']);

export function mergeVisitHistory(stored, incomingAll) {
  const base = Array.isArray(stored) ? stored : [];
  const seenKeys = new Set(base.map(stableStringify));
  const incoming = (incomingAll || []).filter(r => !(r && SERVER_ONLY_STATUSES.has(r.status)) || seenKeys.has(stableStringify(r)));
  if (!incoming || incoming.length === 0) return { history: base, changed: false };
  const seen = new Set(base.map(stableStringify));
  const cancelKey = r => (r && r.status === 'CANCELLED')
    ? `${r.cancelledBy ?? ''}|${r.reason ?? ''}|${r.note ?? ''}` : null;
  const cancelSeen = new Set(base.map(cancelKey).filter(k => k !== null));
  const history = [...base];
  for (const rec of incoming) {
    const k = stableStringify(rec);
    const ck = cancelKey(rec);
    if (seen.has(k) || (ck !== null && cancelSeen.has(ck))) continue;
    seen.add(k);
    if (ck !== null) cancelSeen.add(ck);
    history.push(rec);
  }
  return { history, changed: history.length !== base.length };
}

// ── single-assignment UPDATE builder ─────────────────────────────────────────

const IDENT = /^[a-z_][a-z0-9_]*$/;

export class ActivityUpdateBuilder {
  constructor() {
    this.cols = new Map(); // column -> { kind:'param', value, wrap } | { kind:'raw', sql }
  }
  /** Assign `col` from a bound parameter. wrap(n) may embed "$n" in a SQL expression. */
  param(col, value, wrap = n => `$${n}`) {
    if (!IDENT.test(col)) throw new Error(`bad column name: ${col}`);
    this.cols.set(col, { kind: 'param', value, wrap });
    return this;
  }
  /** Assign `col` from a fixed SQL expression (no user input). */
  raw(col, sql) {
    if (!IDENT.test(col)) throw new Error(`bad column name: ${col}`);
    this.cols.set(col, { kind: 'raw', sql });
    return this;
  }
  /** Apply a planActivityTimestamps() result to one column. */
  timestamp(col, plan) {
    if (plan.mode === 'now') return this.raw(col, 'NOW()');
    if (plan.mode === 'null') return this.raw(col, 'NULL');
    if (plan.mode === 'value') return this.param(col, plan.value, n => `$${n}::timestamptz`);
    return this; // keep
  }
  has(col) { return this.cols.has(col); }
  /** → { sql, params }. Every column appears exactly once by construction. */
  build(whereId) {
    const params = [];
    const parts = [];
    for (const [col, spec] of this.cols) {
      if (spec.kind === 'raw') { parts.push(`${col}=${spec.sql}`); continue; }
      params.push(spec.value);
      parts.push(`${col}=${spec.wrap(params.length)}`);
    }
    params.push(whereId);
    return { sql: `UPDATE activities SET ${parts.join(', ')} WHERE id=$${params.length} RETURNING updated_at`, params };
  }
}

// ── F-3: partial updates ─────────────────────────────────────────────────────
// A key that is not in the request body leaves the stored value alone. A key that is present
// with null or '' is an explicit request to clear it. The rules for clearing:
//   • type, priority, status, plannedDate are mandatory — clearing one that has a value is a 400;
//   • siteId, leadTechId, description, durationHours may be cleared by Admin / Team Lead only;
//     anyone else asking for it gets a 403 (a field engineer can never clear them);
//   • sending '' / null for a column that is already empty is not a change (full-record echoes).

const isEmpty = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const normId = v => (v === null || v === undefined) ? '' : String(v).trim();
const idSet = a => [...new Set((Array.isArray(a) ? a : []).map(normId).filter(Boolean))].sort();
const sameIds = (a, b) => JSON.stringify(idSet(a)) === JSON.stringify(idSet(b));
const instant = v => (isEmpty(v) ? null : new Date(v).getTime());

const FIELD_RULES = [
  { key: 'type', col: 'type', mandatory: true, kind: 'text' },
  { key: 'priority', col: 'priority', mandatory: true, kind: 'text' },
  { key: 'status', col: 'status', mandatory: true, kind: 'text' },
  { key: 'plannedDate', col: 'planned_date', mandatory: true, kind: 'date' },
  { key: 'siteId', col: 'site_id', kind: 'text' },
  { key: 'leadTechId', col: 'lead_tech_id', kind: 'text' },
  { key: 'description', col: 'description', kind: 'text' },
  { key: 'durationHours', col: 'duration_hours', kind: 'number' },
];

/** → { values: {type, priority, status, plannedDate, siteId, leadTechId, description, durationHours}, cleared: [key…] } */
export function resolveFieldUpdates(body, stored, { isManager }) {
  const values = {};
  const cleared = [];
  for (const f of FIELD_RULES) {
    const storedVal = stored[f.col] === undefined ? null : stored[f.col];
    const present = Object.prototype.hasOwnProperty.call(body, f.key) && body[f.key] !== undefined;
    if (!present) { values[f.key] = storedVal; continue; }
    const v = body[f.key];
    if (isEmpty(v)) {
      if (isEmpty(storedVal)) { values[f.key] = storedVal; continue; }      // echo of an empty column
      if (f.mandatory) throw new ActivityValidationError(`${f.key} is required and cannot be cleared`);
      if (!isManager) throw new ActivityForbiddenError(`Only a Team Lead or Admin can clear ${f.key}.`);
      values[f.key] = null; cleared.push(f.key); continue;
    }
    if (f.kind === 'date') {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new ActivityValidationError(`${f.key} is not a valid date/time`);
      values[f.key] = d.toISOString();
    } else if (f.kind === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new ActivityValidationError(`${f.key} must be a non-negative number`);
      values[f.key] = n;
    } else {
      if (typeof v !== 'string' && typeof v !== 'number') throw new ActivityValidationError(`${f.key} must be text`);
      values[f.key] = String(v);
    }
  }
  return { values, cleared };
}

/**
 * Team fields live in `details`. Absent → unchanged; present → replaced, with the field-engineer
 * protections: an engineer can neither clear the primary engineer nor drop anyone already on the
 * supporting list (their list is MERGED into the stored one).
 * → { primaryEngineerId, supportingEngineerIds }  (supporting is undefined when it stays as stored)
 */
export function resolveTeamUpdates(body, storedDetails, { isManager }) {
  const sd = storedDetails || {};
  const has = k => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
  let primary = sd.primaryEngineerId || null;
  if (has('primaryEngineerId')) {
    const v = body.primaryEngineerId;
    if (isEmpty(v)) {
      if (!isManager && !isEmpty(sd.primaryEngineerId)) throw new ActivityForbiddenError('Only a Team Lead or Admin can remove the primary engineer.');
      primary = null;
    } else primary = String(v);
  }
  let supporting;
  if (has('supportingEngineerIds')) {
    const list = Array.isArray(body.supportingEngineerIds) ? body.supportingEngineerIds : [];
    supporting = isManager ? list : [...new Set([...(Array.isArray(sd.supportingEngineerIds) ? sd.supportingEngineerIds : []), ...list])];
  }
  return { primaryEngineerId: primary, supportingEngineerIds: supporting };
}

// ── F-1: optimistic concurrency ──────────────────────────────────────────────

/**
 * Is this update workflow-critical? Only these changes need an up-to-date version:
 * status (incl. cancel / reschedule / complete), planned date, lead, any team member, or an
 * explicit time correction. Notes, remarks, photos, descriptions and history merges do not.
 */
export function isWorkflowCritical({ stored, storedDetails, next, correctionApplied }) {
  const sd = storedDetails || {};
  // Repeating a cancel on an already-cancelled job changes nothing: the server clears the team on
  // cancel anyway, so an older copy still listing the team is not a conflicting edit.
  if (stored.status === 'CANCELLED' && normId(next.status) === 'CANCELLED' && !correctionApplied) return false;
  return !!(
    correctionApplied ||
    normId(next.status) !== normId(stored.status) ||
    instant(next.plannedDate) !== instant(stored.planned_date) ||
    normId(next.leadTechId) !== normId(stored.lead_tech_id) ||
    normId(next.primaryEngineerId) !== normId(sd.primaryEngineerId) ||
    (next.supportingEngineerIds !== undefined && !sameIds(next.supportingEngineerIds, sd.supportingEngineerIds)) ||
    (next.assistantTechIds !== undefined && !sameIds(next.assistantTechIds, sd.assistantTechIds))
  );
}

/** The version token the server hands out: the row's updated_at as an ISO string. */
export const versionOf = updatedAt => (updatedAt ? new Date(updatedAt).toISOString() : null);

/**
 * Compare the version a client based its change on with the stored one.
 * A missing token is NOT treated as "current":
 *   policy 'reject' (default)  → 428, nothing written;
 *   policy 'allow-logged'      → accepted for a transition window, flagged `unverified` so the
 *                                caller logs it.
 * Non-critical updates never need a token.
 */
export function evaluateVersion({ baseVersion, storedUpdatedAt, critical, unversionedPolicy = 'reject' }) {
  if (!critical) return { ok: true, verified: false, unverified: false };
  if (isEmpty(baseVersion)) {
    // A legacy row whose updated_at was never set has no version to show a client (versionOf → null), so no token can exist:
    // its FIRST critical change is let through (logged as unverified) and stamps updated_at; every later change needs a token.
    if (storedUpdatedAt === null || storedUpdatedAt === undefined) return { ok: true, verified: false, unverified: true };
    if (unversionedPolicy === 'allow-logged') return { ok: true, verified: false, unverified: true };
    throw new ActivityConflictError(428, 'VERSION_REQUIRED', 'This screen is out of date. Please reload the app and try again.');
  }
  const t = new Date(baseVersion).getTime();
  if (Number.isNaN(t)) throw new ActivityValidationError('baseVersion is not a valid version');
  if (t !== new Date(storedUpdatedAt).getTime()) {
    throw new ActivityConflictError(409, 'ACTIVITY_CHANGED', 'This job was changed by someone else. The latest version has been loaded — please check it and try again.');
  }
  return { ok: true, verified: true, unverified: false };
}

// ── F-4: explicit time correction record ─────────────────────────────────────
/** History record that preserves the values a correction replaced. null when nothing changed. */
export function planTimeCorrectionRecord({ stored, plan, by, role, nowIso }) {
  const before = {
    startedAt: stored.started_at ? new Date(stored.started_at).toISOString() : null,
    completedAt: stored.completed_at ? new Date(stored.completed_at).toISOString() : null,
  };
  const after = {
    startedAt: plan.started.mode === 'value' ? plan.started.value : before.startedAt,
    completedAt: plan.completed.mode === 'value' ? plan.completed.value : before.completedAt,
  };
  if (before.startedAt === after.startedAt && before.completedAt === after.completedAt) return null;
  // Only a value that REPLACES an existing one needs preserving; filling an empty column loses nothing.
  if (!before.startedAt && !before.completedAt) return null;
  return { status: 'TIME_CORRECTION', correctedAt: nowIso, correctedBy: by, correctedByRole: role, previous: before, corrected: after };
}

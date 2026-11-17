// ─────────────────────────────────────────────────────────────────────────────
// Centralised authentication + authorisation (Batch 1 security remediation)
//
// Why this file exists
//   Before this change `authenticate` only verified the JWT signature and
//   blocked VIEWER writes. It trusted the role baked into the token for up
//   to 12 h, never re-checked that the account still existed / was active,
//   and almost no route had a role or ownership check (QA-01, QA-02, QA-19).
//
// What it provides
//   • createAuthenticate()  – verifies the JWT, then LOADS THE ACCOUNT FROM
//                             THE DATABASE on every request so that deleted,
//                             deactivated or demoted users lose access on
//                             their very next request.
//   • requireRoles(...)     – deny-by-default role gate (403 otherwise).
//   • job-participation helpers – ownership checks based on the REAL
//                             assignment columns stored in the database
//                             (never on ids sent by the client).
//   • password fingerprint  – lets a password change invalidate older tokens
//                             without a schema change.
//
// Nothing in here touches the database schema.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';

export const ROLE = Object.freeze({
  ADMIN: 'ADMIN',
  TEAM_LEAD: 'TEAM_LEAD',
  FIELD_ENGINEER: 'FIELD_ENGINEER',
  SALES: 'SALES',
  VIEWER: 'VIEWER',
});

/** Roles an administrator may assign to an account. 'NONE' is the existing
 *  "no system role" value used for technical associates. */
export const ASSIGNABLE_ROLES = Object.freeze([
  ROLE.ADMIN, ROLE.TEAM_LEAD, ROLE.FIELD_ENGINEER, ROLE.SALES, ROLE.VIEWER, 'NONE',
]);

/** Account statuses written by the app. Anything else is rejected on write. */
export const ASSIGNABLE_STATUSES = Object.freeze(['ACTIVE', 'AVAILABLE', 'INACTIVE', 'BUSY', 'LEAVE', 'ON_LEAVE']);

/** Status value that means "this account may not use the API". */
export const DISABLED_STATUS = 'INACTIVE';

// Common role groups (used by route guards and documented in the matrix).
export const STAFF_MANAGERS = Object.freeze([ROLE.ADMIN, ROLE.TEAM_LEAD]);
export const ADMIN_ONLY = Object.freeze([ROLE.ADMIN]);

/** Short, non-reversible fingerprint of the stored password hash. Embedded in
 *  new JWTs ("pwv") so that changing a password invalidates older sessions.
 *  Tokens issued before this change do not carry the claim and stay valid
 *  until they expire (avoids a company-wide forced logout on deploy). */
export function passwordFingerprint(passwordHash) {
  return crypto.createHash('sha256').update(String(passwordHash || '')).digest('hex').slice(0, 16);
}

function structuredLog(level, payload) {
  const line = JSON.stringify({ level, ...payload, timestamp: new Date().toISOString() });
  if (level === 'ERROR') console.error(line); else console.warn(line);
}

/**
 * Builds the `authenticate` middleware.
 *  - 401  : missing / invalid / expired token, account deleted, password changed
 *           after the token was issued, account disabled.
 *  - 503  : the account lookup itself failed (database down). Deliberately NOT
 *           401 because the web app logs the user out on every 401 — a short
 *           database outage must not sign the whole company out.
 */
export function createAuthenticate({ pool, jwt, secret }) {
  return async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized — no token' });
    }
    const token = authHeader.slice(7).trim();

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      return res.status(401).json({ error: 'Unauthorized — invalid token' });
    }
    if (!payload || typeof payload.id !== 'string' || !payload.id) {
      return res.status(401).json({ error: 'Unauthorized — invalid token' });
    }

    let row;
    try {
      const r = await pool.query(
        'SELECT id, name, email, role, status, password FROM users WHERE id = $1',
        [payload.id]
      );
      row = r.rows[0];
    } catch (e) {
      structuredLog('ERROR', { event: 'AUTH_LOOKUP_FAILED', message: e.message });
      return res.status(503).json({ error: 'Authentication service temporarily unavailable' });
    }

    if (!row) {
      return res.status(401).json({ error: 'Unauthorized — account no longer exists' });
    }
    if (row.status === DISABLED_STATUS) {
      return res.status(401).json({ error: 'Unauthorized — account is inactive' });
    }
    if (payload.pwv && payload.pwv !== passwordFingerprint(row.password)) {
      return res.status(401).json({ error: 'Unauthorized — session expired, please sign in again' });
    }

    // The role used for every decision is the CURRENT database role, not the
    // one that was in the token when it was issued.
    req.user = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
    };

    // VIEWER accounts are strictly read-only (unchanged behaviour).
    if (req.user.role === ROLE.VIEWER && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return res.status(403).json({ error: 'View-only accounts cannot make changes.' });
    }
    next();
  };
}

/**
 * Deny-by-default role gate. Must be placed AFTER authenticate.
 * Usage: app.delete('/api/x/:id', authenticate, requireRoles(ROLE.ADMIN), handler)
 */
export function requireRoles(...allowed) {
  const set = new Set(allowed.flat());
  return function roleGate(req, res, next) {
    if (!req.user || !set.has(req.user.role)) {
      structuredLog('WARN', {
        event: 'AUTHZ_DENIED',
        method: req.method,
        url: req.originalUrl?.split('?')[0],
        user: req.user?.email || 'anonymous',
        role: req.user?.role || null,
        required: [...set],
      });
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

// ── Job participation (ownership) ───────────────────────────────────────────
// An activity involves a person if they are its lead, primary engineer,
// supporting engineer or technical associate/assistant — the same set used by
// activityInvolvesPersonClause() in server.js and isInvolvedInJob() in the
// frontend. Always evaluated against the STORED row, never request data.

/** Returns the participant ids of a stored activity row. */
export function activityParticipantIds(row) {
  const d = (row && row.details) || {};
  const ids = new Set();
  if (row?.lead_tech_id) ids.add(String(row.lead_tech_id));
  if (d.primaryEngineerId) ids.add(String(d.primaryEngineerId));
  for (const id of Array.isArray(d.supportingEngineerIds) ? d.supportingEngineerIds : []) if (id) ids.add(String(id));
  for (const id of Array.isArray(d.assistantTechIds) ? d.assistantTechIds : []) if (id) ids.add(String(id));
  return ids;
}

export const isActivityParticipant = (row, userId) => activityParticipantIds(row).has(String(userId));

/** A ticket has one assignee. */
export const isTicketAssignee = (row, userId) =>
  !!row && !!row.assigned_tech_id && String(row.assigned_tech_id) === String(userId);

/** Compares two id lists ignoring order. */
export function sameIdSet(a, b) {
  const x = [...new Set((a || []).filter(Boolean).map(String))].sort();
  const y = [...new Set((b || []).filter(Boolean).map(String))].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export const normId = (v) => (v === undefined || v === null || v === '' ? null : String(v));

/** Number of enabled administrator accounts (optionally ignoring one id). */
export async function countActiveAdmins(db, exceptUserId = null) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM users
      WHERE role = 'ADMIN' AND COALESCE(status,'ACTIVE') <> 'INACTIVE'
        AND ($1::text IS NULL OR id <> $1)`,
    [exceptUserId]
  );
  return r.rows[0].n;
}

// ── Password / secret helpers ───────────────────────────────────────────────
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72; // bcrypt only uses the first 72 bytes

// Passwords that have shipped as defaults in this project's code/docs. They are
// refused for any new or reset password.
const KNOWN_DEFAULT_PASSWORDS = new Set(['admin123', 'qonnect@123', 'password', '12345678', 'fieldops_pass']);

export function validateNewPassword(pw) {
  if (typeof pw !== 'string') return 'Password is required';
  if (KNOWN_DEFAULT_PASSWORDS.has(pw.trim().toLowerCase())) return 'That password is a well-known default — choose a different one';
  if (pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (Buffer.byteLength(pw, 'utf8') > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} bytes`;
  return null;
}

/** Constant-time string comparison (length differences do not short-circuit). */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a ?? '').length === String(b ?? '').length;
}

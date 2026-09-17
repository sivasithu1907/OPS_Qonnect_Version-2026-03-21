// ============================================================================
// Freelancer Management — profiles, daily attendance/wages, payments &
// allocations, and a scoped/expiring CEO review link.
// ============================================================================
// Self-contained module, mirroring the conventions already used throughout
// server.js (idempotent `CREATE TABLE IF NOT EXISTS` bootstrap, inline
// `req.user.role !== 'X'` checks, `pool.connect()` + BEGIN/COMMIT/ROLLBACK
// for multi-statement writes, `logAudit()` for the audit trail).
//
// Wired into server.js via two calls:
//   - `initFreelancerSchema(pool)`      — called once inside initDb()
//   - `registerFreelancerRoutes(app, {..})` — called once at startup, after
//                                              authenticate/logAudit exist.
//
// ── Data model ──────────────────────────────────────────────────────────────
//   freelancers                     — permanent, reusable profiles
//   freelancer_attendance           — one row = one CONFIRMED payable day
//                                      (or a VOIDED correction trail entry)
//   freelancer_attendance_links     — activities worked that day (snapshotted
//                                      at confirmation time — reassigning the
//                                      activity later never rewrites this)
//   freelancer_attendance_allocations — how that day's single wage is split
//                                      across linked projects for cost
//                                      reporting (must total the daily wage)
//   freelancer_payments             — a single money transfer (may settle
//                                      several attendance records, possibly
//                                      across different freelancers)
//   freelancer_payment_allocations  — how one payment is applied across
//                                      attendance records
//   freelancer_review_tokens        — scoped, expiring, revocable read-only
//                                      links for the CEO review page
//
// ── Permissions (mapped to roles that actually exist — ADMIN / TEAM_LEAD /
//    FIELD_ENGINEER / SALES / VIEWER — nothing invented) ──────────────────
//   VIEW_FREELANCERS   ADMIN, TEAM_LEAD, VIEWER  — directory + attendance read
//   MANAGE_FREELANCERS ADMIN, TEAM_LEAD          — create/edit profiles,
//                                                   confirm/edit/void attendance
//   VIEW_PAYMENTS      ADMIN, VIEWER             — payment ledger (financial
//                                                   detail — Team Leads confirm
//                                                   attendance only, per spec)
//   MANAGE_PAYMENTS    ADMIN                     — record/reverse payments,
//                                                   create/revoke review links
// VIEWER remains strictly read-only (the shared `authenticate` middleware in
// server.js already hard-blocks every non-GET request for VIEWER accounts,
// same as the rest of the app).
// ============================================================================

import crypto from 'crypto';

const VIEW_FREELANCERS   = ['ADMIN', 'TEAM_LEAD', 'VIEWER'];
const MANAGE_FREELANCERS = ['ADMIN', 'TEAM_LEAD'];
const VIEW_PAYMENTS      = ['ADMIN', 'VIEWER'];
const MANAGE_PAYMENTS    = ['ADMIN'];

const FREELANCER_ROLE_VALUES = ['FIELD_ENGINEER', 'TECHNICAL_ASSOCIATE'];
const DEFAULT_DAILY_RATE = 150.00;
const MAX_ATTACHMENT_BASE64_LEN = 2_400_000; // ~1.75MB decoded — same order of magnitude as the existing photo fields

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Same convention as the inline normalizer already used in POST /api/customers
// — kept as its own copy here (not imported) since server.js's version is a
// closure local to that one route, not an exported shared function.
function normalizeQatarPhone(raw) {
  if (!raw) return null;
  let clean = String(raw).replace(/[^0-9+]/g, '');
  if (!clean) return null;
  if (/^[0-9]{8}$/.test(clean)) return `+974${clean}`;
  if (clean.startsWith('00')) clean = '+' + clean.substring(2);
  if (!clean.startsWith('+') && clean.startsWith('974')) clean = '+' + clean;
  if (!clean.startsWith('+') && clean.length === 8) return `+974${clean}`;
  return clean;
}

function toCents(n) {
  const v = Number(n);
  if (!isFinite(v)) return NaN;
  return Math.round(v * 100);
}
function centsToStr(c) {
  return (Math.round(c) / 100).toFixed(2);
}

// Qatar has no DST and sits at a fixed UTC+3 offset — same as this
// deployment's Asia/Riyadh reference point — so a simple fixed offset is
// sufficient (no need for a timezone library dependency).
function qatarToday() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
function isValidDateStr(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}
function isReasonableWorkDate(dateStr) {
  if (!isValidDateStr(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z').getTime();
  if (isNaN(d)) return false;
  const now = Date.now() + 3 * 60 * 60 * 1000;
  const threeDaysAhead = now + 3 * 24 * 60 * 60 * 1000;
  const fiveYearsAgo = now - 5 * 365 * 24 * 60 * 60 * 1000;
  return d <= threeDaysAhead && d >= fiveYearsAgo;
}

async function nextFreelancerId(pool) {
  const { rows } = await pool.query('INSERT INTO freelancer_id_seq DEFAULT VALUES RETURNING id');
  return `QNC-FL-${String(rows[0].id).padStart(4, '0')}`;
}
async function nextAttendanceId(pool) {
  const { rows } = await pool.query('INSERT INTO freelancer_attendance_id_seq DEFAULT VALUES RETURNING id');
  return `QNC-FLA-${String(rows[0].id).padStart(6, '0')}`;
}
async function nextPaymentId(pool) {
  const { rows } = await pool.query('INSERT INTO freelancer_payment_id_seq DEFAULT VALUES RETURNING id');
  return `QNC-FLP-${String(rows[0].id).padStart(6, '0')}`;
}

function paymentStatusFor(agreedRateCents, paidCents) {
  if (paidCents <= 0) return 'UNPAID';
  if (paidCents >= agreedRateCents) return 'PAID';
  return 'PARTIALLY_PAID';
}

function mapFreelancer(r) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone || '',
    role: r.role || 'TECHNICAL_ASSOCIATE',
    skill: r.skill || '',
    defaultDailyRate: Number(r.default_daily_rate),
    notes: r.notes || '',
    isActive: r.is_active !== false,
    createdBy: r.created_by || null,
    createdByName: r.created_by_name || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapAttendance(r) {
  return {
    id: r.id,
    freelancerId: r.freelancer_id,
    freelancerName: r.freelancer_name || '',
    freelancerPhone: r.freelancer_phone || '',
    workDate: r.work_date_str,
    agreedDailyRate: Number(r.agreed_daily_rate),
    status: r.status,
    paidAmount: Number(r.paid_amount),
    balance: Number((Number(r.agreed_daily_rate) - Number(r.paid_amount)).toFixed(2)),
    paymentStatus: r.payment_status,
    primaryActivityId: r.primary_activity_id || null,
    crmReference: r.crm_reference || '',
    customerName: r.customer_name || '',
    salesLeadId: r.sales_lead_id || null,
    salesLeadName: r.sales_lead_name || '',
    teamLeadId: r.team_lead_id || null,
    teamLeadName: r.team_lead_name || '',
    workSummary: r.work_summary || '',
    confirmedBy: r.confirmed_by,
    confirmedByName: r.confirmed_by_name || '',
    confirmedAt: r.confirmed_at,
    voidedBy: r.voided_by || null,
    voidedAt: r.voided_at || null,
    voidReason: r.void_reason || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPayment(r) {
  return {
    id: r.id,
    amount: Number(r.amount),
    paymentDate: r.payment_date_str,
    paymentMethod: r.payment_method || '',
    recipientFreelancerId: r.recipient_freelancer_id,
    recipientName: r.recipient_name_snapshot || '',
    reference: r.reference || '',
    hasAttachment: !!r.proof_attachment,
    notes: r.notes || '',
    status: r.status,
    recordedBy: r.recorded_by,
    recordedByName: r.recorded_by_name || '',
    recordedAt: r.recorded_at,
    reversedBy: r.reversed_by || null,
    reversedAt: r.reversed_at || null,
    reversalReason: r.reversal_reason || '',
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Schema bootstrap — additive, idempotent, safe to run on every boot
// ---------------------------------------------------------------------------
export async function initFreelancerSchema(pool) {
  await pool.query(`
    -- 1. Freelancer profiles ----------------------------------------------
    CREATE TABLE IF NOT EXISTS freelancers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'TECHNICAL_ASSOCIATE',
      skill TEXT,
      default_daily_rate NUMERIC(10,2) NOT NULL DEFAULT 150.00,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_freelancers_phone ON freelancers(phone);
    CREATE INDEX IF NOT EXISTS idx_freelancers_name  ON freelancers(lower(name));
    CREATE INDEX IF NOT EXISTS idx_freelancers_active ON freelancers(is_active);

    CREATE TABLE IF NOT EXISTS freelancer_id_seq (id BIGSERIAL PRIMARY KEY);

    -- 2. Daily attendance (= the payable day) ------------------------------
    CREATE TABLE IF NOT EXISTS freelancer_attendance (
      id TEXT PRIMARY KEY,
      freelancer_id TEXT NOT NULL REFERENCES freelancers(id),
      work_date DATE NOT NULL,
      agreed_daily_rate NUMERIC(10,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED', -- CONFIRMED | VOIDED
      paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'UNPAID', -- UNPAID | PARTIALLY_PAID | PAID
      primary_activity_id TEXT,
      crm_reference TEXT,
      customer_name TEXT,
      sales_lead_id TEXT,
      sales_lead_name TEXT,
      team_lead_id TEXT,
      team_lead_name TEXT,
      work_summary TEXT,
      confirmed_by TEXT NOT NULL,
      confirmed_by_name TEXT,
      confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_by TEXT,
      voided_at TIMESTAMPTZ,
      void_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- One payable (CONFIRMED) day per freelancer per date — enforced at the
    -- database level so two concurrent/duplicate submissions can never both
    -- succeed, regardless of any frontend guard.
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_attendance_active_per_day
      ON freelancer_attendance(freelancer_id, work_date) WHERE status = 'CONFIRMED';
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON freelancer_attendance(work_date);
    CREATE INDEX IF NOT EXISTS idx_attendance_freelancer ON freelancer_attendance(freelancer_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_status ON freelancer_attendance(status);
    CREATE INDEX IF NOT EXISTS idx_attendance_payment_status ON freelancer_attendance(payment_status);
    CREATE INDEX IF NOT EXISTS idx_attendance_sales_lead ON freelancer_attendance(sales_lead_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_team_lead ON freelancer_attendance(team_lead_id);

    CREATE TABLE IF NOT EXISTS freelancer_attendance_id_seq (id BIGSERIAL PRIMARY KEY);

    -- 3. Activities worked that day — snapshotted, not live-joined, so a
    --    later reassignment of the activity never rewrites who worked
    --    together on the day it actually happened.
    CREATE TABLE IF NOT EXISTS freelancer_attendance_links (
      id BIGSERIAL PRIMARY KEY,
      attendance_id TEXT NOT NULL REFERENCES freelancer_attendance(id) ON DELETE CASCADE,
      activity_id TEXT,
      activity_reference TEXT,
      activity_type TEXT,
      customer_name TEXT,
      odoo_link TEXT,
      sales_lead_name TEXT,
      team_lead_name TEXT,
      planned_date TIMESTAMPTZ,
      UNIQUE(attendance_id, activity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_attlinks_activity ON freelancer_attendance_links(activity_id);
    CREATE INDEX IF NOT EXISTS idx_attlinks_attendance ON freelancer_attendance_links(attendance_id);

    -- 4. Explicit per-project cost allocation of that one daily wage -------
    CREATE TABLE IF NOT EXISTS freelancer_attendance_allocations (
      id BIGSERIAL PRIMARY KEY,
      attendance_id TEXT NOT NULL REFERENCES freelancer_attendance(id) ON DELETE CASCADE,
      activity_id TEXT,
      activity_reference TEXT,
      amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_attalloc_attendance ON freelancer_attendance_allocations(attendance_id);

    -- 5. Payments (a single transfer — may settle several attendance rows,
    --    possibly across different freelancers when one person collects on
    --    behalf of others) ---------------------------------------------------
    CREATE TABLE IF NOT EXISTS freelancer_payments (
      id TEXT PRIMARY KEY,
      amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
      payment_date DATE NOT NULL,
      payment_method TEXT,
      recipient_freelancer_id TEXT NOT NULL REFERENCES freelancers(id),
      recipient_name_snapshot TEXT,
      reference TEXT,
      proof_attachment TEXT, -- optional base64 data URL, same pattern as ticket/activity photos; never returned in list responses
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'RECORDED', -- RECORDED | REVERSED
      recorded_by TEXT NOT NULL,
      recorded_by_name TEXT,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reversed_by TEXT,
      reversed_at TIMESTAMPTZ,
      reversal_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_payments_recipient ON freelancer_payments(recipient_freelancer_id);
    CREATE INDEX IF NOT EXISTS idx_payments_date ON freelancer_payments(payment_date);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON freelancer_payments(status);

    CREATE TABLE IF NOT EXISTS freelancer_payment_id_seq (id BIGSERIAL PRIMARY KEY);

    CREATE TABLE IF NOT EXISTS freelancer_payment_allocations (
      id BIGSERIAL PRIMARY KEY,
      payment_id TEXT NOT NULL REFERENCES freelancer_payments(id) ON DELETE CASCADE,
      attendance_id TEXT NOT NULL REFERENCES freelancer_attendance(id),
      freelancer_id TEXT NOT NULL REFERENCES freelancers(id),
      amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_payalloc_payment ON freelancer_payment_allocations(payment_id);
    CREATE INDEX IF NOT EXISTS idx_payalloc_attendance ON freelancer_payment_allocations(attendance_id);

    -- 6. CEO review links — expiring, revocable, unguessable read-only tokens
    CREATE TABLE IF NOT EXISTS freelancer_review_tokens (
      token TEXT PRIMARY KEY,
      label TEXT,
      scope JSONB NOT NULL DEFAULT '{}',
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      last_viewed_at TIMESTAMPTZ,
      view_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_review_tokens_expires ON freelancer_review_tokens(expires_at);
  `);
}

// ---------------------------------------------------------------------------
// Shared query fragments
// ---------------------------------------------------------------------------

// Attendance row + joined freelancer name/phone + work_date as text (avoids
// node-pg's DATE→JS Date UTC-midnight parsing ambiguity entirely).
const ATTENDANCE_SELECT = `
  SELECT fa.*, f.name AS freelancer_name, f.phone AS freelancer_phone,
         to_char(fa.work_date, 'YYYY-MM-DD') AS work_date_str
  FROM freelancer_attendance fa
  JOIN freelancers f ON f.id = fa.freelancer_id
`;

async function fetchAttendanceDetail(pool, id) {
  const { rows } = await pool.query(`${ATTENDANCE_SELECT} WHERE fa.id = $1`, [id]);
  if (!rows[0]) return null;
  const attendance = mapAttendance(rows[0]);
  const [links, allocations, paymentAllocs] = await Promise.all([
    pool.query(`SELECT * FROM freelancer_attendance_links WHERE attendance_id = $1 ORDER BY id`, [id]),
    pool.query(`SELECT * FROM freelancer_attendance_allocations WHERE attendance_id = $1 ORDER BY id`, [id]),
    pool.query(
      `SELECT pa.amount, pa.payment_id, p.payment_date, p.status, p.recipient_name_snapshot,
              to_char(p.payment_date, 'YYYY-MM-DD') AS payment_date_str
       FROM freelancer_payment_allocations pa
       JOIN freelancer_payments p ON p.id = pa.payment_id
       WHERE pa.attendance_id = $1 ORDER BY p.recorded_at`,
      [id]
    ),
  ]);
  attendance.activities = links.rows.map(l => ({
    activityId: l.activity_id,
    activityReference: l.activity_reference,
    activityType: l.activity_type,
    customerName: l.customer_name,
    odooLink: l.odoo_link,
    salesLeadName: l.sales_lead_name,
    teamLeadName: l.team_lead_name,
    plannedDate: l.planned_date,
  }));
  attendance.allocations = allocations.rows.map(a => ({
    activityId: a.activity_id,
    activityReference: a.activity_reference,
    amount: Number(a.amount),
  }));
  attendance.paymentHistory = paymentAllocs.rows.map(p => ({
    paymentId: p.payment_id,
    amount: Number(p.amount),
    paymentDate: p.payment_date_str,
    status: p.status,
    recipientName: p.recipient_name_snapshot,
  }));
  return attendance;
}

// Resolves a set of activity IDs against the authoritative `activities`
// table (never trusts client-sent labels) and builds the frozen snapshot
// used for both the links table and the top-level "primary activity" columns.
async function resolveActivitySnapshots(pool, activityIds) {
  if (!Array.isArray(activityIds) || activityIds.length === 0) {
    return { snapshots: [], missing: [] };
  }
  const uniqueIds = [...new Set(activityIds.filter(Boolean))];
  const { rows } = await pool.query(
    `SELECT a.id, a.reference, a.type, a.lead_tech_id, a.customer_id, a.customer_name, a.planned_date, a.details,
            u.name AS lead_tech_name
     FROM activities a
     LEFT JOIN users u ON u.id = a.lead_tech_id
     WHERE a.id = ANY($1::text[])`,
    [uniqueIds]
  );
  const found = new Map(rows.map(r => [r.id, r]));
  const missing = uniqueIds.filter(id => !found.has(id));
  const snapshots = uniqueIds
    .filter(id => found.has(id))
    .map(id => {
      const r = found.get(id);
      const d = r.details || {};
      return {
        activityId: r.id,
        activityReference: r.reference || r.id,
        activityType: r.type || '',
        customerName: r.customer_name || d.customerName || '',
        odooLink: d.odooLink || '',
        salesLeadId: d.salesLeadId || null,
        salesLeadName: d.salesLeadName || '',
        teamLeadId: r.lead_tech_id || null,
        teamLeadName: r.lead_tech_name || '',
        plannedDate: r.planned_date,
      };
    });
  return { snapshots, missing };
}

// Validates that a set of {activityId, amount} allocations exactly covers
// the linked activities and sums, in exact cents, to the agreed daily rate.
function validateAllocations(allocations, linkedActivityIds, agreedRateCents) {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return { ok: false, error: 'At least one project allocation is required.' };
  }
  const linkedSet = new Set(linkedActivityIds);
  let sumCents = 0;
  const seen = new Set();
  for (const a of allocations) {
    if (!a || !a.activityId || !linkedSet.has(a.activityId)) {
      return { ok: false, error: 'Allocation references an activity that is not linked to this attendance day.' };
    }
    if (seen.has(a.activityId)) {
      return { ok: false, error: 'Duplicate activity in allocation list — combine into a single line.' };
    }
    seen.add(a.activityId);
    const c = toCents(a.amount);
    if (!isFinite(c) || c < 0) {
      return { ok: false, error: 'Allocation amounts must be zero or a positive number.' };
    }
    sumCents += c;
  }
  if (sumCents !== agreedRateCents) {
    return { ok: false, error: `Allocations must total exactly the daily wage (QAR ${centsToStr(agreedRateCents)}), got QAR ${centsToStr(sumCents)}.` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public review page — plain, dependency-free HTML (served through the same
// /api/ path nginx already proxies, so no frontend/infra changes are needed).
// ---------------------------------------------------------------------------
function renderReviewPageHtml(token) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Freelancer Review — Qonnect</title>
<style>
  :root { --amber:#FFCC00; --ink:#0F172A; --muted:#64748B; --line:#E2E8F0; --bg:#F8FAFC; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif; background:var(--bg); color:var(--ink); }
  header { background:#0F172A; color:#fff; padding:20px 16px; }
  header h1 { margin:0 0 4px; font-size:18px; }
  header p { margin:0; color:#94A3B8; font-size:12px; }
  .wrap { max-width:820px; margin:0 auto; padding:16px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px; margin-bottom:14px; }
  .kpis { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; }
  @media (min-width:600px){ .kpis{ grid-template-columns:repeat(4,1fr);} }
  .kpi { background:#fff; border:1px solid var(--line); border-radius:12px; padding:12px; }
  .kpi .v { font-size:20px; font-weight:800; }
  .kpi .l { font-size:11px; color:var(--muted); text-transform:uppercase; font-weight:700; }
  .row { display:flex; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid var(--line); }
  .row:last-child { border-bottom:none; }
  .name { font-weight:700; }
  .muted { color:var(--muted); font-size:12px; }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:800; text-transform:uppercase; }
  .pill.PAID { background:#D1FAE5; color:#047857; }
  .pill.PARTIALLY_PAID { background:#FEF3C7; color:#B45309; }
  .pill.UNPAID { background:#FEE2E2; color:#B91C1C; }
  .amt { font-weight:800; }
  .empty { text-align:center; color:var(--muted); padding:40px 0; font-size:13px; }
  a { color:#B45309; }
</style>
</head>
<body>
<header>
  <h1>Freelancer Review</h1>
  <p id="scope-line">Loading…</p>
</header>
<div class="wrap">
  <div class="card kpis" id="kpis"></div>
  <div class="card">
    <h3 style="margin-top:0;">Attendance</h3>
    <div id="attendance"><div class="empty">Loading…</div></div>
  </div>
  <div class="card">
    <h3 style="margin-top:0;">Payments</h3>
    <div id="payments"><div class="empty">Loading…</div></div>
  </div>
</div>
<script>
(function () {
  var token = ${JSON.stringify(token)};
  fetch('/api/public/freelancer-review/' + encodeURIComponent(token))
    .then(function (r) { if (!r.ok) throw new Error('This review link is no longer available.'); return r.json(); })
    .then(render)
    .catch(function (e) {
      document.getElementById('scope-line').textContent = e.message || 'This review link is no longer available.';
      document.getElementById('attendance').innerHTML = '';
      document.getElementById('payments').innerHTML = '';
    });

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function money(n) { return 'QAR ' + Number(n || 0).toFixed(2); }

  function render(data) {
    document.title = (data.label || 'Freelancer Review') + ' — Qonnect';
    document.getElementById('scope-line').textContent =
      (data.label || 'Freelancer Review') + ' · Updated ' + new Date(data.generatedAt).toLocaleString();

    var kpis = data.totals || {};
    document.getElementById('kpis').innerHTML = [
      ['Freelancers', kpis.uniqueFreelancers || 0],
      ['Person-Days', kpis.personDays || 0],
      ['Total Wages', money(kpis.totalWages)],
      ['Balance Due', money(kpis.totalBalance)],
    ].map(function (kv) {
      return '<div class="kpi"><div class="v">' + esc(kv[1]) + '</div><div class="l">' + esc(kv[0]) + '</div></div>';
    }).join('');

    var att = data.attendance || [];
    document.getElementById('attendance').innerHTML = att.length ? att.map(function (a) {
      var acts = (a.activities || []).map(function (x) {
        return esc(x.customerName || x.activityReference) + (x.odooLink ? ' (<a href="' + esc(x.odooLink) + '" target="_blank" rel="noopener">CRM</a>)' : '');
      }).join(', ');
      return '<div class="row"><div>' +
        '<div class="name">' + esc(a.freelancerName) + ' · ' + esc(a.workDate) + '</div>' +
        '<div class="muted">' + acts + (a.salesLeadName ? ' · Sales: ' + esc(a.salesLeadName) : '') + (a.teamLeadName ? ' · Team: ' + esc(a.teamLeadName) : '') + '</div>' +
        (a.workSummary ? '<div class="muted">' + esc(a.workSummary) + '</div>' : '') +
        '</div><div style="text-align:right;">' +
        '<div class="amt">' + money(a.agreedDailyRate) + '</div>' +
        '<div class="muted">Paid ' + money(a.paidAmount) + ' · Bal ' + money(a.balance) + '</div>' +
        '<span class="pill ' + esc(a.paymentStatus) + '">' + esc(a.paymentStatus.replace(/_/g, ' ')) + '</span>' +
        '</div></div>';
    }).join('') : '<div class="empty">No attendance records in this scope.</div>';

    var pay = data.payments || [];
    document.getElementById('payments').innerHTML = pay.length ? pay.map(function (p) {
      return '<div class="row"><div>' +
        '<div class="name">' + esc(p.recipientName) + '</div>' +
        '<div class="muted">' + esc(p.paymentDate) + (p.paymentMethod ? ' · ' + esc(p.paymentMethod) : '') + '</div>' +
        '</div><div class="amt">' + money(p.amount) + '</div></div>';
    }).join('') : '<div class="empty">No payments in this scope.</div>';
  }
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export function registerFreelancerRoutes(app, { pool, authenticate, writeRateLimit, deleteRateLimit, logAudit }) {

  function requireRole(roles) {
    return (req, res, next) => {
      if (!roles.includes(req.user?.role)) {
        return res.status(403).json({ error: 'You do not have permission to perform this action.' });
      }
      next();
    };
  }

  // ── Freelancer Profiles ───────────────────────────────────────────────
  app.get('/api/freelancers', authenticate, requireRole(VIEW_FREELANCERS), async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const activeOnly = req.query.isActive === 'true';
      const params = [];
      let where = '1=1';
      if (q) {
        params.push(`%${q}%`);
        where += ` AND (name ILIKE $${params.length} OR phone ILIKE $${params.length} OR id ILIKE $${params.length})`;
      }
      if (activeOnly) where += ' AND is_active = true';
      const { rows } = await pool.query(
        `SELECT * FROM freelancers WHERE ${where} ORDER BY name ASC LIMIT 500`,
        params
      );
      res.json(rows.map(mapFreelancer));
    } catch (e) {
      console.error('Freelancers list error:', e);
      res.status(500).json({ error: 'Failed to load freelancers' });
    }
  });

  app.get('/api/freelancers/check-duplicates', authenticate, requireRole(MANAGE_FREELANCERS), async (req, res) => {
    try {
      const name = String(req.query.name || '').trim();
      const phone = normalizeQatarPhone(req.query.phone || '');
      if (!name && !phone) return res.json([]);
      const clauses = [];
      const params = [];
      if (phone) { params.push(phone); clauses.push(`phone = $${params.length}`); }
      if (name) { params.push(name.toLowerCase()); clauses.push(`lower(trim(name)) = $${params.length}`); }
      const { rows } = await pool.query(
        `SELECT * FROM freelancers WHERE ${clauses.join(' OR ')} ORDER BY is_active DESC, name ASC LIMIT 20`,
        params
      );
      res.json(rows.map(mapFreelancer));
    } catch (e) {
      console.error('Freelancer duplicate check error:', e);
      res.status(500).json({ error: 'Failed to check duplicates' });
    }
  });

  app.post('/api/freelancers', authenticate, writeRateLimit, requireRole(MANAGE_FREELANCERS), async (req, res) => {
    try {
      const { name, phone, role, skill, defaultDailyRate, notes, confirmDuplicateAnyway } = req.body || {};
      const cleanName = String(name || '').trim();
      if (cleanName.length < 2) return res.status(400).json({ error: 'Freelancer name is required.' });
      const cleanPhone = phone ? normalizeQatarPhone(phone) : null;
      const cleanRole = FREELANCER_ROLE_VALUES.includes(role) ? role : 'TECHNICAL_ASSOCIATE';
      const rate = defaultDailyRate !== undefined && defaultDailyRate !== null && defaultDailyRate !== ''
        ? Number(defaultDailyRate) : DEFAULT_DAILY_RATE;
      if (!isFinite(rate) || rate <= 0) return res.status(400).json({ error: 'Default daily rate must be a positive number.' });

      if (!confirmDuplicateAnyway) {
        const clauses = []; const params = [];
        if (cleanPhone) { params.push(cleanPhone); clauses.push(`phone = $${params.length}`); }
        params.push(cleanName.toLowerCase()); clauses.push(`lower(trim(name)) = $${params.length}`);
        const dupCheck = await pool.query(
          `SELECT id, name, phone, role, is_active FROM freelancers WHERE ${clauses.join(' OR ')} LIMIT 10`,
          params
        );
        if (dupCheck.rows.length > 0) {
          return res.status(409).json({
            error: 'duplicate_warning',
            message: 'A freelancer with a matching name or phone number already exists. Use the existing profile, or confirm to create a new, separate one.',
            matches: dupCheck.rows.map(mapFreelancer),
          });
        }
      }

      const id = await nextFreelancerId(pool);
      await pool.query(
        `INSERT INTO freelancers (id, name, phone, role, skill, default_daily_rate, notes, is_active, created_by, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)`,
        [id, cleanName, cleanPhone, cleanRole, (skill || '').trim() || null, rate.toFixed(2), (notes || '').trim() || null, req.user.id, req.user.name || req.user.email]
      );
      logAudit(req, { action: 'CREATE', entityType: 'FREELANCER', entityId: id, entityLabel: cleanName, details: { role: cleanRole, defaultDailyRate: rate } });
      const { rows } = await pool.query('SELECT * FROM freelancers WHERE id=$1', [id]);
      res.status(201).json(mapFreelancer(rows[0]));
    } catch (e) {
      console.error('Freelancer creation error:', e);
      res.status(500).json({ error: 'Failed to create freelancer' });
    }
  });

  app.get('/api/freelancers/:id', authenticate, requireRole(VIEW_FREELANCERS), async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM freelancers WHERE id=$1', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Freelancer not found' });
      const profile = mapFreelancer(rows[0]);

      const stats = await pool.query(
        `SELECT COUNT(*)::int AS person_days,
                COALESCE(SUM(agreed_daily_rate),0) AS total_wages,
                COALESCE(SUM(paid_amount),0) AS total_paid
         FROM freelancer_attendance WHERE freelancer_id=$1 AND status='CONFIRMED'`,
        [req.params.id]
      );
      const s = stats.rows[0];
      profile.stats = {
        personDays: s.person_days,
        totalWages: Number(s.total_wages),
        totalPaid: Number(s.total_paid),
        balance: Number((Number(s.total_wages) - Number(s.total_paid)).toFixed(2)),
      };

      const recent = await pool.query(
        `${ATTENDANCE_SELECT} WHERE fa.freelancer_id=$1 ORDER BY fa.work_date DESC, fa.created_at DESC LIMIT 30`,
        [req.params.id]
      );
      profile.recentAttendance = recent.rows.map(mapAttendance);
      res.json(profile);
    } catch (e) {
      console.error('Freelancer detail error:', e);
      res.status(500).json({ error: 'Failed to load freelancer' });
    }
  });

  app.put('/api/freelancers/:id', authenticate, writeRateLimit, requireRole(MANAGE_FREELANCERS), async (req, res) => {
    try {
      const current = await pool.query('SELECT * FROM freelancers WHERE id=$1', [req.params.id]);
      if (!current.rows[0]) return res.status(404).json({ error: 'Freelancer not found' });
      const { name, phone, role, skill, defaultDailyRate, notes, isActive } = req.body || {};
      const cleanName = name !== undefined ? String(name).trim() : current.rows[0].name;
      if (cleanName.length < 2) return res.status(400).json({ error: 'Freelancer name is required.' });
      const cleanPhone = phone !== undefined ? normalizeQatarPhone(phone) : current.rows[0].phone;
      const cleanRole = role !== undefined ? (FREELANCER_ROLE_VALUES.includes(role) ? role : current.rows[0].role) : current.rows[0].role;
      let rate = current.rows[0].default_daily_rate;
      if (defaultDailyRate !== undefined && defaultDailyRate !== null && defaultDailyRate !== '') {
        const r = Number(defaultDailyRate);
        if (!isFinite(r) || r <= 0) return res.status(400).json({ error: 'Default daily rate must be a positive number.' });
        rate = r.toFixed(2);
      }
      // Deliberately NOT retroactive — this only changes the *default* used
      // for future attendance confirmations. Every past attendance row keeps
      // its own agreed_daily_rate, unaffected by this update.
      await pool.query(
        `UPDATE freelancers SET name=$1, phone=$2, role=$3, skill=$4, default_daily_rate=$5, notes=$6, is_active=$7, updated_at=now() WHERE id=$8`,
        [cleanName, cleanPhone, cleanRole, (skill ?? current.rows[0].skill) || null, rate,
         (notes !== undefined ? notes : current.rows[0].notes) || null,
         isActive !== undefined ? !!isActive : current.rows[0].is_active,
         req.params.id]
      );
      logAudit(req, { action: 'UPDATE', entityType: 'FREELANCER', entityId: req.params.id, entityLabel: cleanName, details: { defaultDailyRate: rate, isActive } });
      const { rows } = await pool.query('SELECT * FROM freelancers WHERE id=$1', [req.params.id]);
      res.json(mapFreelancer(rows[0]));
    } catch (e) {
      console.error('Freelancer update error:', e);
      res.status(500).json({ error: 'Failed to update freelancer' });
    }
  });

  // ── Attendance ──────────────────────────────────────────────────────────
  app.get('/api/freelancer-attendance', authenticate, requireRole(VIEW_FREELANCERS), async (req, res) => {
    try {
      const { dateFrom, dateTo, freelancerId, crmReference, salesLeadId, teamLeadId, paymentStatus } = req.query;
      const status = req.query.status || 'CONFIRMED';
      const params = [];
      let where = '1=1';
      if (status !== 'ALL') { params.push(status); where += ` AND fa.status = $${params.length}`; }
      if (dateFrom) { params.push(dateFrom); where += ` AND fa.work_date >= $${params.length}`; }
      if (dateTo) { params.push(dateTo); where += ` AND fa.work_date <= $${params.length}`; }
      if (freelancerId) { params.push(freelancerId); where += ` AND fa.freelancer_id = $${params.length}`; }
      if (salesLeadId) { params.push(salesLeadId); where += ` AND fa.sales_lead_id = $${params.length}`; }
      if (teamLeadId) { params.push(teamLeadId); where += ` AND fa.team_lead_id = $${params.length}`; }
      if (paymentStatus) { params.push(paymentStatus); where += ` AND fa.payment_status = $${params.length}`; }
      if (crmReference) {
        params.push(`%${crmReference}%`);
        where += ` AND (fa.crm_reference ILIKE $${params.length} OR fa.customer_name ILIKE $${params.length})`;
      }
      const { rows } = await pool.query(
        `${ATTENDANCE_SELECT} WHERE ${where} ORDER BY fa.work_date DESC, fa.created_at DESC LIMIT 1000`,
        params
      );
      res.json(rows.map(mapAttendance));
    } catch (e) {
      console.error('Attendance list error:', e);
      res.status(500).json({ error: 'Failed to load attendance' });
    }
  });

  app.post('/api/freelancer-attendance', authenticate, writeRateLimit, requireRole(MANAGE_FREELANCERS), async (req, res) => {
    const client = await pool.connect();
    try {
      const {
        freelancerId, newFreelancer, workDate, agreedDailyRate,
        activityIds, allocations, workSummary, confirmDuplicateAnyway,
      } = req.body || {};

      if (!isReasonableWorkDate(workDate)) {
        return res.status(400).json({ error: 'Please provide a valid work date (YYYY-MM-DD).' });
      }
      const rate = Number(agreedDailyRate);
      if (!isFinite(rate) || rate <= 0) {
        return res.status(400).json({ error: 'Agreed daily rate must be a positive number.' });
      }
      if (!Array.isArray(activityIds) || activityIds.length === 0) {
        return res.status(400).json({ error: 'At least one linked activity is required.' });
      }

      await client.query('BEGIN');

      // 1. Resolve the freelancer — existing profile, or create one inline.
      let resolvedFreelancerId = freelancerId;
      if (!resolvedFreelancerId) {
        if (!newFreelancer || !String(newFreelancer.name || '').trim()) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Select an existing freelancer or provide details for a new one.' });
        }
        const cleanName = String(newFreelancer.name).trim();
        const cleanPhone = newFreelancer.phone ? normalizeQatarPhone(newFreelancer.phone) : null;
        if (!confirmDuplicateAnyway) {
          const clauses = []; const params = [];
          if (cleanPhone) { params.push(cleanPhone); clauses.push(`phone = $${params.length}`); }
          params.push(cleanName.toLowerCase()); clauses.push(`lower(trim(name)) = $${params.length}`);
          const dupCheck = await client.query(
            `SELECT id, name, phone, role, is_active FROM freelancers WHERE ${clauses.join(' OR ')} LIMIT 10`,
            params
          );
          if (dupCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              error: 'duplicate_warning',
              message: 'A freelancer with a matching name or phone number already exists.',
              matches: dupCheck.rows.map(mapFreelancer),
            });
          }
        }
        resolvedFreelancerId = await nextFreelancerId(client);
        const cleanRole = FREELANCER_ROLE_VALUES.includes(newFreelancer.role) ? newFreelancer.role : 'TECHNICAL_ASSOCIATE';
        const defRate = Number(newFreelancer.defaultDailyRate) > 0 ? Number(newFreelancer.defaultDailyRate) : DEFAULT_DAILY_RATE;
        await client.query(
          `INSERT INTO freelancers (id, name, phone, role, skill, default_daily_rate, notes, is_active, created_by, created_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)`,
          [resolvedFreelancerId, cleanName, cleanPhone, cleanRole, (newFreelancer.skill || '').trim() || null,
           defRate.toFixed(2), (newFreelancer.notes || '').trim() || null, req.user.id, req.user.name || req.user.email]
        );
      } else {
        const fCheck = await client.query('SELECT id, is_active FROM freelancers WHERE id=$1', [resolvedFreelancerId]);
        if (!fCheck.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Freelancer not found.' }); }
        if (fCheck.rows[0].is_active === false) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'This freelancer is marked inactive. Reactivate their profile before confirming new attendance.' });
        }
      }

      // 2. Resolve + snapshot linked activities against the authoritative table.
      const { snapshots, missing } = await resolveActivitySnapshots(client, activityIds);
      if (missing.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Activity not found: ${missing.join(', ')}` });
      }

      // 3. Validate the project-cost allocation totals exactly the daily wage.
      const rateCents = toCents(rate);
      const finalAllocations = (Array.isArray(allocations) && allocations.length > 0)
        ? allocations
        : (snapshots.length === 1 ? [{ activityId: snapshots[0].activityId, amount: rate }] : null);
      if (!finalAllocations) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Multiple linked activities require an explicit project cost allocation.' });
      }
      const allocCheck = validateAllocations(finalAllocations, snapshots.map(s => s.activityId), rateCents);
      if (!allocCheck.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: allocCheck.error });
      }

      // 4. Insert the attendance row — the partial unique index is the real
      //    guard against duplicate/concurrent submissions for the same day.
      const primary = snapshots[0];
      const attendanceId = await nextAttendanceId(client);
      try {
        await client.query(
          `INSERT INTO freelancer_attendance
             (id, freelancer_id, work_date, agreed_daily_rate, status, primary_activity_id,
              crm_reference, customer_name, sales_lead_id, sales_lead_name, team_lead_id, team_lead_name,
              work_summary, confirmed_by, confirmed_by_name)
           VALUES ($1,$2,$3,$4,'CONFIRMED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [attendanceId, resolvedFreelancerId, workDate, rate.toFixed(2), primary.activityId,
           primary.odooLink || '', primary.customerName || '', primary.salesLeadId, primary.salesLeadName || '',
           primary.teamLeadId, primary.teamLeadName || '', (workSummary || '').trim() || null,
           req.user.id, req.user.name || req.user.email]
        );
      } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505') {
          return res.status(409).json({ error: 'Attendance has already been confirmed for this freelancer on this date.' });
        }
        throw e;
      }

      for (const s of snapshots) {
        await client.query(
          `INSERT INTO freelancer_attendance_links
             (attendance_id, activity_id, activity_reference, activity_type, customer_name, odoo_link, sales_lead_name, team_lead_name, planned_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [attendanceId, s.activityId, s.activityReference, s.activityType, s.customerName, s.odooLink, s.salesLeadName, s.teamLeadName, s.plannedDate]
        );
      }
      for (const a of finalAllocations) {
        const snap = snapshots.find(s => s.activityId === a.activityId);
        await client.query(
          `INSERT INTO freelancer_attendance_allocations (attendance_id, activity_id, activity_reference, amount)
           VALUES ($1,$2,$3,$4)`,
          [attendanceId, a.activityId, snap?.activityReference || a.activityId, Number(a.amount).toFixed(2)]
        );
      }

      await client.query('COMMIT');
      logAudit(req, {
        action: 'CREATE', entityType: 'FREELANCER_ATTENDANCE', entityId: attendanceId,
        entityLabel: `${primary.customerName || primary.activityReference} — ${workDate}`,
        details: { freelancerId: resolvedFreelancerId, workDate, agreedDailyRate: rate, activityCount: snapshots.length },
      });
      const detail = await fetchAttendanceDetail(pool, attendanceId);
      res.status(201).json(detail);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Attendance confirmation error:', e);
      res.status(500).json({ error: 'Failed to confirm attendance', detail: e.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/freelancer-attendance/:id', authenticate, requireRole(VIEW_FREELANCERS), async (req, res) => {
    try {
      const detail = await fetchAttendanceDetail(pool, req.params.id);
      if (!detail) return res.status(404).json({ error: 'Attendance record not found' });
      res.json(detail);
    } catch (e) {
      console.error('Attendance detail error:', e);
      res.status(500).json({ error: 'Failed to load attendance record' });
    }
  });

  app.put('/api/freelancer-attendance/:id', authenticate, writeRateLimit, requireRole(MANAGE_FREELANCERS), async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM freelancer_attendance WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!current.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Attendance record not found' }); }
      const row = current.rows[0];
      if (row.status !== 'CONFIRMED') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This attendance record has been voided and can no longer be edited.' });
      }
      const paidCents = toCents(row.paid_amount);
      const { agreedDailyRate, activityIds, allocations, workSummary } = req.body || {};

      let newRate = Number(row.agreed_daily_rate);
      if (agreedDailyRate !== undefined && Number(agreedDailyRate) !== newRate) {
        if (paidCents > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Cannot change the daily rate after a payment has been recorded against this attendance. Reverse the payment first.' });
        }
        const r = Number(agreedDailyRate);
        if (!isFinite(r) || r <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Agreed daily rate must be a positive number.' }); }
        newRate = r;
      }

      let snapshots = null;
      let finalAllocations = null;
      if (activityIds !== undefined) {
        if (paidCents > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Cannot change linked activities after a payment has been recorded. Reverse the payment first.' });
        }
        const resolved = await resolveActivitySnapshots(client, activityIds);
        if (resolved.missing.length > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Activity not found: ${resolved.missing.join(', ')}` });
        }
        snapshots = resolved.snapshots;
        finalAllocations = (Array.isArray(allocations) && allocations.length > 0)
          ? allocations
          : (snapshots.length === 1 ? [{ activityId: snapshots[0].activityId, amount: newRate }] : null);
        if (!finalAllocations) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Multiple linked activities require an explicit project cost allocation.' });
        }
        const allocCheck = validateAllocations(finalAllocations, snapshots.map(s => s.activityId), toCents(newRate));
        if (!allocCheck.ok) { await client.query('ROLLBACK'); return res.status(400).json({ error: allocCheck.error }); }
      } else if (allocations !== undefined) {
        // Re-splitting the same linked activities without changing them.
        const existingLinks = await client.query('SELECT activity_id FROM freelancer_attendance_links WHERE attendance_id=$1', [req.params.id]);
        const allocCheck = validateAllocations(allocations, existingLinks.rows.map(l => l.activity_id), toCents(newRate));
        if (!allocCheck.ok) { await client.query('ROLLBACK'); return res.status(400).json({ error: allocCheck.error }); }
        finalAllocations = allocations;
      }

      const primary = snapshots ? snapshots[0] : null;
      await client.query(
        `UPDATE freelancer_attendance SET
           agreed_daily_rate = $1,
           work_summary = $2,
           primary_activity_id = COALESCE($3, primary_activity_id),
           crm_reference = COALESCE($4, crm_reference),
           customer_name = COALESCE($5, customer_name),
           sales_lead_id = COALESCE($6, sales_lead_id),
           sales_lead_name = COALESCE($7, sales_lead_name),
           team_lead_id = COALESCE($8, team_lead_id),
           team_lead_name = COALESCE($9, team_lead_name),
           updated_at = now()
         WHERE id = $10`,
        [newRate.toFixed(2), workSummary !== undefined ? (workSummary || '').trim() || null : row.work_summary,
         primary?.activityId, primary?.odooLink, primary?.customerName, primary?.salesLeadId, primary?.salesLeadName,
         primary?.teamLeadId, primary?.teamLeadName, req.params.id]
      );

      if (snapshots) {
        await client.query('DELETE FROM freelancer_attendance_links WHERE attendance_id=$1', [req.params.id]);
        for (const s of snapshots) {
          await client.query(
            `INSERT INTO freelancer_attendance_links
               (attendance_id, activity_id, activity_reference, activity_type, customer_name, odoo_link, sales_lead_name, team_lead_name, planned_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [req.params.id, s.activityId, s.activityReference, s.activityType, s.customerName, s.odooLink, s.salesLeadName, s.teamLeadName, s.plannedDate]
          );
        }
      }
      if (finalAllocations) {
        await client.query('DELETE FROM freelancer_attendance_allocations WHERE attendance_id=$1', [req.params.id]);
        for (const a of finalAllocations) {
          const snap = snapshots?.find(s => s.activityId === a.activityId);
          await client.query(
            `INSERT INTO freelancer_attendance_allocations (attendance_id, activity_id, activity_reference, amount)
             VALUES ($1,$2,$3,$4)`,
            [req.params.id, a.activityId, snap?.activityReference || a.activityId, Number(a.amount).toFixed(2)]
          );
        }
      }

      await client.query('COMMIT');
      logAudit(req, {
        action: 'UPDATE', entityType: 'FREELANCER_ATTENDANCE', entityId: req.params.id,
        details: { rateChanged: Number(row.agreed_daily_rate) !== newRate, activitiesChanged: !!snapshots },
      });
      const detail = await fetchAttendanceDetail(pool, req.params.id);
      res.json(detail);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Attendance update error:', e);
      res.status(500).json({ error: 'Failed to update attendance record' });
    } finally {
      client.release();
    }
  });

  app.post('/api/freelancer-attendance/:id/void', authenticate, deleteRateLimit, requireRole(MANAGE_FREELANCERS), async (req, res) => {
    try {
      const { reason } = req.body || {};
      if (!String(reason || '').trim()) return res.status(400).json({ error: 'A reason is required to void an attendance record.' });
      const current = await pool.query('SELECT * FROM freelancer_attendance WHERE id=$1', [req.params.id]);
      if (!current.rows[0]) return res.status(404).json({ error: 'Attendance record not found' });
      if (current.rows[0].status !== 'CONFIRMED') return res.status(409).json({ error: 'This record has already been voided.' });
      if (Number(current.rows[0].paid_amount) > 0) {
        return res.status(409).json({ error: 'This attendance has payments recorded against it. Reverse the payment(s) first, then void.' });
      }
      await pool.query(
        `UPDATE freelancer_attendance SET status='VOIDED', voided_by=$1, voided_at=now(), void_reason=$2, updated_at=now() WHERE id=$3`,
        [req.user.id, reason.trim(), req.params.id]
      );
      logAudit(req, { action: 'VOID', entityType: 'FREELANCER_ATTENDANCE', entityId: req.params.id, details: { reason: reason.trim() } });
      const detail = await fetchAttendanceDetail(pool, req.params.id);
      res.json(detail);
    } catch (e) {
      console.error('Attendance void error:', e);
      res.status(500).json({ error: 'Failed to void attendance record' });
    }
  });

  // ── Overview / Summary ────────────────────────────────────────────────
  app.get('/api/freelancer-overview', authenticate, requireRole(VIEW_FREELANCERS), async (req, res) => {
    try {
      const { dateFrom, dateTo, freelancerId, crmReference, salesLeadId, teamLeadId } = req.query;
      const params = [];
      let where = `fa.status = 'CONFIRMED'`;
      if (dateFrom) { params.push(dateFrom); where += ` AND fa.work_date >= $${params.length}`; }
      if (dateTo) { params.push(dateTo); where += ` AND fa.work_date <= $${params.length}`; }
      if (freelancerId) { params.push(freelancerId); where += ` AND fa.freelancer_id = $${params.length}`; }
      if (salesLeadId) { params.push(salesLeadId); where += ` AND fa.sales_lead_id = $${params.length}`; }
      if (teamLeadId) { params.push(teamLeadId); where += ` AND fa.team_lead_id = $${params.length}`; }
      if (crmReference) {
        params.push(`%${crmReference}%`);
        where += ` AND (fa.crm_reference ILIKE $${params.length} OR fa.customer_name ILIKE $${params.length})`;
      }
      const totals = await pool.query(
        `SELECT COUNT(DISTINCT fa.freelancer_id)::int AS unique_freelancers,
                COUNT(*)::int AS person_days,
                COALESCE(SUM(fa.agreed_daily_rate),0) AS total_wages,
                COALESCE(SUM(fa.paid_amount),0) AS total_paid
         FROM freelancer_attendance fa WHERE ${where}`,
        params
      );
      const byStatus = await pool.query(
        `SELECT payment_status, COUNT(*)::int AS n FROM freelancer_attendance fa WHERE ${where} GROUP BY payment_status`,
        params
      );
      const byFreelancer = await pool.query(
        `SELECT fa.freelancer_id, f.name, COUNT(*)::int AS person_days,
                COALESCE(SUM(fa.agreed_daily_rate),0) AS total_wages,
                COALESCE(SUM(fa.paid_amount),0) AS total_paid
         FROM freelancer_attendance fa JOIN freelancers f ON f.id = fa.freelancer_id
         WHERE ${where} GROUP BY fa.freelancer_id, f.name ORDER BY total_wages DESC LIMIT 50`,
        params
      );
      const t = totals.rows[0];
      res.json({
        totals: {
          uniqueFreelancers: t.unique_freelancers,
          personDays: t.person_days,
          totalWages: Number(t.total_wages),
          totalPaid: Number(t.total_paid),
          totalBalance: Number((Number(t.total_wages) - Number(t.total_paid)).toFixed(2)),
        },
        byPaymentStatus: byStatus.rows.reduce((acc, r) => { acc[r.payment_status] = r.n; return acc; }, {}),
        byFreelancer: byFreelancer.rows.map(r => ({
          freelancerId: r.freelancer_id, name: r.name, personDays: r.person_days,
          totalWages: Number(r.total_wages), totalPaid: Number(r.total_paid),
          balance: Number((Number(r.total_wages) - Number(r.total_paid)).toFixed(2)),
        })),
      });
    } catch (e) {
      console.error('Freelancer overview error:', e);
      res.status(500).json({ error: 'Failed to load overview' });
    }
  });

  // ── Payments ─────────────────────────────────────────────────────────
  app.get('/api/freelancer-payments', authenticate, requireRole(VIEW_PAYMENTS), async (req, res) => {
    try {
      const { dateFrom, dateTo, recipientFreelancerId, status } = req.query;
      const params = [];
      let where = '1=1';
      if (dateFrom) { params.push(dateFrom); where += ` AND p.payment_date >= $${params.length}`; }
      if (dateTo) { params.push(dateTo); where += ` AND p.payment_date <= $${params.length}`; }
      if (recipientFreelancerId) { params.push(recipientFreelancerId); where += ` AND p.recipient_freelancer_id = $${params.length}`; }
      if (status) { params.push(status); where += ` AND p.status = $${params.length}`; }
      const { rows } = await pool.query(
        `SELECT p.*, to_char(p.payment_date,'YYYY-MM-DD') AS payment_date_str
         FROM freelancer_payments p WHERE ${where} ORDER BY p.recorded_at DESC LIMIT 500`,
        params
      );
      res.json(rows.map(mapPayment));
    } catch (e) {
      console.error('Payments list error:', e);
      res.status(500).json({ error: 'Failed to load payments' });
    }
  });

  app.post('/api/freelancer-payments', authenticate, writeRateLimit, requireRole(MANAGE_PAYMENTS), async (req, res) => {
    const client = await pool.connect();
    try {
      const { paymentDate, amount, paymentMethod, recipientFreelancerId, reference, notes, proofAttachment, allocations } = req.body || {};
      if (!isValidDateStr(paymentDate)) return res.status(400).json({ error: 'Please provide a valid payment date.' });
      const amountCents = toCents(amount);
      if (!isFinite(amountCents) || amountCents <= 0) return res.status(400).json({ error: 'Payment amount must be a positive number.' });
      if (!recipientFreelancerId) return res.status(400).json({ error: 'A payment recipient is required.' });
      if (!Array.isArray(allocations) || allocations.length === 0) return res.status(400).json({ error: 'At least one attendance allocation is required.' });
      if (proofAttachment && String(proofAttachment).length > MAX_ATTACHMENT_BASE64_LEN) {
        return res.status(400).json({ error: 'Proof attachment is too large. Please use a smaller image.' });
      }

      const seen = new Set();
      let sumCents = 0;
      for (const a of allocations) {
        if (!a || !a.attendanceId) return res.status(400).json({ error: 'Each allocation must reference an attendance record.' });
        if (seen.has(a.attendanceId)) return res.status(400).json({ error: 'Duplicate attendance record in allocation list — combine into one line.' });
        seen.add(a.attendanceId);
        const c = toCents(a.amount);
        if (!isFinite(c) || c <= 0) return res.status(400).json({ error: 'Allocation amounts must be positive.' });
        sumCents += c;
      }
      if (sumCents !== amountCents) {
        return res.status(400).json({ error: `Allocation total (QAR ${centsToStr(sumCents)}) must equal the payment amount (QAR ${centsToStr(amountCents)}) exactly.` });
      }

      await client.query('BEGIN');

      const recipient = await client.query('SELECT id, name FROM freelancers WHERE id=$1', [recipientFreelancerId]);
      if (!recipient.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Recipient freelancer not found.' }); }

      // Lock every affected attendance row up front (consistent order — by
      // id — to avoid deadlocks against a concurrent payment touching an
      // overlapping set of records) and validate against its *current*
      // balance inside this same transaction, so two concurrent payment
      // submissions against the same record can never both succeed.
      const attendanceIds = [...seen].sort();
      const locked = await client.query(
        `SELECT * FROM freelancer_attendance WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
        [attendanceIds]
      );
      const lockedMap = new Map(locked.rows.map(r => [r.id, r]));
      for (const id of attendanceIds) {
        const row = lockedMap.get(id);
        if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ error: `Attendance record not found: ${id}` }); }
        if (row.status !== 'CONFIRMED') { await client.query('ROLLBACK'); return res.status(409).json({ error: `Attendance ${id} has been voided and cannot be paid.` }); }
      }
      for (const a of allocations) {
        const row = lockedMap.get(a.attendanceId);
        const remainingCents = toCents(row.agreed_daily_rate) - toCents(row.paid_amount);
        if (toCents(a.amount) > remainingCents) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: `Allocation for ${a.attendanceId} (QAR ${Number(a.amount).toFixed(2)}) exceeds its outstanding balance (QAR ${centsToStr(remainingCents)}).` });
        }
      }

      const paymentId = await nextPaymentId(client);
      await client.query(
        `INSERT INTO freelancer_payments
           (id, amount, payment_date, payment_method, recipient_freelancer_id, recipient_name_snapshot, reference, proof_attachment, notes, status, recorded_by, recorded_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RECORDED',$10,$11)`,
        [paymentId, centsToStr(amountCents), paymentDate, (paymentMethod || '').trim() || null, recipientFreelancerId,
         recipient.rows[0].name, (reference || '').trim() || null, proofAttachment || null, (notes || '').trim() || null,
         req.user.id, req.user.name || req.user.email]
      );

      for (const a of allocations) {
        const row = lockedMap.get(a.attendanceId);
        await client.query(
          `INSERT INTO freelancer_payment_allocations (payment_id, attendance_id, freelancer_id, amount) VALUES ($1,$2,$3,$4)`,
          [paymentId, a.attendanceId, row.freelancer_id, Number(a.amount).toFixed(2)]
        );
        const newPaidCents = toCents(row.paid_amount) + toCents(a.amount);
        await client.query(
          `UPDATE freelancer_attendance SET paid_amount=$1, payment_status=$2, updated_at=now() WHERE id=$3`,
          [centsToStr(newPaidCents), paymentStatusFor(toCents(row.agreed_daily_rate), newPaidCents), a.attendanceId]
        );
      }

      await client.query('COMMIT');
      logAudit(req, {
        action: 'CREATE', entityType: 'FREELANCER_PAYMENT', entityId: paymentId,
        entityLabel: `${recipient.rows[0].name} — QAR ${centsToStr(amountCents)}`,
        details: { recipientFreelancerId, amount: centsToStr(amountCents), attendanceIds },
      });
      const { rows } = await pool.query(
        `SELECT p.*, to_char(p.payment_date,'YYYY-MM-DD') AS payment_date_str FROM freelancer_payments p WHERE p.id=$1`,
        [paymentId]
      );
      res.status(201).json(mapPayment(rows[0]));
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Payment recording error:', e);
      res.status(500).json({ error: 'Failed to record payment', detail: e.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/freelancer-payments/:id', authenticate, requireRole(VIEW_PAYMENTS), async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT p.*, to_char(p.payment_date,'YYYY-MM-DD') AS payment_date_str FROM freelancer_payments p WHERE p.id=$1`,
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Payment not found' });
      const payment = mapPayment(rows[0]);
      const allocs = await pool.query(
        `SELECT pa.*, fa.work_date, f.name AS freelancer_name, to_char(fa.work_date,'YYYY-MM-DD') AS work_date_str
         FROM freelancer_payment_allocations pa
         JOIN freelancer_attendance fa ON fa.id = pa.attendance_id
         JOIN freelancers f ON f.id = pa.freelancer_id
         WHERE pa.payment_id=$1 ORDER BY pa.id`,
        [req.params.id]
      );
      payment.allocations = allocs.rows.map(a => ({
        attendanceId: a.attendance_id, freelancerId: a.freelancer_id, freelancerName: a.freelancer_name,
        workDate: a.work_date_str, amount: Number(a.amount),
      }));
      res.json(payment);
    } catch (e) {
      console.error('Payment detail error:', e);
      res.status(500).json({ error: 'Failed to load payment' });
    }
  });

  // Proof attachment is fetched on demand only — never included in list/detail
  // JSON — mirroring the ticket/activity photo pattern (keeps normal payloads light).
  app.get('/api/freelancer-payments/:id/attachment', authenticate, requireRole(VIEW_PAYMENTS), async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT proof_attachment FROM freelancer_payments WHERE id=$1', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Payment not found' });
      res.json({ proofAttachment: rows[0].proof_attachment || null });
    } catch (e) {
      console.error('Payment attachment fetch error:', e);
      res.status(500).json({ error: 'Failed to load attachment' });
    }
  });

  app.post('/api/freelancer-payments/:id/reverse', authenticate, deleteRateLimit, requireRole(MANAGE_PAYMENTS), async (req, res) => {
    const client = await pool.connect();
    try {
      const { reason } = req.body || {};
      if (!String(reason || '').trim()) return res.status(400).json({ error: 'A reason is required to reverse a payment.' });

      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM freelancer_payments WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!current.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }
      if (current.rows[0].status !== 'RECORDED') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This payment has already been reversed.' }); }

      const allocs = await client.query('SELECT * FROM freelancer_payment_allocations WHERE payment_id=$1', [req.params.id]);
      for (const a of allocs.rows) {
        const att = await client.query('SELECT * FROM freelancer_attendance WHERE id=$1 FOR UPDATE', [a.attendance_id]);
        if (!att.rows[0]) continue;
        const newPaidCents = Math.max(0, toCents(att.rows[0].paid_amount) - toCents(a.amount));
        await client.query(
          `UPDATE freelancer_attendance SET paid_amount=$1, payment_status=$2, updated_at=now() WHERE id=$3`,
          [centsToStr(newPaidCents), paymentStatusFor(toCents(att.rows[0].agreed_daily_rate), newPaidCents), a.attendance_id]
        );
      }
      await client.query(
        `UPDATE freelancer_payments SET status='REVERSED', reversed_by=$1, reversed_at=now(), reversal_reason=$2 WHERE id=$3`,
        [req.user.id, reason.trim(), req.params.id]
      );
      await client.query('COMMIT');
      logAudit(req, { action: 'REVERSE', entityType: 'FREELANCER_PAYMENT', entityId: req.params.id, details: { reason: reason.trim() } });
      const { rows } = await pool.query(
        `SELECT p.*, to_char(p.payment_date,'YYYY-MM-DD') AS payment_date_str FROM freelancer_payments p WHERE p.id=$1`,
        [req.params.id]
      );
      res.json(mapPayment(rows[0]));
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Payment reversal error:', e);
      res.status(500).json({ error: 'Failed to reverse payment' });
    } finally {
      client.release();
    }
  });

  // ── CEO Review Links ────────────────────────────────────────────────────
  app.get('/api/freelancer-review-links', authenticate, requireRole(MANAGE_PAYMENTS), async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM freelancer_review_tokens ORDER BY created_at DESC LIMIT 100');
      res.json(rows.map(r => ({
        token: r.token, label: r.label || '', scope: r.scope || {},
        createdByName: r.created_by_name || '', createdAt: r.created_at, expiresAt: r.expires_at,
        revokedAt: r.revoked_at || null, lastViewedAt: r.last_viewed_at || null, viewCount: r.view_count,
        isActive: !r.revoked_at && new Date(r.expires_at) > new Date(),
      })));
    } catch (e) {
      console.error('Review links list error:', e);
      res.status(500).json({ error: 'Failed to load review links' });
    }
  });

  app.post('/api/freelancer-review-links', authenticate, writeRateLimit, requireRole(MANAGE_PAYMENTS), async (req, res) => {
    try {
      const { label, scope, expiresInDays } = req.body || {};
      const days = Number(expiresInDays) > 0 && Number(expiresInDays) <= 90 ? Number(expiresInDays) : 14;
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO freelancer_review_tokens (token, label, scope, created_by, created_by_name, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [token, (label || '').trim() || 'Freelancer Review', JSON.stringify(scope || {}), req.user.id, req.user.name || req.user.email, expiresAt]
      );
      logAudit(req, { action: 'CREATE', entityType: 'FREELANCER_REVIEW_LINK', entityId: token.slice(0, 8) + '…', details: { label, expiresInDays: days } });
      res.status(201).json({ token, expiresAt, pageUrl: `/api/public/freelancer-review/${token}/page` });
    } catch (e) {
      console.error('Review link creation error:', e);
      res.status(500).json({ error: 'Failed to create review link' });
    }
  });

  app.post('/api/freelancer-review-links/:token/revoke', authenticate, deleteRateLimit, requireRole(MANAGE_PAYMENTS), async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE freelancer_review_tokens SET revoked_at=now() WHERE token=$1 AND revoked_at IS NULL RETURNING token`,
        [req.params.token]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Review link not found or already revoked.' });
      logAudit(req, { action: 'REVOKE', entityType: 'FREELANCER_REVIEW_LINK', entityId: req.params.token.slice(0, 8) + '…' });
      res.json({ ok: true });
    } catch (e) {
      console.error('Review link revoke error:', e);
      res.status(500).json({ error: 'Failed to revoke review link' });
    }
  });

  // ── Public, token-scoped, read-only review endpoints (NO auth) ─────────
  // Deliberately excludes: payment references/proof attachments, phone
  // numbers, and any data outside the token's own scope.
  app.get('/api/public/freelancer-review/:token/page', async (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(renderReviewPageHtml(req.params.token));
  });

  app.get('/api/public/freelancer-review/:token', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM freelancer_review_tokens WHERE token=$1', [req.params.token]);
      const tok = rows[0];
      if (!tok || tok.revoked_at || new Date(tok.expires_at) < new Date()) {
        return res.status(404).json({ error: 'This review link is no longer available.' });
      }
      pool.query(
        `UPDATE freelancer_review_tokens SET last_viewed_at=now(), view_count = view_count + 1 WHERE token=$1`,
        [req.params.token]
      ).catch(() => {});

      const scope = tok.scope || {};
      const params = [];
      let where = `fa.status = 'CONFIRMED'`;
      if (scope.dateFrom) { params.push(scope.dateFrom); where += ` AND fa.work_date >= $${params.length}`; }
      if (scope.dateTo) { params.push(scope.dateTo); where += ` AND fa.work_date <= $${params.length}`; }
      if (scope.freelancerId) { params.push(scope.freelancerId); where += ` AND fa.freelancer_id = $${params.length}`; }
      if (scope.salesLeadId) { params.push(scope.salesLeadId); where += ` AND fa.sales_lead_id = $${params.length}`; }
      if (scope.teamLeadId) { params.push(scope.teamLeadId); where += ` AND fa.team_lead_id = $${params.length}`; }
      if (scope.crmReference) {
        params.push(`%${scope.crmReference}%`);
        where += ` AND (fa.crm_reference ILIKE $${params.length} OR fa.customer_name ILIKE $${params.length})`;
      }

      const attendanceRows = await pool.query(
        `${ATTENDANCE_SELECT} WHERE ${where} ORDER BY fa.work_date DESC LIMIT 500`,
        params
      );
      const attendance = [];
      for (const r of attendanceRows.rows) {
        const mapped = mapAttendance(r);
        const links = await pool.query('SELECT * FROM freelancer_attendance_links WHERE attendance_id=$1', [mapped.id]);
        attendance.push({
          freelancerName: mapped.freelancerName,
          workDate: mapped.workDate,
          agreedDailyRate: mapped.agreedDailyRate,
          paidAmount: mapped.paidAmount,
          balance: mapped.balance,
          paymentStatus: mapped.paymentStatus,
          salesLeadName: mapped.salesLeadName,
          teamLeadName: mapped.teamLeadName,
          workSummary: mapped.workSummary,
          activities: links.rows.map(l => ({
            activityReference: l.activity_reference, customerName: l.customer_name, odooLink: l.odoo_link,
          })),
        });
      }

      let payments = [];
      if (Array.isArray(scope.paymentBatchIds) && scope.paymentBatchIds.length > 0) {
        const p = await pool.query(
          `SELECT p.*, to_char(p.payment_date,'YYYY-MM-DD') AS payment_date_str FROM freelancer_payments p
           WHERE p.id = ANY($1::text[]) AND p.status='RECORDED' ORDER BY p.payment_date DESC`,
          [scope.paymentBatchIds]
        );
        payments = p.rows.map(r => ({
          recipientName: r.recipient_name_snapshot, paymentDate: r.payment_date_str,
          amount: Number(r.amount), paymentMethod: r.payment_method || '',
        }));
      }

      const totals = {
        uniqueFreelancers: new Set(attendanceRows.rows.map(r => r.freelancer_id)).size,
        personDays: attendanceRows.rows.length,
        totalWages: attendance.reduce((s, a) => s + a.agreedDailyRate, 0),
        totalBalance: attendance.reduce((s, a) => s + a.balance, 0),
      };

      res.json({
        label: tok.label,
        generatedAt: new Date().toISOString(),
        scope: { dateFrom: scope.dateFrom, dateTo: scope.dateTo },
        totals,
        attendance,
        payments,
      });
    } catch (e) {
      console.error('Public review fetch error:', e);
      res.status(500).json({ error: 'Failed to load review data' });
    }
  });
}

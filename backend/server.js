import express from 'express';
import compression from 'compression';
import cors from 'cors';
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import dotenv from 'dotenv';
import { pool } from "./db.js";
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

dotenv.config();
const app = express();
app.use(compression()); // Gzip API responses

// --- Security Headers (Phase 3) ---
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

// --- Request Timeout (30s) ---
app.use((req, res, next) => {
    req.setTimeout(30000, () => {
        if (!res.headersSent) {
            res.status(408).json({ error: 'Request timeout' });
        }
    });
    next();
});

// --- Request Logging (Phase 3) ---
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logLevel = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
        if (req.url !== '/api/health' && req.url !== '/api/refresh' && req.url !== '/api/init') {
            console.log(JSON.stringify({
                level: logLevel,
                method: req.method,
                url: req.url,
                status: res.statusCode,
                duration: `${duration}ms`,
                user: req.user?.email || 'anonymous',
                timestamp: new Date().toISOString()
            }));
        }
    });
    next();
});
const PORT = process.env.PORT || 8080;

// --- Write Rate Limiter (Phase 3) — 60 writes/minute per user ---
const writeRateMap = new Map();
const writeRateLimit = (req, res, next) => {
    const key = req.user?.email || req.ip;
    const now = Date.now();
    const window = 60000; // 1 minute
    const max = 60;
    const attempts = writeRateMap.get(key) || [];
    const recent = attempts.filter(t => t > now - window);
    if (recent.length >= max) {
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    recent.push(now);
    writeRateMap.set(key, recent);
    // Cleanup old entries every 5 minutes
    if (Math.random() < 0.01) {
        for (const [k, v] of writeRateMap.entries()) {
            if (v.every(t => t < now - window)) writeRateMap.delete(k);
        }
    }
    next();
};

// Tighter rate limit for destructive/sensitive operations (30/min per user)
const deleteRateLimit = (req, res, next) => {
    const key = (req.user?.email || req.ip) + ':delete';
    const now = Date.now();
    const window = 60000;
    const max = 30;
    const attempts = writeRateMap.get(key) || [];
    const recent = attempts.filter(t => t > now - window);
    if (recent.length >= max) {
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    recent.push(now);
    writeRateMap.set(key, recent);
    next();
};

/* ---------- WhatsApp Send Helper ---------- */
async function sendWhatsAppText(to, bodyText) {
  if (!process.env.WA_ACCESS_TOKEN || !process.env.WA_PHONE_NUMBER_ID) {
    throw new Error("WhatsApp credentials missing (WA_ACCESS_TOKEN / WA_PHONE_NUMBER_ID)");
  }

  const url = `https://graph.facebook.com/v17.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: bodyText }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.WA_ACCESS_TOKEN}`
    },
    body: JSON.stringify(payload)
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const errMsg = data?.error?.message || JSON.stringify(data);
    throw new Error(`Meta send failed: ${resp.status} ${errMsg}`);
  }

  // Log every outbound message to WhatsApp monitor
  try {
    await pool.query(
      `INSERT INTO whatsapp_logs (id, type, phone, status, payload_summary, latency)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [`log-out-${Date.now()}-${Math.random().toString(36).substr(2,5)}`,
       'OUTBOUND', to, 'SENT', bodyText, 0]
    );
  } catch (logErr) {
    console.error("Failed to log outbound message:", logErr.message);
  }

  return data;
}

// ==============================
// Notify all Team Leads via WhatsApp
// ==============================
async function notifyTeamLeads(message) {
  try {
    const { rows } = await pool.query(
      "SELECT phone FROM users WHERE role = 'TEAM_LEAD' AND status = 'ACTIVE' AND phone IS NOT NULL"
    );
    for (const lead of rows) {
      try {
        await sendWhatsAppText(lead.phone, message);
      } catch (e) {
        console.error(`Failed to notify team lead ${lead.phone}:`, e.message);
      }
    }
  } catch (e) {
    console.error("notifyTeamLeads error:", e.message);
  }
}

// ── Audit Log ────────────────────────────────────────────────────────────
// Records who did what, on which record, and when. Called from write
// endpoints (create/update/delete/status-change) across the app.
// Deliberately fire-and-forget: a logging failure must never block or fail
// the actual user-facing action, so errors are caught and only logged to
// the console, never thrown.
//
// req         — the Express request (used to pull actor identity + IP)
// action      — short verb, e.g. 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE'
// entityType  — e.g. 'TICKET', 'ACTIVITY', 'CUSTOMER', 'USER', 'TEAM', 'SALES_REQUEST'
// entityId    — the record's own ID, e.g. 'QNC-TK-000139'
// entityLabel — human-readable label for the record, e.g. a customer name
// details     — small JSON object with whatever changed (kept compact —
//               this is a log, not a full snapshot of the record)
// actorOverride — optional { id, name, role } for routes that run before the
//               authenticate middleware (e.g. /api/login), where req.user
//               doesn't exist yet.
async function logAudit(req, { action, entityType, entityId, entityLabel, details, actorOverride }) {
  try {
    const actor = actorOverride || req.user || {};
    await pool.query(
      `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_label, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        actor.id || null,
        actor.name || actor.email || 'Unknown',
        actor.role || null,
        action,
        entityType,
        entityId || null,
        entityLabel || null,
        JSON.stringify(details || {}),
        req.ip || null,
      ]
    );
  } catch (e) {
    console.error('Audit log write failed (non-fatal):', e.message);
  }
}

// Produces a compact { field: { from, to } } diff between a record's
// before/after state — used so the audit log shows what actually changed
// on an UPDATE, instead of just the names of every field that happened to
// be present in the request body. The previous behavior (Object.keys of the
// whole request body) was nearly useless: an edit form resending the full
// record meant the "changed fields" list was the same long list every time,
// regardless of what was genuinely different, with no values shown at all.
//
// - Skips fields whose value is unchanged (deep-equal via JSON comparison,
//   sufficient here since values are plain strings/numbers/arrays/objects
//   coming straight out of the database/request body).
// - Skips a denylist of fields that are noisy or always differ for reasons
//   unrelated to a genuine edit (timestamps, internal IDs).
// - Caps at 15 changed fields and truncates long values, so a single
//   large edit can't produce an unreadably huge audit entry.
const AUDIT_DIFF_SKIP_FIELDS = new Set(['id', 'updatedAt', 'createdAt', 'updated_at', 'created_at']);
function diffFields(before, after) {
  const diff = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (AUDIT_DIFF_SKIP_FIELDS.has(key)) continue;
    const beforeVal = before?.[key];
    const afterVal = after?.[key];
    const beforeStr = JSON.stringify(beforeVal ?? null);
    const afterStr = JSON.stringify(afterVal ?? null);
    if (beforeStr === afterStr) continue;
    const truncate = (v) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s && s.length > 200 ? s.slice(0, 200) + '…' : v;
    };
    diff[key] = { from: truncate(beforeVal ?? null), to: truncate(afterVal ?? null) };
    if (Object.keys(diff).length >= 15) {
      diff['…'] = { note: 'additional fields changed but omitted for brevity' };
      break;
    }
  }
  return diff;
}

const SALES_REDIRECT_MESSAGE =
  `Thank you for contacting Qonnect. This number is for after-sales support only.\n` +
  `For sales enquiries, kindly contact +974 3330 0319.\n` +
  `Direct WhatsApp: https://api.whatsapp.com/send/?phone=97433300319&text&type=phone_number&app_absent=0`;

function makeActivityId(prefix = "ACT") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function makeTicketId() {
  return `QNC-${Date.now().toString().slice(-6)}`;
}

async function upsertWhatsAppCustomer(phone, name) {
  const customerId = `c-${phone}`;
  await pool.query(
    `INSERT INTO customers (id, name, phone)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
     SET name = COALESCE(EXCLUDED.name, customers.name),
         phone = EXCLUDED.phone`,
    [customerId, name || "Valued Client", phone]
  );
  return customerId;
}

// WhatsApp support interactions create TICKETS only, not activities
// Activities are for planned field operations managed by Team Leads
async function createSupportActivity({ phone, customerId, customerName, issue, action, issueCategory }) {
  // No-op: WhatsApp tickets no longer create activity entries
  const reference = `WA-${Date.now().toString().slice(-6)}`;
  return { activityId: null, reference };
}


function isSalesInquiry(text = "") {
  const t = String(text).trim().toLowerCase();

  const salesPhrases = [
    "want to install",
    "need installation",
    "need quotation",
    "need quote",
    "need a quote",
    "price for",
    "cost for",
    "quotation for",
    "quote for",
    "new system",
    "new villa",
    "new project",
    "looking for",
    "interested in",
    "want automation",
    "want to automate",
    "automate the lights",
    "smart home",
    "home automation",
    "install cctv",
    "install intercom",
    "install speakers",
    "install access control",
    "need cctv",
    "need intercom",
    "need speakers",
    "need access control"
  ];

  const supportPhrases = [
    "not working",
    "issue",
    "problem",
    "offline",
    "slow",
    "down",
    "fault",
    "repair",
    "service",
    "technician",
    "visit",
    "restart",
    "no internet",
    "still same",
    "still not working",
    "camera offline",
    "internet issue"
  ];

  const hasSalesPhrase = salesPhrases.some(p => t.includes(p));
  const hasSupportPhrase = supportPhrases.some(p => t.includes(p));

  return hasSalesPhrase && !hasSupportPhrase;
}

// ==============================
// DB Bootstrap (Auto-init)
// ==============================
async function initDb() {
  try {
    // 1. Customers Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        building_number TEXT,
        avatar TEXT,
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS building_number TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar TEXT;
    `);

    // 2. Tickets Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        customer_id TEXT REFERENCES customers(id),
        customer_name TEXT,
        category TEXT,
        type TEXT DEFAULT 'Under Warranty',
        priority TEXT,
        status TEXT DEFAULT 'NEW',
        location_url TEXT,
        house_number TEXT,
        ai_summary TEXT,
        assigned_tech_id TEXT,
        appointment_time TIMESTAMPTZ,
        odoo_link TEXT,
        notes TEXT,
        phone_number TEXT,
        carry_forward_note TEXT,
        next_planned_at TIMESTAMPTZ,
        messages JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      -- Add columns if upgrading existing DB
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_summary TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_tech_id TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS appointment_time TIMESTAMPTZ;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS odoo_link TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS phone_number TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS carry_forward_note TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS next_planned_at TIMESTAMPTZ;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_note TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS completion_note TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_escalated_at TIMESTAMPTZ;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS visit_history JSONB DEFAULT '[]';
      -- Tickets never had photo support at all (no column, no save path) —
      -- field engineers could "upload" a photo but it was never persisted.
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]';
    `);

    // 3. Customer ID Sequence
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_id_seq (
      id BIGSERIAL PRIMARY KEY
    );
  `);

  // 3b. Ticket ID Sequence — atomic, server-only ticket numbering.
  //     Tickets used to have their IDs generated on the client (localStorage counter),
  //     which let two devices independently produce the same ID and collide.
  //     This BIGSERIAL sequence guarantees every ticket ID is unique and assigned
  //     by the server, the same pattern already used for customer IDs.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_id_seq (
      id BIGSERIAL PRIMARY KEY
    );
  `);
    
    // 4. Users/Technicians Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        phone TEXT,
        avatar TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      -- Add columns if upgrading existing DB
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS job_role TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS level TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS job_role TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS level TEXT;
    `);
// 5. Teams Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        lead_id TEXT,
        member_ids JSONB DEFAULT '[]',
        status TEXT DEFAULT 'AVAILABLE',
        current_site_id TEXT,
        workload_level TEXT DEFAULT 'LOW'
      );
    `);

    // 5b. Audit Logs Table — records who did what, on what record, and when.
    //     Written by logAudit() helper, called from write endpoints below.
    //     id is BIGSERIAL since logs are append-only and high-volume —
    //     no need for a formatted string ID like other entities.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_id TEXT,
        actor_name TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        entity_label TEXT,
        details JSONB DEFAULT '{}',
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created    ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_entity      ON audit_logs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_actor       ON audit_logs(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action      ON audit_logs(action);

      -- 5c. Recurring Schedules (AMC contracts) — previously this whole feature
      -- had a frontend but no backend at all: every create/pause/delete/process
      -- call hit a route that didn't exist, so nothing was ever saved.
      CREATE TABLE IF NOT EXISTS recurring_schedules (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        customer_name TEXT,
        type TEXT NOT NULL,
        category TEXT,
        interval_type TEXT NOT NULL DEFAULT 'MONTHLY',
        next_due_date DATE NOT NULL,
        last_scheduled_date DATE,
        preferred_time TEXT DEFAULT '09:00',
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_schedules(next_due_date) WHERE is_active = true;

      -- 5d. App Settings — simple key/value store for admin-configurable
      -- values. Starts with the Google Review URL (Completion Feedback
      -- feature) but the shape is generic so future settings don't each
      -- need their own table/migration.
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_by TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      -- 5e. Service Feedback — customer feedback captured at job completion,
      -- before the job is allowed to finally close. One row per completed
      -- job (ticket or activity); activity_id/ticket_id is whichever
      -- applies, the other stays null. Never blocks or alters the existing
      -- completion logic itself — this is purely additive data captured
      -- alongside it.
      CREATE TABLE IF NOT EXISTS service_feedback (
        id BIGSERIAL PRIMARY KEY,
        activity_id TEXT,
        ticket_id TEXT,
        engineer_id TEXT,
        engineer_name TEXT,
        customer_name TEXT,
        rating SMALLINT CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
        resolution_status TEXT CHECK (resolution_status IS NULL OR resolution_status IN ('COMPLETED', 'PARTIALLY_COMPLETED', 'NOT_COMPLETED')),
        comment TEXT,
        google_review_prompt_shown BOOLEAN DEFAULT false,
        follow_up_required BOOLEAN DEFAULT false,
        follow_up_resolved BOOLEAN DEFAULT false,
        -- Skip support: not every customer is willing or available to rate
        -- the service. When skipped is true, rating/resolution_status are
        -- both null and skip_reason records why — a real submission still
        -- requires a genuine rating, this only opens an alternate path for
        -- when one genuinely can't be captured.
        skipped BOOLEAN NOT NULL DEFAULT false,
        skip_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        -- resolution_status ("was the work completed?") is intentionally
        -- NOT required here — confirmed product decision: the feedback step
        -- only needs a star rating (+ optional comment), since requiring an
        -- extra field was part of what made the original two-screen flow
        -- feel like more than customers were willing to do. follow_up_required
        -- (see the POST endpoint) now derives from rating alone when
        -- resolution_status isn't provided.
        CONSTRAINT service_feedback_rating_or_skip CHECK (
          (skipped = false AND rating IS NOT NULL)
          OR
          (skipped = true AND skip_reason IS NOT NULL)
        )
      );
      -- Existing installs: relax the old NOT NULL constraints and add the
      -- new columns. Safe to run repeatedly — IF NOT EXISTS / DROP IF EXISTS
      -- guards on every statement, and existing rows (all real ratings, all
      -- already satisfying the new CHECK) are unaffected either way.
      ALTER TABLE service_feedback ALTER COLUMN rating DROP NOT NULL;
      ALTER TABLE service_feedback ALTER COLUMN resolution_status DROP NOT NULL;
      ALTER TABLE service_feedback ADD COLUMN IF NOT EXISTS skipped BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE service_feedback ADD COLUMN IF NOT EXISTS skip_reason TEXT;
      -- A constraint can't be re-added under the same name with different
      -- rules — it has to be dropped first. DROP ... IF EXISTS makes this
      -- safe whether or not a previous round already created the old,
      -- stricter version of this same constraint name.
      ALTER TABLE service_feedback DROP CONSTRAINT IF EXISTS service_feedback_rating_or_skip;
      DO $$ BEGIN
        ALTER TABLE service_feedback ADD CONSTRAINT service_feedback_rating_or_skip CHECK (
          (skipped = false AND rating IS NOT NULL)
          OR
          (skipped = true AND skip_reason IS NOT NULL)
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
      CREATE INDEX IF NOT EXISTS idx_feedback_followup ON service_feedback(follow_up_required) WHERE follow_up_required = true AND follow_up_resolved = false;
      CREATE INDEX IF NOT EXISTS idx_feedback_activity ON service_feedback(activity_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_ticket ON service_feedback(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_created ON service_feedback(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feedback_skipped ON service_feedback(skipped) WHERE skipped = true;

      -- SLA alert acknowledgements — per-user, not global. Acknowledging
      -- only dismisses an alert from the acknowledging person's own view;
      -- it can still show up for a different Team Lead, and reappears for
      -- everyone (including the original acknowledger) once the ticket
      -- crosses into the next alert level (e.g. WARNING acknowledged, then
      -- it later escalates to STALLED_72H — that's a new, distinct alert).
      CREATE TABLE IF NOT EXISTS sla_acknowledgements (
        ticket_id TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        acknowledged_by TEXT NOT NULL,
        acknowledged_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (ticket_id, alert_type, acknowledged_by)
      );
      CREATE INDEX IF NOT EXISTS idx_sla_ack_user ON sla_acknowledgements(acknowledged_by);
    `);

    // 6. Sites Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        client_name TEXT,
        location TEXT,
        priority TEXT,
        status TEXT DEFAULT 'PLANNED',
        assigned_team_id TEXT
      );
    `);

    // 7. Activities Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        reference TEXT,
        type TEXT,
        priority TEXT,
        status TEXT DEFAULT 'PLANNED',
        planned_date TIMESTAMPTZ,
        customer_id TEXT,
        site_id TEXT,
        lead_tech_id TEXT,
        description TEXT,
        duration_hours NUMERIC,
        details JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      );
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS visit_history JSONB DEFAULT '[]';
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS customer_name TEXT;
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS customer_phone TEXT;
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

      -- Permanent fix: normalise any users whose level is blank or whose systemRole
      -- was stored as a human-readable label instead of the enum value.
      -- This runs on every restart and is idempotent (no harm if already correct).
      UPDATE users
        SET level = 'TECHNICAL_ASSOCIATE',
            role  = COALESCE(NULLIF(role, 'Technical Associate'), 'FIELD_ENGINEER')
        WHERE (level IS NULL OR level = '')
          AND (role ILIKE '%associate%' OR role ILIKE '%technical%');

      UPDATE users
        SET level = 'SALES',
            role  = COALESCE(NULLIF(role, 'Sales Lead'), 'FIELD_ENGINEER')
        WHERE (level IS NULL OR level = '')
          AND (role ILIKE '%sales%');

      UPDATE users
        SET level = 'FIELD_ENGINEER'
        WHERE (level IS NULL OR level = '')
          AND role = 'FIELD_ENGINEER';

      UPDATE users
        SET level = 'TEAM_LEAD'
        WHERE (level IS NULL OR level = '')
          AND role = 'TEAM_LEAD';

      -- ADMINs belong in the Team Lead section
      UPDATE users
        SET level = 'TEAM_LEAD'
        WHERE (level IS NULL OR level = '' OR level = 'ADMIN')
          AND role = 'ADMIN';

      -- Catch-all: any user still missing a level gets FIELD_ENGINEER
      UPDATE users
        SET level = 'FIELD_ENGINEER'
        WHERE level IS NULL OR level = '' OR level = 'ADMIN';
    `);
    
// 8. WhatsApp Logs Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_logs (
        id TEXT PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT now(),
        type TEXT,
        phone TEXT,
        status TEXT,
        payload_summary TEXT,
        latency INTEGER
      );
    `);
    
// 9. WhatsApp Inbound Message Deduplication
await pool.query(`
  CREATE TABLE IF NOT EXISTS whatsapp_inbound_messages (
    message_id TEXT PRIMARY KEY,
    phone TEXT,
    message_type TEXT,
    message_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );
`);

// ── Ensure default admin always exists with correct bcrypt password ──
    const hashedAdminPass = await bcrypt.hash("admin123", 10);
    const adminCheck = await pool.query("SELECT id FROM users WHERE email = 'admin@qonnect.qa'");
    if (adminCheck.rows.length === 0) {
        await pool.query(
            "INSERT INTO users (id, name, email, password, role, status) VALUES ($1, $2, $3, $4, $5, $6)",
            ["u-admin", "System Admin", "admin@qonnect.qa", hashedAdminPass, "ADMIN", "ACTIVE"]
        );
        console.log("✅ Default admin created: admin@qonnect.qa / admin123");
    } else {
        // Always sync password so a DB wipe + restart always works
        await pool.query("UPDATE users SET password = $1, role = 'ADMIN', status = 'ACTIVE' WHERE email = 'admin@qonnect.qa'", [hashedAdminPass]);
        console.log("✅ Default admin password synced");
    }
    // Fix any legacy role values
    await pool.query("UPDATE users SET role = 'ADMIN' WHERE role = 'OPERATIONS_MANAGER'");
    
    // WhatsApp Sessions Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        phone TEXT PRIMARY KEY,
        customer_name TEXT,
        house_number TEXT,
        location_url TEXT,
        issue_details TEXT,
        issue_category TEXT,
        ticket_id TEXT,
        step TEXT DEFAULT 'ASK_NAME',
        last_action TEXT,
        last_bot_question TEXT,
        troubleshooting_state JSONB DEFAULT '{}',
        last_interaction TIMESTAMPTZ DEFAULT now()
      );
      -- Add new structured fields (safe to run on existing DB)
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS location_url TEXT;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS issue_category TEXT;
    `);

    // WhatsApp Logs Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_logs (
        id TEXT PRIMARY KEY,
        type TEXT,
        phone TEXT,
        status TEXT,
        payload_summary TEXT,
        latency INTEGER,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // WhatsApp Inbound Messages Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_inbound_messages (
        message_id TEXT PRIMARY KEY,
        phone TEXT,
        message_type TEXT,
        message_text TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Performance indexes
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
        CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON tickets(customer_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON tickets(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
        CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone);
        CREATE INDEX IF NOT EXISTS idx_activities_status ON activities(status);
        CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_phone ON whatsapp_logs(phone);
        
        -- Performance indexes (Phase 1 optimization)
        CREATE INDEX IF NOT EXISTS idx_activities_lead_tech ON activities(lead_tech_id);
        CREATE INDEX IF NOT EXISTS idx_activities_customer ON activities(customer_id);
        CREATE INDEX IF NOT EXISTS idx_activities_planned ON activities(planned_date DESC);
        CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_tech_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_phone ON tickets(phone_number);
        CREATE INDEX IF NOT EXISTS idx_sessions_last_interaction ON sessions(last_interaction);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
        CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at DESC);
    `).catch(() => {}); // Non-fatal if indexes already exist

    // ── Sales Appointment Requests Table ──────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_appointment_requests (
        id                        TEXT PRIMARY KEY,
        customer_id               TEXT,
        customer_name             TEXT NOT NULL,
        contact_number            TEXT NOT NULL,
        location_url              TEXT NOT NULL,
        house_number              TEXT NOT NULL,
        odoo_reference            TEXT NOT NULL,
        activity_type             TEXT NOT NULL,
        service_category          TEXT NOT NULL,
        sales_lead_user_id        TEXT NOT NULL,
        sales_lead_name           TEXT NOT NULL,
        remarks                   TEXT,
        status                    TEXT NOT NULL DEFAULT 'PENDING_SCHEDULING',
        scheduled_date            DATE,
        scheduled_start_time      TEXT,
        scheduled_end_time        TEXT,
        assigned_field_engineer_id TEXT,
        linked_activity_id        TEXT,
        created_by                TEXT NOT NULL,
        updated_by                TEXT,
        created_at                TIMESTAMPTZ DEFAULT now(),
        updated_at                TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_sar_status       ON sales_appointment_requests(status);
      CREATE INDEX IF NOT EXISTS idx_sar_sales_lead   ON sales_appointment_requests(sales_lead_user_id);
      CREATE INDEX IF NOT EXISTS idx_sar_created      ON sales_appointment_requests(created_at DESC);

      -- SAR → existing-activity linking (rebuilt per spec). status can now
      -- also be 'LINKED' — no schema change needed for that, it's a plain
      -- TEXT column with no CHECK constraint. These three columns are new;
      -- all nullable, so existing rows are unaffected.
      ALTER TABLE sales_appointment_requests ADD COLUMN IF NOT EXISTS link_note TEXT;
      ALTER TABLE sales_appointment_requests ADD COLUMN IF NOT EXISTS linked_by TEXT;
      ALTER TABLE sales_appointment_requests ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;
    `);

    // ── Self-healing: fix SALES-level users who have role=NULL or role='NONE' ──
    // This handles users created in TeamCRM before the SALES role was introduced.
    const salesFix = await pool.query(`
        UPDATE users
        SET role = 'SALES'
        WHERE level = 'SALES'
          AND (role IS NULL OR role = 'NONE' OR role = '')
    `);
    if (salesFix.rowCount > 0) {
        console.log(`✅ Fixed ${salesFix.rowCount} SALES-level user(s) missing system role`);
    }

    // ── Self-healing: seed ticket_id_seq past the highest existing ticket number ──
    // On first run after this migration, existing tickets (e.g. QNC-TK-000139) already
    // exist with numbers the sequence knows nothing about. Without this, the sequence
    // would start at 1 and immediately collide with real tickets. This runs once —
    // after the sequence has any rows, it manages its own state and this is a no-op.
    const seqCheck = await pool.query(`SELECT COUNT(*) AS n FROM ticket_id_seq`);
    if (Number(seqCheck.rows[0].n) === 0) {
        const maxTicket = await pool.query(
            `SELECT id FROM tickets WHERE id LIKE 'QNC-TK-%' ORDER BY id DESC LIMIT 1`
        );
        const lastNum = maxTicket.rows[0]?.id
            ? parseInt(maxTicket.rows[0].id.replace('QNC-TK-', ''), 10) || 0
            : 0;
        if (lastNum > 0) {
            await pool.query(
                `SELECT setval(pg_get_serial_sequence('ticket_id_seq', 'id'), $1, false)`,
                [lastNum + 1]
            );
            console.log(`✅ Seeded ticket_id_seq to start at ${lastNum + 1}`);
        }
    }

    console.log("✅ DB initialized with Tickets and Customers");
  } catch (err) {
    console.error("❌ DB initialization failed:", err);
  }
}

// Middleware
app.use(express.json({ limit: '10mb' })); 
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://qonnectops.duckdns.org',
  credentials: true
}));

// Simple in-memory rate limiter for login endpoint
const loginAttempts = new Map();
const loginRateLimit = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const attempts = loginAttempts.get(ip) || [];
    const recent = attempts.filter(t => now - t < 15 * 60 * 1000); // 15 min window
    if (recent.length >= 10) {
        return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }
    recent.push(now);
    loginAttempts.set(ip, recent);
    next();
};


// Check API Key
if (!process.env.API_KEY) {
  console.error("❌ FATAL ERROR: API_KEY is missing in backend/.env file.");
  console.error("AI features will not work.");
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// ── JWT Authentication Middleware ──────────────────────────
if (!process.env.JWT_SECRET) {
    console.error("❌ FATAL: JWT_SECRET environment variable is not set. Shutting down.");
    process.exit(1);
}

const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized — no token' });
    }
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        // VIEWER accounts are strictly read-only. Blocking it here — inside
        // the shared authenticate() middleware that virtually every route
        // already calls — means every existing and future mutating endpoint
        // is covered automatically, instead of relying on each individual
        // route remembering to check the role itself (several routes, e.g.
        // ticket/user create & update, currently have no per-route role
        // check at all, so this is the one place that reliably closes it
        // off for VIEWER regardless of which endpoint they hit).
        if (req.user.role === 'VIEWER' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return res.status(403).json({ error: 'View-only accounts cannot make changes.' });
        }
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Unauthorized — invalid token' });
    }
};

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── TV Display Data ──
// Protected by a static TV_TOKEN from .env — set TV_TOKEN in backend/.env
// TV screen accesses via: /api/tv-data?token=<TV_TOKEN>
// Falls back to open if TV_TOKEN is not configured (backward compatible)
app.get('/api/tv-data', async (req, res) => {
    const tvToken = process.env.TV_TOKEN;
    if (tvToken) {
        const provided = req.query.token || req.headers['x-tv-token'];
        if (!provided || provided !== tvToken) {
            return res.status(401).json({ error: 'TV access denied — invalid or missing token' });
        }
    }
    try {
        const [ticketsRes, activitiesRes, usersRes, teamsRes, sitesRes, customersRes] = await Promise.all([
            pool.query(`SELECT id, customer_id, customer_name, phone_number, category, type, priority, status,
                location_url, house_number, ai_summary, assigned_tech_id, appointment_time,
                odoo_link, notes, carry_forward_note, next_planned_at, assignment_note,
                completion_note, cancellation_reason, last_escalated_at, started_at, completed_at,
                visit_history, created_at, updated_at FROM tickets ORDER BY updated_at DESC LIMIT 100`),
            pool.query(`SELECT id, reference, type, priority, status, planned_date, customer_id, customer_name,
                customer_phone, site_id, lead_tech_id, description, duration_hours,
                details, started_at, completed_at, visit_history, created_at, updated_at FROM activities WHERE type != 'WHATSAPP_SUPPORT' ORDER BY created_at DESC LIMIT 200`),
            pool.query("SELECT id, name, role, status, avatar, level, phone FROM users WHERE status != 'INACTIVE'"),
            pool.query("SELECT * FROM teams"),
            pool.query("SELECT * FROM sites"),
            pool.query("SELECT id, name, phone, email, address, avatar, building_number FROM customers")
        ]);

        const tickets = ticketsRes.rows.map(r => ({
            id: r.id, customerId: r.customer_id, customerName: r.customer_name,
            phoneNumber: r.phone_number, category: r.category, type: r.type,
            priority: r.priority, status: r.status, assignedTechId: r.assigned_tech_id,
            createdAt: r.created_at, updatedAt: r.updated_at,
            appointmentTime: r.appointment_time, houseNumber: r.house_number,
            locationUrl: r.location_url, startedAt: r.started_at, completedAt: r.completed_at,
            messages: [], // Exclude messages for privacy
        }));

        const activities = activitiesRes.rows.map(r => ({
            id: r.id, reference: r.reference, type: r.type, priority: r.priority,
            status: r.status, plannedDate: r.planned_date, customerId: r.customer_id,
            siteId: r.site_id, leadTechId: r.lead_tech_id, description: r.description,
            durationHours: Number(r.duration_hours),
            ...r.details,
            // Column values MUST override JSONB details (details may have stale frontend timestamps)
            startedAt: r.started_at || (r.details || {}).startedAt || null,
            completedAt: r.completed_at || (r.details || {}).completedAt || null,
            createdAt: r.created_at, updatedAt: r.updated_at,
        }));

        const technicians = usersRes.rows.map(r => {
            // Normalise: SALES-level users with no DB role get systemRole='SALES'
            const sysRole = (r.level === 'SALES' && (!r.role || r.role === 'NONE')) ? 'SALES' : r.role;
            return {
                id: r.id, name: r.name, systemRole: sysRole, status: r.status || 'AVAILABLE',
                avatar: r.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name)}&background=random`,
                level: r.level || r.role, isActive: true, email: '', role: sysRole, phone: r.phone,
            };
        });

        const teams = teamsRes.rows.map(r => ({
            id: r.id, name: r.name, leadId: r.lead_id,
            memberIds: r.member_ids || [], status: r.status || 'AVAILABLE', workloadLevel: 'MEDIUM',
        }));

        const sites = sitesRes.rows.map(r => ({
            id: r.id, name: r.name, clientName: r.client_name || '',
            location: r.location || '', priority: r.priority || 'MEDIUM', status: r.status || 'ACTIVE',
        }));

        const customers = customersRes.rows.map(r => ({
            id: r.id, name: r.name, phone: r.phone || '',
            email: r.email || '', address: r.address || '',
            avatar: r.avatar || '', buildingNumber: r.building_number || '',
        }));

        res.json({ tickets, activities, technicians, teams, sites, customers, timestamp: new Date().toISOString() });
    } catch (e) {
        console.error('TV data endpoint error:', e);
        res.status(500).json({ error: 'Failed to load TV data' });
    }
});

// ==============================
// Tickets (PostgreSQL)
// ==============================

// Helper: map DB snake_case ticket row → frontend camelCase
// includeFullPhotos=true returns real photo data (used only by the
// on-demand /full endpoint); otherwise photos is either [] or ['HAS_PHOTOS']
// — same lightweight-flag convention already used for activities — so the
// list endpoint never balloons with base64 image data for every ticket.
function mapTicket(r, includeFullPhotos = false) {
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    phoneNumber: r.phone_number || r.phone || '',
    category: r.category,
    type: r.type,
    priority: r.priority,
    status: r.status,
    assignedTechId: r.assigned_tech_id || undefined,
    appointmentTime: r.appointment_time || undefined,
    locationUrl: r.location_url || undefined,
    houseNumber: r.house_number || undefined,
    odooLink: r.odoo_link || undefined,
    notes: r.notes || undefined,
    ai_summary: r.ai_summary || undefined,
    messages: Array.isArray(r.messages) ? r.messages : (r.messages ? JSON.parse(r.messages) : []),
    photos: includeFullPhotos
        ? (Array.isArray(r.photos) ? r.photos : [])
        : (r.has_photos || (Array.isArray(r.photos) && r.photos.length > 0) ? ['HAS_PHOTOS'] : []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    unreadCount: 0,
    // Workflow fields
    startedAt: r.started_at || (r.details || {}).startedAt || undefined,
    completedAt: r.completed_at || (r.details || {}).completedAt || undefined,
    carryForwardNote: r.carry_forward_note || undefined,
    nextPlannedAt: r.next_planned_at || undefined,
    assignmentNote: r.assignment_note || undefined,
    completionNote: r.completion_note || undefined,
    cancellationReason: r.cancellation_reason || undefined,
    lastEscalatedAt: r.last_escalated_at || undefined,
    startedAt: r.started_at || undefined,
    completedAt: r.completed_at || undefined,
    visitHistory: Array.isArray(r.visit_history) ? r.visit_history : [],
    cancellationReason: r.cancellation_reason || undefined,
  };
}

// 1. Get all tickets from DB

/* ---------- Activity row mapper (matches /api/activities format exactly) ---------- */
// Lite version — excludes photos for list endpoints (saves 99% bandwidth)
function mapActivityLite(r) {
    const d = r.details || {};
    return {
        id: r.id, reference: r.reference, type: r.type, priority: r.priority,
        status: r.status, plannedDate: r.planned_date, customerId: r.customer_id,
        customerName: r.customer_name || d.customerName || '',
        customerPhone: d.customerPhone || '',
        siteId: r.site_id, leadTechId: r.lead_tech_id, description: r.description,
        serviceCategory: d.serviceCategory || r.service_category || '',
        durationHours: Number(r.duration_hours || 0),
        durationUnit: d.durationUnit || 'HOURS',
        assistantTechIds: d.assistantTechIds || r.assistant_tech_ids || [],
        salesLeadId: d.salesLeadId || r.sales_lead_id || null,
        salesLeadName: d.salesLeadName || '',
        locationUrl: d.locationUrl || r.location_url || '',
        houseNumber: d.houseNumber || r.house_number || '',
        escalationLevel: d.escalationLevel || r.escalation_level || '',
        carryForwardNote: d.carryForwardNote || r.carry_forward_note || '',
        nextPlannedAt: d.nextPlannedAt || r.next_planned_at || null,
        odooLink: d.odooLink || r.odoo_link || '',
        freelancerDetails: d.freelancerDetails || r.freelancer_details || null,
        freelancers: d.freelancers || [],
        photos: ((d.photos || r.photos || []).length > 0) ? ['HAS_PHOTOS'] : [],
        completionNote: d.completionNote || r.completion_note || '',
        remarks: d.remarks || '',
        primaryEngineerId: d.primaryEngineerId || null,
        supportingEngineerIds: d.supportingEngineerIds || [],
        currentVisitRemark: d.currentVisitRemark || '',
        createdAt: r.created_at, updatedAt: r.updated_at,
        startedAt: r.started_at || (d).startedAt || null,
        completedAt: r.completed_at || (d).completedAt || null,
        visitHistory: r.visit_history || [],
    };
}

function mapActivity(r) {
    const d = r.details || {};
    return {
        id: r.id, reference: r.reference, type: r.type, priority: r.priority,
        status: r.status, plannedDate: r.planned_date, customerId: r.customer_id,
        customerName: r.customer_name || d.customerName || '',
        customerPhone: d.customerPhone || '',
        siteId: r.site_id, leadTechId: r.lead_tech_id, description: r.description,
        serviceCategory: d.serviceCategory || r.service_category || '',
        durationHours: Number(r.duration_hours || 0),
        durationUnit: d.durationUnit || 'HOURS',
        assistantTechIds: d.assistantTechIds || r.assistant_tech_ids || [],
        salesLeadId: d.salesLeadId || r.sales_lead_id || null,
        salesLeadName: d.salesLeadName || '',
        locationUrl: d.locationUrl || r.location_url || '',
        houseNumber: d.houseNumber || r.house_number || '',
        escalationLevel: d.escalationLevel || r.escalation_level || '',
        carryForwardNote: d.carryForwardNote || r.carry_forward_note || '',
        nextPlannedAt: d.nextPlannedAt || r.next_planned_at || null,
        odooLink: d.odooLink || r.odoo_link || '',
        freelancerDetails: d.freelancerDetails || r.freelancer_details || null,
        freelancers: d.freelancers || [],
        photos: d.photos || r.photos || [],
        completionNote: d.completionNote || r.completion_note || '',
        remarks: d.remarks || '',
        primaryEngineerId: d.primaryEngineerId || null,
        supportingEngineerIds: d.supportingEngineerIds || [],
        currentVisitRemark: d.currentVisitRemark || '',
        createdAt: r.created_at, updatedAt: r.updated_at,
        startedAt: r.started_at || (r.details || {}).startedAt || null,
        completedAt: r.completed_at || (r.details || {}).completedAt || null,
        visitHistory: r.visit_history || [],
    };
}


/* ---------- MOBILE LIGHTWEIGHT APIs (Performance Optimization) ---------- */

// Lead Portal — only data the lead needs
app.get("/api/mobile/lead", authenticate, async (req, res) => {
    try {
        const [ticketsR, activitiesR, techsR, customersR, teamsR, sitesR] = await Promise.all([
            // Previously excluded RESOLVED/CANCELLED tickets entirely — meaning
            // "My Jobs" swiping back to a past day could never show completed
            // work, because it was never sent to the client at all. Now includes
            // resolved/cancelled tickets from the last 30 days, same window as
            // everything else here.
            pool.query(`SELECT id, customer_id, customer_name, phone_number, category, type, priority, status,
                location_url, house_number, ai_summary, assigned_tech_id, appointment_time,
                odoo_link, notes, carry_forward_note, next_planned_at, assignment_note,
                completion_note, cancellation_reason, last_escalated_at, started_at, completed_at,
                visit_history, created_at, updated_at FROM tickets
                WHERE status NOT IN ('RESOLVED','CANCELLED') OR updated_at > NOW() - INTERVAL '30 days'
                ORDER BY updated_at DESC LIMIT 200`),
            // Previously: (a) only matched lead_tech_id/assistantTechIds/primaryEngineerId —
            // supportingEngineerIds was missing entirely, so a supporting engineer's
            // own completed/carried-forward jobs never even left the database for
            // them; (b) the DONE cutoff was 7 days, far too short for "swipe back
            // to see history" to mean anything. Both fixed below.
            pool.query(`SELECT id, reference, type, priority, status, planned_date, customer_id, customer_name,
                customer_phone, site_id, lead_tech_id, description, duration_hours,
                details, started_at, completed_at, visit_history, created_at, updated_at FROM activities
                WHERE type != 'WHATSAPP_SUPPORT' AND (status NOT IN ('CANCELLED') AND (status != 'DONE' OR completed_at > NOW() - INTERVAL '30 days'))
                ORDER BY planned_date DESC LIMIT 250`),
            pool.query('SELECT id, name, email, role as "systemRole", status, phone, avatar, job_role, level FROM users'),
            pool.query("SELECT id, name, phone, address, building_number FROM customers ORDER BY name LIMIT 200"),
            pool.query("SELECT * FROM teams ORDER BY name"),
            pool.query("SELECT * FROM sites ORDER BY name")
        ]);
        res.json({
            tickets: ticketsR.rows.map(r => mapTicket(r)),
            activities: activitiesR.rows.map(mapActivityLite),
            technicians: techsR.rows.map(r => ({
                id: r.id, name: r.name, email: r.email, systemRole: r.systemRole, 
                status: r.status, isActive: r.status === 'ACTIVE' || r.status === 'AVAILABLE' || r.status !== 'INACTIVE',
                phone: r.phone, avatar: r.avatar || null,
                jobRole: r.job_role, level: r.level || '', role: r.systemRole
            })),
            customers: customersR.rows.map(r => ({ ...r, buildingNumber: r.building_number })),
            teams: teamsR.rows.map(r => ({ ...r, leadId: r.lead_id, memberIds: r.member_ids })),
            sites: sitesR.rows.map(r => ({ ...r, clientName: r.client_name, assignedTeamId: r.assigned_team_id }))
        });
    } catch (e) {
        console.error("Mobile lead API error:", e);
        res.status(500).json({ error: "Failed" });
    }
});

// Tech Portal — only the engineer's own jobs
app.get("/api/mobile/tech", authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const [ticketsR, activitiesR, customersR, techsR] = await Promise.all([
            pool.query(`SELECT id, customer_id, customer_name, phone_number, category, type, priority, status,
                location_url, house_number, ai_summary, assigned_tech_id, appointment_time,
                odoo_link, notes, carry_forward_note, next_planned_at, assignment_note,
                completion_note, cancellation_reason, last_escalated_at, started_at, completed_at,
                visit_history, created_at, updated_at FROM tickets WHERE assigned_tech_id = $1 ORDER BY updated_at DESC LIMIT 100`, [userId]),
            // Previously missing supportingEngineerIds from this match entirely —
            // a tech who was a supporting engineer (not the planning-stage lead,
            // not a TA, not even primary) on a job never had that job sent to
            // their own portal at all, active or completed. This is the same gap
            // already fixed in the Activity Planner / Operations Monitor / the
            // frontend completedJobs filter — now consistent here too.
            pool.query(`SELECT id, reference, type, priority, status, planned_date, customer_id, customer_name, customer_phone, site_id, lead_tech_id, description, duration_hours, details, started_at, completed_at, visit_history, created_at, updated_at FROM activities WHERE ${activityInvolvesPersonClause(1)}
                        AND type != 'WHATSAPP_SUPPORT'
                        AND (status NOT IN ('DONE','CANCELLED') OR planned_date > NOW() - INTERVAL '30 days')
                        ORDER BY planned_date DESC LIMIT 200`, [userId]),
            pool.query("SELECT id, name, phone, address, building_number FROM customers ORDER BY name LIMIT 200"),
            // Previously this lightweight endpoint never returned technicians
            // at all — meaning anything resolving "my own name" (e.g. the
            // Completion Feedback flow's auto-filled engineer name) from the
            // technicians list could come back empty right after a fresh
            // mobile-portal login, before some other call happened to
            // populate it. Just this one user's own record is enough here —
            // their name/role for display purposes, not the full roster.
            pool.query('SELECT id, name, email, role as "systemRole", status, phone, avatar, job_role, level FROM users WHERE id = $1', [userId]),
        ]);
        res.json({
            tickets: ticketsR.rows.map(r => mapTicket(r)),
            activities: activitiesR.rows.map(mapActivityLite),
            customers: customersR.rows.map(r => ({ ...r, buildingNumber: r.building_number })),
            technicians: techsR.rows,
        });
    } catch (e) {
        console.error("Mobile tech API error:", e);
        res.status(500).json({ error: "Failed" });
    }
});

// Lightweight refresh — incremental updates only (changed since timestamp)
app.get("/api/refresh-lite", authenticate, async (req, res) => {
    try {
        const since = req.query.since || new Date(Date.now() - 60000).toISOString();
        const [ticketsR, activitiesR] = await Promise.all([
            pool.query(`SELECT id, customer_id, customer_name, phone_number, category, type, priority, status,
                location_url, house_number, ai_summary, assigned_tech_id, appointment_time,
                odoo_link, notes, carry_forward_note, next_planned_at, assignment_note,
                completion_note, cancellation_reason, last_escalated_at, started_at, completed_at,
                visit_history, created_at, updated_at FROM tickets WHERE updated_at > $1 ORDER BY updated_at DESC`, [since]),
            pool.query(`SELECT id, reference, type, priority, status, planned_date, customer_id, customer_name,
                customer_phone, site_id, lead_tech_id, description, duration_hours,
                details, started_at, completed_at, visit_history, created_at, updated_at FROM activities WHERE updated_at > $1 AND type != 'WHATSAPP_SUPPORT' ORDER BY updated_at DESC`, [since])
        ]);
        const hasChanges = ticketsR.rows.length > 0 || activitiesR.rows.length > 0;
        res.json({
            hasChanges,
            timestamp: new Date().toISOString(),
            tickets: ticketsR.rows.map(r => mapTicket(r)),
            activities: activitiesR.rows.map(mapActivity),
            hasChanges: ticketsR.rows.length > 0 || activitiesR.rows.length > 0,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error("Refresh-lite error:", e);
        res.status(500).json({ error: "Failed" });
    }
});

/* ---------- COMBINED INIT ENDPOINT — single call replaces 6 ---------- */
app.get("/api/init", authenticate, async (req, res) => {
    try {
        const [ticketsR, activitiesR, usersR, customersR, teamsR, sitesR] = await Promise.all([
            pool.query(`SELECT id, customer_id, customer_name, phone_number, category, type, priority, status,
                location_url, house_number, ai_summary, assigned_tech_id, appointment_time,
                odoo_link, notes, carry_forward_note, next_planned_at, assignment_note,
                completion_note, cancellation_reason, last_escalated_at, started_at, completed_at,
                visit_history, created_at, updated_at FROM tickets ORDER BY updated_at DESC LIMIT 200`),
            pool.query(`SELECT id, reference, type, priority, status, planned_date, customer_id, customer_name,
                customer_phone, site_id, lead_tech_id, description, duration_hours,
                details, started_at, completed_at, visit_history, created_at, updated_at FROM activities WHERE type != 'WHATSAPP_SUPPORT' ORDER BY created_at DESC LIMIT 200`),
            pool.query('SELECT id, name, email, role as "systemRole", status, phone, avatar, job_role, level FROM users'),
            pool.query(`SELECT id, name, phone, email, address, building_number, avatar, notes, is_active, created_at FROM customers ORDER BY name LIMIT 200`),
            pool.query("SELECT * FROM teams ORDER BY name"),
            pool.query("SELECT * FROM sites ORDER BY name")
        ]);
        res.json({
            tickets: ticketsR.rows.map(r => mapTicket(r)),
            activities: activitiesR.rows.map(mapActivityLite),
            users: usersR.rows.map(r => ({
                id: r.id, name: r.name, email: r.email,
                systemRole: r.systemRole, status: r.status,
                isActive: r.status === 'ACTIVE' || r.status === 'AVAILABLE',
                phone: r.phone, avatar: r.avatar || null,
                jobRole: r.job_role, level: r.level || ''
            })),
            customers: customersR.rows.map(r => ({ ...r, buildingNumber: r.building_number })),
            teams: teamsR.rows.map(r => ({ ...r, leadId: r.lead_id, memberIds: r.member_ids })),
            sites: sitesR.rows.map(r => ({ ...r, clientName: r.client_name, assignedTeamId: r.assigned_team_id }))
        });
    } catch (e) {
        console.error("Init fetch error:", e);
        res.status(500).json({ error: "Failed to load initial data" });
    }
});

/* ---------- COMBINED REFRESH — just tickets + activities + customers ---------- */
app.get("/api/refresh", authenticate, async (req, res) => {
    try {
        const [ticketsR, activitiesR, customersR] = await Promise.all([
            pool.query(`SELECT id, customer_id, customer_name, phone_number, category, type, priority, status,
                location_url, house_number, ai_summary, assigned_tech_id, appointment_time,
                odoo_link, notes, carry_forward_note, next_planned_at, assignment_note,
                completion_note, cancellation_reason, last_escalated_at, started_at, completed_at,
                visit_history, created_at, updated_at FROM tickets ORDER BY updated_at DESC LIMIT 200`),
            pool.query(`SELECT id, reference, type, priority, status, planned_date, customer_id, customer_name,
                customer_phone, site_id, lead_tech_id, description, duration_hours,
                details, started_at, completed_at, visit_history, created_at, updated_at FROM activities WHERE type != 'WHATSAPP_SUPPORT' ORDER BY created_at DESC LIMIT 200`),
            pool.query(`SELECT id, name, phone, email, address, building_number, avatar, notes, is_active, created_at FROM customers ORDER BY name LIMIT 200`)
        ]);
        res.json({
            tickets: ticketsR.rows.map(r => mapTicket(r)),
            activities: activitiesR.rows.map(mapActivityLite),
            customers: customersR.rows.map(r => ({ ...r, buildingNumber: r.building_number }))
        });
    } catch (e) {
        console.error("Refresh error:", e);
        res.status(500).json({ error: "Failed to refresh data" });
    }
});

app.get("/api/tickets", authenticate, async (req, res) => {
  try {
    // Note: photos column is deliberately excluded here — same reasoning as
    // activities' lite list endpoint. jsonb_array_length flags whether photos
    // exist without pulling the actual (large, base64) image data into every
    // ticket list response.
    const result = await pool.query(`SELECT id, customer_id, customer_name, phone_number, category, type, priority, status,
                location_url, house_number, ai_summary, assigned_tech_id, appointment_time,
                odoo_link, notes, carry_forward_note, next_planned_at, assignment_note,
                completion_note, cancellation_reason, last_escalated_at, started_at, completed_at,
                visit_history, created_at, updated_at,
                CASE WHEN jsonb_array_length(COALESCE(photos, '[]'::jsonb)) > 0 THEN true ELSE false END AS has_photos
                FROM tickets ORDER BY updated_at DESC LIMIT 200`);
    res.json(result.rows.map(r => mapTicket(r)));
  } catch (e) {
    console.error("Tickets fetch error:", e);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// Full ticket detail, including real photo data — fetched on demand only
// when a person actually opens a job's photos, never as part of the list.
app.get("/api/tickets/:id/full", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM tickets WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(mapTicket(rows[0], true));
  } catch (e) {
    console.error("Ticket full fetch error:", e);
    res.status(500).json({ error: "Failed to fetch ticket" });
  }
});

// 2. Create a new ticket in DB (Fixed for Foreign Key sync)
app.post("/api/tickets", authenticate, writeRateLimit, async (req, res) => {
  const client = await pool.connect();
  try {
    let { id, customerId, customerName, category, priority, locationUrl, houseNumber, messages, phoneNumber, initialMessage } = req.body;

    // Ticket IDs are always assigned by the server via an atomic Postgres
    // sequence — any client-supplied id is ignored. This is the fix for the
    // duplicate/overwritten-ticket bug: previously each device generated its
    // own ID from a local counter, so two devices could independently land
    // on the same ID (e.g. QNC-TK-000139) and collide. The sequence below
    // can never hand out the same number twice, no matter how many devices
    // are creating tickets at once.
    id = await nextTicketId();

    await client.query('BEGIN');

    // STEP A: Check for existing customer by phone (prevent duplicates)
    let actualCustomerId = customerId;
    if (phoneNumber && String(phoneNumber).trim().length > 4) {
      // Unified normalization: strip all non-digit/non-plus characters
      const normalizedPhone = String(phoneNumber).trim().replace(/[^0-9+]/g, '');
      const existingCust = await client.query(
        `SELECT id FROM customers WHERE REGEXP_REPLACE(phone, '[^0-9+]', '', 'g') = $1 LIMIT 1`,
        [normalizedPhone]
      );
      if (existingCust.rows.length > 0) {
        // Customer already exists — use their canonical ID, update enriched fields
        actualCustomerId = existingCust.rows[0].id;
        await client.query(
          `UPDATE customers SET
             name             = COALESCE(NULLIF($1,''), name),
             building_number  = COALESCE(NULLIF($2,''), building_number),
             address          = COALESCE(NULLIF($3,''), address)
           WHERE id = $4`,
          [customerName, houseNumber || '', locationUrl || '', actualCustomerId]
        );
        // IMPORTANT: do NOT insert a new customer — existing one wins
      } else {
        // New customer — server uses the client-provided ID (already a QNC-CUST-XXXX from backend)
        await client.query(`
          INSERT INTO customers (id, name, phone, address, building_number)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE SET 
            name = COALESCE(EXCLUDED.name, customers.name), 
            phone = COALESCE(NULLIF(EXCLUDED.phone, ''), customers.phone),
            building_number = COALESCE(NULLIF(EXCLUDED.building_number, ''), customers.building_number)
        `, [customerId, customerName, phoneNumber || '', locationUrl || '', houseNumber || '']);
      }
    } else {
      await client.query(`
        INSERT INTO customers (id, name, phone, address, building_number)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET 
          name = COALESCE(EXCLUDED.name, customers.name), 
          phone = COALESCE(NULLIF(EXCLUDED.phone, ''), customers.phone),
          building_number = COALESCE(NULLIF(EXCLUDED.building_number, ''), customers.building_number)
      `, [customerId, customerName, phoneNumber || '', locationUrl || '', houseNumber || '']);
    }

    // STEP B: Now create the ticket safely
    // NOTE: phone_number and ai_summary (the ticket "description" shown in the
    // UI, submitted by the client as `initialMessage`) were previously missing
    // from this INSERT entirely — they were accepted from the request body
    // but never written to the tickets table, so every newly created ticket
    // showed a blank description and no phone number. Both are now persisted.
    const result = await client.query(
      `INSERT INTO tickets (id, customer_id, customer_name, category, type, priority, status, location_url, house_number, messages, assigned_tech_id, appointment_time, phone_number, ai_summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [id, actualCustomerId, customerName, category,
       req.body.type || 'Under Warranty',
       priority,
       req.body.status || 'NEW',
       locationUrl, houseNumber,
       JSON.stringify(messages || []),
       req.body.assignedTechId || null,
       req.body.appointmentTime || null,
       phoneNumber || null,
       initialMessage || null
      ]
    );

    await client.query('COMMIT');

    const ticket = mapTicket(result.rows[0]);

    logAudit(req, {
      action: 'CREATE',
      entityType: 'TICKET',
      entityId: id,
      entityLabel: customerName,
      details: { category, priority, status: req.body.status || 'NEW' },
    });

    // ── Notification 1 (manual): Notify all Team Leads of new manually-created ticket ──
    try {
      const priorityLabel = priority || 'MEDIUM';
      const locationLabel = houseNumber || locationUrl || 'Not provided';
      const createdByName = req.user?.name || 'Dashboard';
      await notifyTeamLeads(
        `*New Ticket (Dashboard): ${id}*\nCustomer: ${customerName}\nCategory: ${category || 'Support'}\nPriority: ${priorityLabel}\nLocation: ${locationLabel}\nCreated by: ${createdByName}`
      );
    } catch (notifErr) {
      console.error('Team lead notify error (manual ticket):', notifErr.message);
    }

    res.status(201).json(ticket);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Ticket creation error:", e);
    res.status(500).json({ error: "Failed to create ticket and customer" });
  } finally {
    client.release();
  }
});

// 2b. Full ticket update (category, priority, type, location, assignment etc.)
app.put("/api/tickets/:id", authenticate, writeRateLimit, async (req, res) => {
    try {
        const id = req.params.id;
        const { category, priority, type, customerId, customerName,
                assignedTechId, appointmentTime, locationUrl, houseNumber, odooLink, notes, photos } = req.body;
        const { phoneNumber } = req.body; // also capture phoneNumber for update

        // Previously this endpoint had no audit logging at all — editing a
        // ticket's category, priority, location, etc. left zero trace.
        // Fetching the before-state here so the audit entry shows a real
        // diff, consistent with the activity-update fix above.
        const before = await pool.query(
            `SELECT category, priority, type, customer_id, customer_name, assigned_tech_id,
                    appointment_time, location_url, house_number, odoo_link, notes, phone_number
             FROM tickets WHERE id = $1`,
            [id]
        );

        await pool.query(
            `UPDATE tickets SET
                category         = COALESCE($1,  category),
                priority         = COALESCE($2,  priority),
                location_url     = COALESCE($3,  location_url),
                house_number     = COALESCE($4,  house_number),
                assigned_tech_id = $5,
                appointment_time = $6,
                odoo_link        = COALESCE($7,  odoo_link),
                notes            = COALESCE($8,  notes),
                customer_id      = COALESCE($9,  customer_id),
                customer_name    = COALESCE($10, customer_name),
                type             = COALESCE($12, type),
                phone_number     = COALESCE($13, phone_number),
                photos           = COALESCE($14::jsonb, photos),
                updated_at       = NOW()
             WHERE id = $11`,
            [
                category || null, priority || null,
                locationUrl || null, houseNumber || null,
                assignedTechId || null, appointmentTime || null,
                odooLink || null, notes || null,
                customerId || null, customerName || null,
                id,
                type || null, phoneNumber || null,
                photos ? JSON.stringify(photos) : null
            ]
        );

        if (before.rows[0]) {
            const b = before.rows[0];
            logAudit(req, {
                action: 'UPDATE',
                entityType: 'TICKET',
                entityId: id,
                entityLabel: customerName || b.customer_name || id,
                details: diffFields(
                    { category: b.category, priority: b.priority, type: b.type, customerId: b.customer_id, customerName: b.customer_name, assignedTechId: b.assigned_tech_id, appointmentTime: b.appointment_time, locationUrl: b.location_url, houseNumber: b.house_number, odooLink: b.odoo_link, notes: b.notes, phoneNumber: b.phone_number },
                    { category, priority, type, customerId, customerName, assignedTechId, appointmentTime, locationUrl, houseNumber, odooLink, notes, phoneNumber }
                ),
            });
        }

        res.json({ ok: true });
    } catch (e) {
        console.error("Ticket update error:", e);
        res.status(500).json({ error: "Failed to update ticket" });
    }
});

// 2b-lite. Get messages for a specific ticket (on-demand, not in list payload)
app.get("/api/tickets/:id/messages", authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT messages FROM tickets WHERE id = $1",
            [req.params.id]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'Ticket not found' });
        const messages = Array.isArray(result.rows[0].messages)
            ? result.rows[0].messages
            : (result.rows[0].messages ? JSON.parse(result.rows[0].messages) : []);
        res.json({ messages });
    } catch (e) {
        console.error('Messages fetch error:', e);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// 2c. Append a message to ticket messages array
app.post("/api/tickets/:id/message", authenticate, writeRateLimit, async (req, res) => {
    try {
        const id = req.params.id;
        const { sender, content } = req.body;
        if (!sender || !content) return res.status(400).json({ error: "sender and content required" });
        const newMsg = {
            id: `m-${Date.now()}`,
            sender,
            content,
            timestamp: new Date().toISOString(),
            at: new Date().toISOString()
        };
        await pool.query(
            `UPDATE tickets
             SET messages = COALESCE(messages, '[]'::jsonb) || $1::jsonb,
                 updated_at = NOW()
             WHERE id = $2`,
            [JSON.stringify([newMsg]), id]
        );
        res.json({ ok: true, message: newMsg });
    } catch (e) {
        console.error("Message append error:", e);
        res.status(500).json({ error: "Failed to append message" });
    }
});

// 3. Delete a ticket in DB (Admin only)
app.delete("/api/tickets/:id", authenticate, deleteRateLimit, async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await pool.query("SELECT customer_name FROM tickets WHERE id=$1", [id]);
    const result = await pool.query("DELETE FROM tickets WHERE id=$1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
    logAudit(req, {
      action: 'DELETE',
      entityType: 'TICKET',
      entityId: id,
      entityLabel: existing.rows[0]?.customer_name || id,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ticket deletion error:", e);
    res.status(500).json({ error: "Failed to delete ticket" });
  }
});

// 4. Update Ticket Status & Trigger Review Message
app.put("/api/tickets/:id/status", authenticate, writeRateLimit, async (req, res) => {
    try {
        const { status, assignedTechId, appointmentTime, carryForwardNote, nextPlannedAt, completionNote, startedAt: adminStartedAt, completedAt: adminCompletedAt } = req.body;
        const ticketId = req.params.id;

        // Fetch current status to detect transitions for timestamp tracking
        const current = await pool.query("SELECT status, started_at FROM tickets WHERE id=$1", [ticketId]);
        const prevStatus = current.rows[0]?.status;
        const alreadyStarted = current.rows[0]?.started_at;

        // Build timestamp clauses — admin-provided values take priority (parameterized)
        let startedAtClause = "";
        let completedAtClause = "";
        const extraTicketParams = [];

        if (adminStartedAt) {
            extraTicketParams.push(new Date(adminStartedAt).toISOString());
            startedAtClause = `, started_at = $${7 + extraTicketParams.length}`;
        } else if (
            ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'].includes(status) &&
            !['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'].includes(prevStatus)
        ) {
            // A ticket entering active execution for the first time (from NEW,
            // ASSIGNED, PLANNED, or CARRY_FORWARD) gets a fresh started_at now.
            // Previously this only fired for IN_PROGRESS specifically, and only
            // if started_at had never been set at all (`!alreadyStarted`) — so a
            // ticket that had been carried forward kept its OLD started_at from
            // before the carry-forward forever, which is why Operations Monitor
            // showed a stale/early start time on the timeline for tickets that
            // had actually just restarted. Carry-forward now also clears
            // started_at (below) so this can never be blocked by stale data.
            startedAtClause = ", started_at = NOW()";
        }

        if (adminCompletedAt) {
            extraTicketParams.push(new Date(adminCompletedAt).toISOString());
            completedAtClause = `, completed_at = $${7 + extraTicketParams.length}`;
        } else if (status === 'RESOLVED' && prevStatus !== 'RESOLVED') {
            completedAtClause = ", completed_at = NOW()";
        }

        if (status === 'CANCELLED') {
            startedAtClause  = ", started_at = NULL";
            completedAtClause = ", completed_at = NULL";
        }

        // 1. Update the database — status + assignment + appointment + notes + timestamps
        //    For CARRY_FORWARD: also append a visit record to visit_history
        let visitHistoryClause = '';
        const visitHistoryParams = [];
        if (status === 'CARRY_FORWARD' && prevStatus !== 'CARRY_FORWARD') {
            // Fetch existing visit_history + timestamps to build the visit record
            const ticketState = await pool.query(
                'SELECT visit_history, started_at, completed_at FROM tickets WHERE id=$1', [ticketId]
            );
            const existingHistory = ticketState.rows[0]?.visit_history || [];
            const visitRecord = {
                date: new Date().toISOString(),
                startedAt: ticketState.rows[0]?.started_at || null,
                completedAt: new Date().toISOString(),
                status: 'CARRY_FORWARD',
                carryForwardReason: carryForwardNote || 'No reason provided',
                nextPlannedAt: nextPlannedAt || null,
                assignedTechId: assignedTechId || null,
            };
            const updatedHistory = [...existingHistory, visitRecord];
            visitHistoryParams.push(JSON.stringify(updatedHistory));
            visitHistoryClause = `, visit_history = $${7 + extraTicketParams.length + visitHistoryParams.length}::jsonb`;
            // The old started_at is now safely captured in visit_history above —
            // clear the live column so the next restart gets a clean, fresh
            // started_at instead of being blocked by this stale value.
            startedAtClause = ", started_at = NULL";
        }

        await pool.query(
            `UPDATE tickets SET 
                status = $1,
                assigned_tech_id = COALESCE($2, assigned_tech_id),
                appointment_time = COALESCE($3, appointment_time),
                carry_forward_note = COALESCE($4, carry_forward_note),
                next_planned_at = COALESCE($5, next_planned_at),
                completion_note = COALESCE($7, completion_note),
                updated_at = NOW()${startedAtClause}${completedAtClause}${visitHistoryClause}
             WHERE id = $6`,
            [status, assignedTechId || null, appointmentTime || null,
             carryForwardNote || null, nextPlannedAt || null, ticketId,
             completionNote || null, ...extraTicketParams, ...visitHistoryParams]
        );

        // 2. Fetch customer + ticket info for notifications
        const ticketData = await pool.query(`
            SELECT t.id, t.customer_name, t.category, t.priority,
                   c.phone as customer_phone, c.name as customer_name_from_db
            FROM tickets t
            JOIN customers c ON t.customer_id = c.id
            WHERE t.id = $1
        `, [ticketId]);

        logAudit(req, {
            action: 'STATUS_CHANGE',
            entityType: 'TICKET',
            entityId: ticketId,
            entityLabel: ticketData.rows[0]?.customer_name_from_db || ticketData.rows[0]?.customer_name || ticketId,
            details: { from: prevStatus, to: status, carryForwardNote: carryForwardNote || undefined, nextPlannedAt: nextPlannedAt || undefined },
        });

        if (ticketData.rows.length > 0) {
            const { customer_phone, customer_name_from_db, category, priority } = ticketData.rows[0];
            const customerName = customer_name_from_db || "Valued Client";

            try {
                // ── Notification 2: Engineer assigned + appointment ──
                if (status === 'ASSIGNED' && assignedTechId) {
                    const techData = await pool.query(
                        "SELECT name FROM users WHERE id = $1", [assignedTechId]
                    );
                    const techName = techData.rows[0]?.name || "our engineer";
                    const apptText = appointmentTime
                        ? `\nAppointment: ${new Date(appointmentTime).toLocaleString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                        : `\nAppointment: *To be confirmed* — our team will reach out shortly.`;
                    await sendWhatsAppText(customer_phone,
                        `Hello ${customerName}, your service request *${ticketId}* has been assigned to *${techName}*.${apptText}\n\nWe will keep you updated on the progress.`
                    );
                }

                // ── Notification 3a: Engineer on the way ──
                if (status === 'ON_MY_WAY') {
                    await sendWhatsAppText(customer_phone,
                        `Hello ${customerName}, your Qonnect engineer is now *on the way* to your location for service request *${ticketId}*.\n\nPlease ensure someone is available to receive them.`
                    );
                }

                // ── Notification 3b: Engineer arrived ──
                if (status === 'ARRIVED') {
                    await sendWhatsAppText(customer_phone,
                        `Hello ${customerName}, your Qonnect engineer has *arrived* at your location for service request *${ticketId}*.`
                    );
                }

                // ── Notification 3c: Work started ──
                if (status === 'IN_PROGRESS') {
                    await sendWhatsAppText(customer_phone,
                        `Hello ${customerName}, work has *started* on your service request *${ticketId}*. We will notify you once completed.`
                    );
                }

                // ── Notification: Resolved — review request ──
                if (status === 'RESOLVED') {
                    await sendWhatsAppText(customer_phone,
                        `Hello ${customerName}, your service request *${ticketId}* has been *resolved*. We hope you are satisfied with our service.\n\nIf you need further assistance, please message us here.`
                    );
                }

                // ── Notification 5: Carry Forward — notify team leads ──
                if (status === 'CARRY_FORWARD') {
                    const reason = carryForwardNote || "No reason provided";
                    const nextDate = nextPlannedAt
                        ? new Date(nextPlannedAt).toLocaleString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : "TBD";
                    await notifyTeamLeads(
                        `*Carry Forward Alert*\nTicket: *${ticketId}*\nCustomer: ${customerName}\nCategory: ${category || "Support"}\nReason: ${reason}\nNext visit: ${nextDate}`
                    );
                }

            } catch (notifErr) {
                console.error("Notification error (non-fatal):", notifErr.message);
            }
        }

        // 3. n8n webhook trigger (if configured)
        if (process.env.N8N_WEBHOOK_URL && status === 'ASSIGNED') {
            try {
                await fetch(`${process.env.N8N_WEBHOOK_URL}/ticket-assigned`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ticketId, status, assignedTechId, appointmentTime })
                });
            } catch (e) { console.error("n8n webhook error:", e.message); }
        }

        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to update status" });
    }
});

// ==============================
// Customers (PostgreSQL)
// ==============================
function toCustomerId(n) {
  return `QNC-CUST-${String(n).padStart(4, "0")}`;
}

async function nextCustomerId() {
  const { rows } = await pool.query(
    "INSERT INTO customer_id_seq DEFAULT VALUES RETURNING id"
  );
  return toCustomerId(Number(rows[0].id));
}

// Ticket IDs are always assigned here — the server is the single source of
// truth. Any client-supplied ticket ID is ignored. This prevents two devices
// from ever generating the same ticket number (the old localStorage-counter
// bug), since the sequence lives in Postgres, not on any one device.
function toTicketId(n) {
  return `QNC-TK-${String(n).padStart(6, "0")}`;
}

async function nextTicketId() {
  const { rows } = await pool.query(
    "INSERT INTO ticket_id_seq DEFAULT VALUES RETURNING id"
  );
  return toTicketId(Number(rows[0].id));
}

// Shared by POST /api/activities and the AMC recurring-schedule processor —
// keeps both call sites generating IDs the same way instead of duplicating
// the SQL. (Activities don't yet have an atomic BIGSERIAL sequence like
// tickets do — this is the existing MAX()+1 pattern, just factored out.)
async function nextActivityId() {
  const maxResult = await pool.query("SELECT id FROM activities ORDER BY id DESC LIMIT 1");
  const lastId = maxResult.rows[0]?.id || 'QNC-ACT-000000';
  const lastNum = parseInt(lastId.replace('QNC-ACT-', ''), 10) || 0;
  return `QNC-ACT-${String(lastNum + 1).padStart(6, '0')}`;
}

// ── Shared "is this person involved in this activity" SQL fragment ───────
// Backend counterpart to utils/jobRoleUtils.ts on the frontend. Several
// endpoints (mobile data sync, bulk reassignment) need to find every
// activity a given person is on, in ANY role — lead, primary, supporting,
// or technical associate. Before this helper existed, that WHERE clause was
// written out by hand at each call site, and at least one of those copies
// was missing supportingEngineerIds entirely (the exact bug behind the
// Tech Portal's "I'm a supporting engineer but don't see my own jobs" issue).
//
// Takes the $N placeholder number for the person's ID (reused 4x — once per
// role check — since all four checks compare against the same single
// value, the same $N can be referenced multiple times in one query).
// Returns just the clause string; the caller supplies paramN in their own
// params array exactly once.
function activityInvolvesPersonClause(paramN) {
  return `(lead_tech_id = $${paramN} OR details->>'primaryEngineerId' = $${paramN} OR details->'supportingEngineerIds' ? $${paramN} OR details->'assistantTechIds' ? $${paramN})`;
}

// List customers (optional search: ?q=)
app.get("/api/customers", authenticate, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    let result;

    if (q) {
      result = await pool.query(
        `
        SELECT * FROM customers
        WHERE id ILIKE $1 OR name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1
        ORDER BY created_at DESC
        LIMIT 200
        `,
        [`%${q}%`]
      );
    } else {
      result = await pool.query(
        `SELECT id, name, phone, email, address, building_number, avatar, notes, is_active, created_at FROM customers ORDER BY created_at DESC LIMIT 200`
      );
    }

    res.json(result.rows.map(r => ({
      id: r.id,
      name: r.name,
      phone: r.phone || '',
      email: r.email || '',
      address: r.address || '',
      buildingNumber: r.building_number || r.address || '',
      avatar: r.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name || 'C')}&background=random`,
      isActive: r.is_active !== false,
      notes: r.notes || ''
    })));
  } catch (e) {
    console.error("customers list error:", e);
    res.status(500).json({ error: "Failed to list customers" });
  }
});

// Create customer (with duplicate phone prevention)
app.post("/api/customers", authenticate, writeRateLimit, async (req, res) => {
  try {
    const { name, phone, email, address, notes, is_active, buildingNumber } = req.body || {};

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Customer name is required" });
    }

    // Check for existing customer with same phone number
    if (phone && String(phone).trim().length > 4) {
      const normalizedPhone = String(phone).trim().replace(/[^0-9+]/g, '');
      const existing = await pool.query(
        `SELECT * FROM customers WHERE REGEXP_REPLACE(phone, '[^0-9+]', '', 'g') = $1 LIMIT 1`,
        [normalizedPhone]
      );
      if (existing.rows.length > 0) {
        const r = existing.rows[0];
        // Update name/address if provided and different
        if (name && name !== r.name) {
          await pool.query(`UPDATE customers SET name=$1 WHERE id=$2`, [String(name).trim(), r.id]);
        }
        if (buildingNumber && buildingNumber !== r.building_number) {
          await pool.query(`UPDATE customers SET building_number=$1 WHERE id=$2`, [String(buildingNumber).trim(), r.id]);
        }
        return res.json({
          id: r.id,
          name: name || r.name,
          phone: r.phone || '',
          email: r.email || '',
          address: r.address || '',
          buildingNumber: buildingNumber || r.building_number || r.address || '',
          avatar: r.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name || 'C')}&background=random`,
          isActive: r.is_active !== false,
          notes: r.notes || '',
          existed: true
        });
      }
    }

    const id = await nextCustomerId();

    const { rows } = await pool.query(
      `
      INSERT INTO customers (id, name, phone, email, address, notes, is_active, building_number)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        id,
        String(name).trim(),
        phone ? String(phone).trim() : null,
        email ? String(email).trim() : null,
        address ? String(address).trim() : null,
        notes ? String(notes).trim() : null,
        typeof is_active === "boolean" ? is_active : true,
        buildingNumber ? String(buildingNumber).trim() : null,
      ]
    );

    const r = rows[0];
    logAudit(req, {
      action: 'CREATE',
      entityType: 'CUSTOMER',
      entityId: id,
      entityLabel: r.name,
      details: { phone: r.phone || undefined },
    });
    // Return same shape as GET /api/customers so frontend can use immediately
    res.status(201).json({
      id: r.id,
      name: r.name,
      phone: r.phone || '',
      email: r.email || '',
      address: r.address || '',
      buildingNumber: r.building_number || '',
      avatar: r.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name || 'C')}&background=random`,
      isActive: r.is_active !== false,
      notes: r.notes || ''
    });
  } catch (e) {
    console.error("customers create error:", e);
    res.status(500).json({ error: "Failed to create customer" });
  }
});

// Update customer
app.put("/api/customers/:id", authenticate, writeRateLimit, async (req, res) => {
  try {
    const id = req.params.id;
    const { name, phone, email, address, buildingNumber, notes, is_active } = req.body || {};

    const before = await pool.query(
      `SELECT name, phone, email, address, building_number, notes, is_active FROM customers WHERE id = $1`,
      [id]
    );

    const { rows } = await pool.query(
      `
      UPDATE customers
      SET
        name = COALESCE($2, name),
        phone = COALESCE($3, phone),
        email = COALESCE($4, email),
        address = COALESCE($5, address),
        building_number = COALESCE($8, building_number),
        notes = COALESCE($6, notes),
        is_active = COALESCE($7, is_active),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        id,
        name !== undefined ? String(name).trim() : null,
        phone !== undefined ? (phone ? String(phone).trim() : null) : null,
        email !== undefined ? (email ? String(email).trim() : null) : null,
        address !== undefined ? (address ? String(address).trim() : null) : null,
        notes !== undefined ? (notes ? String(notes).trim() : null) : null,
        typeof is_active === "boolean" ? is_active : null,
        buildingNumber !== undefined ? (buildingNumber ? String(buildingNumber).trim() : null) : null,
      ]
    );

    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    const r = rows[0];
    logAudit(req, {
      action: 'UPDATE',
      entityType: 'CUSTOMER',
      entityId: id,
      entityLabel: r.name,
      details: diffFields(
        { name: before.rows[0]?.name, phone: before.rows[0]?.phone, email: before.rows[0]?.email, address: before.rows[0]?.address, buildingNumber: before.rows[0]?.building_number, notes: before.rows[0]?.notes, isActive: before.rows[0]?.is_active },
        { name: r.name, phone: r.phone, email: r.email, address: r.address, buildingNumber: r.building_number, notes: r.notes, isActive: r.is_active }
      ),
    });
    res.json({
      id: r.id, name: r.name, phone: r.phone || '',
      email: r.email || '', address: r.address || '',
      buildingNumber: r.building_number || '',
      avatar: r.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name || 'C')}&background=random`,
      isActive: r.is_active !== false, notes: r.notes || ''
    });
  } catch (e) {
    console.error("customers update error:", e);
    res.status(500).json({ error: "Failed to update customer" });
  }
});

// Delete customer
app.delete("/api/customers/:id", authenticate, deleteRateLimit, async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await pool.query(`SELECT name FROM customers WHERE id=$1`, [id]);
    const r = await pool.query(`DELETE FROM customers WHERE id=$1`, [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
    logAudit(req, {
      action: 'DELETE',
      entityType: 'CUSTOMER',
      entityId: id,
      entityLabel: existing.rows[0]?.name || id,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("customers delete error:", e);
    res.status(500).json({ error: "Failed to delete customer" });
  }
});

// Analyze Endpoint
app.post('/api/analyze', authenticate, async (req, res) => {
  try {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY not configured on server");
    }

    const { message, history = [] } = req.body;
    console.log(`[Analyze] Processing message: "${message?.substring(0, 50)}..."`);

    const context = history.length > 0 ? `Conversation History:\n${history.join('\n')}\n\n` : '';

    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `You are a field operations & after-sales support assistant in Qatar.\n` +
                `${context}` +
                `Analyze the client message and return STRICT JSON only.\n\n` +
                `Client message:\n"""${message}"""\n\n` +
                `Return a JSON object with exactly these fields:\n` +
                `- summary: short description of the issue\n` +
                `- service_category: one of "ELV Systems", "Home Automation", "Unknown"\n` +
                `- priority: one of "LOW", "MEDIUM", "HIGH", "URGENT"\n` +
                `- remote_possible: true or false\n` +
                `- recommended_action: one of "remote_support", "assign_technician", "request_more_info"\n` +
                `- suggested_questions: array of up to 3 strings\n` +
                `- draft_reply: a professional reply to send to the customer\n` +
                `- confidence: number between 0 and 100\n`
            }
          ]
        }
      ],
    });

    // JSON mode guarantees clean JSON — parse directly
    const rawText = result.response.text();
    let data;
    try {
        data = JSON.parse(rawText);
    } catch (e) {
        // Fallback cleanup just in case
        console.warn("[Analyze] JSON parse failed, attempting cleanup.");
        const start = rawText.indexOf("{");
        const end = rawText.lastIndexOf("}");
        if (start >= 0 && end > start) {
            data = JSON.parse(rawText.slice(start, end + 1));
        } else {
            throw new Error("Invalid JSON response from AI");
        }
    }

    res.json(data);
  } catch (error) {
    console.error("[Analyze] Error:", error);
    res.status(500).json({ 
        error: "Failed to process analysis", 
        details: error.message 
    });
  }
});

// Chat Endpoint
app.post('/api/chat', authenticate, async (req, res) => {
  try {
    if (!process.env.API_KEY) throw new Error("API_KEY not configured");

    const { history, newMessage } = req.body;
    
    // Convert history to the format Gemini expects
    const contents = history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model', // Gemini uses 'model' instead of 'assistant'
      parts: [{ text: msg.text }]
    }));
    
    contents.push({
      role: 'user',
      parts: [{ text: newMessage }]
    });

   // FIXED: systemInstruction is passed inside getGenerativeModel as an object property
   const model = genAI.getGenerativeModel({ 
       model: "gemini-2.5-flash",
       systemInstruction: {
           role: "system",
           parts: [{ text: "You are Qonnect AI, a helpful field operations assistant for Qonnect W.L.L. in Qatar." }]
       }
   });
   
   const result = await model.generateContent({
      contents: contents
    });

    res.json({ text: result.response.text() });
  } catch (error) {
    console.error("[Chat] Error:", error);
    res.status(500).json({ error: "Failed to process chat" });
  }
});

// ==============================
// Authentication & Users (JWT)
// ==============================
app.post("/api/login", loginRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const { rows } = await pool.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [email.trim()]);
    if (rows.length === 0) {
        logAudit(req, { action: 'LOGIN_FAILED', entityType: 'USER', entityLabel: email.trim(), actorOverride: { name: email.trim() } });
        return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = rows[0];
    if (!user.password) return res.status(401).json({ error: "Account not configured. Contact admin." });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
        logAudit(req, { action: 'LOGIN_FAILED', entityType: 'USER', entityId: user.id, entityLabel: user.name, actorOverride: { id: user.id, name: user.name, role: user.role } });
        return res.status(401).json({ error: "Invalid credentials" });
    }

    // Block inactive users
    if (user.status === 'INACTIVE') return res.status(403).json({ error: "Account is inactive. Contact admin." });

    const token = jwt.sign(
        { id: user.id, role: user.role, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
    );

    logAudit(req, { action: 'LOGIN', entityType: 'USER', entityId: user.id, entityLabel: user.name, actorOverride: { id: user.id, name: user.name, role: user.role } });

    res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, techId: user.id, avatar: user.avatar || null }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }

// ── /api/me — verify token and return current user (used on app startup) ──
app.get("/api/me", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, email, role, status, avatar FROM users WHERE id = $1", [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    const u = rows[0];
    if (u.status === 'INACTIVE') return res.status(403).json({ error: "Account inactive" });
    res.json({ id: u.id, name: u.name, email: u.email, role: u.role, techId: u.id, avatar: u.avatar || null });
  } catch (e) {
    res.status(500).json({ error: "Failed to verify session" });
  }
});
});

// ── Bulk Reassignment ───────────────────────────────────────────────────
// Lists every OPEN job a person is on, in any role, so a Team Lead can move
// all of someone's work to another engineer in one action (e.g. when
// someone goes on leave) instead of opening each job individually.
app.get("/api/reassignment/open-jobs/:personId", authenticate, async (req, res) => {
    try {
        const { personId } = req.params;
        const [ticketsR, activitiesR] = await Promise.all([
            pool.query(
                `SELECT id, customer_name, category, type, status, appointment_time, created_at
                 FROM tickets
                 WHERE assigned_tech_id = $1
                   AND status NOT IN ('RESOLVED', 'CANCELLED')
                 ORDER BY created_at DESC`,
                [personId]
            ),
            pool.query(
                `SELECT id, reference, type, status, planned_date, customer_name, lead_tech_id, details
                 FROM activities
                 WHERE ${activityInvolvesPersonClause(1)}
                   AND status NOT IN ('DONE', 'CANCELLED')
                 ORDER BY planned_date DESC`,
                [personId]
            ),
        ]);

        const jobs = [
            ...ticketsR.rows.map(r => ({
                id: r.id,
                kind: 'ticket',
                customerName: r.customer_name,
                title: r.category || r.type,
                status: r.status,
                date: r.appointment_time || r.created_at,
                role: 'ASSIGNED',
            })),
            ...activitiesR.rows.map(r => {
                const d = r.details || {};
                // Same role precedence as utils/jobRoleUtils.ts on the frontend —
                // keep these in sync if either changes.
                let role = null;
                if (r.lead_tech_id === personId) role = 'LEAD';
                else if (d.primaryEngineerId === personId) role = 'PRIMARY';
                else if ((d.supportingEngineerIds || []).includes(personId)) role = 'SUPPORTING';
                else if ((d.assistantTechIds || []).includes(personId)) role = 'TECHNICAL_ASSOCIATE';
                return {
                    id: r.id,
                    kind: 'activity',
                    customerName: r.customer_name || d.customerName || '',
                    title: r.type,
                    status: r.status,
                    date: r.planned_date,
                    role,
                };
            }),
        ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

        res.json({ jobs });
    } catch (e) {
        console.error('Reassignment open-jobs error:', e);
        res.status(500).json({ error: 'Failed to load open jobs' });
    }
});

// Executes the reassignment for a selected set of jobs. The new engineer
// REPLACES the old one in whatever role they held — a job where the
// original person was "Supporting" gets the new person as the supporting
// engineer, not as the lead; a job where they were "Lead" gets the new
// person as lead. This is a deliberate choice (confirmed before building):
// replace, not add alongside.
app.post("/api/reassignment/execute", authenticate, writeRateLimit, async (req, res) => {
    try {
        const { fromPersonId, toPersonId, jobIds } = req.body || {};
        if (!fromPersonId || !toPersonId) return res.status(400).json({ error: 'fromPersonId and toPersonId are required' });
        if (!Array.isArray(jobIds) || jobIds.length === 0) return res.status(400).json({ error: 'jobIds must be a non-empty array' });

        const toUserRow = await pool.query('SELECT id, name FROM users WHERE id = $1', [toPersonId]);
        if (!toUserRow.rows[0]) return res.status(400).json({ error: 'Target engineer not found' });
        const fromUserRow = await pool.query('SELECT id, name FROM users WHERE id = $1', [fromPersonId]);
        const fromName = fromUserRow.rows[0]?.name || fromPersonId;
        const toName = toUserRow.rows[0].name;

        let movedTickets = 0, movedActivities = 0, failed = 0;
        const movedJobIds = [];

        for (const jobId of jobIds) {
            try {
                // Tickets: single assignee field, simple replace.
                const ticketUpdate = await pool.query(
                    `UPDATE tickets SET assigned_tech_id = $1, updated_at = NOW() WHERE id = $2 AND assigned_tech_id = $3`,
                    [toPersonId, jobId, fromPersonId]
                );
                if (ticketUpdate.rowCount > 0) { movedTickets++; movedJobIds.push(jobId); continue; }

                // Activities: replace fromPersonId in EVERY role field where it
                // appears — a person can simultaneously be lead_tech_id AND
                // primaryEngineerId on the same job (common, since the lead is
                // often also the one actually doing the work), so this checks
                // each field independently rather than stopping at the first match.
                const actRow = await pool.query('SELECT lead_tech_id, details FROM activities WHERE id = $1', [jobId]);
                if (!actRow.rows[0]) { failed++; continue; }
                const d = actRow.rows[0].details || {};
                let updated = false;
                let newLeadTechId = actRow.rows[0].lead_tech_id;

                if (actRow.rows[0].lead_tech_id === fromPersonId) {
                    newLeadTechId = toPersonId;
                    updated = true;
                }
                if (d.primaryEngineerId === fromPersonId) {
                    d.primaryEngineerId = toPersonId;
                    updated = true;
                }
                if ((d.supportingEngineerIds || []).includes(fromPersonId)) {
                    d.supportingEngineerIds = d.supportingEngineerIds.map((id) => id === fromPersonId ? toPersonId : id);
                    updated = true;
                }
                if ((d.assistantTechIds || []).includes(fromPersonId)) {
                    d.assistantTechIds = d.assistantTechIds.map((id) => id === fromPersonId ? toPersonId : id);
                    updated = true;
                }

                if (updated) {
                    await pool.query(
                        'UPDATE activities SET lead_tech_id = $1, details = $2, updated_at = NOW() WHERE id = $3',
                        [newLeadTechId, JSON.stringify(d), jobId]
                    );
                    movedActivities++;
                    movedJobIds.push(jobId);
                } else {
                    failed++; // job didn't actually have fromPersonId in any role — skip silently counted as failed
                }
            } catch (e) {
                console.error('Reassignment failed for job', jobId, e.message);
                failed++;
            }
        }

        // One summary audit entry for the whole batch, not one per job —
        // confirmed this is the right granularity before building.
        logAudit(req, {
            action: 'UPDATE',
            entityType: 'BULK_REASSIGNMENT',
            entityLabel: `${fromName} → ${toName}`,
            details: { fromPersonId, toPersonId, movedTickets, movedActivities, failed, jobIds: movedJobIds },
        });

        res.json({ ok: true, movedTickets, movedActivities, failed });
    } catch (e) {
        console.error('Reassignment execute error:', e);
        res.status(500).json({ error: 'Failed to reassign jobs' });
    }
});

app.get("/api/users", authenticate, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, email, role as \"systemRole\", status, phone, avatar, job_role, level FROM users");
        res.json(result.rows.map(r => {
            // If a SALES-level user has no system role set (created before the SALES role fix),
            // normalise it so User Management shows them correctly.
            let sysRole = r.systemRole;
            if (r.level === 'SALES' && (!sysRole || sysRole === 'NONE')) sysRole = 'SALES';
            return {
                id: r.id,
                name: r.name,
                email: r.email,
                systemRole: sysRole,
                isActive: r.status === 'ACTIVE' || r.status === 'AVAILABLE',
                status: (r.status === 'AVAILABLE') ? 'ACTIVE' : (r.status || 'ACTIVE'),
                phone: r.phone || '',
                jobRole: r.job_role || '',
                level:   r.level   || '',
                avatar: r.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name || 'U')}&background=random&color=fff&bold=true&size=128`
            };
        }));
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// ── Audit Log ────────────────────────────────────────────────────────────
// Admin only. Unlike most other routes in this file (which rely on the
// frontend hiding nav items by role), this endpoint contains sensitive data
// — login failures, password-change events, who deleted what — so it
// enforces the role check server-side rather than trusting the client.
app.get("/api/audit-logs", authenticate, async (req, res) => {
    try {
        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: "Admin access required" });
        }

        const { actorId, action, entityType, entityId, startDate, endDate, q } = req.query;
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        const conditions = [];
        const params = [];

        if (actorId) { params.push(actorId); conditions.push(`actor_id = $${params.length}`); }
        if (action) { params.push(action); conditions.push(`action = $${params.length}`); }
        if (entityType) { params.push(entityType); conditions.push(`entity_type = $${params.length}`); }
        if (entityId) { params.push(entityId); conditions.push(`entity_id = $${params.length}`); }
        if (startDate) { params.push(startDate); conditions.push(`created_at >= $${params.length}`); }
        if (endDate) { params.push(endDate); conditions.push(`created_at <= $${params.length}`); }
        if (q) {
            params.push(`%${q}%`);
            conditions.push(`(entity_label ILIKE $${params.length} OR actor_name ILIKE $${params.length} OR entity_id ILIKE $${params.length})`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await pool.query(`SELECT COUNT(*) AS total FROM audit_logs ${whereClause}`, params);
        const total = Number(countResult.rows[0]?.total || 0);

        params.push(limit);
        params.push(offset);
        const result = await pool.query(
            `SELECT id, actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_label, details, ip_address, created_at
             FROM audit_logs ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        res.json({
            total,
            limit,
            offset,
            logs: result.rows.map(r => ({
                id: r.id,
                actorId: r.actor_id,
                actorName: r.actor_name,
                actorRole: r.actor_role,
                action: r.action,
                entityType: r.entity_type,
                entityId: r.entity_id,
                entityLabel: r.entity_label,
                details: r.details || {},
                ipAddress: r.ip_address,
                createdAt: r.created_at,
            })),
        });
    } catch (e) {
        console.error("Audit log fetch error:", e);
        res.status(500).json({ error: "Failed to fetch audit logs" });
    }
});

// ── System Data Import ──────────────────────────────────────────────────
// Admin only. This is the actual persistence layer behind the Data Export
// Tool's "Import" feature. Previously, import only updated in-memory React
// state on the page that ran it — nothing was written to the database, so
// the very next page refresh (or background poll) silently discarded
// everything that was "imported". This endpoint actually writes the data.
//
// Policy: update existing records, create new ones, NEVER delete anything
// missing from the imported file (the safest option — an import can never
// destroy data that isn't explicitly back in the file).
//
// Staff/users are a special case: exported backups never include
// passwords (and never should). So for users: existing users get their
// non-credential fields updated; users present in the import but not yet
// in the database are skipped entirely, since there is no safe password
// to give them. Admin accounts are never modified by import, regardless
// of what the import file says about them.
app.post("/api/system/import", authenticate, writeRateLimit, async (req, res) => {
    if (req.user?.role !== 'ADMIN') {
        return res.status(403).json({ error: "Admin access required" });
    }

    const { tickets = [], activities = [], customers = [], teams = [], sites = [], technicians = [] } = req.body || {};
    const result = {
        tickets: { created: 0, updated: 0, failed: 0 },
        activities: { created: 0, updated: 0, failed: 0 },
        customers: { created: 0, updated: 0, failed: 0 },
        teams: { created: 0, updated: 0, failed: 0 },
        sites: { created: 0, updated: 0, failed: 0 },
        technicians: { updated: 0, skippedNew: 0, skippedAdmin: 0, failed: 0 },
    };

    // ── Customers ──
    for (const c of customers) {
        if (!c?.id || !c?.name) { result.customers.failed++; continue; }
        try {
            const existing = await pool.query('SELECT id FROM customers WHERE id=$1', [c.id]);
            await pool.query(
                `INSERT INTO customers (id, name, phone, email, address, building_number, avatar, notes, is_active)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 ON CONFLICT (id) DO UPDATE SET
                   name = EXCLUDED.name, phone = EXCLUDED.phone, email = EXCLUDED.email,
                   address = EXCLUDED.address, building_number = EXCLUDED.building_number,
                   avatar = EXCLUDED.avatar, notes = EXCLUDED.notes, is_active = EXCLUDED.is_active`,
                [c.id, c.name, c.phone || null, c.email || null, c.address || null, c.buildingNumber || null, c.avatar || null, c.notes || null, c.isActive !== false]
            );
            if (existing.rows.length > 0) result.customers.updated++; else result.customers.created++;
        } catch (e) {
            console.error('Import customer failed:', c.id, e.message);
            result.customers.failed++;
        }
    }

    // ── Teams ──
    for (const t of teams) {
        if (!t?.id || !t?.name) { result.teams.failed++; continue; }
        try {
            const existing = await pool.query('SELECT id FROM teams WHERE id=$1', [t.id]);
            await pool.query(
                `INSERT INTO teams (id, name, lead_id, member_ids, status, current_site_id, workload_level)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (id) DO UPDATE SET
                   name = EXCLUDED.name, lead_id = EXCLUDED.lead_id, member_ids = EXCLUDED.member_ids,
                   status = EXCLUDED.status, current_site_id = EXCLUDED.current_site_id, workload_level = EXCLUDED.workload_level`,
                [t.id, t.name, t.leadId || null, JSON.stringify(t.memberIds || []), t.status || 'AVAILABLE', t.currentSiteId || null, t.workloadLevel || 'LOW']
            );
            if (existing.rows.length > 0) result.teams.updated++; else result.teams.created++;
        } catch (e) {
            console.error('Import team failed:', t.id, e.message);
            result.teams.failed++;
        }
    }

    // ── Sites ──
    for (const s of sites) {
        if (!s?.id || !s?.name) { result.sites.failed++; continue; }
        try {
            const existing = await pool.query('SELECT id FROM sites WHERE id=$1', [s.id]);
            await pool.query(
                `INSERT INTO sites (id, name, client_name, location, priority, status, assigned_team_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (id) DO UPDATE SET
                   name = EXCLUDED.name, client_name = EXCLUDED.client_name, location = EXCLUDED.location,
                   priority = EXCLUDED.priority, status = EXCLUDED.status, assigned_team_id = EXCLUDED.assigned_team_id`,
                [s.id, s.name, s.clientName || null, s.location || null, s.priority || null, s.status || 'PLANNED', s.assignedTeamId || null]
            );
            if (existing.rows.length > 0) result.sites.updated++; else result.sites.created++;
        } catch (e) {
            console.error('Import site failed:', s.id, e.message);
            result.sites.failed++;
        }
    }

    // ── Tickets ──
    // Note: ticket IDs from a legitimate Qonnect export are already
    // server-assigned and unique, so they're trusted here (unlike the
    // ticket-creation endpoint, which never trusts a client-supplied ID).
    for (const t of tickets) {
        if (!t?.id || !t?.customerId) { result.tickets.failed++; continue; }
        try {
            const existing = await pool.query('SELECT id FROM tickets WHERE id=$1', [t.id]);
            await pool.query(
                `INSERT INTO tickets (id, customer_id, customer_name, category, type, priority, status,
                    location_url, house_number, ai_summary, assigned_tech_id, appointment_time, odoo_link,
                    notes, phone_number, carry_forward_note, next_planned_at, messages,
                    assignment_note, completion_note, cancellation_reason, last_escalated_at,
                    started_at, completed_at, visit_history, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
                    COALESCE($26, now()), now())
                 ON CONFLICT (id) DO UPDATE SET
                    customer_id = EXCLUDED.customer_id, customer_name = EXCLUDED.customer_name,
                    category = EXCLUDED.category, type = EXCLUDED.type, priority = EXCLUDED.priority,
                    status = EXCLUDED.status, location_url = EXCLUDED.location_url, house_number = EXCLUDED.house_number,
                    ai_summary = EXCLUDED.ai_summary, assigned_tech_id = EXCLUDED.assigned_tech_id,
                    appointment_time = EXCLUDED.appointment_time, odoo_link = EXCLUDED.odoo_link,
                    notes = EXCLUDED.notes, phone_number = EXCLUDED.phone_number,
                    carry_forward_note = EXCLUDED.carry_forward_note, next_planned_at = EXCLUDED.next_planned_at,
                    messages = EXCLUDED.messages, assignment_note = EXCLUDED.assignment_note,
                    completion_note = EXCLUDED.completion_note, cancellation_reason = EXCLUDED.cancellation_reason,
                    last_escalated_at = EXCLUDED.last_escalated_at, started_at = EXCLUDED.started_at,
                    completed_at = EXCLUDED.completed_at, visit_history = EXCLUDED.visit_history,
                    updated_at = now()`,
                [
                    t.id, t.customerId, t.customerName || '', t.category || null, t.type || 'Under Warranty',
                    t.priority || 'MEDIUM', t.status || 'NEW', t.locationUrl || null, t.houseNumber || null,
                    t.ai_summary || null, t.assignedTechId || null, t.appointmentTime || null, t.odooLink || null,
                    t.notes || null, t.phoneNumber || null, t.carryForwardNote || null, t.nextPlannedAt || null,
                    JSON.stringify(t.messages || []), t.assignmentNote || null, t.completionNote || null,
                    t.cancellationReason || null, t.lastEscalatedAt || null, t.startedAt || null,
                    t.completedAt || null, JSON.stringify(t.visitHistory || []), t.createdAt || null
                ]
            );
            if (existing.rows.length > 0) result.tickets.updated++; else result.tickets.created++;
        } catch (e) {
            console.error('Import ticket failed:', t.id, e.message);
            result.tickets.failed++;
        }
    }

    // ── Activities ──
    // Most fields live in the `details` JSONB blob, same convention used by
    // the activity PUT endpoint — merge onto any existing details rather
    // than replacing wholesale, so nothing already in the DB is lost if the
    // imported record happens to be missing a field the export normally includes.
    for (const a of activities) {
        if (!a?.id) { result.activities.failed++; continue; }
        try {
            const existing = await pool.query('SELECT id, details FROM activities WHERE id=$1', [a.id]);
            const existingDetails = existing.rows[0]?.details || {};
            const mergedDetails = {
                ...existingDetails,
                customerName: a.customerName, customerPhone: a.customerPhone,
                serviceCategory: a.serviceCategory, durationUnit: a.durationUnit,
                assistantTechIds: a.assistantTechIds || [], salesLeadId: a.salesLeadId, salesLeadName: a.salesLeadName,
                locationUrl: a.locationUrl, houseNumber: a.houseNumber, escalationLevel: a.escalationLevel,
                carryForwardNote: a.carryForwardNote, nextPlannedAt: a.nextPlannedAt, odooLink: a.odooLink,
                freelancerDetails: a.freelancerDetails, freelancers: a.freelancers || [],
                photos: a.photos || existingDetails.photos || [], completionNote: a.completionNote, remarks: a.remarks,
                primaryEngineerId: a.primaryEngineerId || null, supportingEngineerIds: a.supportingEngineerIds || [],
                currentVisitRemark: a.currentVisitRemark,
            };
            await pool.query(
                `INSERT INTO activities (id, reference, type, priority, status, planned_date, customer_id, site_id,
                    lead_tech_id, description, duration_hours, details, started_at, completed_at, visit_history, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, COALESCE($16, now()), now())
                 ON CONFLICT (id) DO UPDATE SET
                    reference = EXCLUDED.reference, type = EXCLUDED.type, priority = EXCLUDED.priority,
                    status = EXCLUDED.status, planned_date = EXCLUDED.planned_date, customer_id = EXCLUDED.customer_id,
                    site_id = EXCLUDED.site_id, lead_tech_id = EXCLUDED.lead_tech_id, description = EXCLUDED.description,
                    duration_hours = EXCLUDED.duration_hours, details = EXCLUDED.details,
                    started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at,
                    visit_history = EXCLUDED.visit_history, updated_at = now()`,
                [
                    a.id, a.reference || a.id, a.type || null, a.priority || 'MEDIUM', a.status || 'PLANNED',
                    a.plannedDate || null, a.customerId || null, a.siteId || null, a.leadTechId || null,
                    a.description || '', a.durationHours || 2, JSON.stringify(mergedDetails),
                    a.startedAt || null, a.completedAt || null, JSON.stringify(a.visitHistory || []), a.createdAt || null
                ]
            );
            if (existing.rows.length > 0) result.activities.updated++; else result.activities.created++;
        } catch (e) {
            console.error('Import activity failed:', a.id, e.message);
            result.activities.failed++;
        }
    }

    // ── Technicians / Staff ──
    // Only updates EXISTING users — never creates new ones (no safe password
    // to assign) and never touches Admin accounts, regardless of what the
    // import file contains for them.
    for (const tech of technicians) {
        if (!tech?.id) { result.technicians.failed++; continue; }
        try {
            const existing = await pool.query('SELECT id, role FROM users WHERE id=$1', [tech.id]);
            if (existing.rows.length === 0) { result.technicians.skippedNew++; continue; }
            if (existing.rows[0].role === 'ADMIN' || tech.systemRole === 'ADMIN') { result.technicians.skippedAdmin++; continue; }
            await pool.query(
                `UPDATE users SET name = $1, phone = $2, job_role = $3, level = $4,
                    status = $5, avatar = $6
                 WHERE id = $7`,
                [
                    tech.name || null, tech.phone || null, tech.role || null, tech.level || null,
                    (tech.isActive === false ? 'INACTIVE' : 'ACTIVE'), tech.avatar || null, tech.id
                ]
            );
            result.technicians.updated++;
        } catch (e) {
            console.error('Import technician failed:', tech.id, e.message);
            result.technicians.failed++;
        }
    }

    logAudit(req, {
        action: 'IMPORT',
        entityType: 'SYSTEM',
        entityLabel: 'Bulk data import',
        details: result,
    });

    res.json({ ok: true, result });
});

// ── Recurring Schedules (AMC contracts) ────────────────────────────────────
// Previously this entire feature had a frontend but no backend at all —
// every create/pause/resume/delete/process call hit a route that returned
// 404, so nothing was ever saved and the list always reset back to empty.

// List all recurring schedules, most overdue first
app.get("/api/recurring-schedules", authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM recurring_schedules ORDER BY next_due_date ASC, created_at DESC`
        );
        res.json(rows.map(r => ({
            id: r.id,
            customer_id: r.customer_id,
            customer_name: r.customer_name,
            type: r.type,
            category: r.category,
            interval_type: r.interval_type,
            next_due_date: r.next_due_date,
            last_scheduled_date: r.last_scheduled_date,
            preferred_time: r.preferred_time,
            notes: r.notes,
            is_active: r.is_active,
        })));
    } catch (e) {
        console.error('Recurring schedules list error:', e);
        res.status(500).json({ error: "Failed to load recurring schedules" });
    }
});

// Create a new AMC contract
app.post("/api/recurring-schedules", authenticate, writeRateLimit, async (req, res) => {
    try {
        const { customerId, customerName, category, intervalType, nextDueDate, preferredTime, notes } = req.body || {};
        if (!customerId || !nextDueDate) {
            return res.status(400).json({ error: "customerId and nextDueDate are required" });
        }
        const id = `AMC-${Date.now()}`;
        const custRow = await pool.query('SELECT name FROM customers WHERE id=$1', [customerId]);
        const resolvedName = customerName || custRow.rows[0]?.name || '';

        await pool.query(
            `INSERT INTO recurring_schedules (id, customer_id, customer_name, type, category, interval_type, next_due_date, preferred_time, notes, is_active, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)`,
            [id, customerId, resolvedName, category || 'Maintenance', category || null,
             intervalType || 'MONTHLY', nextDueDate, preferredTime || '09:00', notes || null, req.user?.id || null]
        );

        logAudit(req, {
            action: 'CREATE',
            entityType: 'RECURRING_SCHEDULE',
            entityId: id,
            entityLabel: resolvedName,
            details: { intervalType: intervalType || 'MONTHLY', nextDueDate },
        });

        res.status(201).json({ ok: true, id });
    } catch (e) {
        console.error('Recurring schedule create error:', e);
        res.status(500).json({ error: "Failed to create recurring schedule" });
    }
});

// Pause/resume a schedule, or edit its fields
app.put("/api/recurring-schedules/:id", authenticate, writeRateLimit, async (req, res) => {
    try {
        const { isActive, nextDueDate, intervalType, preferredTime, notes } = req.body || {};
        const { rows } = await pool.query(
            `UPDATE recurring_schedules SET
                is_active = COALESCE($1, is_active),
                next_due_date = COALESCE($2, next_due_date),
                interval_type = COALESCE($3, interval_type),
                preferred_time = COALESCE($4, preferred_time),
                notes = COALESCE($5, notes),
                updated_at = now()
             WHERE id = $6
             RETURNING *`,
            [isActive, nextDueDate || null, intervalType || null, preferredTime || null, notes ?? null, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: "Schedule not found" });

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'RECURRING_SCHEDULE',
            entityId: req.params.id,
            entityLabel: rows[0].customer_name,
            details: { isActive: rows[0].is_active },
        });

        res.json({ ok: true });
    } catch (e) {
        console.error('Recurring schedule update error:', e);
        res.status(500).json({ error: "Failed to update recurring schedule" });
    }
});

// Delete a schedule
app.delete("/api/recurring-schedules/:id", authenticate, deleteRateLimit, async (req, res) => {
    try {
        const existing = await pool.query('SELECT customer_name FROM recurring_schedules WHERE id=$1', [req.params.id]);
        const r = await pool.query(`DELETE FROM recurring_schedules WHERE id = $1`, [req.params.id]);
        if (r.rowCount === 0) return res.status(404).json({ error: "Schedule not found" });

        logAudit(req, {
            action: 'DELETE',
            entityType: 'RECURRING_SCHEDULE',
            entityId: req.params.id,
            entityLabel: existing.rows[0]?.customer_name || req.params.id,
        });

        res.json({ ok: true });
    } catch (e) {
        console.error('Recurring schedule delete error:', e);
        res.status(500).json({ error: "Failed to delete recurring schedule" });
    }
});

// Advance a schedule's next_due_date forward by one interval from a given date
function advanceInterval(fromDate, intervalType) {
    const d = new Date(fromDate);
    switch (intervalType) {
        case 'MONTHLY': d.setMonth(d.getMonth() + 1); break;
        case 'QUARTERLY': d.setMonth(d.getMonth() + 3); break;
        case 'BIANNUAL': d.setMonth(d.getMonth() + 6); break;
        case 'ANNUAL': d.setFullYear(d.getFullYear() + 1); break;
        default: d.setMonth(d.getMonth() + 1);
    }
    return d;
}

// Days of lead time before a contract's actual due date that its visit
// should already exist as a draft job in Activity Planner. The visit's own
// planned_date is still the REAL due date — this only controls how early
// the (unassigned) activity gets created, so a Team Lead has time to staff
// it before the day actually arrives.
const AMC_LEAD_TIME_DAYS = 2;

// Creates a real Activity for every AMC contract due within AMC_LEAD_TIME_DAYS,
// notifies Team Leads on WhatsApp, and rolls each processed schedule forward
// to its next interval. Each created activity is intentionally left
// unassigned (no lead_tech_id, no primaryEngineerId) — it lands in Activity
// Planner under Planned exactly like a manually-created draft, and a Team
// Lead picks the engineer and time from there, the same as any other
// activity. Runs automatically (see the interval timer below) — there is no
// "Process Due Now" button in the UI anymore, since nothing should depend
// on someone remembering to click it.
async function processAmcSchedules(actorContext) {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() + AMC_LEAD_TIME_DAYS);

    const { rows: due } = await pool.query(
        `SELECT * FROM recurring_schedules WHERE is_active = true AND next_due_date <= $1`,
        [cutoff.toISOString().slice(0, 10)]
    );

    const created = [];
    for (const s of due) {
        try {
            const activityId = await nextActivityId();
            const plannedDate = new Date(s.next_due_date);
            const [hh, mm] = (s.preferred_time || '09:00').split(':');
            plannedDate.setHours(parseInt(hh, 10) || 9, parseInt(mm, 10) || 0, 0, 0);

            await pool.query(
                `INSERT INTO activities (id, reference, type, priority, status, planned_date, customer_id, description, duration_hours, details, customer_name)
                 VALUES ($1,$2,$3,$4,'PLANNED',$5,$6,$7,$8,$9,$10)`,
                [
                    activityId, activityId, s.type || 'Maintenance', 'MEDIUM', plannedDate,
                    s.customer_id, s.notes || `AMC ${s.interval_type} visit`, 2,
                    JSON.stringify({ serviceCategory: s.category, amcScheduleId: s.id, customerName: s.customer_name }),
                    s.customer_name,
                ]
            );

            const nextDue = advanceInterval(s.next_due_date, s.interval_type);
            await pool.query(
                `UPDATE recurring_schedules SET last_scheduled_date = $1, next_due_date = $2, updated_at = now() WHERE id = $3`,
                [s.next_due_date, nextDue.toISOString().slice(0, 10), s.id]
            );

            await logAudit({ user: actorContext, ip: null }, {
                action: 'CREATE',
                entityType: 'ACTIVITY',
                entityId: activityId,
                entityLabel: s.customer_name,
                details: { source: 'AMC_SCHEDULE', scheduleId: s.id, type: s.type, dueDate: s.next_due_date },
            });

            created.push({ activityId, customerName: s.customer_name, scheduleId: s.id });
        } catch (e) {
            console.error('Failed to process recurring schedule', s.id, e.message);
        }
    }

    if (created.length > 0) {
        const lines = created.map(c => `• ${c.customerName} — ${c.activityId}`).join('\n');
        await notifyTeamLeads(`*AMC: ${created.length} upcoming visit${created.length > 1 ? 's' : ''} added to Activity Planner*\n${lines}`);
    }

    return created;
}

// Runs automatically — checks hourly for any contract now due within
// AMC_LEAD_TIME_DAYS. Hourly is more than precise enough for a 2-day lead
// window; this deliberately avoids adding a cron dependency for something
// this simple. Errors are caught and logged so one bad run can't crash the
// server or stop future runs.
// Note: this assumes a single backend instance (true for the current
// docker-compose setup, which runs no replicas). If this is ever scaled to
// multiple backend containers, two instances could both read the same
// overdue schedule before either commits its next_due_date update, creating
// a duplicate activity for the same visit — this is NOT safe to run
// concurrently as written. Scaling to multiple replicas would need a lock
// (e.g. a Postgres advisory lock around processAmcSchedules) or moving this
// to a single dedicated worker process instead of running in every replica.
const AMC_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
setInterval(() => {
    processAmcSchedules({ id: null, name: 'AMC Scheduler', role: 'SYSTEM' })
        .catch(e => console.error('Automatic AMC processing failed:', e.message));
}, AMC_CHECK_INTERVAL_MS);
// Also run once shortly after server start, so a restart doesn't mean
// waiting up to an hour before the first check happens.
setTimeout(() => {
    processAmcSchedules({ id: null, name: 'AMC Scheduler', role: 'SYSTEM' })
        .catch(e => console.error('Automatic AMC processing failed (startup run):', e.message));
}, 30 * 1000);

// Manual trigger — no longer surfaced in the UI (processing is automatic
// now), but left in place in case it's ever useful to trigger on demand
// without waiting for the hourly check.
app.post("/api/recurring-schedules/process", authenticate, writeRateLimit, async (req, res) => {
    try {
        const created = await processAmcSchedules(req.user);
        res.json({ ok: true, created: created.length, activities: created });
    } catch (e) {
        console.error('Recurring schedule process error:', e);
        res.status(500).json({ error: "Failed to process recurring schedules" });
    }
});

// ── App Settings ──────────────────────────────────────────────────────────
// Simple key/value store. GET is open to any authenticated user (the
// Google Review URL needs to be readable by Field Engineers completing a
// job, not just Admins), PUT is Admin only.
app.get("/api/settings/:key", authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT key, value, updated_at FROM app_settings WHERE key = $1', [req.params.key]);
        if (!rows[0]) return res.json({ key: req.params.key, value: null });
        res.json({ key: rows[0].key, value: rows[0].value, updatedAt: rows[0].updated_at });
    } catch (e) {
        console.error('Get setting error:', e);
        res.status(500).json({ error: 'Failed to load setting' });
    }
});

app.put("/api/settings/:key", authenticate, writeRateLimit, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only Admin can change settings' });
        }
        const { value } = req.body || {};

        // Specific validation for the Google Review URL setting — per spec,
        // must start with https://. Other settings (if any are added later)
        // aren't validated this strictly here; this check is deliberately
        // scoped to this one key rather than a generic "looks like a URL"
        // rule that might reject a future, differently-shaped setting.
        if (req.params.key === 'google_review_url' && value) {
            if (!/^https:\/\//i.test(value.trim())) {
                return res.status(400).json({ error: 'Google Review URL must start with https://' });
            }
        }

        const { rows } = await pool.query(
            `INSERT INTO app_settings (key, value, updated_by, updated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()
             RETURNING key, value, updated_at`,
            [req.params.key, value?.trim() || null, req.user.id]
        );

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'SYSTEM',
            entityId: req.params.key,
            entityLabel: `Setting: ${req.params.key}`,
            details: { value: rows[0].value },
        });

        res.json({ key: rows[0].key, value: rows[0].value, updatedAt: rows[0].updated_at });
    } catch (e) {
        console.error('Update setting error:', e);
        res.status(500).json({ error: 'Failed to save setting' });
    }
});

// ── Service Feedback (Completion Feedback & Google Review QR flow) ───────
// Submitted by a Field Engineer at job completion, before the job is
// allowed to finally close. Never blocks completion if this call fails —
// the calling frontend code treats this as best-effort, consistent with
// the spec's "do not break existing completion logic" requirement.
app.post("/api/service-feedback", authenticate, writeRateLimit, async (req, res) => {
    try {
        const { activityId, ticketId, engineerId, engineerName, customerName, rating, resolutionStatus, comment, googleReviewPromptShown, skipped, skipReason } = req.body || {};

        if (!activityId && !ticketId) {
            return res.status(400).json({ error: 'activityId or ticketId is required' });
        }

        // Not every customer is willing or available to rate the service —
        // this is the alternate path for that, separate from a real rating.
        // A skip still gets recorded (so Admin/Team Lead can see how often
        // and why it happens) but never blocks completion, never triggers a
        // follow-up alert (there's no quality signal to act on), and never
        // shows the Google review prompt.
        if (skipped) {
            const VALID_SKIP_REASONS = ['CUSTOMER_UNAVAILABLE', 'DECLINED', 'LANGUAGE_BARRIER', 'OTHER'];
            if (!VALID_SKIP_REASONS.includes(skipReason)) {
                return res.status(400).json({ error: 'skipReason must be one of ' + VALID_SKIP_REASONS.join(', ') });
            }

            const { rows } = await pool.query(
                `INSERT INTO service_feedback
                    (activity_id, ticket_id, engineer_id, engineer_name, customer_name, skipped, skip_reason, follow_up_required)
                 VALUES ($1,$2,$3,$4,$5,true,$6,false)
                 RETURNING *`,
                [activityId || null, ticketId || null, engineerId || null, engineerName || null, customerName || null, skipReason]
            );

            const f = rows[0];
            logAudit(req, {
                action: 'CREATE',
                entityType: 'SERVICE_FEEDBACK',
                entityId: String(f.id),
                entityLabel: f.customer_name || f.activity_id || f.ticket_id,
                details: { skipped: true, skipReason: f.skip_reason },
            });

            return res.status(201).json({
                id: f.id, activityId: f.activity_id, ticketId: f.ticket_id, engineerId: f.engineer_id,
                engineerName: f.engineer_name, customerName: f.customer_name, rating: null,
                resolutionStatus: null, comment: null, googleReviewPromptShown: false,
                followUpRequired: false, followUpResolved: f.follow_up_resolved,
                skipped: true, skipReason: f.skip_reason, createdAt: f.created_at,
            });
        }

        const ratingNum = Number(rating);
        if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({ error: 'rating must be between 1 and 5' });
        }
        // resolutionStatus ("was the work completed?") is now optional —
        // confirmed product decision: the feedback step only needs a star
        // rating plus an optional comment, since the extra required field
        // was part of why customers were stopping after the rating and
        // never reaching the actual Google review step. Still validated
        // if it IS provided, so a genuinely invalid value never sneaks in.
        const validResolutions = ['COMPLETED', 'PARTIALLY_COMPLETED', 'NOT_COMPLETED'];
        const resolutionStatusValue = resolutionStatus || null;
        if (resolutionStatusValue && !validResolutions.includes(resolutionStatusValue)) {
            return res.status(400).json({ error: 'resolutionStatus must be one of ' + validResolutions.join(', ') });
        }

        // Per spec alert rule: low rating still flags this for Team
        // Lead/Admin follow-up regardless of whether resolution_status was
        // provided. An explicitly incomplete resolution (when it IS
        // provided) also flags it — but its absence is no longer treated
        // as a problem in itself, since it's an optional field now.
        const followUpRequired = ratingNum <= 3
            || resolutionStatusValue === 'PARTIALLY_COMPLETED'
            || resolutionStatusValue === 'NOT_COMPLETED';

        const { rows } = await pool.query(
            `INSERT INTO service_feedback
                (activity_id, ticket_id, engineer_id, engineer_name, customer_name, rating, resolution_status, comment, google_review_prompt_shown, follow_up_required)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING *`,
            [
                activityId || null, ticketId || null, engineerId || null, engineerName || null,
                customerName || null, ratingNum, resolutionStatusValue, comment?.trim() || null,
                !!googleReviewPromptShown, followUpRequired,
            ]
        );

        const f = rows[0];
        logAudit(req, {
            action: 'CREATE',
            entityType: 'SERVICE_FEEDBACK',
            entityId: String(f.id),
            entityLabel: f.customer_name || f.activity_id || f.ticket_id,
            details: { rating: f.rating, resolutionStatus: f.resolution_status, followUpRequired: f.follow_up_required },
        });

        // Notify Team Leads when a follow-up is genuinely needed — same
        // pattern already used for new tickets / AMC visits.
        if (followUpRequired) {
            notifyTeamLeads(
                `*Service feedback needs follow-up*\n` +
                `${f.customer_name ? `Customer: ${f.customer_name}\n` : ''}` +
                `Engineer: ${f.engineer_name || 'Unknown'}\n` +
                `Rating: ${f.rating}/5 · ${f.resolution_status.replace(/_/g, ' ')}\n` +
                `${f.comment ? `Comment: ${f.comment}\n` : ''}` +
                `Ref: ${f.activity_id || f.ticket_id}`
            ).catch(() => {});
        }

        res.status(201).json({
            id: f.id, activityId: f.activity_id, ticketId: f.ticket_id, engineerId: f.engineer_id,
            engineerName: f.engineer_name, customerName: f.customer_name, rating: f.rating,
            resolutionStatus: f.resolution_status, comment: f.comment,
            googleReviewPromptShown: f.google_review_prompt_shown, followUpRequired: f.follow_up_required,
            followUpResolved: f.follow_up_resolved, skipped: false, skipReason: null, createdAt: f.created_at,
        });
    } catch (e) {
        console.error('Service feedback create error:', e);
        res.status(500).json({ error: 'Failed to save feedback' });
    }
});

// List feedback — Admin / Team Lead only, matches the spec's "Feedback /
// Service Quality" section. Supports an optional ?followUpOnly=true filter
// for the dashboard's alert view.
app.get("/api/service-feedback", authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN' && req.user.role !== 'TEAM_LEAD') {
            return res.status(403).json({ error: 'Only Admin or Team Lead can view service feedback' });
        }
        const followUpOnly = req.query.followUpOnly === 'true';
        const { rows } = await pool.query(
            `SELECT * FROM service_feedback
             ${followUpOnly ? 'WHERE follow_up_required = true AND follow_up_resolved = false' : ''}
             ORDER BY created_at DESC LIMIT 300`
        );
        res.json(rows.map(f => ({
            id: f.id, activityId: f.activity_id, ticketId: f.ticket_id, engineerId: f.engineer_id,
            engineerName: f.engineer_name, customerName: f.customer_name, rating: f.rating,
            resolutionStatus: f.resolution_status, comment: f.comment,
            googleReviewPromptShown: f.google_review_prompt_shown, followUpRequired: f.follow_up_required,
            followUpResolved: f.follow_up_resolved, skipped: f.skipped, skipReason: f.skip_reason, createdAt: f.created_at,
        })));
    } catch (e) {
        console.error('Service feedback list error:', e);
        res.status(500).json({ error: 'Failed to load feedback' });
    }
});

// Mark a flagged feedback's follow-up as resolved — Admin / Team Lead only.
app.put("/api/service-feedback/:id/resolve-followup", authenticate, writeRateLimit, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN' && req.user.role !== 'TEAM_LEAD') {
            return res.status(403).json({ error: 'Only Admin or Team Lead can resolve follow-ups' });
        }
        const { rows } = await pool.query(
            `UPDATE service_feedback SET follow_up_resolved = true WHERE id = $1 RETURNING id, customer_name, activity_id, ticket_id`,
            [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Feedback not found' });

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'SERVICE_FEEDBACK',
            entityId: String(rows[0].id),
            entityLabel: rows[0].customer_name || rows[0].activity_id || rows[0].ticket_id,
            details: { followUpResolved: true },
        });

        res.json({ ok: true });
    } catch (e) {
        console.error('Resolve followup error:', e);
        res.status(500).json({ error: 'Failed to resolve follow-up' });
    }
});

// Full detail for a single feedback entry — joins against the linked
// activity or ticket for context the feedback row itself doesn't store
// (service category, sales lead, technical associates). Falls back
// gracefully if the linked job no longer exists (e.g. a test activity that
// was itself deleted) — the feedback's own fields still display either way.
app.get("/api/service-feedback/:id", authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN' && req.user.role !== 'TEAM_LEAD') {
            return res.status(403).json({ error: 'Only Admin or Team Lead can view service feedback' });
        }
        const { rows } = await pool.query('SELECT * FROM service_feedback WHERE id = $1', [req.params.id]);
        const f = rows[0];
        if (!f) return res.status(404).json({ error: 'Feedback not found' });

        let serviceCategory = null, salesLeadName = null, assistantTechIds = [], assistantTechNames = [];
        if (f.activity_id) {
            const actRow = await pool.query('SELECT details FROM activities WHERE id = $1', [f.activity_id]);
            const d = actRow.rows[0]?.details || {};
            serviceCategory = d.serviceCategory || null;
            salesLeadName = d.salesLeadName || null;
            assistantTechIds = d.assistantTechIds || [];
            if (assistantTechIds.length > 0) {
                const techRows = await pool.query('SELECT id, name FROM users WHERE id = ANY($1)', [assistantTechIds]);
                assistantTechNames = techRows.rows.map(t => t.name);
            }
        } else if (f.ticket_id) {
            const tixRow = await pool.query('SELECT category FROM tickets WHERE id = $1', [f.ticket_id]);
            serviceCategory = tixRow.rows[0]?.category || null;
            // Tickets have no sales lead / technical associate concept — left null/empty.
        }

        res.json({
            id: f.id, activityId: f.activity_id, ticketId: f.ticket_id, engineerId: f.engineer_id,
            engineerName: f.engineer_name, customerName: f.customer_name, rating: f.rating,
            resolutionStatus: f.resolution_status, comment: f.comment,
            googleReviewPromptShown: f.google_review_prompt_shown, followUpRequired: f.follow_up_required,
            followUpResolved: f.follow_up_resolved, skipped: f.skipped, skipReason: f.skip_reason,
            createdAt: f.created_at, serviceCategory, salesLeadName, assistantTechNames,
        });
    } catch (e) {
        console.error('Service feedback detail error:', e);
        res.status(500).json({ error: 'Failed to load feedback detail' });
    }
});

// Admin-only hard delete — primarily for clearing out test entries created
// while verifying this feature. Permanently removes the row; there is no
// undo. Audit-logged before deletion so the record of who deleted what
// survives even though the feedback row itself doesn't.
app.delete("/api/service-feedback/:id", authenticate, deleteRateLimit, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only Admin can delete service feedback' });
        }
        const { rows } = await pool.query('SELECT id, customer_name, activity_id, ticket_id FROM service_feedback WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'Feedback not found' });

        await pool.query('DELETE FROM service_feedback WHERE id = $1', [req.params.id]);

        logAudit(req, {
            action: 'DELETE',
            entityType: 'SERVICE_FEEDBACK',
            entityId: String(rows[0].id),
            entityLabel: rows[0].customer_name || rows[0].activity_id || rows[0].ticket_id,
            details: {},
        });

        res.json({ ok: true });
    } catch (e) {
        console.error('Service feedback delete error:', e);
        res.status(500).json({ error: 'Failed to delete feedback' });
    }
});

// ── SLA Alerts ─────────────────────────────────────────────────────────────
// Real implementation — this endpoint previously didn't exist at all
// (the frontend's notification bell has always silently 404'd here,
// meaning it never once surfaced a real alert). Business rules confirmed
// directly:
//   - WARNING  at 48h since creation, still unresolved
//   - STALLED_72H at 72h since creation, still unresolved
//   - Excludes RESOLVED, CANCELLED, and CARRY_FORWARD (already actively
//     worked, not sitting untouched)
//   - Acknowledging is per-user only (sla_acknowledgements), not global —
//     it can still surface for a different Team Lead, and reappears for
//     everyone (including the acknowledger) if the SAME ticket later
//     escalates to a higher alert_type, since that's tracked as a
//     genuinely distinct row.
const SLA_WARNING_HOURS = 48;
const SLA_STALLED_HOURS = 72;
const SLA_EXCLUDED_STATUSES = ['RESOLVED', 'CANCELLED', 'CARRY_FORWARD'];

app.get("/api/sla/alerts", authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN' && req.user.role !== 'TEAM_LEAD') {
            return res.json({ allOverdue: [] }); // Other roles see no SLA panel at all in the UI; fail quiet, not an error.
        }

        const { rows: tickets } = await pool.query(
            `SELECT t.id, t.customer_name, t.category, t.status, t.created_at, t.assigned_tech_id, u.name AS assigned_tech_name
             FROM tickets t
             LEFT JOIN users u ON t.assigned_tech_id = u.id
             WHERE t.status NOT IN ('RESOLVED', 'CANCELLED', 'CARRY_FORWARD')
               AND t.created_at < NOW() - INTERVAL '${SLA_WARNING_HOURS} hours'`
        );

        const { rows: acked } = await pool.query(
            `SELECT ticket_id, alert_type FROM sla_acknowledgements WHERE acknowledged_by = $1`,
            [req.user.id]
        );
        const ackedSet = new Set(acked.map(a => `${a.ticket_id}::${a.alert_type}`));

        const now = Date.now();
        const allOverdue = tickets
            .map(t => {
                const hoursOpen = Math.floor((now - new Date(t.created_at).getTime()) / (1000 * 60 * 60));
                const alertType = hoursOpen >= SLA_STALLED_HOURS ? 'STALLED_72H' : 'WARNING';
                return {
                    ticketId: t.id,
                    customerName: t.customer_name,
                    category: t.category,
                    assignedTech: t.assigned_tech_name || 'Unassigned',
                    hoursOpen,
                    alertType,
                    alreadyAlerted: ackedSet.has(`${t.id}::${alertType}`),
                };
            })
            // Most urgent first — stalled before warning, then longest-open first.
            .sort((a, b) => {
                if (a.alertType !== b.alertType) return a.alertType === 'STALLED_72H' ? -1 : 1;
                return b.hoursOpen - a.hoursOpen;
            });

        res.json({ allOverdue });
    } catch (e) {
        console.error('SLA alerts error:', e);
        res.status(500).json({ error: 'Failed to load SLA alerts' });
    }
});

app.post("/api/sla/alerts/:ticketId/acknowledge", authenticate, writeRateLimit, async (req, res) => {
    try {
        // alertType isn't in the URL (the existing frontend only sends the
        // ticketId) — re-derive it the same way the GET above does, so the
        // acknowledgement is recorded against whichever alert level is
        // currently showing, not guessed.
        const { rows: tRows } = await pool.query('SELECT created_at FROM tickets WHERE id = $1', [req.params.ticketId]);
        if (!tRows[0]) return res.status(404).json({ error: 'Ticket not found' });
        const hoursOpen = Math.floor((Date.now() - new Date(tRows[0].created_at).getTime()) / (1000 * 60 * 60));
        const alertType = hoursOpen >= SLA_STALLED_HOURS ? 'STALLED_72H' : 'WARNING';

        await pool.query(
            `INSERT INTO sla_acknowledgements (ticket_id, alert_type, acknowledged_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (ticket_id, alert_type, acknowledged_by) DO NOTHING`,
            [req.params.ticketId, alertType, req.user.id]
        );

        res.json({ ok: true });
    } catch (e) {
        console.error('SLA acknowledge error:', e);
        res.status(500).json({ error: 'Failed to acknowledge alert' });
    }
});

// POST User (Create)
app.post("/api/users", authenticate, writeRateLimit, async (req, res) => {
    try {
        const { id, name, email, password, role, status, phone, job_role, level } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "name, email, and password are required" });
        }
        // SALES and TECHNICAL_ASSOCIATE don't need a system role — default to 'NONE'
        const finalRole = role || 'NONE';
        const hashedPass = await bcrypt.hash(password, 10);
        const userId = id || `u-${Date.now()}`;
        const { rows } = await pool.query(
            `INSERT INTO users (id, name, email, password, role, status, phone, job_role, level)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, name, email, role as "systemRole", status, phone, job_role, level`,
            [userId, name.trim(), email.trim(), hashedPass, finalRole, (status === 'AVAILABLE' ? 'ACTIVE' : (status || 'ACTIVE')), phone || null, job_role || null, level || null]
        );
        logAudit(req, {
            action: 'CREATE',
            entityType: 'USER',
            entityId: userId,
            entityLabel: name,
            details: { email, role: finalRole, level: level || undefined },
        });
        res.status(201).json(rows[0]);
    } catch (e) {
        console.error("User create error:", e);
        if (e.code === "23505") return res.status(409).json({ error: "Email already exists" });
        res.status(500).json({ error: "Failed to create user" });
    }
});

// PUT User (Update)
app.put("/api/users/:id", authenticate, writeRateLimit, async (req, res) => {
    try {
        const { name, email, password, role, status, phone, avatar, job_role, level } = req.body;
        const id = req.params.id;
        let hashedPass = null;
        if (password) {
            hashedPass = await bcrypt.hash(password, 10);
        }
        const before = await pool.query(
            `SELECT name, email, role as "systemRole", status, phone, avatar, job_role, level FROM users WHERE id = $1`,
            [id]
        );
        const { rows } = await pool.query(
            `UPDATE users SET
                name     = COALESCE($1, name),
                email    = COALESCE($2, email),
                password = COALESCE($3, password),
                role     = COALESCE($4, role),
                status   = COALESCE($5, status),
                phone    = COALESCE($6, phone),
                avatar   = COALESCE($7, avatar),
                job_role = COALESCE($9, job_role),
                level    = COALESCE($10, level)
             WHERE id = $8
             RETURNING id, name, email, role as "systemRole", status, phone, avatar, job_role, level`,
            [
                name ? name.trim() : null,
                email ? email.trim() : null,
                hashedPass,
                role || null,
                status ? (status === 'AVAILABLE' ? 'ACTIVE' : status) : null,
                phone || null,
                avatar || null,
                id,
                job_role || null,
                level    || null
            ]
        );
        if (!rows[0]) return res.status(404).json({ error: "User not found" });
        const r = rows[0];
        logAudit(req, {
            action: 'UPDATE',
            entityType: 'USER',
            entityId: id,
            entityLabel: r.name,
            details: {
                // Password is never part of the diff — even a hashed value
                // has no place in an audit log, hence the separate boolean.
                ...diffFields(before.rows[0] || {}, r),
                passwordChanged: !!password,
            },
        });
        res.json({
            ...r,
            isActive: r.status === 'ACTIVE',
            avatar: r.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name || 'U')}&background=random&color=fff&bold=true&size=128`
        });
    } catch (e) {
        console.error("User update error:", e);
        res.status(500).json({ error: "Failed to update user" });
    }
});

// DELETE User
// Change own password
app.put("/api/users/:id/password", authenticate, writeRateLimit, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const id = req.params.id;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: "Current and new password are required" });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: "New password must be at least 8 characters" });
        }

        // Verify current password
        const { rows } = await pool.query("SELECT password FROM users WHERE id = $1", [id]);
        if (!rows[0]) return res.status(404).json({ error: "User not found" });

        const isValid = await bcrypt.compare(currentPassword, rows[0].password);
        if (!isValid) return res.status(401).json({ error: "Current password is incorrect" });

        // Hash and save new password
        const hashedPass = await bcrypt.hash(newPassword, 10);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPass, id]);

        logAudit(req, {
            action: 'PASSWORD_CHANGE',
            entityType: 'USER',
            entityId: id,
            entityLabel: req.user?.name || id,
        });

        res.json({ ok: true, message: "Password changed successfully" });
    } catch (e) {
        console.error("Change password error:", e);
        res.status(500).json({ error: "Failed to change password" });
    }
});

app.delete("/api/users/:id", authenticate, deleteRateLimit, async (req, res) => {
    try {
        const existing = await pool.query("SELECT name, email FROM users WHERE id = $1", [req.params.id]);
        const r = await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
        if (r.rowCount === 0) return res.status(404).json({ error: "User not found" });
        logAudit(req, {
            action: 'DELETE',
            entityType: 'USER',
            entityId: req.params.id,
            entityLabel: existing.rows[0]?.name || req.params.id,
            details: { email: existing.rows[0]?.email || undefined },
        });
        res.json({ ok: true });
    } catch (e) {
        console.error("User delete error:", e);
        res.status(500).json({ error: "Failed to delete user" });
    }
});

// ==============================
// Operations & Planning (Teams, Sites, Activities)
// ==============================

// GET Teams
app.get("/api/teams", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM teams");
    res.json(rows.map(r => ({
        id: r.id, name: r.name, leadId: r.lead_id, memberIds: r.member_ids,
        status: r.status, currentSiteId: r.current_site_id, workloadLevel: r.workload_level
    })));
  } catch (e) { res.status(500).json({error: "Failed to load teams"}); }
});

// POST Team (Create)
app.post("/api/teams", authenticate, writeRateLimit, async (req, res) => {
    try {
        const { id, name, leadId, memberIds, status, currentSiteId, workloadLevel } = req.body;
        if (!name) return res.status(400).json({ error: "Team name is required" });
        const teamId = id || `team-${Date.now()}`;
        await pool.query(
            `INSERT INTO teams (id, name, lead_id, member_ids, status, current_site_id, workload_level)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                teamId,
                name.trim(),
                leadId || null,
                JSON.stringify(memberIds || []),
                status || "AVAILABLE",
                currentSiteId || null,
                workloadLevel || "LOW"
            ]
        );
        res.status(201).json({ id: teamId, name, leadId, memberIds: memberIds || [], status: status || "AVAILABLE", currentSiteId: currentSiteId || null, workloadLevel: workloadLevel || "LOW" });
    } catch (e) {
        console.error("Team create error:", e);
        res.status(500).json({ error: "Failed to create team" });
    }
});

// PUT Team (Update)
app.put("/api/teams/:id", authenticate, writeRateLimit, async (req, res) => {
    try {
        const { name, leadId, memberIds, status, currentSiteId, workloadLevel } = req.body;
        const id = req.params.id;
        const { rows } = await pool.query(
            `UPDATE teams SET
                name = COALESCE($1, name),
                lead_id = COALESCE($2, lead_id),
                member_ids = COALESCE($3, member_ids),
                status = COALESCE($4, status),
                current_site_id = COALESCE($5, current_site_id),
                workload_level = COALESCE($6, workload_level)
             WHERE id = $7
             RETURNING *`,
            [
                name ? name.trim() : null,
                leadId || null,
                memberIds ? JSON.stringify(memberIds) : null,
                status || null,
                currentSiteId || null,
                workloadLevel || null,
                id
            ]
        );
        if (!rows[0]) return res.status(404).json({ error: "Team not found" });
        const r = rows[0];
        res.json({ id: r.id, name: r.name, leadId: r.lead_id, memberIds: r.member_ids, status: r.status, currentSiteId: r.current_site_id, workloadLevel: r.workload_level });
    } catch (e) {
        console.error("Team update error:", e);
        res.status(500).json({ error: "Failed to update team" });
    }
});

// DELETE Team
app.delete("/api/teams/:id", authenticate, deleteRateLimit, async (req, res) => {
    try {
        const r = await pool.query("DELETE FROM teams WHERE id = $1", [req.params.id]);
        if (r.rowCount === 0) return res.status(404).json({ error: "Team not found" });
        res.json({ ok: true });
    } catch (e) {
        console.error("Team delete error:", e);
        res.status(500).json({ error: "Failed to delete team" });
    }
});

// GET Sites
app.get("/api/sites", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM sites");
    res.json(rows.map(r => ({
        id: r.id, name: r.name, clientName: r.client_name, location: r.location,
        priority: r.priority, status: r.status, assignedTeamId: r.assigned_team_id
    })));
  } catch (e) { res.status(500).json({error: "Failed to load sites"}); }
});

// GET Activities
// Get full activity with photos (for detail view only)
app.get("/api/activities/:id/full", authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM activities WHERE id = $1", [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: "Not found" });
        res.json(mapActivity(rows[0]));
    } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.get("/api/activities", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, reference, type, priority, status, planned_date, customer_id, customer_name,
                customer_phone, site_id, lead_tech_id, description, duration_hours,
                details, started_at, completed_at, visit_history, created_at, updated_at FROM activities WHERE type != 'WHATSAPP_SUPPORT' ORDER BY created_at DESC LIMIT 200`);
    res.json(rows.map(mapActivityLite));
  } catch (e) { res.status(500).json({error: "Failed to load activities"}); }
});

// POST Activity (Create)
app.post("/api/activities", authenticate, writeRateLimit, async (req, res) => {
    try {
        let { id, reference, type, priority, status, plannedDate, customerId, siteId, leadTechId, description, durationHours, ...details } = req.body;
        // Server controls timestamps — remove from client-sent details
        delete details.startedAt; delete details.completedAt; delete details.createdAt; delete details.updatedAt;
        // Remove timestamp fields — server controls these
        delete details.startedAt;
        delete details.completedAt;
        delete details.createdAt;
        delete details.updatedAt;
        
        if (!type) {
            return res.status(400).json({ error: "Activity type is required" });
        }
        
        // Server always generates the canonical ID — never trust client-provided IDs.
        // This prevents temp/optimistic client IDs from leaking into the database
        // and eliminates race conditions when the user acts before the sync completes.
        id = await nextActivityId();
        reference = id;
        
        await pool.query(
            `INSERT INTO activities (id, reference, type, priority, status, planned_date, customer_id, site_id, lead_tech_id, description, duration_hours, details, customer_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [id, reference || id, type, priority || 'MEDIUM', status || 'PLANNED', plannedDate, customerId || null, siteId || null, leadTechId || null, description || '', durationHours || 2, JSON.stringify(details || {}),
             details?.customerName || (customerId ? ((await pool.query('SELECT name FROM customers WHERE id=$1 LIMIT 1', [customerId]).catch(()=>({rows:[]}))).rows[0]?.name || '') : '')]
        );
        logAudit(req, {
            action: 'CREATE',
            entityType: 'ACTIVITY',
            entityId: id,
            entityLabel: details?.customerName || id,
            details: { type, status: status || 'PLANNED' },
        });
        res.status(201).json({ok: true, id});
    } catch(e) { console.error('Activity creation error:', e.message, e.detail || ''); res.status(500).json({error: "Failed to create activity", detail: e.message}); }
});

// PUT Activity (Update)
app.put("/api/activities/:id", authenticate, writeRateLimit, async (req, res) => {
    try {
        const { type, priority, status, plannedDate, customerId, siteId, leadTechId, description, durationHours, primaryEngineerId, supportingEngineerIds, ...details } = req.body;
        // Save admin-provided timestamps BEFORE deleting from details
        const adminStartedAt = req.body.startedAt || null;
        const adminCompletedAt = req.body.completedAt || null;
        // Remove timestamp fields from details JSONB — timestamps go in dedicated columns
        delete details.startedAt;
        delete details.completedAt;
        delete details.createdAt;
        delete details.updatedAt;

        // Fetch current row to detect transitions and merge details
        const current = await pool.query("SELECT type, priority, status, started_at, completed_at, details, visit_history, planned_date, lead_tech_id, customer_id, description, duration_hours FROM activities WHERE id=$1", [req.params.id]);
        if (!current.rows[0]) return res.status(404).json({ error: "Activity not found" });
        const prevStatus = current.rows[0]?.status;
        const alreadyStarted = current.rows[0]?.started_at;
        const existingDetails = current.rows[0]?.details || {};
        const existingHistory = current.rows[0]?.visit_history || [];
        // PROTECT: Always use existing customer_id — never overwrite from status updates
        const safeCustomerId = current.rows[0].customer_id;

        // Merge execution fields into details JSONB
        const mergedDetails = { ...existingDetails, ...details };
        // ALWAYS overwrite team assignments — even if null/empty (to clear old members)
        mergedDetails.primaryEngineerId = primaryEngineerId || null;
        if (supportingEngineerIds !== undefined) {
            mergedDetails.supportingEngineerIds = supportingEngineerIds || [];
        }
        // Validate freelancers array if present
        if (mergedDetails.freelancers && Array.isArray(mergedDetails.freelancers)) {
            mergedDetails.freelancers = mergedDetails.freelancers
                .filter(f => f && typeof f.name === 'string' && f.name.trim())
                .map(f => ({
                    name: f.name.trim(),
                    role: ['FIELD_ENGINEER','TECHNICAL_ASSOCIATE'].includes(f.role) ? f.role : 'TECHNICAL_ASSOCIATE',
                    phone: f.phone ? String(f.phone).trim() : ''
                }));
        }

        // ── CARRY FORWARD HANDLING ──
        // When status is CARRY_FORWARD: record current visit in history, mark as CARRY_FORWARD on original date,
        // then the frontend will create a NEW activity for the rescheduled date
        if (status === 'CARRY_FORWARD' && prevStatus !== 'CARRY_FORWARD') {
            // Build visit record from current state
            const visitRecord = {
                date: current.rows[0].planned_date,
                startedAt: current.rows[0].started_at || null,
                completedAt: new Date().toISOString(),
                assignedTeam: {
                    leadTechId: current.rows[0].lead_tech_id || leadTechId,
                    primaryEngineerId: existingDetails.primaryEngineerId || primaryEngineerId,
                    supportingEngineerIds: existingDetails.supportingEngineerIds || supportingEngineerIds || [],
                    assistantTechIds: existingDetails.assistantTechIds || [],
                    freelancers: existingDetails.freelancers || []
                },
                remarks: mergedDetails.currentVisitRemark || mergedDetails.remarks || details.remarks || '',
                carryForwardReason: mergedDetails.carryForwardNote || details.carryForwardNote || '',
                completionNote: mergedDetails.completionNote || '',
                status: 'CARRY_FORWARD'
            };
            const updatedHistory = [...existingHistory, visitRecord];

            // IMPORTANT: planned_date stays as the ORIGINAL visit date — never overwrite with nextPlannedAt.
            // The next visit date lives only in details.nextPlannedAt so the calendar shows
            // this activity on its original day as CARRY_FORWARD (orange), not the future date.
            // Store nextPlannedAt from the request into mergedDetails if provided.
            if (details.nextPlannedAt) {
                mergedDetails.nextPlannedAt = details.nextPlannedAt;
            }
            await pool.query(
                `UPDATE activities SET type=$1, priority=$2, status='CARRY_FORWARD', planned_date=$3, customer_id=COALESCE($4, customer_id), site_id=$5, lead_tech_id=$6, description=$7, duration_hours=$8, details=$9, visit_history=$10, updated_at=NOW(), completed_at=NOW(), started_at=NULL WHERE id=$11`,
                [type, priority, current.rows[0].planned_date, safeCustomerId, siteId, leadTechId, description, durationHours, JSON.stringify(mergedDetails), JSON.stringify(updatedHistory), req.params.id]
            );
            logAudit(req, {
                action: 'STATUS_CHANGE',
                entityType: 'ACTIVITY',
                entityId: req.params.id,
                entityLabel: mergedDetails.customerName || req.params.id,
                details: { from: prevStatus, to: 'CARRY_FORWARD', carryForwardNote: visitRecord.carryForwardReason || undefined, nextPlannedAt: mergedDetails.nextPlannedAt || undefined },
            });
            return res.json({ok: true, visitRecorded: true});
        }

        // ── NORMAL STATUS TRANSITIONS (fully parameterized — no string interpolation) ──
        // Build SET clause and params array together to avoid SQL injection in timestamps
        const baseParams = [
            type, priority, status, plannedDate,
            safeCustomerId, siteId, leadTechId,
            description, durationHours,
            JSON.stringify(mergedDetails)
        ];
        let extraClauses = '';
        const extraParams = [];

        // Admin-provided startedAt (explicit override) — always parameterized
        if (adminStartedAt) {
            extraParams.push(new Date(adminStartedAt).toISOString());
            extraClauses += `, started_at = $${baseParams.length + extraParams.length}`;
        } else if (
            ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'].includes(status) &&
            !['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'].includes(prevStatus)
        ) {
            // A job entering active execution for the first time (from PLANNED or
            // CARRY_FORWARD) gets a fresh started_at right now. Previously this
            // only fired when status became IN_PROGRESS specifically — so a job
            // that went CARRY_FORWARD → ON_MY_WAY → ARRIVED kept its OLD started_at
            // from before the carry-forward all the way through those two states,
            // which is why the Operations Monitor timeline showed a stale start
            // time (or fell back to a hardcoded 08:00) until it finally reached
            // IN_PROGRESS. Resetting on the first active-state transition means
            // the displayed start time is always the real, current one.
            extraClauses += ', started_at = NOW()';
        }

        // Admin-provided completedAt (explicit override) — always parameterized
        if (adminCompletedAt) {
            extraParams.push(new Date(adminCompletedAt).toISOString());
            extraClauses += `, completed_at = $${baseParams.length + extraParams.length}`;
        } else if (status === 'DONE' && prevStatus !== 'DONE') {
            extraClauses += ', completed_at = NOW()';
            // Record completed visit in history — parameterized jsonb
            const visitRecord = {
                date: current.rows[0].planned_date || plannedDate,
                startedAt: current.rows[0].started_at || null,
                completedAt: new Date().toISOString(),
                assignedTeam: {
                    leadTechId: leadTechId || current.rows[0].lead_tech_id,
                    primaryEngineerId: mergedDetails.primaryEngineerId || primaryEngineerId,
                    supportingEngineerIds: mergedDetails.supportingEngineerIds || [],
                    freelancers: mergedDetails.freelancers || []
                },
                remarks: mergedDetails.remarks || details.remarks || mergedDetails.completionNote || '',
                status: 'DONE'
            };
            const updatedHistory = [...existingHistory, visitRecord];
            extraParams.push(JSON.stringify(updatedHistory));
            extraClauses += `, visit_history = $${baseParams.length + extraParams.length}::jsonb`;
        }

        // Only clear timestamps when EXPLICITLY rescheduling (prevStatus was not PLANNED).
        // IMPORTANT: We do NOT wipe data when an admin edits a PLANNED activity normally.
        if (status === 'PLANNED' && prevStatus !== 'PLANNED') {
            // Rescheduling back to planned — clear execution timestamps only
            extraClauses += ', started_at = NULL, completed_at = NULL';
        }
        if (status === 'CANCELLED') {
            extraClauses += ', started_at = NULL, completed_at = NULL';
            delete mergedDetails.primaryEngineerId;
            delete mergedDetails.supportingEngineerIds;
            // Re-apply mergedDetails since we mutated it after setting baseParams
            baseParams[9] = JSON.stringify(mergedDetails);
        }

        // id is always the last param
        const allParams = [...baseParams, ...extraParams, req.params.id];
        const idParam = `$${allParams.length}`;

        // Handle cancellationReason for cancelled activities
        const cancellationReason = req.body.cancellationReason || mergedDetails.cancellationReason || null;
        const visitHistory = req.body.visitHistory
            ? JSON.stringify(req.body.visitHistory)
            : (mergedDetails.visitHistory ? JSON.stringify(mergedDetails.visitHistory) : null);
        const visitHistoryClause = visitHistory ? `, visit_history = $${allParams.length + 1}::jsonb` : '';
        const cancelClause = cancellationReason ? `, cancellation_reason = $${allParams.length + (visitHistory ? 2 : 1)}` : '';
        if (visitHistory) allParams.push(visitHistory);
        if (cancellationReason) allParams.push(cancellationReason);

        await pool.query(
            `UPDATE activities SET type=$1, priority=$2, status=$3, planned_date=$4, customer_id=COALESCE($5, customer_id), site_id=$6, lead_tech_id=$7, description=$8, duration_hours=$9, details=$10, updated_at=NOW()${extraClauses}${visitHistoryClause}${cancelClause} WHERE id=${idParam}`,
            allParams
        );

        logAudit(req, {
            action: prevStatus !== status ? 'STATUS_CHANGE' : 'UPDATE',
            entityType: 'ACTIVITY',
            entityId: req.params.id,
            entityLabel: mergedDetails.customerName || req.params.id,
            details: prevStatus !== status
                ? { from: prevStatus, to: status }
                // Diff the row's own columns plus everything inside details,
                // before vs. after — see diffFields() for why this replaced
                // a plain list of touched field names.
                : diffFields(
                    { type: current.rows[0].type, priority: current.rows[0].priority, description: current.rows[0].description, durationHours: current.rows[0].duration_hours, plannedDate: current.rows[0].planned_date, leadTechId: current.rows[0].lead_tech_id, ...existingDetails },
                    { type, priority, description, durationHours, plannedDate, leadTechId, ...mergedDetails }
                  ),
        });

        // ── SAR Sync: if this activity was created from a Sales Appointment Request,
        // keep the SAR status in sync with activity progress ──────────────────────
        const salesRequestId = mergedDetails.salesRequestId || details.salesRequestId;
        if (salesRequestId) {
            let sarStatus = null;
            if (status === 'IN_PROGRESS' || status === 'ON_MY_WAY' || status === 'ARRIVED') {
                sarStatus = 'IN_PROGRESS';
            } else if (status === 'DONE') {
                sarStatus = 'COMPLETED';
            } else if (status === 'CANCELLED') {
                sarStatus = 'CANCELLED';
            } else if (status === 'PLANNED' || status === 'CARRY_FORWARD') {
                sarStatus = 'SCHEDULED'; // back to scheduled if rescheduled
            }
            if (sarStatus) {
                await pool.query(
                    `UPDATE sales_appointment_requests SET status = $1, updated_at = NOW() WHERE id = $2`,
                    [sarStatus, salesRequestId]
                ).catch(e => console.error('SAR sync failed (non-critical):', e.message));
            }
        }

        res.json({ok: true});
    } catch(e) { console.error(e); res.status(500).json({error: "Failed to update activity"}); }
});

// DELETE Activity
app.delete("/api/activities/:id", authenticate, deleteRateLimit, async (req, res) => {
    try {
        const existing = await pool.query("SELECT customer_name FROM activities WHERE id=$1", [req.params.id]);
        await pool.query("DELETE FROM activities WHERE id=$1", [req.params.id]);
        logAudit(req, {
            action: 'DELETE',
            entityType: 'ACTIVITY',
            entityId: req.params.id,
            entityLabel: existing.rows[0]?.customer_name || req.params.id,
        });
        res.json({ok: true});
    } catch(e) { res.status(500).json({error: "Failed to delete activity"}); }
});

// ==============================
// Intent Detection
// ==============================
async function detectIntent(message, model) {
  // Maps URL = location sharing = SUPPORT
  if (message.match(/https?:\/\//i) && message.match(/maps|goo\.gl|google\.com/i)) return "SUPPORT";
  // Villa/building number = SUPPORT
  if (/^(villa|building|flat|block|house)?\s*\d+/i.test(message.trim())) return "SUPPORT";
  try {

    const intentPrompt = `
You are an AI classifier for the Qonnect WhatsApp Support Bot.

Classify the customer message into ONE of the following intents:

SUPPORT
Customer reporting a technical issue.

Examples:
wifi not working
camera offline
internet slow
automation not responding

TICKET_FOLLOWUP
Customer asking about technician visit or status of existing request.

Examples:
where is technician
any update
no one came
technician coming today

SALES
Customer asking about price, quotation, installation, or packages.

Examples:
camera price
intercom package
wifi installation
home automation price

GENERAL
Greeting or acknowledgement.

Examples:
hi
hello
ok
thanks

Respond ONLY with JSON.

Example:
{
 "intent": "SUPPORT"
}
`;

    const prompt = intentPrompt + `

Customer message:
"${message}"

Return JSON only.
`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return "GENERAL";
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed.intent || "GENERAL";

  } catch (err) {
    console.error("Intent detection error:", err);
    return "GENERAL";
  }
}

// ==============================
// Sales Appointment Requests
// ==============================

/* ── Helper: map DB row → API shape ── */
function mapSAR(r) {
    return {
        id:                       r.id,
        customerId:               r.customer_id,
        customerName:             r.customer_name,
        contactNumber:            r.contact_number,
        locationUrl:              r.location_url,
        houseNumber:              r.house_number,
        odooReference:            r.odoo_reference,
        activityType:             r.activity_type,
        serviceCategory:          r.service_category,
        salesLeadUserId:          r.sales_lead_user_id,
        salesLeadName:            r.sales_lead_name,
        remarks:                  r.remarks,
        status:                   r.status,
        scheduledDate:            r.scheduled_date ? r.scheduled_date.toISOString().slice(0, 10) : null,
        scheduledStartTime:       r.scheduled_start_time,
        scheduledEndTime:         r.scheduled_end_time,
        assignedFieldEngineerId:  r.assigned_field_engineer_id,
        linkedActivityId:         r.linked_activity_id,
        // SAR → existing-activity link metadata (rebuilt per spec)
        linkNote:                 r.link_note || null,
        linkedBy:                 r.linked_by || null,
        linkedAt:                 r.linked_at || null,
        createdBy:                r.created_by,
        updatedBy:                r.updated_by,
        createdAt:                r.created_at,
        updatedAt:                r.updated_at,
    };
}

// Pulls the numeric Odoo CRM deal ID out of a reference URL, e.g.
// "https://qonnect.qa/odoo/crm/1119/sales/684" → "1119". Used as a last-
// resort fallback match when a SAR has no customer_id AND no usable phone
// number — two records pointing at the same Odoo deal are almost certainly
// the same real-world job, even if nothing else lines up.
function extractOdooDealId(url) {
    if (!url) return null;
    const m = String(url).match(/\/crm\/(\d+)/);
    return m ? m[1] : null;
}

function normalizePhoneForMatch(phone) {
    if (!phone) return '';
    return String(phone).replace(/[^0-9+]/g, '');
}

// ── GET /api/sales-appointment-requests/:id/matching-activities ──────────
// TEAM_LEAD / ADMIN only. Finds activities for the same client as this SAR,
// within a 7-day window, that the SAR could reasonably be linked to instead
// of spawning a duplicate job.
//
// Matching order (per spec — client ID first, fallback only if missing):
//   1. customer_id — exact match, if the SAR has one.
//   2. normalized contact number — fallback if customer_id is missing/null.
//   3. Odoo deal ID extracted from the reference URL — last-resort fallback,
//      only tried if neither of the above is available.
//
// Status + date window (per spec):
//   - PLANNED / SCHEDULED — only if planned within the next 7 days.
//   - CARRY_FORWARD / IN_PROGRESS — always included regardless of date
//     (these are inherently "happening now", not something with a future
//     due date to be within a window of).
//   - DONE / COMPLETED — only if completed within the last 7 days.
//   - CANCELLED — never included, per spec rule #8.
app.get('/api/sales-appointment-requests/:id/matching-activities', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'TEAM_LEAD' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only Team Lead or Admin can view matching activities' });
        }

        const sarRow = await pool.query('SELECT * FROM sales_appointment_requests WHERE id = $1', [req.params.id]);
        if (!sarRow.rows[0]) return res.status(404).json({ error: 'Request not found' });
        const sar = sarRow.rows[0];

        let rows = [];
        let matchedBy = null;

        // Per spec rule #5, the fallback chain is meant for when customer_id
        // is missing — but it's deliberately also used when customer_id IS
        // present but returns zero matches, since a phone-number fallback
        // can still genuinely find the right activity (e.g. a duplicate or
        // differently-linked customer record with the same real phone). This
        // only ever adds more genuine candidates, never produces a false one.
        if (sar.customer_id) {
            matchedBy = 'customerId';
            const r = await pool.query(
                `SELECT a.*, c.name AS customer_name, c.phone AS customer_phone
                 FROM activities a
                 LEFT JOIN customers c ON a.customer_id = c.id
                 WHERE a.customer_id = $1`,
                [sar.customer_id]
            );
            rows = r.rows;
        }

        if (rows.length === 0) {
            const normPhone = normalizePhoneForMatch(sar.contact_number);
            if (normPhone) {
                matchedBy = 'contactNumber';
                const r = await pool.query(
                    `SELECT a.*, c.name AS customer_name, c.phone AS customer_phone
                     FROM activities a
                     LEFT JOIN customers c ON a.customer_id = c.id
                     WHERE REGEXP_REPLACE(COALESCE(c.phone, ''), '[^0-9+]', '', 'g') = $1`,
                    [normPhone]
                );
                rows = r.rows;
            }
        }

        if (rows.length === 0) {
            const dealId = extractOdooDealId(sar.odoo_reference);
            if (dealId) {
                matchedBy = 'odooReference';
                // odoo_link is stored as a plain TEXT column on activities,
                // not inside details, so this can be matched directly.
                const r = await pool.query(
                    `SELECT a.*, c.name AS customer_name, c.phone AS customer_phone
                     FROM activities a
                     LEFT JOIN customers c ON a.customer_id = c.id
                     WHERE a.odoo_link LIKE $1`,
                    [`%/crm/${dealId}%`]
                );
                rows = r.rows;
            }
        }

        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
        const sevenDaysAhead = new Date(now.getTime() + 7 * 86400000);

        const ALLOWED_STATUSES = ['PLANNED', 'SCHEDULED', 'CARRY_FORWARD', 'IN_PROGRESS', 'DONE', 'COMPLETED'];

        const matches = rows
            .filter(a => {
                if (!ALLOWED_STATUSES.includes(a.status)) return false; // also excludes CANCELLED implicitly
                if (a.status === 'CARRY_FORWARD' || a.status === 'IN_PROGRESS') return true;
                if (a.status === 'PLANNED' || a.status === 'SCHEDULED') {
                    if (!a.planned_date) return false;
                    const pd = new Date(a.planned_date);
                    return pd >= now && pd <= sevenDaysAhead;
                }
                if (a.status === 'DONE' || a.status === 'COMPLETED') {
                    const completedAt = a.completed_at ? new Date(a.completed_at) : null;
                    if (!completedAt) return false;
                    return completedAt >= sevenDaysAgo && completedAt <= now;
                }
                return false;
            })
            .map(a => {
                const d = a.details || {};
                return {
                    activityId: a.id,
                    reference: a.reference || a.id,
                    customerName: a.customer_name || d.customerName || '',
                    contactNumber: a.customer_phone || d.customerPhone || '',
                    plannedDate: a.planned_date,
                    completedAt: a.completed_at,
                    status: a.status,
                    assignedEngineerId: a.lead_tech_id || d.primaryEngineerId || null,
                    activityType: a.type,
                    serviceCategory: d.serviceCategory || null,
                    carryForwardNote: a.carry_forward_note || d.carryForwardNote || null,
                };
            })
            .sort((x, y) => new Date(y.completedAt || y.plannedDate || 0).getTime() - new Date(x.completedAt || x.plannedDate || 0).getTime())
            .slice(0, 10);

        res.json({ matches, matchedBy, withinSevenDays: matches.length > 0 });
    } catch (e) {
        console.error('Matching activities error:', e);
        res.status(500).json({ error: 'Failed to load matching activities' });
    }
});

// ── POST /api/sales-appointment-requests/:id/link-activity ───────────────
// TEAM_LEAD / ADMIN only. Links a SAR to an existing activity instead of
// creating a new one. Requires a mandatory internal note. Does not touch
// the activity's own scheduling fields — linking is a lightweight
// "these two things are related" action; if the activity also needs new
// scope folded into it, that happens separately via the normal activity
// edit flow, not as a side effect of this endpoint.
app.post('/api/sales-appointment-requests/:id/link-activity', authenticate, writeRateLimit, async (req, res) => {
    try {
        if (req.user.role !== 'TEAM_LEAD' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only Team Lead or Admin can link a request to an existing activity' });
        }

        const { id } = req.params;
        const { activityId, linkNote } = req.body || {};

        if (!activityId) return res.status(400).json({ error: 'activityId is required' });
        if (!linkNote || !String(linkNote).trim()) return res.status(400).json({ error: 'An internal note is required to link this request' });

        const sarRow = await pool.query('SELECT * FROM sales_appointment_requests WHERE id = $1', [id]);
        if (!sarRow.rows[0]) return res.status(404).json({ error: 'Request not found' });
        const sar = sarRow.rows[0];

        if (sar.status === 'LINKED') return res.status(409).json({ error: 'This request is already linked to an activity' });
        if (sar.status === 'SCHEDULED' || sar.status === 'COMPLETED') {
            return res.status(409).json({ error: 'This request has already been scheduled as its own activity — unschedule it first if you want to link it instead' });
        }
        if (sar.status === 'SCHEDULING') {
            return res.status(409).json({ error: 'This request is currently being scheduled — please try again in a moment' });
        }

        const actRow = await pool.query('SELECT id FROM activities WHERE id = $1', [activityId]);
        if (!actRow.rows[0]) return res.status(404).json({ error: 'Activity not found' });

        const updated = await pool.query(
            `UPDATE sales_appointment_requests SET
                linked_activity_id = $1,
                link_note          = $2,
                linked_by          = $3,
                linked_at          = now(),
                status             = 'LINKED',
                updated_by         = $3,
                updated_at         = now()
             WHERE id = $4
             RETURNING *`,
            [activityId, String(linkNote).trim(), req.user.id, id]
        );

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'SALES_REQUEST',
            entityId: id,
            entityLabel: sar.customer_name,
            details: { linkedActivityId: activityId, linkNote: String(linkNote).trim() },
        });
        logAudit(req, {
            action: 'UPDATE',
            entityType: 'ACTIVITY',
            entityId: activityId,
            entityLabel: sar.customer_name,
            details: { linkedSalesRequestId: id, reason: 'Sales Appointment Request linked instead of creating a duplicate activity' },
        });

        res.json({ ok: true, request: mapSAR(updated.rows[0]) });
    } catch (e) {
        console.error('Link activity error:', e);
        res.status(500).json({ error: 'Failed to link request to activity' });
    }
});

// ── POST /api/sales-appointment-requests/:id/unlink-activity ─────────────
// TEAM_LEAD / ADMIN only. Reverses a link, putting the SAR back to
// PENDING_SCHEDULING so it can be scheduled as its own new activity instead
// — referenced directly by the schedule endpoint's guard message above.
// Does not touch or delete the activity that was linked; only clears the
// SAR's own link fields.
app.post('/api/sales-appointment-requests/:id/unlink-activity', authenticate, writeRateLimit, async (req, res) => {
    try {
        if (req.user.role !== 'TEAM_LEAD' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only Team Lead or Admin can unlink a request' });
        }

        const { id } = req.params;
        const sarRow = await pool.query('SELECT * FROM sales_appointment_requests WHERE id = $1', [id]);
        if (!sarRow.rows[0]) return res.status(404).json({ error: 'Request not found' });
        const sar = sarRow.rows[0];

        if (sar.status !== 'LINKED') return res.status(409).json({ error: 'This request is not currently linked' });

        const previousActivityId = sar.linked_activity_id;
        const updated = await pool.query(
            `UPDATE sales_appointment_requests SET
                linked_activity_id = NULL,
                link_note          = NULL,
                linked_by          = NULL,
                linked_at          = NULL,
                status             = 'PENDING_SCHEDULING',
                updated_by         = $1,
                updated_at         = now()
             WHERE id = $2
             RETURNING *`,
            [req.user.id, id]
        );

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'SALES_REQUEST',
            entityId: id,
            entityLabel: sar.customer_name,
            details: { unlinkedFromActivityId: previousActivityId },
        });

        res.json({ ok: true, request: mapSAR(updated.rows[0]) });
    } catch (e) {
        console.error('Unlink activity error:', e);
        res.status(500).json({ error: 'Failed to unlink request' });
    }
});

/* ── GET /api/sales-appointment-requests/check-existing-job ── */
// Non-blocking heads-up check: given a phone number, does this customer
// already have an open job (Planned/Carry Forward/In Progress) or a job
// completed in the last 7 days? Used by the Sales Appointment Request
// creation form so Sales — who has no visibility into field work — finds
// out a customer was just serviced or already has pending work, instead
// of unknowingly creating a duplicate request for the same scope.
//
// This never blocks creation; it's purely informational. The actual
// decision to link a new request to an existing job happens later, when a
// Team Lead schedules it (see the `linkedActivityId` field on SAR PUT).
app.get('/api/sales-appointment-requests/check-existing-job', authenticate, async (req, res) => {
    try {
        const rawPhone = String(req.query.phone || '').trim();
        if (!rawPhone) return res.json({ matches: [] });

        // Same normalisation used when a SAR is created, so the lookup
        // matches however the number was actually stored.
        let normPhone = rawPhone.replace(/[\s\-]/g, '');
        if (/^[0-9]{8}$/.test(normPhone)) normPhone = `+974${normPhone}`;
        else if (/^974[0-9]{8}$/.test(normPhone)) normPhone = `+${normPhone}`;
        else if (normPhone.startsWith('00974')) normPhone = `+974${normPhone.slice(5)}`;

        const { rows } = await pool.query(
            `SELECT a.id, a.type, a.status, a.planned_date, a.completed_at, a.carry_forward_note, a.details
             FROM activities a
             JOIN customers c ON a.customer_id = c.id
             WHERE REGEXP_REPLACE(c.phone, '[^0-9+]', '', 'g') = REGEXP_REPLACE($1, '[^0-9+]', '', 'g')
               AND (
                 a.status IN ('PLANNED', 'CARRY_FORWARD', 'IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED')
                 OR (a.status = 'DONE' AND a.completed_at > NOW() - INTERVAL '7 days')
               )
             ORDER BY COALESCE(a.completed_at, a.planned_date) DESC
             LIMIT 5`,
            [normPhone]
        );

        res.json({
            matches: rows.map(r => ({
                activityId: r.id,
                type: r.type,
                status: r.status,
                plannedDate: r.planned_date,
                completedAt: r.completed_at,
                carryForwardNote: r.carry_forward_note || (r.details || {}).carryForwardNote || null,
                serviceCategory: (r.details || {}).serviceCategory || null,
            })),
        });
    } catch (e) {
        console.error('Check existing job error:', e);
        // Non-critical lookup — fail soft so it never blocks SAR creation.
        res.json({ matches: [] });
    }
});

/* ── GET /api/sales-appointment-requests ── */
app.get('/api/sales-appointment-requests', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM sales_appointment_requests ORDER BY created_at DESC LIMIT 500`
        );
        res.json(rows.map(mapSAR));
    } catch (e) {
        console.error('SAR GET error:', e);
        res.status(500).json({ error: 'Failed to fetch sales appointment requests' });
    }
});

/* ── GET /api/dashboard/pending-sales-requests ── */
app.get('/api/dashboard/pending-sales-requests', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM sales_appointment_requests WHERE status = 'PENDING_SCHEDULING' ORDER BY created_at DESC LIMIT 20`
        );
        res.json({ count: rows.length, requests: rows.map(mapSAR) });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch pending requests' });
    }
});

/* ── POST /api/sales-appointment-requests ── */
app.post('/api/sales-appointment-requests', authenticate, writeRateLimit, async (req, res) => {
    try {
        const role = req.user.role;
        const userId = req.user.id;

        // Determine caller identity
        const userRow = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
        if (!userRow.rows[0]) return res.status(401).json({ error: 'User not found' });
        const userName = userRow.rows[0].name;

        const {
            customerId,
            customerName, contactNumber, locationUrl, houseNumber, odooReference,
            activityType, serviceCategory, remarks,
        } = req.body;

        // Mandatory field validation
        const missing = [];
        if (!customerName?.trim())   missing.push('customerName');
        if (!contactNumber?.trim())  missing.push('contactNumber');
        if (!locationUrl?.trim())    missing.push('locationUrl');
        if (!houseNumber?.trim())    missing.push('houseNumber');
        if (!odooReference?.trim())  missing.push('odooReference');
        if (!activityType?.trim())   missing.push('activityType');
        if (!serviceCategory?.trim()) missing.push('serviceCategory');
        if (missing.length) return res.status(400).json({ error: 'Missing required fields', fields: missing });

        // SALES users: force status=PENDING_SCHEDULING and set salesLead to themselves
        const isSalesRole = role === 'SALES';
        const salesLeadUserId = isSalesRole ? userId : (req.body.salesLeadUserId || userId);
        const salesLeadName   = isSalesRole ? userName : (req.body.salesLeadName || userName);
        const status = 'PENDING_SCHEDULING'; // Always starts PENDING regardless of role

        // Validate activityType
        const allowedTypes = ['Installation', 'Troubleshooting', 'Inspection', 'Survey', 'Service', 'Maintenance'];
        if (!allowedTypes.includes(activityType)) {
            return res.status(400).json({ error: 'Invalid activityType' });
        }

        // Generate ID
        const idRes = await pool.query(
            `SELECT id FROM sales_appointment_requests ORDER BY created_at DESC LIMIT 1`
        );
        const lastId  = idRes.rows[0]?.id || 'SAR-00000';
        const lastNum = parseInt(lastId.replace('SAR-', ''), 10) || 0;
        const newId   = `SAR-${String(lastNum + 1).padStart(5, '0')}`;

        // ── Auto-upsert customer record ──────────────────────────────────────
        // Normalise phone to full E.164 format (+974XXXXXXXX for Qatar numbers)
        // so it matches how CustomerRecords stores and searches phones.
        const rawPhone = contactNumber?.trim() || '';
        let normPhone = rawPhone.replace(/[\s\-]/g, '');
        if (/^[0-9]{8}$/.test(normPhone)) normPhone = `+974${normPhone}`;
        else if (/^974[0-9]{8}$/.test(normPhone)) normPhone = `+${normPhone}`;
        else if (normPhone.startsWith('00974')) normPhone = `+974${normPhone.slice(5)}`;

        let resolvedCustomerId = customerId || null;
        if (!resolvedCustomerId && normPhone) {
            // Search by normalised phone — try exact match first, then stripped-prefix match
            const existingCust = await pool.query(
                `SELECT id FROM customers WHERE
                   REGEXP_REPLACE(phone, '[^0-9+]', '', 'g') = REGEXP_REPLACE($1, '[^0-9+]', '', 'g')
                 LIMIT 1`,
                [normPhone]
            );
            if (existingCust.rows[0]) {
                resolvedCustomerId = existingCust.rows[0].id;
            } else {
                // Create new customer with properly formatted phone
                const custId = `CUST-${Date.now()}`;
                const custRes = await pool.query(
                    `INSERT INTO customers (id, name, phone, address, building_number, is_active)
                     VALUES ($1, $2, $3, $4, $5, true)
                     ON CONFLICT DO NOTHING
                     RETURNING id`,
                    [custId, customerName.trim(), normPhone,
                     locationUrl?.trim() || null, houseNumber?.trim() || null]
                );
                if (custRes.rows[0]) resolvedCustomerId = custRes.rows[0].id;
            }
        } else if (resolvedCustomerId) {
            // Customer exists — update address and building number if provided
            await pool.query(
                `UPDATE customers SET
                   address         = COALESCE(NULLIF($1,''), address),
                   building_number = COALESCE(NULLIF($2,''), building_number)
                 WHERE id = $3`,
                [locationUrl?.trim() || '', houseNumber?.trim() || '', resolvedCustomerId]
            );
        }
        // ─────────────────────────────────────────────────────────────────────

        const { rows } = await pool.query(
            `INSERT INTO sales_appointment_requests
               (id, customer_id, customer_name, contact_number, location_url, house_number,
                odoo_reference, activity_type, service_category, sales_lead_user_id,
                sales_lead_name, remarks, status, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
             RETURNING *`,
            [
                newId, resolvedCustomerId, customerName.trim(), contactNumber.trim(),
                locationUrl.trim(), houseNumber.trim(), odooReference.trim(),
                activityType.trim(), serviceCategory.trim(), salesLeadUserId,
                salesLeadName, remarks?.trim() || null, status, userId
            ]
        );
        res.status(201).json(mapSAR(rows[0]));
    } catch (e) {
        console.error('SAR POST error:', e);
        res.status(500).json({ error: 'Failed to create sales appointment request' });
    }
});

/* ── PUT /api/sales-appointment-requests/:id ── */
app.put('/api/sales-appointment-requests/:id', authenticate, writeRateLimit, async (req, res) => {
    try {
        const role   = req.user.role;
        const userId = req.user.id;
        const { id } = req.params;

        const current = await pool.query(
            'SELECT * FROM sales_appointment_requests WHERE id = $1', [id]
        );
        if (!current.rows[0]) return res.status(404).json({ error: 'Request not found' });
        const row = current.rows[0];

        // Permission check
        if (role === 'SALES') {
            if (row.created_by !== userId) {
                return res.status(403).json({ error: 'You can only edit your own requests' });
            }
            if (row.status !== 'PENDING_SCHEDULING') {
                return res.status(403).json({ error: 'Request can no longer be edited (already scheduled or in progress)' });
            }
        }
        if (role === 'FIELD_ENGINEER') {
            return res.status(403).json({ error: 'Field engineers cannot edit sales requests' });
        }

        const {
            customerName, contactNumber, locationUrl, houseNumber, odooReference,
            activityType, serviceCategory, remarks, customerId,
        } = req.body;

        // For SALES: only allow editing the non-scheduling fields
        // For ADMIN/TEAM_LEAD: also allow editing everything except scheduled fields (those go via /schedule)
        const updated = await pool.query(
            `UPDATE sales_appointment_requests SET
               customer_id      = COALESCE($1,  customer_id),
               customer_name    = COALESCE($2,  customer_name),
               contact_number   = COALESCE($3,  contact_number),
               location_url     = COALESCE($4,  location_url),
               house_number     = COALESCE($5,  house_number),
               odoo_reference   = COALESCE($6,  odoo_reference),
               activity_type    = COALESCE($7,  activity_type),
               service_category = COALESCE($8,  service_category),
               remarks          = COALESCE($9,  remarks),
               updated_by       = $10,
               updated_at       = now()
             WHERE id = $11
             RETURNING *`,
            [
                customerId || null,
                customerName?.trim()    || null,
                contactNumber?.trim()   || null,
                locationUrl?.trim()     || null,
                houseNumber?.trim()     || null,
                odooReference?.trim()   || null,
                activityType?.trim()    || null,
                serviceCategory?.trim() || null,
                remarks !== undefined ? (remarks?.trim() || null) : null,
                userId,
                id,
            ]
        );

        // Previously this endpoint had no audit logging at all — now that
        // Admin/Team Lead can edit any request (not just the original Sales
        // creator while pending), a record of who changed what matters more.
        logAudit(req, {
            action: 'UPDATE',
            entityType: 'SALES_REQUEST',
            entityId: id,
            entityLabel: updated.rows[0]?.customer_name || id,
            details: diffFields(
                { customerId: row.customer_id, customerName: row.customer_name, contactNumber: row.contact_number, locationUrl: row.location_url, houseNumber: row.house_number, odooReference: row.odoo_reference, activityType: row.activity_type, serviceCategory: row.service_category, remarks: row.remarks },
                { customerId: updated.rows[0]?.customer_id, customerName: updated.rows[0]?.customer_name, contactNumber: updated.rows[0]?.contact_number, locationUrl: updated.rows[0]?.location_url, houseNumber: updated.rows[0]?.house_number, odooReference: updated.rows[0]?.odoo_reference, activityType: updated.rows[0]?.activity_type, serviceCategory: updated.rows[0]?.service_category, remarks: updated.rows[0]?.remarks }
            ),
        });

        res.json(mapSAR(updated.rows[0]));
    } catch (e) {
        console.error('SAR PUT error:', e);
        res.status(500).json({ error: 'Failed to update sales appointment request' });
    }
});

/* ── DELETE /api/sales-appointment-requests/:id ── */
app.delete('/api/sales-appointment-requests/:id', authenticate, deleteRateLimit, async (req, res) => {
    try {
        const role   = req.user.role;
        const userId = req.user.id;
        const { id } = req.params;

        const current = await pool.query(
            'SELECT * FROM sales_appointment_requests WHERE id = $1', [id]
        );
        if (!current.rows[0]) return res.status(404).json({ error: 'Request not found' });
        const row = current.rows[0];

        // SALES: can only delete their own PENDING_SCHEDULING requests.
        // Once scheduled, in-progress, or done — no deletions regardless of creator.
        if (role === 'SALES') {
            if (row.created_by !== userId)
                return res.status(403).json({ error: 'You can only delete your own requests' });
            if (row.status !== 'PENDING_SCHEDULING')
                return res.status(403).json({ error: 'Scheduled, in-progress, or completed appointments cannot be deleted. Contact your Team Lead.' });
        } else if (role === 'FIELD_ENGINEER') {
            return res.status(403).json({ error: 'Field engineers cannot delete sales requests' });
        }
        // ADMIN / TEAM_LEAD: can delete any status

        // If the SAR has a linked activity, only delete it if THIS SAR was
        // the one that created it (a fresh job created purely from this
        // request, with no history of its own). If the SAR was instead
        // linked to a pre-existing activity (the "additional scope on an
        // existing job" path), that activity has its own independent
        // history and must never be deleted just because this SAR is.
        const linkedActivityId = row.linked_activity_id;
        let removedActivityId = null;
        if (linkedActivityId) {
            const linkedAct = await pool.query(
                `SELECT details FROM activities WHERE id = $1`, [linkedActivityId]
            );
            const wasCreatedBySar = linkedAct.rows[0] && (linkedAct.rows[0].details || {}).salesRequestId === id;
            if (wasCreatedBySar) {
                await pool.query('DELETE FROM activities WHERE id = $1', [linkedActivityId]);
                removedActivityId = linkedActivityId;
                console.log(`SAR DELETE: removed linked activity ${linkedActivityId} with SAR ${id}`);
            } else {
                console.log(`SAR DELETE: ${id} was linked to pre-existing activity ${linkedActivityId} — not deleting it`);
            }
        }

        await pool.query('DELETE FROM sales_appointment_requests WHERE id = $1', [id]);
        res.json({ ok: true, id, removedActivityId });
    } catch (e) {
        console.error('SAR DELETE error:', e);
        res.status(500).json({ error: 'Failed to delete sales appointment request' });
    }
});

/* ── POST /api/sales-appointment-requests/:id/schedule ── */
// Only TEAM_LEAD or ADMIN may call this endpoint.
// Validates required scheduling fields, updates the request to SCHEDULED,
// then creates a corresponding planned Activity so it appears in
// Activity Planner and Operations Monitor immediately.
app.post('/api/sales-appointment-requests/:id/schedule', authenticate, writeRateLimit, async (req, res) => {
    // Declared here (not inside the try block) so the catch block's
    // rollback can actually see the real value — a const declared inside
    // try is out of scope in catch, which would have made the rollback
    // below silently always fall back to a hardcoded default instead of
    // the SAR's true prior status.
    let priorStatus = null;
    try {
        const role   = req.user.role;
        const userId = req.user.id;

        if (role !== 'TEAM_LEAD' && role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only Team Lead or Admin can schedule appointments' });
        }

        const { id } = req.params;
        const { scheduledDate, scheduledStartTime, assignedFieldEngineerId, durationHours, assistantTechIds } = req.body;

        // Validate
        if (!scheduledDate)            return res.status(400).json({ error: 'scheduledDate is required' });
        if (!scheduledStartTime)       return res.status(400).json({ error: 'scheduledStartTime is required' });
        if (!assignedFieldEngineerId)  return res.status(400).json({ error: 'assignedFieldEngineerId is required' });

        // Fetch request
        const current = await pool.query(
            'SELECT * FROM sales_appointment_requests WHERE id = $1', [id]
        );
        if (!current.rows[0]) return res.status(404).json({ error: 'Request not found' });
        const sar = current.rows[0];

        // Fetch engineer name
        const engRow = await pool.query('SELECT id, name FROM users WHERE id = $1', [assignedFieldEngineerId]);
        if (!engRow.rows[0]) return res.status(400).json({ error: 'Assigned engineer not found' });

        // Fetch sales lead name
        const salesLeadRow = await pool.query('SELECT name FROM users WHERE id = $1', [sar.sales_lead_user_id]);
        const salesLeadName = salesLeadRow.rows[0]?.name || sar.sales_lead_name || '';

        // Fetch customer phone so Call button works in the portal
        let customerPhone = sar.contact_number || '';
        if (sar.customer_id) {
            const custRow = await pool.query('SELECT phone FROM customers WHERE id = $1', [sar.customer_id]);
            if (custRow.rows[0]?.phone) customerPhone = custRow.rows[0].phone;
        }

        // A request already linked to an existing activity (via
        // POST /.../link-activity) must not also be scheduled as its own
        // new activity — that would defeat the entire point of linking,
        // which is to avoid a duplicate job. Admin can intentionally
        // reverse a link first (clear linked_activity_id/status) if this
        // was a mistake, then schedule normally.
        if (sar.status === 'LINKED') {
            return res.status(409).json({ error: 'This request is linked to an existing activity. Unlink it first if you want to schedule it as a new activity instead.' });
        }

        // A request that's already been scheduled must not be scheduled
        // AGAIN — this is the actual fix for a real, reported bug: a
        // near-simultaneous second call to this endpoint (a fast
        // double-tap before the Schedule button's disabled state visually
        // took effect, a flaky network causing a client retry, anything)
        // previously had no guard at all stopping it from running this
        // whole endpoint a second time, generating its own new activity ID
        // and creating a genuinely separate, duplicate activity for the
        // same request.
        //
        // A plain read-then-write check (read sar.status, decide, then
        // write later) is NOT actually safe against two truly concurrent
        // calls — both could read the same old status before either one's
        // UPDATE commits. So this claims the SAR right now, atomically: the
        // UPDATE's WHERE clause requires the row to STILL be in an
        // unclaimed state at the exact moment it runs. Only one concurrent
        // call can ever actually change a row; Postgres serializes
        // concurrent UPDATEs to the same row, so there is no window for
        // both to succeed. If this affects zero rows, scheduling has
        // already happened (or is happening right now in another request),
        // and this call bails out immediately, before ever generating an
        // activity ID or touching the activities table at all.
        const claim = await pool.query(
            `UPDATE sales_appointment_requests
             SET status = 'SCHEDULING', updated_by = $1, updated_at = now()
             WHERE id = $2 AND status NOT IN ('SCHEDULED', 'LINKED', 'SCHEDULING')
             RETURNING id`,
            [userId, id]
        );
        if (claim.rowCount === 0) {
            return res.status(409).json({ error: 'This request has already been scheduled (or is being scheduled right now).' });
        }
        // Remember the real prior status so it can be restored if anything
        // below fails — a SAR must never get permanently stuck in the
        // transitional SCHEDULING state just because, say, the activity
        // insert happened to fail for an unrelated reason.
        priorStatus = sar.status;

        // Build the planned date/time string (combine scheduledDate + scheduledStartTime)
        const plannedDate = `${scheduledDate}T${scheduledStartTime}:00+03:00`; // Qatar timezone offset

        // Generate Activity ID
        const maxAct = await pool.query("SELECT id FROM activities ORDER BY id DESC LIMIT 1");
        const lastActId  = maxAct.rows[0]?.id || 'QNC-ACT-000000';
        const lastActNum = parseInt(lastActId.replace('QNC-ACT-', ''), 10) || 0;
        const actId      = `QNC-ACT-${String(lastActNum + 1).padStart(6, '0')}`;

        // Build activity details JSONB — match exactly what mapActivityLite / PlanningModule expect
        const actDetails = {
            // ── Sales request back-reference (internal only) ──
            salesRequestId:      id,
            salesRequestRef:     id,
            // ── Display fields used by planner / ops monitor / team card ──
            customerName:        sar.customer_name,
            customerPhone:       customerPhone,
            salesLeadId:         sar.sales_lead_user_id,
            salesLeadName:       salesLeadName,
            serviceCategory:     sar.service_category,
            locationUrl:         sar.location_url,
            houseNumber:         sar.house_number,
            // odooLink stored here so Edit Activity shows it
            odooLink:            sar.odoo_reference,
            remarks:             sar.remarks || '',
            scheduledStartTime:  scheduledStartTime,
            assistantTechIds:    Array.isArray(assistantTechIds) ? assistantTechIds : [],
            freelancers:         [],
        };

        // Clean description — no SAR prefix, just like a manually created activity
        const cleanDescription = sar.remarks?.trim() || '';

        // Insert Activity — set customer_name column directly so all portal views show the client
        await pool.query(
            `INSERT INTO activities
               (id, reference, type, priority, status, planned_date, customer_id, customer_name,
                lead_tech_id, description, duration_hours, details)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
                actId, actId, sar.activity_type, 'MEDIUM', 'PLANNED',
                plannedDate,
                sar.customer_id || null,
                sar.customer_name,
                assignedFieldEngineerId,
                cleanDescription,
                Number(durationHours) || 2,
                JSON.stringify(actDetails),
            ]
        );

        // Update the SAR to SCHEDULED
        const updated = await pool.query(
            `UPDATE sales_appointment_requests SET
               status                     = 'SCHEDULED',
               scheduled_date             = $1,
               scheduled_start_time       = $2,
               assigned_field_engineer_id = $3,
               linked_activity_id         = $4,
               updated_by                 = $5,
               updated_at                 = now()
             WHERE id = $6
             RETURNING *`,
            [scheduledDate, scheduledStartTime, assignedFieldEngineerId, actId, userId, id]
        );

        res.json({
            ok: true,
            request: mapSAR(updated.rows[0]),
            activityId: actId,
        });
    } catch (e) {
        console.error('SAR schedule error:', e);
        // If the claim above succeeded but something failed afterward
        // (e.g. the activity insert), the SAR would otherwise be stuck
        // permanently in the transitional SCHEDULING state, unable to ever
        // be scheduled again. Best-effort revert back to its real prior
        // status. priorStatus stays null if the claim itself never
        // succeeded (e.g. validation failed before reaching it) — in that
        // case there is nothing to roll back, so the WHERE clause below
        // (status = 'SCHEDULING') simply won't match anything, which is
        // exactly the correct no-op.
        if (priorStatus !== null) {
            try {
                await pool.query(
                    `UPDATE sales_appointment_requests SET status = $1 WHERE id = $2 AND status = 'SCHEDULING'`,
                    [priorStatus, req.params.id]
                );
            } catch (rollbackErr) {
                console.error('SAR schedule rollback also failed:', rollbackErr);
            }
        }
        res.status(500).json({ error: 'Failed to schedule appointment', detail: e.message });
    }
});

// ==============================
// WhatsApp Webhook & Logs Integration
// ==============================

// GET WhatsApp Logs for the Monitor
app.get("/api/whatsapp/logs", authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT 
                wl.*,
                COALESCE(wim.message_text, wl.payload_summary) AS payload_summary
            FROM whatsapp_logs wl
            LEFT JOIN whatsapp_inbound_messages wim 
                ON wl.phone = wim.phone 
                AND wl.type = 'INBOUND'
                AND ABS(EXTRACT(EPOCH FROM (wl.timestamp - wim.created_at))) < 5
            ORDER BY wl.timestamp DESC 
            LIMIT 200
        `);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch logs" });
    }
});

app.get("/api/whatsapp/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // Use the variable from your .env file
    if (mode === "subscribe" && token === process.env.WA_VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// ── WhatsApp Webhook: TEMPORARILY DISABLED ──
// Bot flow is on hold. Incoming messages are acknowledged (200) but not processed.
// Re-enable by removing this stub and uncommenting the full handler below.
app.post("/api/whatsapp/webhook", async (req, res) => {
    console.log('[WA Webhook] Received — bot flow disabled, returning 200');
    return res.sendStatus(200);
});

// ── DISABLED WA webhook handler (preserved for re-enable) ──
// eslint-disable-next-line no-unused-vars
async function _disabled_whatsapp_webhook(req, res) {
    const startTime = Date.now();
    try {
        const body = req.body;
        if (body.object !== "whatsapp_business_account") return res.sendStatus(404);

        const entry = body.entry?.[0];
        const change = entry?.changes?.[0]?.value;
        const message = change?.messages?.[0];

        // 1. Handle Status Updates (Sent/Delivered/Read)
        if (change?.statuses) {
            const s = change.statuses[0];
            await pool.query(
                `INSERT INTO whatsapp_logs (id, type, phone, status, payload_summary, latency) VALUES ($1, $2, $3, $4, $5, $6)`,
                [`log-stat-${Date.now()}`, 'OUTBOUND', s.recipient_id, s.status.toUpperCase(), `Update: ${s.status}`, 0]
            );
            // processed
        }

	// Handle different message types
	if (!message) return res.sendStatus(200);

	// WhatsApp native location share
	if (message.type === 'location') {
		const lat = message.location?.latitude;
		const lng = message.location?.longitude;
		const locationUrl = 'https://maps.google.com/?q=' + lat + ',' + lng;
		await pool.query('UPDATE sessions SET location_url = COALESCE(location_url, $1) WHERE phone = $2', [locationUrl, message.from]).catch(() => {});
		await sendWhatsAppText(message.from, "Location received! Could you also share your villa or building number?");
		return res.sendStatus(200);
	}

	// Image — Gemini Vision reads building/villa number
	if (message.type === 'image') {
		try {
			const imageId = message.image && message.image.id;
			const caption = (message.image && message.image.caption) || '';
			if (imageId) {
				const mediaResp = await fetch('https://graph.facebook.com/v17.0/' + imageId, { headers: { Authorization: 'Bearer ' + process.env.WA_ACCESS_TOKEN } });
				const mediaData = await mediaResp.json();
				const imgResp = await fetch(mediaData.url, { headers: { Authorization: 'Bearer ' + process.env.WA_ACCESS_TOKEN } });
				const imgBuffer = await imgResp.arrayBuffer();
				const base64Image = Buffer.from(imgBuffer).toString('base64');
				const mimeType = mediaData.mime_type || 'image/jpeg';
				const visionModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
				const visionResult = await visionModel.generateContent([
					{ inlineData: { data: base64Image, mimeType } },
					{ text: 'This image is from a customer in Qatar. Extract any visible building number, villa number, street number, or address. Reply with ONLY the extracted text. If nothing found, reply: NOT_FOUND' }
				]);
				const extracted = visionResult.response.text().trim();
				if (extracted && extracted !== 'NOT_FOUND') {
					await pool.query('UPDATE sessions SET house_number = $1 WHERE phone = $2', [extracted, message.from]).catch(() => {});
					await sendWhatsAppText(message.from, 'Got it! I can see: ' + extracted + '. Is that correct? If yes, please describe your issue.');
				} else {
					await sendWhatsAppText(message.from, 'Thank you for the image! Could you type your villa or building number?');
				}
			} else if (caption) {
				await handleIncomingMessage(message.from, caption);
			} else {
				await sendWhatsAppText(message.from, 'Thank you for the image! Could you type your villa or building number?');
			}
		} catch (imgErr) {
			console.error('Image processing error:', imgErr);
			await sendWhatsAppText(message.from, 'Thank you for the image! Could you also type your villa or building number?');
		}
		return res.sendStatus(200);
	}

	// Voice/Audio — Gemini transcribes Arabic or English
	if (message.type === 'audio') {
		try {
			const audioId = message.audio && message.audio.id;
			if (audioId) {
				const mediaResp = await fetch('https://graph.facebook.com/v17.0/' + audioId, { headers: { Authorization: 'Bearer ' + process.env.WA_ACCESS_TOKEN } });
				const mediaData = await mediaResp.json();
				const audioResp = await fetch(mediaData.url, { headers: { Authorization: 'Bearer ' + process.env.WA_ACCESS_TOKEN } });
				const audioBuffer = await audioResp.arrayBuffer();
				const base64Audio = Buffer.from(audioBuffer).toString('base64');
				const mimeType = mediaData.mime_type || 'audio/ogg';
				const audioModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
				const audioResult = await audioModel.generateContent([
					{ inlineData: { data: base64Audio, mimeType } },
					{ text: 'Transcribe this voice message. The customer may speak Arabic or English. Reply with ONLY the transcribed text.' }
				]);
				const transcribed = audioResult.response.text().trim();
				if (transcribed) {
					console.log('[Voice] Transcribed: ' + transcribed);
					await handleIncomingMessage(message.from, transcribed);
				} else {
					await sendWhatsAppText(message.from, 'Sorry, I could not understand the voice message. Could you please type your message?');
				}
			} else {
				await sendWhatsAppText(message.from, 'Sorry, I could not process the voice message. Could you please type your message?');
			}
		} catch (audioErr) {
			console.error('Audio processing error:', audioErr);
			await sendWhatsAppText(message.from, 'Sorry, I could not process the voice message. Could you please type your message?');
		}
		return res.sendStatus(200);
	}

	// Ignore stickers, documents, reactions
	if (message.type !== 'text') return res.sendStatus(200);

	const inboundMessageId = message.id;
	const phone = message.from;
	const text = message.text?.body || "";

	if (!inboundMessageId) {
	    console.warn("Inbound WhatsApp message missing message.id, skipping");
	    return res.sendStatus(200);
	}

	// Deduplicate inbound webhook deliveries
	const dedupeInsert = await pool.query(
	    `INSERT INTO whatsapp_inbound_messages (message_id, phone, message_type, message_text)
	     VALUES ($1, $2, $3, $4)
	     ON CONFLICT (message_id) DO NOTHING`,
	    [inboundMessageId, phone, message.type, text]
	);

	if (dedupeInsert.rowCount === 0) {
	    console.log(`Duplicate inbound WhatsApp message skipped: ${inboundMessageId}`);
	    return res.sendStatus(200);
	}

	if (!phone || !text.trim()) {
	    console.warn("Inbound WhatsApp message missing phone or text, skipping");
	    return res.sendStatus(200);
	}

	// ── 13-second message buffer ──
	// Waits for customer to finish typing before processing
	if (!global.msgBuffer) global.msgBuffer = new Map();
	const bufEntry = global.msgBuffer.get(phone) || { texts: [], timer: null };
	bufEntry.texts.push(text);
	if (bufEntry.timer) clearTimeout(bufEntry.timer);
	global.msgBuffer.set(phone, bufEntry);
	res.sendStatus(200);
	bufEntry.timer = setTimeout(async () => {
	    const buf = global.msgBuffer.get(phone);
	    if (!buf) return;
	    global.msgBuffer.delete(phone);
	    const combinedText = buf.texts.join(" ");
	    console.log(`[Buffer] ${buf.texts.length} msg(s) from ${phone}: "${combinedText}"`);
	    try {
	        await handleIncomingMessage(phone, combinedText);
	    } catch (bufErr) {
	        console.error(`[Buffer] Error processing message from ${phone}:`, bufErr.message);
	        global.msgBuffer.delete(phone); // Ensure cleanup on error
	    }
	}, 13000);
	return;
    } catch (webhookErr) {
        console.error("Webhook outer error:", webhookErr);
    }
} // end _disabled_whatsapp_webhook

async function handleIncomingMessage(phone, text) {
	try {
	const startTime = Date.now();

	// ── Session expiry: clear stale sessions older than 48 hours ──
	// Prevents returning customers from re-entering an old incomplete flow
	try {
		const expiry = await pool.query(
			`DELETE FROM sessions WHERE phone = $1 AND last_interaction < NOW() - INTERVAL '48 hours' RETURNING phone`,
			[phone]
		);
		if (expiry.rowCount > 0) {
			console.log(`[Session] Expired stale session for ${phone} — starting fresh`);
		}
	} catch(expErr) {
		console.error('[Session] Expiry check error (non-critical):', expErr.message);
	}

	const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
	const intent = await detectIntent(text, model);
	console.log("Detected intent:", intent);

	// ==============================
	// Ticket Follow-up Handler
	// ==============================
	// Override TICKET_FOLLOWUP to SUPPORT if active session exists
	if (intent === "TICKET_FOLLOWUP") {
		try {
			const sessCheck = await pool.query("SELECT step FROM sessions WHERE phone = $1", [phone]);
			if (sessCheck.rows.length > 0 && sessCheck.rows[0].step && sessCheck.rows[0].step !== "DONE") {
				console.log("[Intent] Active session - routing as SUPPORT");
				intent = "SUPPORT";
			}
		} catch(e) {}
	}
	if (intent === "TICKET_FOLLOWUP") {

	const ticketResult = await pool.query(
	  `SELECT t.id, t.status, t.created_at
	   FROM tickets t
	   JOIN customers c ON t.customer_id = c.id
	   WHERE c.phone = $1
	   AND t.status NOT IN ('RESOLVED','CLOSED')
	   ORDER BY t.created_at DESC
	   LIMIT 1`,
	  [phone]
	);

	  if (ticketResult.rows.length === 0) {
	    await sendWhatsAppText(
	      phone,
	      "I could not find an active service request. Please briefly describe the issue and I will assist you."
	    );
          // processed
	  }

	  const ticket = ticketResult.rows[0];

	  let reply = `Your service request *${ticket.id}* is currently *${ticket.status}*.`;

	  await sendWhatsAppText(phone, reply);

          // processed
	}

	// Sales enquiry redirect (only if there is no active support session/ticket yet)

	const existingSession = (await pool.query("SELECT * FROM sessions WHERE phone = $1", [phone])).rows[0];

	const canRedirectToSales =
	  isSalesInquiry(text) &&
	  !text.toLowerCase().includes("not working") &&
	  (
	    !existingSession ||
	  (
	      !existingSession.ticket_id &&
	      ["ASK_NAME", "ASK_LOCATION", "ASK_ISSUE"].includes(existingSession.step)
	    )
	  );

	if (canRedirectToSales) {
	  await sendWhatsAppText(phone, SALES_REDIRECT_MESSAGE);

	  // Remove temporary early support session so sales chats do not stay in support flow
	  if (existingSession && !existingSession.ticket_id) {
	    await pool.query("DELETE FROM sessions WHERE phone = $1", [phone]);
	  }

	  await pool.query(
	    `INSERT INTO whatsapp_logs (id, type, phone, status, payload_summary, latency)
	     VALUES ($1, $2, $3, $4, $5, $6)`,
	    [
	      `log-in-${Date.now()}`,
	      "INBOUND",
	      phone,
	      "SALES_REDIRECT",
	      text.substring(0, 80),
	      Date.now() - startTime
	    ]
	  );

	  return; // ← stop here — do NOT fall through to session/ticket creation
	}

	// 2. SESSION LOOKUP (The Smart Part)
	let session = existingSession;

        if (!session) {
            await pool.query("INSERT INTO sessions (phone, step) VALUES ($1, 'ASK_NAME')", [phone]);
            session = { phone, step: 'ASK_NAME', customer_name: null, house_number: null, issue_details: null };
        }

        // If there is already an open ticket for this phone, treat new messages as follow-up

	if (session?.ticket_id) {
	  const normalized = (text || "").trim().toLowerCase();

	  const simpleAcks = [
	  "ok", "okay", "thanks", "thank you", "noted", "done", "sure",
	  "hi", "hello", "hey", "salam", "good morning", "good afternoon", "good evening"
	];

	  const wantsSiteVisit =
	    normalized.includes("site visit") ||
	    normalized.includes("technician") ||
	    normalized.includes("visit") ||
	    normalized.includes("come and check") ||
	    normalized.includes("remote not possible") ||
	    normalized.includes("not possible");

	  const resolvedNow =
	    normalized.includes("now working") ||
	    normalized.includes("resolved") ||
	    normalized.includes("fixed");

	  const hasAdditionalRequest =
	    normalized.includes("move") ||
	    normalized.includes("shift") ||
	    normalized.includes("relocate") ||
	    normalized.includes("change location") ||
	    normalized.includes("add") ||
	    normalized.includes("remove") ||
	    normalized.includes("router") ||
	    normalized.includes("access point") ||
	    normalized.includes("ap") ||
	    normalized.includes("camera") ||
	    normalized.includes("device");

	  await pool.query(
	    `UPDATE tickets
	     SET messages = COALESCE(messages, '[]'::jsonb) || $1::jsonb,
	         updated_at = NOW()
	     WHERE id = $2`,
	    [
	      JSON.stringify([
	        {
	          sender: "CLIENT",
	          content: text,
	          at: new Date().toISOString()
	        }
	      ]),
	      session.ticket_id
	    ]
	  );

	  // No reply for simple acknowledgements
	  if (simpleAcks.includes(normalized)) {
	    await pool.query(
	      `INSERT INTO whatsapp_logs (id, type, phone, status, payload_summary, latency)
	       VALUES ($1, $2, $3, $4, $5, $6)`,
	      [
	        `log-in-${Date.now()}`,
	        "INBOUND",
	        phone,
	        "ACK_ONLY",
	        text.substring(0, 50),
	        Date.now() - startTime
	      ]
	    );

          // processed
	  }

	  let followUpReply = null;

	if (wantsSiteVisit) {
	  const hasLocation =
	    !!(session?.house_number && String(session.house_number).trim());

	  const locationPending =
	    session?.troubleshooting_state?.location_pending === true;

	  await pool.query(
	    `UPDATE sessions
	     SET last_action = 'site_visit',
	         last_bot_question = $2,
	         last_interaction = NOW()
	     WHERE phone = $1`,
	    [
	      phone,
	      hasLocation
	        ? 'Customer requested technician visit'
	        : 'Requested location and villa number for site visit scheduling'
	    ]
	  );

	  if (!hasLocation || locationPending) {
	    followUpReply = `Thank you ${session.customer_name || ""}. We will proceed with the site visit. Please share your location and villa number so we can schedule the appointment.`;
	  } else {
	    followUpReply = `Noted ${session.customer_name || ""}. We have updated ticket ${session.ticket_id} as site visit required. Our team will follow up shortly regarding the appointment.`;
	  }
	}
	else if (resolvedNow) {
	    await pool.query(
	      `UPDATE sessions
	       SET step = 'RESOLVED',
	           last_action = 'resolved_in_chat',
	           last_bot_question = 'Customer confirmed issue resolved',
	           last_interaction = NOW()
	       WHERE phone = $1`,
	      [phone]
	    );

	    followUpReply = `Glad to know the issue is resolved. If it happens again, please message us here.`;
	} else if (hasAdditionalRequest) {
	  await pool.query(
	    `UPDATE sessions
	     SET last_action = 'ticket_scope_update',
	         last_bot_question = 'Customer added extra request to existing ticket',
	         last_interaction = NOW()
	     WHERE phone = $1`,
	    [phone]
	  );

	  followUpReply = `Noted ${session.customer_name || ""}. We have updated ticket ${session.ticket_id} with your additional request. Our team will review it and follow up shortly.`;
	} else {
	  followUpReply = `Thank you ${session.customer_name || ""}. We have updated ticket ${session.ticket_id}. Our team will follow up shortly.`;
	}

	  await sendWhatsAppText(phone, followUpReply);

	  await pool.query(
	    `INSERT INTO whatsapp_logs (id, type, phone, status, payload_summary, latency)
	     VALUES ($1, $2, $3, $4, $5, $6)`,
	    [
	      `log-in-${Date.now()}`,
	      "INBOUND",
	      phone,
	      "PROCESSED",
	      text.substring(0, 50),
	      Date.now() - startTime
	    ]
	  );

          // processed - response handled via WhatsApp
	}

	// 3. AI ANALYSIS (State-Machine Prompt)

	// ══════════════════════════════════════════════════════════════
	// 3. STRUCTURED FIELD-COMPLETION ENGINE
	// Backend owns all flow decisions. AI is only used for:
	//   - entity extraction (name, location, category, fields)
	//   - natural language reply generation for the chosen question
	// ══════════════════════════════════════════════════════════════

	// ── 3a. Extract fields from this message using AI ──
	const extractionPrompt = `You are an entity extractor for a home automation/CCTV/networking support bot in Qatar.

Extract ANY of the following fields from the customer message below.
Return STRICT JSON ONLY — no markdown, no explanation.

Fields to extract (return null for any you cannot determine):
{
  "name": "customer's first name or full name if mentioned",
  "issue_category": "one of: cctv | wifi_network | internet_down | slow_internet | intercom | access_control | home_automation | audio_speaker | tv_streaming | power_issue | general_elv | unknown — or null",
  "technician_requested": "true if customer asks for technician/site visit/someone to come — else false",
  "villa_number": "villa number, building number, flat number, unit number — or null",
  "area": "area name, street, zone, city district — or null",
  "location_pin_received": "true if this message IS a location pin share — else false",
  "affected_scope": "one of: single_camera | multiple_cameras | all_cameras | single_device | multiple_devices | all_devices | single_area | all_areas | unknown — or null",
  "affected_camera_location": "which camera/location is affected e.g. front entrance, back garden, parking — or null",
  "other_cameras_working": "true if customer says other cameras are working — false if all down — null if unknown",
  "restart_done": "true if customer already tried restarting — false if not — null if unknown",
  "issue_resolved": "true if customer says issue is now fixed — else false",
  "photo_shared": "true if customer is sharing a photo of the issue — else false",
  "photo_not_possible": "true if customer says they cannot share a photo — else false",
  "issue_description": "brief description of the problem in the customer's words — or null"
}

Rules:
- "one", "only one", "just one" for cameras => affected_scope = single_camera
- "front one", "main entrance", "entrance" => affected_camera_location
- "yes" after asking if other cameras work => other_cameras_working = true
- "no" after asking if other cameras work => other_cameras_working = false
- Location/map pin message => location_pin_received = true
- "not possible", "cannot", "can't" for photo => photo_not_possible = true
- Any form of "send technician", "need someone", "arrange visit", "come and check", "fix it on site" => technician_requested = true
- Do not invent values. If not mentioned, return null.

CUSTOMER MESSAGE:
"${text}"

PREVIOUS BOT QUESTION (for context):
"${session?.last_bot_question || 'none'}"
`;

	let extracted = {};
	try {
		const extractModel = genAI.getGenerativeModel({
			model: "gemini-2.5-flash",
			generationConfig: { responseMimeType: "application/json" }
		});
		const extractResult = await extractModel.generateContent(extractionPrompt);
		const raw = extractResult.response.text().replace(/```json|```/g, "").trim();
		extracted = JSON.parse(raw);
	} catch (e) {
		console.error("Extraction failed:", e.message);
		extracted = {};
	}

	// ── 3b. Merge extracted fields into session state ──
	// Build the new troubleshooting_state by merging old + new
	const prev = session?.troubleshooting_state || {};

	const newState = {
		// Preserve everything from prev, override only with non-null new values
		affected_scope:            extracted.affected_scope           ?? prev.affected_scope           ?? null,
		affected_camera_location:  extracted.affected_camera_location ?? prev.affected_camera_location ?? null,
		other_cameras_working:     extracted.other_cameras_working    ?? prev.other_cameras_working    ?? null,
		restart_done:              extracted.restart_done             ?? prev.restart_done             ?? null,
		area:                      extracted.area                     ?? prev.area                     ?? null,
		location_pin_received:     extracted.location_pin_received === true ? true : (prev.location_pin_received ?? false),
		technician_requested:      extracted.technician_requested === true  ? true : (prev.technician_requested  ?? false),
		photo_not_possible:        extracted.photo_not_possible === true     ? true : (prev.photo_not_possible    ?? false),
		photo_shared:              extracted.photo_shared === true           ? true : (prev.photo_shared          ?? false),
		issue_resolved:            extracted.issue_resolved === true         ? true : (prev.issue_resolved        ?? false),
		last_question_key:         prev.last_question_key ?? null,
	};

	// Merge top-level session fields
	const newName         = (extracted.name           && extracted.name.trim())          ? extracted.name.trim()           : session?.customer_name  || null;
	const newCategory     = (extracted.issue_category && extracted.issue_category !== 'unknown') ? extracted.issue_category : session?.issue_category || null;
	const newIssueDesc    = (extracted.issue_description && extracted.issue_description.trim()) ? extracted.issue_description.trim() : session?.issue_details  || null;
	const newVilla        = (extracted.villa_number   && extracted.villa_number.trim())  ? extracted.villa_number.trim()   : session?.house_number   || null;
	const newLocationUrl  = session?.location_url || null; // already set via location handler
	const locationKnown   = !!(newLocationUrl || newState.location_pin_received || newState.area);
	const villaKnown      = !!newVilla;

	// ── 3c. Determine what action to take ──

	// IMMEDIATE: customer resolved issue
	if (newState.issue_resolved && !session?.ticket_id) {
		await pool.query(
			`UPDATE sessions SET step='RESOLVED', customer_name=COALESCE($1,customer_name),
			 issue_category=COALESCE($2,issue_category), issue_details=COALESCE($3,issue_details),
			 house_number=COALESCE($4,house_number),
			 troubleshooting_state=COALESCE(troubleshooting_state,'{}'::jsonb)||$5::jsonb,
			 last_interaction=NOW() WHERE phone=$6`,
			[newName, newCategory, newIssueDesc, newVilla, JSON.stringify(newState), phone]
		);
		const finalReply = `Glad to hear that, ${newName || ""}! Issue resolved. If it happens again, feel free to message us here.`.trim();
		await sendWhatsAppText(phone, finalReply);


	// ── 3d. STRUCTURED FIELD-COMPLETION FLOW ──
	// Backend decides the EXACT next question based on what's missing.
	// AI only generates the natural language reply for a pre-decided question key.

	} else {

	// STEP 1 — We need a name first
	const needsName     = !newName;
	// STEP 2 — We need to know the issue category
	const needsCategory = !newCategory && !!newName;
	// STEP 3 — Technician requested OR issue category known → decide flow
	const isTechnicianFlow = newState.technician_requested;

	// ── What is the next missing TICKET FIELD? ──
	// For site visit ticket we need: name, category, affected_scope (CCTV), affected_camera_location (CCTV), villa, location
	const missingFields = [];
	if (!newName)                                                                   missingFields.push("name");
	if (!newCategory)                                                               missingFields.push("issue_category");
	if (!newIssueDesc && !isTechnicianFlow)                                         missingFields.push("issue_description");
	if (newCategory === 'cctv' && !newState.affected_scope)                         missingFields.push("cctv_scope");
	if (newCategory === 'cctv' && newState.affected_scope && newState.affected_scope !== 'all_cameras' && !newState.affected_camera_location) missingFields.push("camera_location");
	if (!villaKnown)                                                                missingFields.push("villa_number");
	if (!locationKnown)                                                             missingFields.push("location");

	const nextMissingField = missingFields[0] || null;
	const prevQuestionKey  = newState.last_question_key;

	// ── TICKET READINESS CHECK ──
	// For CCTV site visit: name + category + scope + camera_location + villa + location
	// For others: name + category + issue + villa + location
	const cctv = newCategory === 'cctv';
	const ticketReady = isTechnicianFlow && newName && newCategory && villaKnown && locationKnown &&
		(!cctv || (newState.affected_scope && newState.affected_camera_location));

	// ── TROUBLESHOOTING READINESS ──
	// Only do troubleshooting if technician NOT yet requested and enough info exists
	const readyToTroubleshoot = newName && newCategory && newIssueDesc && !isTechnicianFlow;

	// Determine what to ask / do
	let questionKey  = null;   // the structured field we are asking for
	let shouldCreateTicket   = false;
	let shouldDoTroubleshooting = false;

	if (ticketReady) {
		shouldCreateTicket = true;
	} else if (isTechnicianFlow) {
		// In technician flow — ask only for missing ticket fields
		questionKey = nextMissingField;
	} else if (needsName) {
		questionKey = "name";
	} else if (needsCategory) {
		questionKey = "issue_category";
	} else if (!newIssueDesc) {
		questionKey = "issue_description";
	} else if (readyToTroubleshoot) {
		shouldDoTroubleshooting = true;
	} else {
		questionKey = nextMissingField;
	}

	// ── DUPLICATE QUESTION GUARD ──
	// Never ask the same question key twice in a row
	if (questionKey && questionKey === prevQuestionKey) {
		// Customer didn't answer — be patient, try rephrasing
		// (still ask, but mark as repeat so AI knows to rephrase)
		newState._repeat_question = true;
	} else {
		newState._repeat_question = false;
	}
	newState.last_question_key = shouldCreateTicket ? null : (questionKey || (shouldDoTroubleshooting ? "troubleshoot" : null));

	// ── SAVE MERGED SESSION STATE ──
	await pool.query(
		`UPDATE sessions SET
		 customer_name      = COALESCE($1, customer_name),
		 house_number       = COALESCE($2, house_number),
		 issue_details      = COALESCE($3, issue_details),
		 issue_category     = COALESCE($4, issue_category),
		 troubleshooting_state = COALESCE(troubleshooting_state,'{}'::jsonb) || $5::jsonb,
		 last_interaction   = NOW()
		 WHERE phone = $6`,
		[newName, newVilla, newIssueDesc, newCategory, JSON.stringify(newState), phone]
	);


	// ── 3e. GENERATE REPLY ──
	// AI generates natural language for the pre-decided question.
	// If creating ticket, AI generates confirmation reply.
	let finalReply = "";
	const customerName = newName || "there";

	if (shouldCreateTicket) {
		// Generate ticket and confirmation
		const ticketId = makeTicketId();
		const priority = "HIGH";

		// Build tech summary
		const summaryParts = [
			newCategory ? newCategory.toUpperCase() : "Support",
			newState.affected_camera_location ? `– ${newState.affected_camera_location}` : "",
			newState.affected_scope ? `(${newState.affected_scope.replace(/_/g,' ')})` : "",
			"– Site visit required.",
			`Villa: ${newVilla || "TBD"}`,
		].filter(Boolean).join(" ");

		const customerId = await upsertWhatsAppCustomer(phone, newName || "WhatsApp Customer");

		await pool.query(
			`INSERT INTO tickets (id, customer_id, customer_name, category, priority, status, location_url, house_number, ai_summary, messages, created_at, updated_at)
			 VALUES ($1,$2,$3,$4,$5,'NEW',$6,$7,$8,$9,NOW(),NOW())`,
			[
				ticketId, customerId, newName || "WhatsApp Customer",
				newCategory || "SUPPORT", priority,
				newLocationUrl || null, newVilla || null,
				summaryParts,
				JSON.stringify([
					{ sender: "CLIENT", content: newIssueDesc || "Site visit requested", at: new Date().toISOString() },
					{ sender: "SYSTEM", content: summaryParts, at: new Date().toISOString() }
				])
			]
		);

		await pool.query(
			`UPDATE sessions SET ticket_id=$1, step='OPEN_TICKET', last_action='site_visit',
			 last_bot_question='Ticket created for site visit', last_interaction=NOW() WHERE phone=$2`,
			[ticketId, phone]
		);

		// Notify team leads
		await notifyTeamLeads(
			`*New Ticket: ${ticketId}*\nCustomer: ${newName || "Unknown"}\nCategory: ${newCategory || "Unknown"}\nPriority: HIGH\nAction: Site Visit Required\nLocation: ${newVilla || ""}${newState.area ? ", " + newState.area : ""}\nIssue: ${newIssueDesc || "Site visit requested"}`
		).catch(e => console.error("Notify error:", e.message));

		// n8n webhook
		if (process.env.N8N_WEBHOOK_URL) {
			fetch(`${process.env.N8N_WEBHOOK_URL}/ticket-created`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ticketId, customerName: newName, phone, issueCategory: newCategory, priority, action: "site_visit", location: newVilla || newState.area || "Not provided", summary: newIssueDesc })
			}).catch(e => console.error("n8n error:", e.message));
		}

		finalReply = `Thank you ${newName}. We have created a site visit ticket for your request. Your Ticket ID is *${ticketId}*. Our team will follow up shortly to schedule your appointment. You will receive the details here once confirmed.`;

	} else if (shouldDoTroubleshooting) {
		// Let AI do one troubleshooting step — but with strict context
		const tsPrompt = `You are the Qonnect WhatsApp support assistant. You are doing structured troubleshooting.

KNOWN SESSION STATE:
- Customer name: ${newName}
- Issue category: ${newCategory}
- Issue description: ${newIssueDesc}
- Affected scope: ${newState.affected_scope || "unknown"}
- Affected camera location: ${newState.affected_camera_location || "not specified"}
- Other cameras working: ${newState.other_cameras_working ?? "unknown"}
- Restart done: ${newState.restart_done ?? "unknown"}
- Last question asked: "${session?.last_bot_question || "none"}"
- Technician requested: ${newState.technician_requested ? "YES" : "no"}

RULES:
1. Ask ONLY ONE short, simple question
2. NEVER repeat the last question asked
3. Do NOT ask for location, villa, or name — those are handled separately
4. If technician was requested, do NOT troubleshoot — just confirm and say team will follow up
5. For CCTV single-camera: do NOT ask about NVR power (other cameras are working = NVR is fine)
6. Do NOT ask for photo if photo_not_possible is true
7. If you have enough info for a recommendation (restart done, scope known), suggest remote_support or site_visit
8. Keep reply under 2 sentences, WhatsApp style
9. End with action: one of continue_troubleshooting | remote_support | site_visit | resolved_in_chat

Return STRICT JSON: { "reply": "...", "action": "..." }
Do not include markdown.

Customer just said: "${text}"`;

		let tsAction = "continue_troubleshooting";
		try {
			const tsModel = genAI.getGenerativeModel({
				model: "gemini-2.5-flash",
				generationConfig: { responseMimeType: "application/json" }
			});
			const tsResult = await tsModel.generateContent(tsPrompt);
			const tsRaw = tsResult.response.text().replace(/```json|```/g, "").trim();
			const tsData = JSON.parse(tsRaw);
			finalReply = tsData.reply || `Could you tell me a bit more about the issue?`;
			tsAction   = tsData.action || "continue_troubleshooting";
		} catch (e) {
			console.error("Troubleshoot AI error:", e.message);
			finalReply = `Could you tell me a bit more about the issue?`;
		}

		// If AI recommends escalation, create remote support ticket
		if (tsAction === "remote_support" || tsAction === "site_visit") {
			const ticketId = makeTicketId();
			const customerId = await upsertWhatsAppCustomer(phone, newName || "WhatsApp Customer");
			const priority = tsAction === "site_visit" ? "HIGH" : "MEDIUM";

			await pool.query(
				`INSERT INTO tickets (id, customer_id, customer_name, category, priority, status, location_url, house_number, ai_summary, messages, created_at, updated_at)
				 VALUES ($1,$2,$3,$4,$5,'NEW',$6,$7,$8,$9,NOW(),NOW())`,
				[
					ticketId, customerId, newName || "WhatsApp Customer",
					newCategory || "SUPPORT", priority,
					newLocationUrl || null, newVilla || null,
					`${newCategory?.toUpperCase() || "Support"} – ${newIssueDesc || "Issue reported"}. ${tsAction === "site_visit" ? "Site visit required." : "Remote support needed."}`,
					JSON.stringify([
						{ sender: "CLIENT", content: newIssueDesc || text, at: new Date().toISOString() }
					])
				]
			);

			await pool.query(
				`UPDATE sessions SET ticket_id=$1, step='OPEN_TICKET', last_action=$2,
				 last_bot_question=$3, last_interaction=NOW() WHERE phone=$4`,
				[ticketId, tsAction, finalReply.substring(0,100), phone]
			);

			await notifyTeamLeads(
				`*New Ticket: ${ticketId}*\nCustomer: ${newName || "Unknown"}\nCategory: ${newCategory || "Unknown"}\nPriority: ${priority}\nAction: ${tsAction === "site_visit" ? "Site Visit Required" : "Remote Support"}\nIssue: ${newIssueDesc || "Reported via WhatsApp"}`
			).catch(e => console.error("Notify error:", e.message));

			finalReply = `Thank you ${newName}. We have created a support ticket *${ticketId}*. Our team will follow up shortly.`;
		} else {
			// Update session with last question
			await pool.query(
				`UPDATE sessions SET last_bot_question=$1, last_action='continue_troubleshooting', last_interaction=NOW() WHERE phone=$2`,
				[finalReply.substring(0, 200), phone]
			);
		}

	} else {
		// Generate a natural language reply for the pre-decided questionKey
		const questionPrompts = {
			"name":              `Ask the customer politely for their name. Keep it short and WhatsApp-friendly. One sentence.`,
			"issue_category":    `Ask the customer what system they are having an issue with (Wi-Fi, CCTV, intercom, access control, home automation, speakers, or something else). One sentence.`,
			"issue_description": `Ask the customer to briefly describe the issue they are facing. One sentence.`,
			"cctv_scope":        `Ask whether all cameras are affected or only one/some cameras. One sentence.`,
			"camera_location":   `Ask which camera location is affected (e.g. front entrance, back garden, parking, etc.). One sentence.`,
			"villa_number":      `Ask for the villa or building number. One sentence. Do not ask for location pin here, just the number.`,
			"location":          `Ask the customer to share their location pin or mention their area so the team can schedule the visit. One sentence.`,
		};

		const promptForKey = questionPrompts[questionKey] || `Ask for any remaining details needed to assist the customer. One sentence.`;
		const repeatNote   = newState._repeat_question ? " Note: the customer did not answer last time, so rephrase slightly." : "";

		const replyPrompt = `You are a WhatsApp support assistant for Qonnect (home automation company in Qatar).
Customer name: ${newName || "unknown"}.
${promptForKey}${repeatNote}
Reply in the same language as the customer's last message: "${text}"
Return ONLY the reply text, no JSON, no markdown.`;

		try {
			const replyModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
			const replyResult = await replyModel.generateContent(replyPrompt);
			finalReply = replyResult.response.text().trim();
		} catch (e) {
			console.error("Reply gen error:", e.message);
			// Fallback replies
			const fallbacks = {
				"name":              "Could I get your name please?",
				"issue_category":    "Which system are you having an issue with — Wi-Fi, CCTV, intercom, automation, or something else?",
				"issue_description": "Could you briefly describe the issue you're facing?",
				"cctv_scope":        "Are all cameras affected or just one camera?",
				"camera_location":   "Which camera location is affected? (e.g. front entrance, back, parking)",
				"villa_number":      "Could you share your villa or building number?",
				"location":          "Could you share your location pin or let us know your area so we can schedule the visit?",
			};
			finalReply = fallbacks[questionKey] || "Could you provide a bit more detail so I can assist you?";
		}

		// Save last_bot_question
		await pool.query(
			`UPDATE sessions SET last_bot_question=$1, last_action=$2,
			 troubleshooting_state=COALESCE(troubleshooting_state,'{}'::jsonb)||$3::jsonb,
			 last_interaction=NOW() WHERE phone=$4`,
			[finalReply.substring(0, 200), questionKey || "ask", JSON.stringify(newState), phone]
		);
	}

	// ── 3f. SEND FINAL REPLY ──
	await sendWhatsAppText(phone, finalReply);

	} // end main else (not issue_resolved early exit)


        await pool.query(
          `INSERT INTO whatsapp_logs (id, type, phone, status, payload_summary, latency)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            `log-in-${Date.now()}`,
            "INBOUND",
            phone,
            "PROCESSED",
            text.substring(0, 50),
            Date.now() - startTime,
          ]
        );

      } catch (error) {
        console.error("Webhook Error:", error);
      }
}  // end handleIncomingMessage

initDb().then(() => {
  // --- Uncaught Error Handlers (Phase 3) ---
process.on('uncaughtException', (err) => {
    console.error(JSON.stringify({ level: 'FATAL', type: 'uncaughtException', error: err.message, stack: err.stack, timestamp: new Date().toISOString() }));
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error(JSON.stringify({ level: 'ERROR', type: 'unhandledRejection', error: String(reason), timestamp: new Date().toISOString() }));
});

// --- Global Express Error Handler (Phase 3) ---
app.use((err, req, res, next) => {
    console.error(JSON.stringify({ level: 'ERROR', type: 'expressError', url: req.url, method: req.method, error: err.message, timestamp: new Date().toISOString() }));
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- AUTO CARRY-FORWARD CRON (runs at 10 PM Qatar / 7 PM UTC daily) ---
const runAutoCarryForward = async () => {
    try {
        const result = await pool.query(`
            UPDATE activities 
            SET status = 'CARRY_FORWARD',
                carry_forward_note = COALESCE(NULLIF(carry_forward_note,''), '') || 
                    E'[Auto] Not completed by end of day — reschedule required',
                next_planned_at = NULL,
                completed_at = NOW(),
                updated_at = NOW()
            WHERE status IN ('PLANNED', 'IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED', 'ASSIGNED')
            AND planned_date::date < (NOW() AT TIME ZONE 'Asia/Qatar')::date
            RETURNING reference, lead_tech_id
        `);
        if (result.rows.length > 0) {
            console.log(JSON.stringify({
                level: 'WARN',
                type: 'auto_carry_forward',
                message: 'Activities auto carry-forwarded (not completed by EOD)',
                count: result.rows.length,
                activities: result.rows.map(r => r.reference),
                assignedTo: result.rows.map(r => r.lead_tech_id).filter(Boolean),
                timestamp: new Date().toISOString()
            }));
        }
    } catch (e) {
        console.error('Auto carry-forward error:', e.message);
    }
};

// Check every 15 minutes — only act at 10 PM Qatar time (19:00 UTC)
setInterval(() => {
    const now = new Date();
    const qatarHour = (now.getUTCHours() + 3) % 24;
    if (qatarHour === 22 && now.getUTCMinutes() < 15) {
        runAutoCarryForward();
    }
}, 15 * 60 * 1000);

// Graceful shutdown
const shutdown = async () => {
    console.log('\nGraceful shutdown initiated...');
    try { await pool.end(); } catch(e) {}
    process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(PORT, () => {
    console.log(`✅ Backend server running on http://localhost:${PORT}`);
  });
});

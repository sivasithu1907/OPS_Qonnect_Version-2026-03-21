
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import dotenv from 'dotenv';
import { pool } from "./db.js";
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 8080;

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
    `);

    // 3. Customer ID Sequence
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_id_seq (
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
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS location_url TEXT;
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
    `).catch(() => {}); // Non-fatal if indexes already exist

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
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Unauthorized — invalid token' });
    }
};

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==============================
// Tickets (PostgreSQL)
// ==============================

// Helper: map DB snake_case ticket row → frontend camelCase
function mapTicket(r) {
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    unreadCount: 0,
    // Workflow fields
    startedAt: r.started_at || undefined,
    completedAt: r.completed_at || undefined,
    carryForwardNote: r.carry_forward_note || undefined,
    nextPlannedAt: r.next_planned_at || undefined,
    assignmentNote: r.assignment_note || undefined,
    completionNote: r.completion_note || undefined,
    cancellationReason: r.cancellation_reason || undefined,
    lastEscalatedAt: r.last_escalated_at || undefined,
  };
}

// 1. Get all tickets from DB
app.get("/api/tickets", authenticate, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tickets ORDER BY updated_at DESC");
    res.json(result.rows.map(mapTicket));
  } catch (e) {
    console.error("Tickets fetch error:", e);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// 2. Create a new ticket in DB (Fixed for Foreign Key sync)
app.post("/api/tickets", authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id, customerId, customerName, category, priority, locationUrl, houseNumber, messages } = req.body;
    const phone = customerId; // Usually the phone number is the unique ID here

    await client.query('BEGIN');

    // STEP A: Ensure the customer exists first (UPSERT)
    // This prevents the "violates foreign key constraint" error
    await client.query(`
      INSERT INTO customers (id, name, phone)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone
    `, [customerId, customerName, phone]);

    // STEP B: Now create the ticket safely
    const result = await client.query(
      `INSERT INTO tickets (id, customer_id, customer_name, category, type, priority, status, location_url, house_number, messages, assigned_tech_id, appointment_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [id, customerId, customerName, category,
       req.body.type || 'Under Warranty',
       priority,
       req.body.status || 'NEW',
       locationUrl, houseNumber,
       JSON.stringify(messages || []),
       req.body.assignedTechId || null,
       req.body.appointmentTime || null
      ]
    );

    await client.query('COMMIT');

    const ticket = mapTicket(result.rows[0]);

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
app.put("/api/tickets/:id", authenticate, async (req, res) => {
    try {
        const id = req.params.id;
        const { category, priority, type, customerId, customerName,
                assignedTechId, appointmentTime, locationUrl, houseNumber, odooLink, notes, photos } = req.body;
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
                messages         = CASE WHEN $12::text IS NOT NULL
                                        THEN COALESCE(messages,'[]'::jsonb) || $12::jsonb
                                        ELSE messages END,
                updated_at       = NOW()
             WHERE id = $11`,
            [
                category || null, priority || null,
                locationUrl || null, houseNumber || null,
                assignedTechId || null, appointmentTime || null,
                odooLink || null, notes || null,
                customerId || null, customerName || null,
                id,
                photos ? JSON.stringify(photos) : null
            ]
        );
        res.json({ ok: true });
    } catch (e) {
        console.error("Ticket update error:", e);
        res.status(500).json({ error: "Failed to update ticket" });
    }
});

// 2c. Append a message to ticket messages array
app.post("/api/tickets/:id/message", authenticate, async (req, res) => {
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
app.delete("/api/tickets/:id", authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await pool.query("DELETE FROM tickets WHERE id=$1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ticket deletion error:", e);
    res.status(500).json({ error: "Failed to delete ticket" });
  }
});

// 4. Update Ticket Status & Trigger Review Message
app.put("/api/tickets/:id/status", authenticate, async (req, res) => {
    try {
        const { status, assignedTechId, appointmentTime, carryForwardNote, nextPlannedAt, completionNote } = req.body;
        const ticketId = req.params.id;

        // Fetch current status to detect transitions for timestamp tracking
        const current = await pool.query("SELECT status, started_at FROM tickets WHERE id=$1", [ticketId]);
        const prevStatus = current.rows[0]?.status;
        const alreadyStarted = current.rows[0]?.started_at;

        // Build timestamp clauses based on status transition
        let startedAtClause = "";
        let completedAtClause = "";

        if (status === 'IN_PROGRESS' && prevStatus !== 'IN_PROGRESS' && !alreadyStarted) {
            // First time entering IN_PROGRESS — record actual start time
            startedAtClause = ", started_at = NOW()";
        }
        if (status === 'RESOLVED' && prevStatus !== 'RESOLVED') {
            // Engineer pressed Complete — record actual completion time
            completedAtClause = ", completed_at = NOW()";
        }
        if (status === 'CANCELLED') {
            // Reset both on cancellation
            startedAtClause  = ", started_at = NULL";
            completedAtClause = ", completed_at = NULL";
        }

        // 1. Update the database — status + assignment + appointment + notes + timestamps
        await pool.query(
            `UPDATE tickets SET 
                status = $1,
                assigned_tech_id = COALESCE($2, assigned_tech_id),
                appointment_time = COALESCE($3, appointment_time),
                carry_forward_note = COALESCE($4, carry_forward_note),
                next_planned_at = COALESCE($5, next_planned_at),
                completion_note = COALESCE($7, completion_note),
                updated_at = NOW()${startedAtClause}${completedAtClause}
             WHERE id = $6`,
            [status, assignedTechId || null, appointmentTime || null,
             carryForwardNote || null, nextPlannedAt || null, ticketId,
             completionNote || null]
        );

        // 2. Fetch customer + ticket info for notifications
        const ticketData = await pool.query(`
            SELECT t.id, t.customer_name, t.category, t.priority,
                   c.phone as customer_phone, c.name as customer_name_from_db
            FROM tickets t
            JOIN customers c ON t.customer_id = c.id
            WHERE t.id = $1
        `, [ticketId]);

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
        `SELECT * FROM customers ORDER BY created_at DESC LIMIT 200`
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

// Create customer
app.post("/api/customers", authenticate, async (req, res) => {
  try {
    const { name, phone, email, address, notes, is_active } = req.body || {};

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Customer name is required" });
    }

    const id = await nextCustomerId();

    const { rows } = await pool.query(
      `
      INSERT INTO customers (id, name, phone, email, address, notes, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
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
      ]
    );

    const r = rows[0];
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
app.put("/api/customers/:id", authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    const { name, phone, email, address, buildingNumber, notes, is_active } = req.body || {};

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
app.delete("/api/customers/:id", authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    const r = await pool.query(`DELETE FROM customers WHERE id=$1`, [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
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
    if (rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

    const user = rows[0];
    if (!user.password) return res.status(401).json({ error: "Account not configured. Contact admin." });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: "Invalid credentials" });

    // Block inactive users
    if (user.status === 'INACTIVE') return res.status(403).json({ error: "Account is inactive. Contact admin." });

    const token = jwt.sign(
        { id: user.id, role: user.role, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
    );

    res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, techId: user.id }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }

// ── /api/me — verify token and return current user (used on app startup) ──
app.get("/api/me", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, email, role, status FROM users WHERE id = $1", [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    const u = rows[0];
    if (u.status === 'INACTIVE') return res.status(403).json({ error: "Account inactive" });
    res.json({ id: u.id, name: u.name, email: u.email, role: u.role, techId: u.id });
  } catch (e) {
    res.status(500).json({ error: "Failed to verify session" });
  }
});
});

app.get("/api/users", authenticate, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, email, role as \"systemRole\", status, phone, avatar, job_role, level FROM users");
        res.json(result.rows.map(r => ({
            id: r.id,
            name: r.name,
            email: r.email,
            systemRole: r.systemRole,
            status: r.status,
            // Treat AVAILABLE same as ACTIVE — legacy rows may have AVAILABLE status
            isActive: r.status === 'ACTIVE' || r.status === 'AVAILABLE',
            status: (r.status === 'AVAILABLE') ? 'ACTIVE' : (r.status || 'ACTIVE'), // normalise on read
            phone: r.phone || '',
            jobRole: r.job_role || '',
            level:   r.level   || '',
            avatar: r.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name || 'U')}&background=random&color=fff&bold=true&size=128`
        })));
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// POST User (Create)
app.post("/api/users", authenticate, async (req, res) => {
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
        res.status(201).json(rows[0]);
    } catch (e) {
        console.error("User create error:", e);
        if (e.code === "23505") return res.status(409).json({ error: "Email already exists" });
        res.status(500).json({ error: "Failed to create user" });
    }
});

// PUT User (Update)
app.put("/api/users/:id", authenticate, async (req, res) => {
    try {
        const { name, email, password, role, status, phone, avatar, job_role, level } = req.body;
        const id = req.params.id;
        let hashedPass = null;
        if (password) {
            hashedPass = await bcrypt.hash(password, 10);
        }
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
app.put("/api/users/:id/password", authenticate, async (req, res) => {
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

        res.json({ ok: true, message: "Password changed successfully" });
    } catch (e) {
        console.error("Change password error:", e);
        res.status(500).json({ error: "Failed to change password" });
    }
});

app.delete("/api/users/:id", authenticate, async (req, res) => {
    try {
        const r = await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
        if (r.rowCount === 0) return res.status(404).json({ error: "User not found" });
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
app.post("/api/teams", authenticate, async (req, res) => {
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
app.put("/api/teams/:id", authenticate, async (req, res) => {
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
app.delete("/api/teams/:id", authenticate, async (req, res) => {
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
app.get("/api/activities", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM activities WHERE type != 'WHATSAPP_SUPPORT' ORDER BY created_at DESC");
    res.json(rows.map(r => ({
        id: r.id, reference: r.reference, type: r.type, priority: r.priority,
        status: r.status, plannedDate: r.planned_date, customerId: r.customer_id,
        siteId: r.site_id, leadTechId: r.lead_tech_id, description: r.description,
        durationHours: Number(r.duration_hours), ...r.details,
        createdAt: r.created_at, updatedAt: r.updated_at,
        startedAt:   r.started_at   || null,   // actual start time (when engineer clicked Start Work)
        completedAt: r.completed_at || null,   // actual completion time
    })));
  } catch (e) { res.status(500).json({error: "Failed to load activities"}); }
});

// POST Activity (Create)
app.post("/api/activities", authenticate, async (req, res) => {
    try {
        const { id, reference, type, priority, status, plannedDate, customerId, siteId, leadTechId, description, durationHours, ...details } = req.body;
        await pool.query(
            `INSERT INTO activities (id, reference, type, priority, status, planned_date, customer_id, site_id, lead_tech_id, description, duration_hours, details)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [id, reference, type, priority, status, plannedDate, customerId, siteId, leadTechId, description, durationHours, JSON.stringify(details)]
        );
        res.status(201).json({ok: true});
    } catch(e) { console.error(e); res.status(500).json({error: "Failed to create activity"}); }
});

// PUT Activity (Update)
app.put("/api/activities/:id", authenticate, async (req, res) => {
    try {
        const { type, priority, status, plannedDate, customerId, siteId, leadTechId, description, durationHours, ...details } = req.body;

        // Fetch current status to detect transitions
        const current = await pool.query("SELECT status, started_at FROM activities WHERE id=$1", [req.params.id]);
        const prevStatus = current.rows[0]?.status;
        const alreadyStarted = current.rows[0]?.started_at;

        // Determine started_at / completed_at based on status transition
        let startedAtClause = "";
        let completedAtClause = "";

        if (status === 'IN_PROGRESS' && prevStatus !== 'IN_PROGRESS' && !alreadyStarted) {
            // First time entering IN_PROGRESS — record real start time
            startedAtClause = ", started_at = NOW()";
        }
        if (status === 'ON_MY_WAY' && prevStatus === 'PLANNED') {
            // Engineer started travelling — record as started_at
            startedAtClause = ", started_at = NOW()";
        }
        if (status === 'DONE' && prevStatus !== 'DONE') {
            completedAtClause = ", completed_at = NOW()";
        }
        if (status === 'PLANNED' || status === 'CANCELLED') {
            // Reset timestamps if re-planned or cancelled
            startedAtClause  = ", started_at = NULL";
            completedAtClause = ", completed_at = NULL";
        }

        await pool.query(
            `UPDATE activities SET type=$1, priority=$2, status=$3, planned_date=$4, customer_id=$5, site_id=$6, lead_tech_id=$7, description=$8, duration_hours=$9, details=$10, updated_at=NOW()${startedAtClause}${completedAtClause} WHERE id=$11`,
            [type, priority, status, plannedDate, customerId, siteId, leadTechId, description, durationHours, JSON.stringify(details), req.params.id]
        );
        res.json({ok: true});
    } catch(e) { console.error(e); res.status(500).json({error: "Failed to update activity"}); }
});

// DELETE Activity
app.delete("/api/activities/:id", authenticate, async (req, res) => {
    try {
        await pool.query("DELETE FROM activities WHERE id=$1", [req.params.id]);
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

app.post("/api/whatsapp/webhook", async (req, res) => {
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
});

async function handleIncomingMessage(phone, text) {
	try {
	const startTime = Date.now();
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
  app.listen(PORT, () => {
    console.log(`✅ Backend server running on http://localhost:${PORT}`);
  });
});

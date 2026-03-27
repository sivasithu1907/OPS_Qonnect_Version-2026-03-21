
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
        updated_at TIMESTAMPTZ DEFAULT now()
      );
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

// Create a default admin if none exists
    const adminCheck = await pool.query("SELECT * FROM users WHERE email = 'admin@qonnect.qa'");
    if (adminCheck.rows.length === 0) {
        const hashedPass = await bcrypt.hash("admin123", 10);
        await pool.query(
            "INSERT INTO users (id, name, email, password, role) VALUES ($1, $2, $3, $4, $5)",
            ["u-admin", "System Admin", "admin@qonnect.qa", hashedPass, "ADMIN"]
        );
        console.log("✅ Default Admin User Created");
    } else {
        // This line automatically fixes the broken user currently stuck in your live database!
        await pool.query("UPDATE users SET role = 'ADMIN' WHERE role = 'OPERATIONS_MANAGER'");
    }
    
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
                assignedTechId, appointmentTime, locationUrl, houseNumber, odooLink, notes } = req.body;
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
                updated_at       = NOW()
             WHERE id = $11`,
            [
                category || null, priority || null,
                locationUrl || null, houseNumber || null,
                assignedTechId || null, appointmentTime || null,
                odooLink || null, notes || null,
                customerId || null, customerName || null,
                id
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
        const { status, assignedTechId, appointmentTime, carryForwardNote, nextPlannedAt } = req.body;
        const ticketId = req.params.id;

        // 1. Update the database — status + assignment + appointment
        await pool.query(
            `UPDATE tickets SET 
                status = $1,
                assigned_tech_id = COALESCE($2, assigned_tech_id),
                appointment_time = COALESCE($3, appointment_time),
                carry_forward_note = COALESCE($4, carry_forward_note),
                next_planned_at = COALESCE($5, next_planned_at),
                updated_at = NOW()
             WHERE id = $6`,
            [status, assignedTechId || null, appointmentTime || null,
             carryForwardNote || null, nextPlannedAt || null, ticketId]
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

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("customers create error:", e);
    res.status(500).json({ error: "Failed to create customer" });
  }
});

// Update customer
app.put("/api/customers/:id", authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    const { name, phone, email, address, notes, is_active } = req.body || {};

    const { rows } = await pool.query(
      `
      UPDATE customers
      SET
        name = COALESCE($2, name),
        phone = COALESCE($3, phone),
        email = COALESCE($4, email),
        address = COALESCE($5, address),
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
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    
    if (rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });
    
    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
        { id: user.id, role: user.role, email: user.email }, 
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
    );

    res.json({ 
        token, 
        user: { id: user.id, name: user.name, email: user.email, role: user.role } 
    });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/users", authenticate, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, email, role as \"systemRole\", status, phone, avatar FROM users");
        res.json(result.rows.map(r => ({
            id: r.id,
            name: r.name,
            email: r.email,
            systemRole: r.systemRole,
            status: r.status,
            isActive: r.status === 'ACTIVE',
            phone: r.phone || '',
            avatar: r.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name || 'U')}&background=random&color=fff&bold=true&size=128`
        })));
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// POST User (Create)
app.post("/api/users", authenticate, async (req, res) => {
    try {
        const { id, name, email, password, role, status, phone } = req.body;
        if (!name || !email || !password || !role) {
            return res.status(400).json({ error: "name, email, password, and role are required" });
        }
        const hashedPass = await bcrypt.hash(password, 10);
        const userId = id || `u-${Date.now()}`;
        const { rows } = await pool.query(
            `INSERT INTO users (id, name, email, password, role, status, phone)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, name, email, role as "systemRole", status, phone`,
            [userId, name.trim(), email.trim(), hashedPass, role, status || "ACTIVE", phone || null]
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
        const { name, email, password, role, status, phone, avatar } = req.body;
        const id = req.params.id;
        let hashedPass = null;
        if (password) {
            hashedPass = await bcrypt.hash(password, 10);
        }
        const { rows } = await pool.query(
            `UPDATE users SET
                name = COALESCE($1, name),
                email = COALESCE($2, email),
                password = COALESCE($3, password),
                role = COALESCE($4, role),
                status = COALESCE($5, status),
                phone = COALESCE($6, phone),
                avatar = COALESCE($7, avatar)
             WHERE id = $8
             RETURNING id, name, email, role as "systemRole", status, phone, avatar`,
            [
                name ? name.trim() : null,
                email ? email.trim() : null,
                hashedPass,
                role || null,
                status || null,
                phone || null,
                avatar || null,
                id
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
        createdAt: r.created_at, updatedAt: r.updated_at
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
        await pool.query(
            `UPDATE activities SET type=$1, priority=$2, status=$3, planned_date=$4, customer_id=$5, site_id=$6, lead_tech_id=$7, description=$8, duration_hours=$9, details=$10, updated_at=NOW() WHERE id=$11`,
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
	const systemPrompt = `You are the Qonnect WhatsApp Support Assistant for a home automation, networking, CCTV, intercom, access control, and ELV company in Qatar.

	Your style:
	- Be polite, professional, and concise.
	- Reply like a real WhatsApp support coordinator.
	- Keep replies short, natural, and WhatsApp-friendly.
	- Do not write email-style replies.
	- Do not say "Dear Valued Client".
	- Do not repeat the same question if the information is already available.
	- Ask only one clear question or give one clear instruction at a time.
	- Avoid long explanations unless the customer asks for more detail.

	Language:
	- Detect the customer's language.
	- Reply in the same language where possible.
	- If unclear, reply in English.

	Flow rules:
	1) If customer name is missing -> ask for name (ASK_NAME)
	2) If issue is missing -> ask for issue (ASK_ISSUE)
	3) Move to TROUBLESHOOT — do first-level troubleshooting to understand the problem
	4) ONLY ask for location and villa number (ASK_LOCATION) when you are ready to create a ticket
	5) NEVER ask for location during the early conversation — only right before ticket creation
	6) If customer already provided location at any point, never ask again
	7) Do not create or confirm a ticket automatically

	Issue categories:
	- wifi_network
	- internet_down
	- slow_internet
	- cctv
	- intercom
	- access_control
	- home_automation
	- audio_speaker
	- tv_streaming
	- power_issue
	- general_elv
	- unknown

	Troubleshooting rules:
	- Ask one short troubleshooting question or give one short instruction at a time
	- Do not ask multiple questions in one message unless absolutely necessary
	- Keep replies short and practical for WhatsApp
	- Start with the most useful first-level check based on the issue category
	- If the customer confirms the issue is fixed, mark resolved_in_chat
	- If more details, photo, or video are needed, mark need_more_info
	- If remote technical review is needed after basic checks, mark remote_support
	- If a physical fault or site attendance is likely needed, mark site_visit
	- If restart_done is already true in the session troubleshooting_state, do not ask the customer to restart again
	- If affected_scope and area_scope are already known in the session troubleshooting_state, do not ask those again
	- If location_pending is true and issue details are already available, do not ask for location again during troubleshooting
	- If the customer already confirms that one camera is affected while other cameras are working, do not repeat NVR/DVR power questions

	Category guidance:

	For wifi_network or internet_down:
	- First ask whether all devices are affected or only one device
	- Then ask whether router / modem / access points have power
	- Then ask customer to restart router / modem once and wait 2 minutes
	- Then ask whether the connection is back
	- If still not working after basic checks, prefer remote_support
	- If power/device issue is suspected on-site, prefer site_visit
	- If the customer says internet is slow overall but one room has no internet, do not get confused by the mixed wording
	- Continue with practical troubleshooting and classify based on the best fit using affected_scope and area_scope

	For slow_internet:
	- Ask whether the issue is on all devices or only one
	- Ask whether the issue is in all areas or only one area
	- Ask for one router restart if not already done
	- If issue continues, prefer remote_support
	- If the customer reports mixed symptoms such as slow internet generally but no internet in one room, treat it as a connectivity issue with partial area impact
	- In that case, prefer identifying whether the issue is across all devices, one device, or one area, without restarting intake

	For cctv:
	- Ask whether all cameras are affected or only some cameras
	- If only one camera or some cameras are affected and other cameras are working, do not keep repeating recorder/NVR power checks
	- If other cameras are working, recorder power can usually be treated as already confirmed
	- In partial camera issues, prefer identifying which camera/location is affected
	- If only some cameras are down, site_visit is more likely
	- Ask for recorder/NVR restart only when it is useful and not already ruled out by context
	- If all cameras are down and basic checks fail, remote_support or site_visit depending on context

	For intercom:
	- Ask whether the indoor monitor/screen turns on
	- Ask whether issue is calling, video, audio, or door opening
	- If power/display issue is suspected, prefer site_visit
	- If app/config behavior is suspected, prefer remote_support

	For access_control:
	- Ask whether issue affects all users or only one user/card/fingerprint
	- Ask whether the device/controller has power
	- If single-user issue, remote_support may be possible
	- If door hardware or full system issue, prefer site_visit

	For home_automation:
	- Ask whether one device is affected or multiple devices
	- Ask whether internet/router is working normally
	- Ask which device type is affected (light, curtain, AC, etc.)
	- If app/config/system issue is suspected, prefer remote_support
	- If device hardware issue is suspected, prefer site_visit

	For unknown issues:
	- Ask which system is affected: Wi-Fi, CCTV, intercom, access control, or automation
	- Or ask customer to send a short photo/video

	Decision rules:
	- Do not create ticket during ASK_NAME / ASK_LOCATION / ASK_ISSUE
	- Do not create ticket just because issue is collected
	- Only recommend escalation after at least one troubleshooting step, unless there is an obvious urgent physical issue
	- If the customer explicitly says remote is not possible and requests technician/site attendance after basic troubleshooting, prefer site_visit
	- If restart_done is true and the issue still affects all devices or all areas, prefer escalation instead of repeating restart steps
	- If location_pending is true, do not ask for location again during troubleshooting unless site_visit handling now requires visit details

	Location handling:
	- If the customer says they will share the location later or shortly, do not keep repeating the same location request immediately
	- Continue troubleshooting if possible
	- Keep location as pending
	- Before site visit ticket creation, location and villa number must be confirmed
	- If the customer already mentioned they will share location later, do not ask again immediately unless the workflow now requires it for escalation
	- If the customer says they will share location later, shortly, or after some time, set location_pending = true
	- If location_pending is true, do not ask for location again during troubleshooting unless escalation now requires it

	Strict output:
	Return STRICT JSON ONLY with these exact keys:
	reply, name, location, issue, next_step, issue_category, action, affected_scope, area_scope, restart_done, location_pending, last_bot_question

	Allowed next_step values:
	ASK_NAME, ASK_LOCATION, ASK_ISSUE, TROUBLESHOOT

	Allowed action values:
	ask_name
	ask_location
	ask_issue
	continue_troubleshooting
	need_more_info
	resolved_in_chat
	remote_support
	site_visit

	Additional field rules:
	- affected_scope: one of all_devices, one_device, some_devices, unknown, or null
	- area_scope: one of all_areas, one_area, some_areas, unknown, or null
	- restart_done: true, false, or null
	- location_pending: true, false, or null
	- last_bot_question: short summary of the question or instruction you are giving now
	- Reuse the current session troubleshooting_state if the customer already answered something earlier
	- Do not ask again for affected_scope, area_scope, or restart_done if already clearly known in the session
	- If the customer asks for technician/site visit after basic troubleshooting failed, prefer site_visit

	If unknown, use null.
	Do not include markdown.
	Do not include explanations outside JSON.`;

	const aiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

	const aiResult = await aiModel.generateContent({
	  contents: [
	    {
	      role: "user",
	      parts: [
	        { text: systemPrompt },
		{ text: `CURRENT SESSION:\n${JSON.stringify(session, null, 2)}` },
		{ text: `CURRENT TROUBLESHOOTING STATE:\n${JSON.stringify(session?.troubleshooting_state || {}, null, 2)}` },
		{ text: `CUSTOMER MESSAGE:\n${text}` },
		{ text: `CRITICAL RULES:
1. Last bot question was: "${session?.last_bot_question || 'none'}". Do NOT ask the same question again.
2. If session.step is TROUBLESHOOT, continue troubleshooting — do not restart intake.
3. If restart_done is true, do NOT ask customer to restart again.
4. If affected_scope or area_scope are already known, do NOT ask again.
5. If customer already gave their name (session.customer_name exists), do NOT ask for name.
6. If customer already gave location or house_number, do NOT ask again.
7. Never repeat a question already answered in this session.
8. Ask for location ONLY when about to create a ticket — not during troubleshooting.` },
	      ],
	    },
	  ],
	});

	const raw = aiResult.response.text();

	// Remove ``` fences safely (no backticks in source)
	const FENCE = String.fromCharCode(96).repeat(3);

	const aiText = raw
	  .replace(FENCE + "json", "")
	  .replaceAll(FENCE, "")
	  .trim();

	let aiData;
	try {
	  aiData = JSON.parse(aiText);
	} catch (e) {

	  // fallback: try to extract JSON object from the text
	  const start = aiText.indexOf("{");
	  const end = aiText.lastIndexOf("}");
	  if (start >= 0 && end > start) {
	    aiData = JSON.parse(aiText.slice(start, end + 1));
	  } else {
	    throw new Error("AI returned non-JSON response");
	  }
	}

 	const normalizedIncoming = (text || "").trim().toLowerCase();

	// 4. UPDATE SESSION
	await pool.query(
	  `UPDATE sessions SET
	      customer_name = COALESCE($1, customer_name),
	      location_url = COALESCE(CASE WHEN $2 ~ '^https?://' THEN $2 ELSE NULL END, location_url),
	      house_number = COALESCE(CASE WHEN $2 !~ '^https?://' THEN $2 ELSE NULL END, house_number),
	      issue_details = COALESCE($3, issue_details),
	      step = $4,
	      issue_category = COALESCE($5, issue_category),
	      last_bot_question = $6,
	      last_action = $7,
	      troubleshooting_state = COALESCE(troubleshooting_state, '{}'::jsonb) || $8::jsonb,
	      last_interaction = NOW()
	   WHERE phone = $9`,
	  [
	    aiData?.name || null,
	    aiData?.location || null,
	    aiData?.issue || null,
	    aiData?.next_step || session.step || "ASK_NAME",
	    aiData?.issue_category || null,
	    aiData?.last_bot_question || null,
	    aiData?.action || null,
		JSON.stringify({
		  affected_scope: aiData?.affected_scope ?? session?.troubleshooting_state?.affected_scope ?? null,
		  area_scope: aiData?.area_scope ?? session?.troubleshooting_state?.area_scope ?? null,
		  restart_done: aiData?.restart_done ?? session?.troubleshooting_state?.restart_done ?? null,
		  location_pending:
		   aiData?.location
		    ? false
		    : (aiData?.location_pending ?? session?.troubleshooting_state?.location_pending ?? null),
		  location_requested_once:
		    session?.troubleshooting_state?.location_requested_once === true ||
		    aiData?.next_step === "ASK_LOCATION" ||
		    (aiData?.last_bot_question || "").toLowerCase().includes("location"),
		  partial_cctv_issue:
		    session?.troubleshooting_state?.partial_cctv_issue === true ||
		    (
		      (aiData?.issue_category === "cctv" || session?.issue_category === "cctv") &&
      			(
        		normalizedIncoming.includes("one camera") ||
        		normalizedIncoming.includes("only one camera") ||
        		normalizedIncoming.includes("other cameras are fine") ||
        		normalizedIncoming.includes("rest are fine") ||
		        normalizedIncoming.includes("others are fine") ||
		        normalizedIncoming.includes("only one is not working")
		      )
		    )
		}),

	    phone,
	  ]
	);

	// 5. ACTION HANDLING
	let finalReply = aiData?.reply || "Thank you. Could you please share your name and location with villa number?";

	const customerName = aiData?.name || session?.customer_name || "Valued Client";
	const issueText = aiData?.issue || session?.issue_details || text;
	const rawCategory = aiData?.issue_category || session?.issue_category || "unknown";

	// Parse aiData.location — split URL from house number if combined
	const rawLocation = aiData?.location || "";
	const urlMatch = rawLocation.match(/https?:\/\/[^\s]+/i);
	const extractedUrl = urlMatch ? urlMatch[0] : null;
	const extractedHouse = rawLocation.replace(/https?:\/\/[^\s]+/gi, '').trim() || null;
	// Use session values as fallback
	const resolvedLocationUrl = session?.location_url || extractedUrl || null;
	const resolvedHouseNumber = session?.house_number || extractedHouse || null;

	const categoryMap = {
	    "cctv": "CCTV",
	    "wifi_network": "Wi-Fi & Networking",
	    "internet_down": "Wi-Fi & Networking",
	    "slow_internet": "Wi-Fi & Networking",
	    "intercom": "Intercom",
	    "access_control": "Intercom",
	    "home_automation": "Light Automation",
	    "audio_speaker": "Smart Speaker",
	    "tv_streaming": "Smart Speaker",
	    "unknown": "Wi-Fi & Networking"
	};
	const issueCategory = categoryMap[rawCategory] || rawCategory;

	const explicitSiteVisitRequest =
	  normalizedIncoming.includes("site visit") ||
	  normalizedIncoming.includes("technician visit") ||
	  normalizedIncoming.includes("need technician") ||
	  normalizedIncoming.includes("prefer technician") ||
	  normalizedIncoming.includes("prefer site visit") ||
	  normalizedIncoming.includes("remote not possible") ||
	  normalizedIncoming.includes("remote not possible,") ||
	  normalizedIncoming.includes("remote not possible.") ||
	  normalizedIncoming.includes("not possible, need technician") ||
	  normalizedIncoming.includes("not possible need technician");

	if (
	  explicitSiteVisitRequest &&
	  session?.step === "TROUBLESHOOT"
	) {
	  aiData.action = "site_visit";
	}

	const locationPendingNow =
	  session?.troubleshooting_state?.location_pending === true;

	const alreadyHasIssue =
	  !!(session?.issue_details && String(session.issue_details).trim());

	if (
	  session?.step === "TROUBLESHOOT" &&
	  locationPendingNow &&
	  alreadyHasIssue &&
	  aiData?.next_step === "ASK_LOCATION" &&
	  !aiData?.location
	) {
	  aiData.next_step = "TROUBLESHOOT";
	  if (aiData.action === "ask_location") {
	    aiData.action = "continue_troubleshooting";
	  }
	}

	const partialCctvIssue =
	  (aiData?.issue_category === "cctv" || session?.issue_category === "cctv") &&
	  (
	    normalizedIncoming.includes("one camera") ||
	    normalizedIncoming.includes("only one camera") ||
	    normalizedIncoming.includes("other cameras are fine") ||
	    normalizedIncoming.includes("rest are fine") ||
	    normalizedIncoming.includes("others are fine") ||
	    normalizedIncoming.includes("only one is not working")
	  );

	if (
	  session?.step === "TROUBLESHOOT" &&
	  partialCctvIssue
	) {
	  if (aiData?.action === "ask_more_info" || aiData?.action === "continue_troubleshooting") {
	    aiData.action = "site_visit";
	  }

	  if (
	    aiData?.last_bot_question &&
	    aiData.last_bot_question.toLowerCase().includes("nvr")
	  ) {
	    aiData.last_bot_question = "Proceeding with site visit for partial CCTV issue";
	  }
	}

	if (aiData?.action === "resolved_in_chat") {
	  const customerId = await upsertWhatsAppCustomer(phone, customerName);

	  await createSupportActivity({
	    phone,
	    customerId,
	    customerName,
	    issue: issueText,
	    action: "resolved_in_chat",
	    issueCategory
	  });

	  finalReply =
	    aiData?.reply ||
	    `Glad to know the issue is resolved. If it happens again, please message us here.`;

	  await pool.query(
	    `UPDATE sessions
	     SET step = 'RESOLVED',
	         last_interaction = NOW()
	     WHERE phone = $1`,
	    [phone]
	  );

	} else if (aiData?.action === "remote_support" || aiData?.action === "site_visit") {
	  const customerId = await upsertWhatsAppCustomer(phone, customerName);
	  const ticketId = makeTicketId();

	  // ── Generate AI technical summary for Team Lead ──
	  let techSummary = null;
	  try {
	    const summaryModel = genAI.getGenerativeModel({
	      model: "gemini-2.5-flash",
	      generationConfig: { responseMimeType: "application/json" }
	    });
	    const summaryResult = await summaryModel.generateContent(
	      `You are a field operations assistant. Based on the conversation below, write a concise one-line technical summary for the Team Lead to understand and assign this ticket quickly.\n\nReturn ONLY JSON: {"summary": "your summary here"}\n\nRules:\n- Max 20 words\n- Include: system type, specific issue, recommended action\n- Example: "CCTV – 1 camera offline at entrance, other cameras working. Site visit required."\n- Example: "WiFi – full outage all devices after router restart. Remote support needed."\n\nConversation:\nCustomer: ${issueText}\nCategory: ${issueCategory}\nAction decided: ${aiData?.action}\nLocation: ${aiData?.location || session?.house_number || "not provided"}`
	    );
	    const summaryData = JSON.parse(summaryResult.response.text());
	    techSummary = summaryData?.summary || null;
	  } catch (e) {
	    console.error("AI summary generation failed (non-fatal):", e.message);
	    // Fallback: build a basic summary from available data
	    techSummary = `${issueCategory || "Support"} – ${issueText?.substring(0, 80)}. ${aiData?.action === "site_visit" ? "Site visit required." : "Remote support needed."}`;
	  }

	  await pool.query(
	    `INSERT INTO tickets (id, customer_id, customer_name, category, priority, status, location_url, house_number, ai_summary, messages, created_at, updated_at)
	     VALUES ($1, $2, $3, $4, $5, 'NEW', $6, $7, $8, $9, NOW(), NOW())`,
	    [
	      ticketId,
	      customerId,
	      customerName,
	      issueCategory || "SUPPORT",
	      aiData?.action === "site_visit" ? "HIGH" : "MEDIUM",
	      resolvedLocationUrl,
	      resolvedHouseNumber,
	      techSummary,
	      JSON.stringify([
	        {
	          sender: "CLIENT",
	          content: issueText,
	          at: new Date().toISOString()
	        },
	        {
	          sender: "SYSTEM",
	          content: techSummary || "AI Summary not available",
	          at: new Date().toISOString()
	        }
	      ])
	    ]
	  );

	  await createSupportActivity({
	    phone,
	    customerId,
	    customerName,
	    issue: issueText,
	    action: aiData?.action,
	    issueCategory
	  });

	  await pool.query(
	    `UPDATE sessions
	     SET ticket_id = $1,
	         step = 'OPEN_TICKET',
	         last_interaction = NOW()
	     WHERE phone = $2`,
	    [ticketId, phone]
	  );

	  // ── Notification 1: Notify all Team Leads of new ticket ──
	  const priorityLabel = aiData?.action === "site_visit" ? "HIGH" : "MEDIUM";
	  const actionLabel = aiData?.action === "site_visit" ? "Site Visit Required" : "Remote Support";
	  const locationLabel = aiData?.location || session?.house_number || "Not provided";
	  const aiSummary = `*New Ticket: ${ticketId}*\nCustomer: ${customerName}\nIssue: ${issueText}\nCategory: ${issueCategory || "Unknown"}\nPriority: ${priorityLabel}\nAction: ${actionLabel}\nLocation: ${locationLabel}`;
	  await notifyTeamLeads(aiSummary).catch(e => console.error("Team lead notify error:", e.message));

	  // ── n8n webhook trigger on ticket creation ──
	  if (process.env.N8N_WEBHOOK_URL) {
	    fetch(`${process.env.N8N_WEBHOOK_URL}/ticket-created`, {
	      method: "POST",
	      headers: { "Content-Type": "application/json" },
	      body: JSON.stringify({
	        ticketId,
	        customerName,
	        phone,
	        issueCategory,
	        priority: priorityLabel,
	        action: aiData?.action,
	        location: locationLabel,
	        summary: issueText
	      })
	    }).catch(e => console.error("n8n webhook error:", e.message));
	  }

	const hasLocationForVisit =
	  !!((aiData?.location || session?.house_number || "").trim());

	const locationPendingForVisit =
	  session?.troubleshooting_state?.location_pending === true;

	if (aiData?.action === "site_visit") {
	  finalReply =
	    !hasLocationForVisit || locationPendingForVisit
	      ? `Thank you ${customerName}. We have created a site visit ticket for your request. Your Ticket ID is ${ticketId}. Please share your location and villa number so we can schedule the appointment. Once scheduled, you will receive the details here.`
	      : `Thank you ${customerName}. We have created a site visit ticket for your request. Your Ticket ID is ${ticketId}. Our team will follow up shortly regarding the appointment. Once scheduled, you will receive the details here.`;
	} else {
	  finalReply = `Thank you ${customerName}. We have created a support ticket for remote review. Your Ticket ID is ${ticketId}. Our team will follow up shortly.`;
	}

	} else if (aiData?.action === "need_more_info") {
	  const customerId = await upsertWhatsAppCustomer(phone, customerName);

	  await createSupportActivity({
	    phone,
	    customerId,
	    customerName,
	    issue: issueText,
	    action: "need_more_info",
	    issueCategory
	  });

	  finalReply =
	    aiData?.reply ||
	    `Please share a photo, video, or a little more detail so we can proceed.`;

	} else if (
	  aiData?.action === "continue_troubleshooting" ||
	  aiData?.next_step === "TROUBLESHOOT"
	) {
	  finalReply =
	    aiData?.reply ||
	    `Understood. Let me check a few quick details to help you.`;
	}

        // 6. SEND REPLY & LOG
        await sendWhatsAppText(phone, finalReply);

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

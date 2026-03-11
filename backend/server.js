
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

  return data;
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

async function createSupportActivity({
  phone,
  customerId,
  customerName,
  issue,
  action,
  issueCategory
}) {
  const activityId = makeActivityId("WA");
  const reference = `WA-${Date.now().toString().slice(-6)}`;

  await pool.query(
    `INSERT INTO activities (
      id, reference, type, priority, status, customer_id, description, duration_hours, details, created_at, updated_at
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
    [
      activityId,
      reference,
      "WHATSAPP_SUPPORT",
      "MEDIUM",
      action === "resolved_in_chat" ? "COMPLETED" : "PLANNED",
      customerId,
      issue || "WhatsApp support interaction",
      0,
      JSON.stringify({
        channel: "whatsapp",
        phone,
        customerName,
        action,
        issueCategory: issueCategory || "unknown"
      })
    ]
  );

  return { activityId, reference };
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
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 2. Tickets Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        customer_id TEXT REFERENCES customers(id),
        customer_name TEXT,
        category TEXT,
        priority TEXT,
        status TEXT DEFAULT 'NEW',
        location_url TEXT,
        house_number TEXT,
        messages JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
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
        created_at TIMESTAMPTZ DEFAULT now()
      );
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
    
    console.log("✅ DB initialized with Tickets and Customers");
  } catch (err) {
    console.error("❌ DB initialization failed:", err);
  }
}

// Middleware
app.use(express.json({ limit: '10mb' })); 
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*', 
  methods: ['GET', 'POST', 'OPTIONS']
}));

// Check API Key
if (!process.env.API_KEY) {
  console.error("❌ FATAL ERROR: API_KEY is missing in backend/.env file.");
  console.error("AI features will not work.");
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==============================
// Tickets (PostgreSQL)
// ==============================

// 1. Get all tickets from DB
app.get("/api/tickets", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tickets ORDER BY updated_at DESC");
    res.json(result.rows);
  } catch (e) {
    console.error("Tickets fetch error:", e);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// 2. Create a new ticket in DB (Fixed for Foreign Key sync)
app.post("/api/tickets", async (req, res) => {
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
      `INSERT INTO tickets (id, customer_id, customer_name, category, priority, location_url, house_number, messages) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, customerId, customerName, category, priority, locationUrl, houseNumber, JSON.stringify(messages)]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Ticket creation error:", e);
    res.status(500).json({ error: "Failed to create ticket and customer" });
  } finally {
    client.release();
  }
});

// 3. Delete a ticket in DB (Admin only)
app.delete("/api/tickets/:id", async (req, res) => {
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
app.put("/api/tickets/:id/status", async (req, res) => {
    try {
        const { status } = req.body;
        const ticketId = req.params.id;

        // 1. Update the database
        await pool.query(
            "UPDATE tickets SET status = $1, updated_at = NOW() WHERE id = $2",
            [status, ticketId]
        );

        // 2. If the ticket is marked RESOLVED, send the automated review message
        if (status === 'RESOLVED') {
            // Get the customer's phone number
            const ticketData = await pool.query(`
                SELECT c.phone, c.name 
                FROM tickets t 
                JOIN customers c ON t.customer_id = c.id 
                WHERE t.id = $1
            `, [ticketId]);

            if (ticketData.rows.length > 0) {
                const customer = ticketData.rows[0];
                const reviewText = `Hi ${customer.name}, your Qonnect service request has been marked as resolved! We hope you are happy with our service. If you have a moment, please let us know how we did or reply here if you need further assistance.`;
                
                // IMPORTANT: We will replace 'YOUR_META_TOKEN' and 'YOUR_PHONE_ID' when we connect to Meta
                try {
                    await fetch(`https://graph.facebook.com/v17.0/${process.env.WA_PHONE_NUMBER_ID}/messages`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            messaging_product: "whatsapp",
                            to: customer.phone,
                            type: "text",
                            text: { body: reviewText }
                        })
                    });
                    console.log(`✅ Review request sent to ${customer.name}`);
                } catch (metaErr) {
                    console.error("Failed to send Meta message:", metaErr);
                }
            }
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
app.get("/api/customers", async (req, res) => {
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

    res.json(result.rows);
  } catch (e) {
    console.error("customers list error:", e);
    res.status(500).json({ error: "Failed to list customers" });
  }
});

// Create customer
app.post("/api/customers", async (req, res) => {
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
app.put("/api/customers/:id", async (req, res) => {
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
    res.json(rows[0]);
  } catch (e) {
    console.error("customers update error:", e);
    res.status(500).json({ error: "Failed to update customer" });
  }
});

// Delete customer
app.delete("/api/customers/:id", async (req, res) => {
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
app.post('/api/analyze', async (req, res) => {
  try {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY not configured on server");
    }

    const { message, history = [] } = req.body;
    console.log(`[Analyze] Processing message: "${message?.substring(0, 50)}..."`);

    const context = history.length > 0 ? `Conversation History:\n${history.join('\n')}\n\n` : '';

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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
                `Decide:\n` +
                `- Provide a short summary\n` +
                `- Choose service_category (ELV Systems / Home Automation / Unknown)\n` +
                `- Choose priority (LOW/MEDIUM/HIGH/URGENT)\n` +
                `- Decide if remote_possible\n` +
                `- Choose recommended_action (remote_support / assign_technician / request_more_info)\n` +
                `- Provide up to 3 suggested_questions\n` +
                `- Provide a professional draft_reply\n` +
                `- Provide confidence 0-100\n`
            }
          ]
        }
      ],
    });

    // CORRECTED DATA EXTRACTION
    const rawText = result.response.text();
    let data;
    try {
        data = JSON.parse(rawText);
    } catch (e) {
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
app.post('/api/chat', async (req, res) => {
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
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    
    if (rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });
    
    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
        { id: user.id, role: user.role, email: user.email }, 
        process.env.JWT_SECRET || 'fallback_secret', 
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

app.get("/api/users", async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, email, role as \"systemRole\", status FROM users");
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// ==============================
// Operations & Planning (Teams, Sites, Activities)
// ==============================

// GET Teams
app.get("/api/teams", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM teams");
    res.json(rows.map(r => ({
        id: r.id, name: r.name, leadId: r.lead_id, memberIds: r.member_ids,
        status: r.status, currentSiteId: r.current_site_id, workloadLevel: r.workload_level
    })));
  } catch (e) { res.status(500).json({error: "Failed to load teams"}); }
});

// GET Sites
app.get("/api/sites", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM sites");
    res.json(rows.map(r => ({
        id: r.id, name: r.name, clientName: r.client_name, location: r.location,
        priority: r.priority, status: r.status, assignedTeamId: r.assigned_team_id
    })));
  } catch (e) { res.status(500).json({error: "Failed to load sites"}); }
});

// GET Activities
app.get("/api/activities", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM activities ORDER BY created_at DESC");
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
app.post("/api/activities", async (req, res) => {
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
app.put("/api/activities/:id", async (req, res) => {
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
app.delete("/api/activities/:id", async (req, res) => {
    try {
        await pool.query("DELETE FROM activities WHERE id=$1", [req.params.id]);
        res.json({ok: true});
    } catch(e) { res.status(500).json({error: "Failed to delete activity"}); }
});

// ==============================
// Intent Detection
// ==============================
async function detectIntent(message, model) {
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
    const text = result.response.text();

    const parsed = JSON.parse(text);

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
app.get("/api/whatsapp/logs", async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM whatsapp_logs ORDER BY timestamp DESC LIMIT 200");
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
            return res.sendStatus(200);
        }

	if (!message || message.type !== 'text') return res.sendStatus(200);

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

	const intent = await detectIntent(text, model);
	console.log("Detected intent:", intent);

	// Intent detection (NEW)
	const intent = await detectIntent(text, model);
	console.log("Detected intent:", intent);

	// ==============================
	// Ticket Follow-up Handler
	// ==============================
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
	    await sendWhatsAppMessage(
	      phone,
	      "I could not find an active service request. Please briefly describe the issue and I will assist you."
	    );
	    return res.sendStatus(200);
	  }

	  const ticket = ticketResult.rows[0];

	  let reply = `Your service request *${ticket.id}* is currently *${ticket.status}*.`;

	  if (ticket.appointment_time) {
	    reply += `\n\nTechnician visit scheduled: ${ticket.appointment_time}`;
	  }

	  await sendWhatsAppMessage(phone, reply);

	  return res.sendStatus(200);
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

	  return res.sendStatus(200);
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

	    return res.sendStatus(200);
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

	  return res.sendStatus(200);
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
	2) If location is missing -> ask for location and villa number (ASK_LOCATION)
	3) If issue is missing -> ask for issue (ASK_ISSUE)
	4) If name, location, and issue are available -> move to TROUBLESHOOT
	5) In TROUBLESHOOT, do first-level troubleshooting over WhatsApp before deciding on ticket creation
	6) Do not create or confirm a ticket automatically

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

	const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

	const aiResult = await model.generateContent({
	  contents: [
	    {
	      role: "user",
	      parts: [
	        { text: systemPrompt },
		{ text: `CURRENT SESSION:\n${JSON.stringify(session, null, 2)}` },
		{ text: `CURRENT TROUBLESHOOTING STATE:\n${JSON.stringify(session?.troubleshooting_state || {}, null, 2)}` },
		{ text: `CUSTOMER MESSAGE:\n${text}` },
		{ text: `Important: If session.step is TROUBLESHOOT, continue troubleshooting and do not restart intake unless required information is actually missing. If troubleshooting_state.restart_done is true, do not ask for restart again. If troubleshooting_state.affected_scope or area_scope are already known, do not ask them again. If troubleshooting_state.location_pending is true and issue details are already available, do not ask for location again unless the workflow now requires site visit scheduling.` },
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
	      house_number = COALESCE($2, house_number),
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
	const issueCategory = aiData?.issue_category || session?.issue_category || "unknown";

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

	  await pool.query(
	    `INSERT INTO tickets (id, customer_id, customer_name, category, priority, status, house_number, messages, created_at, updated_at)
	     VALUES ($1, $2, $3, $4, $5, 'NEW', $6, $7, NOW(), NOW())`,
	    [
	      ticketId,
	      customerId,
	      customerName,
	      issueCategory || "SUPPORT",
	      aiData?.action === "site_visit" ? "HIGH" : "MEDIUM",
	      aiData?.location || session?.house_number || null,
	      JSON.stringify([
	        {
	          sender: "CLIENT",
	          content: issueText,
	          at: new Date().toISOString()
	        },
	        {
	          sender: "SYSTEM",
	          content: `Escalation decision: ${aiData?.action}`,
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

        res.sendStatus(200);
      } catch (error) {
        console.error("Webhook Error:", error);
        res.sendStatus(500);
      }
    });

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Backend server running on http://localhost:${PORT}`);
  });
});

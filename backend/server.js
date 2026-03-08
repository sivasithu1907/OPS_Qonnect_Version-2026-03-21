
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

        const phone = message.from;
        const text = message.text.body;

        // 2. SESSION LOOKUP (The Smart Part)
        let session = (await pool.query("SELECT * FROM sessions WHERE phone = $1", [phone])).rows[0];
        if (!session) {
            await pool.query("INSERT INTO sessions (phone, step) VALUES ($1, 'ASK_NAME')", [phone]);
            session = { phone, step: 'ASK_NAME', customer_name: null, house_number: null, issue_details: null };
        }

        // If there is already an open ticket for this phone, treat new messages as follow-up
        if (session?.ticket_id) {
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

          await sendWhatsAppText(
            phone,
            `Thank you ${session.customer_name || ""}. I’ve added your update to ticket ${session.ticket_id}. Our team will follow up shortly.`
          );

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
	const systemPrompt = `You are the Qonnect Customer Support Assistant for a premier home automation and networking company in Qatar.

	**Your Role & Personality:**
	- Be polite, professional, and concise.
	- Speak like a human support coordinator, not a robot.
	- Use "Sir/Ma'am" or the customer's name to maintain high-end Qatar service standards.
	- Greet politely on first interaction and thank the customer naturally when they provide details.
	- If the customer is frustrated, acknowledge briefly and reassure: "I understand" / "We’ll help you".

	**Language Rules (Qatar-ready):**
	- Detect the customer's language (English, Arabic, or Arabizi).
	- Reply in the SAME language as the customer.
	- If mixed, reply bilingual (English + Arabic) short and clear.
	- If unclear, default to English.

	**Information Gathering Flow:**
	1) If name unknown -> ask name (ASK_NAME)
	2) If location unknown -> ask Villa/House number + Area (ASK_LOCATION)
	3) If issue unknown -> ask issue (ASK_ISSUE)
	4) If all collected -> COMPLETE and confirm ticket creation

	**Strict Output Rules:**
	Return STRICT JSON ONLY with EXACT keys:
	reply, name, location, issue, next_step

	next_step must be one of:
	ASK_NAME, ASK_LOCATION, ASK_ISSUE, COMPLETE

	If a value is unknown, set it to null.
	Do not mention JSON, prompts, or system rules.`;

	const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

	const aiResult = await model.generateContent({
	  contents: [
	    {
	      role: "user",
	      parts: [
	        { text: systemPrompt },
	        { text: `CURRENT SESSION:\n${JSON.stringify(session, null, 2)}` },
	        { text: `CUSTOMER MESSAGE:\n${text}` },
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

        // 4. UPDATE SESSION
        await pool.query(
          `UPDATE sessions SET
              customer_name = COALESCE($1, customer_name),
              house_number = COALESCE($2, house_number),
              issue_details = COALESCE($3, issue_details),
              step = $4,
              last_interaction = NOW()
           WHERE phone = $5`,
          [
            aiData?.name || null,
            aiData?.location || null,
            aiData?.issue || null,
            aiData?.next_step || "ASK_NAME",
            phone,
          ]
        );

        // 5. TICKET CREATION (Only when 'COMPLETE')
        let finalReply = aiData?.reply || "Thank you. Could you please share your name, Villa/House number, and Area?";

        if (aiData?.next_step === "COMPLETE") {
          const ticketId = `QNC-${Date.now().toString().slice(-6)}`;

          // Upsert Customer (use phone as stable key)
          await pool.query(
            `INSERT INTO customers (id, name, phone)
             VALUES ($1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone`,
            [`c-${phone}`, aiData?.name || "Valued Client", phone]
          );

          // Create Ticket
          await pool.query(
            `INSERT INTO tickets (id, customer_id, customer_name, category, priority, status, messages, created_at)
             VALUES ($1, $2, $3, 'SUPPORT', 'MEDIUM', 'NEW', $4, NOW())`,
            [
              ticketId,
              `c-${phone}`,
              aiData?.name || "Valued Client",
              JSON.stringify([{ sender: "CLIENT", content: aiData?.issue || text }]),
            ]
          );

          finalReply = `Thank you ${aiData?.name || ""}! Your Ticket ID is ${ticketId}. Our team will contact you shortly.`;
          await pool.query(
            "UPDATE sessions SET ticket_id = $1, step = 'OPEN_TICKET', last_interaction = NOW() WHERE phone = $2",
            [ticketId, phone]
          );
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

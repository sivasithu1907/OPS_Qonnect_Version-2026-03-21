
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
        // Auto-fix the existing user in the live database!
        await pool.query("UPDATE users SET role = 'ADMIN' WHERE role = 'OPERATIONS_MANAGER'");
        console.log("✅ Admin Role Fixed in Database");
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

// 2. Create a new ticket in DB
app.post("/api/tickets", async (req, res) => {
  try {
    const { id, customerId, customerName, category, priority, locationUrl, houseNumber, messages } = req.body;
    const result = await pool.query(
      "INSERT INTO tickets (id, customer_id, customer_name, category, priority, location_url, house_number, messages) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
      [id, customerId, customerName, category, priority, locationUrl, houseNumber, JSON.stringify(messages)]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error("Ticket creation error:", e);
    res.status(500).json({ error: "Failed to create ticket" });
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
    
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
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
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            summary: { type: SchemaType.STRING },
            service_category: {
              type: SchemaType.STRING,
              enum: ["ELV Systems", "Home Automation", "Unknown"]
            },
            priority: {
              type: SchemaType.STRING,
              enum: ["LOW", "MEDIUM", "HIGH", "URGENT"]
            },
            remote_possible: { type: SchemaType.BOOLEAN },
            recommended_action: {
              type: SchemaType.STRING,
              enum: ["remote_support", "assign_technician", "request_more_info"]
            },
            suggested_questions: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING }
            },
            draft_reply: { type: SchemaType.STRING },
            confidence: { type: SchemaType.NUMBER }
          },
          required: [
            "summary",
            "service_category",
            "priority",
            "remote_possible",
            "recommended_action",
            "suggested_questions",
            "draft_reply",
            "confidence"
          ]
        }
      }
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
    
    const contents = history.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));
    
    contents.push({
      role: 'user',
      parts: [{ text: newMessage }]
    });

   // CORRECTED SYSTEM INSTRUCTION PLACEMENT
   const model = genAI.getGenerativeModel({ 
       model: "gemini-1.5-flash",
       systemInstruction: "You are Qonnect AI, a helpful field operations assistant."
   });
   
   const result = await model.generateContent({
      contents: contents
    });

    // CORRECTED DATA EXTRACTION
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
// WhatsApp Webhook Integration
// ==============================
app.get("/api/whatsapp/webhook", (req, res) => {
    // Meta/WhatsApp Verification
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // The verify token here must match the one you set in Meta Developer Dashboard
    if (mode === "subscribe" && token === "QONNECT_WA_TOKEN") {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post("/api/whatsapp/webhook", async (req, res) => {
    try {
        const body = req.body;
        // Verify this is from WhatsApp API
        if (body.object === "whatsapp_business_account") {
            for (let entry of body.entry) {
                for (let change of entry.changes) {
                    if (change.value && change.value.messages) {
                        const msg = change.value.messages[0];
                        const phone = msg.from; // Sender's phone number
                        const text = msg.text.body;

                        console.log(`[WhatsApp] New message from ${phone}: ${text}`);

                        // Find if an active ticket exists for this phone
                        const { rows: tickets } = await pool.query(
                            "SELECT * FROM tickets WHERE messages::text LIKE $1 AND status != 'RESOLVED' ORDER BY updated_at DESC LIMIT 1",
                            [`%${phone}%`]
                        );

                        if (tickets.length > 0) {
                            // Append message to existing ticket
                            const ticket = tickets[0];
                            const messages = ticket.messages || [];
                            messages.push({
                                id: `wa-${Date.now()}`,
                                sender: "CLIENT",
                                content: text,
                                timestamp: new Date().toISOString()
                            });

                            await pool.query(
                                "UPDATE tickets SET messages = $1, updated_at = NOW() WHERE id = $2",
                                [JSON.stringify(messages), ticket.id]
                            );
                        } else {
                            console.log(`[WhatsApp] No active ticket found for ${phone}.`);
                        }
                    }
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error("[WhatsApp Webhook Error]:", error);
        res.sendStatus(500);
    }
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Backend server running on http://localhost:${PORT}`);
  });
});

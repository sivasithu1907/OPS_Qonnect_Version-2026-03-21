# Qonnect Field Operations — Production Deployment Guide

---

## 1. First-Time Setup

### Environment File
Create your `.env` file on the server before doing anything else.

```bash
cp .env.example .env
nano .env
```

Fill in every value:

```env
API_KEY=your_google_gemini_api_key
JWT_SECRET=your_long_random_secret_string_here
PORT=8080
CORS_ORIGIN=https://ops.yourdomain.com
WA_VERIFY_TOKEN=your_meta_webhook_verify_token
WA_PHONE_NUMBER_ID=your_meta_phone_number_id
WA_ACCESS_TOKEN=your_meta_permanent_access_token
N8N_WEBHOOK_URL=                    # leave blank until n8n is set up
```

> **JWT_SECRET** — generate a strong one:
> ```bash
> openssl rand -base64 32
> ```

---

## 2. Deploy with Docker

```bash
docker compose up -d --build
```

The database initialises automatically on first run. All tables are created via `initDb()` in `server.js`.

---

## 3. Run Database Migration

After first deploy (and after every upgrade), run the migration script:

```bash
docker exec -i $(docker compose ps -q db) psql -U fieldops fieldops < DATABASE_MIGRATION.sql
```

This is safe to run multiple times — all statements use `IF NOT EXISTS`.

---

## 4. Post-Deploy Checklist

- [ ] Visit `https://ops.yourdomain.com/api/health` → should return `{"status":"ok"}`
- [ ] Log in as `admin@qonnect.qa` / `Qonnect@123` and change the password immediately
- [ ] Go to **User Management** → add WhatsApp phone numbers to all Team Lead accounts (required for notifications)
- [ ] Create your real users (Admin, Team Leads, Field Engineers)
- [ ] Test a WhatsApp message end-to-end

---

## 5. Nginx Reverse Proxy (Host Server)

Configure your host Nginx to proxy to the Docker containers:

```nginx
server {
    listen 443 ssl http2;
    server_name ops.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/ops.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ops.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    location /api/ {
        proxy_pass http://localhost:8080/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

---

## 6. Upgrading the System (Zero Data Loss)

Follow these steps every time you deploy a new version.

### Step 1 — Back up the database FIRST

Always back up before touching anything:

```bash
# Create a timestamped backup
docker exec $(docker compose ps -q db) pg_dump -U fieldops fieldops > backup_$(date +%Y%m%d_%H%M).sql

# Verify it's not empty
wc -l backup_*.sql
```

Store backups somewhere safe (outside the server — S3, Google Drive, etc).

### Step 2 — Pull the new code

```bash
git pull origin main
```

### Step 3 — Run the migration script

If the new version added new columns or tables, they'll be in `DATABASE_MIGRATION.sql`:

```bash
docker exec -i $(docker compose ps -q db) psql -U fieldops fieldops < DATABASE_MIGRATION.sql
```

Safe to run even if nothing changed — `IF NOT EXISTS` protects existing data.

### Step 4 — Rebuild and redeploy

```bash
docker compose up -d --build
```

Docker rebuilds only what changed. Existing data in the `postgres_data` volume is untouched.

### Step 5 — Verify

```bash
# Check all containers are running
docker compose ps

# Check backend health
curl https://ops.yourdomain.com/api/health

# Check logs if anything looks wrong
docker compose logs backend --tail=50
```

---

## 7. Rollback (If Something Goes Wrong)

If the new deployment breaks something:

```bash
# Stop the broken containers
docker compose down

# Restore the database from backup
docker compose up -d db
sleep 5
docker exec -i $(docker compose ps -q db) psql -U fieldops fieldops < backup_YYYYMMDD_HHMM.sql

# Redeploy the previous version
git checkout <previous_commit_hash>
docker compose up -d --build
```

---

## 8. Adding New Features (Schema Changes)

When you add a new feature that requires new database columns or tables:

**Always add to `DATABASE_MIGRATION.sql`** using `IF NOT EXISTS`:

```sql
-- Example: adding in-app chat feature
CREATE TABLE IF NOT EXISTS internal_chats (
    id TEXT PRIMARY KEY,
    sender_id TEXT REFERENCES users(id),
    receiver_id TEXT REFERENCES users(id),
    ticket_id TEXT REFERENCES tickets(id),
    content TEXT NOT NULL,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Example: adding a new column to existing table
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS chat_enabled BOOLEAN DEFAULT false;
```

Then follow the upgrade steps above. Existing data is never touched — only new columns/tables are added.

---

## 9. Useful Commands

```bash
# View live backend logs
docker compose logs -f backend

# View all container status
docker compose ps

# Restart backend only (without rebuild)
docker compose restart backend

# Connect to the database directly
docker exec -it $(docker compose ps -q db) psql -U fieldops fieldops

# List all tables
docker exec $(docker compose ps -q db) psql -U fieldops fieldops -c "\dt"

# Check ticket count
docker exec $(docker compose ps -q db) psql -U fieldops fieldops -c "SELECT COUNT(*) FROM tickets;"

# Manual backup
docker exec $(docker compose ps -q db) pg_dump -U fieldops fieldops > manual_backup.sql

# Stop everything
docker compose down

# Stop and wipe all data (DANGER — only for full reset)
docker compose down -v
```

---

## 10. Data Volume

Your PostgreSQL data is stored in a Docker named volume:

```yaml
postgres_data:/var/lib/postgresql/data
```

This volume **persists across restarts and rebuilds**. Your data is safe as long as you don't run `docker compose down -v`.

To see the volume:
```bash
docker volume ls | grep postgres
docker volume inspect postgres_data
```

---

## 11. n8n Integration (When Ready)

Once n8n is set up, add the webhook URL to your `.env`:

```env
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/qonnect
```

Then restart the backend:
```bash
docker compose restart backend
```

The backend will automatically start sending webhook triggers to n8n on:
- New ticket created (via WhatsApp)
- Ticket assigned to engineer

---

*Qonnect Field Operations — Production Guide v1.0*

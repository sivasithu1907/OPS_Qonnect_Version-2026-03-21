-- ============================================================
-- Qonnect Database Migration Script
-- PostgreSQL syntax — safe to run on live DB
-- All statements use IF NOT EXISTS so they can be
-- re-run without errors on an already-updated DB
-- ============================================================

-- 1. Users table additions
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- 2. Tickets table additions
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_tech_id TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS appointment_time TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS odoo_link TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS location_url TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS carry_forward_note TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS next_planned_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'Under Warranty';

-- 3. Customers table additions
ALTER TABLE customers ADD COLUMN IF NOT EXISTS building_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 4. Sessions table additions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS location_url TEXT;

-- 5. Fix old role names
UPDATE users SET role = 'ADMIN' WHERE role = 'OPERATIONS_MANAGER';

-- 6. Performance indexes
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone);
CREATE INDEX IF NOT EXISTS idx_activities_status ON activities(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_phone ON whatsapp_logs(phone);

-- ============================================================
-- Verification SELECTs
-- ============================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'users';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'tickets';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'customers';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions';

-- 8. Users avatar column
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;

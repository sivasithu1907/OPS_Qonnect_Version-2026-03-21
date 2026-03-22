-- ============================================================
-- Qonnect Database Migration Script
-- PostgreSQL syntax — safe to run on live DB
-- All statements use IF NOT EXISTS / IF EXISTS so they
-- can be re-run without errors on an already-updated DB
-- ============================================================

-- 1. Add phone column to users (for Team Lead WhatsApp notifications)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- 2. Add ai_summary column to tickets (AI-generated summary for Team Lead)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_summary TEXT;

-- 3. Fix any users stuck with old role name
UPDATE users SET role = 'ADMIN' WHERE role = 'OPERATIONS_MANAGER';

-- ============================================================
-- Verification — run these SELECTs to confirm migration worked
-- ============================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'users';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'tickets';

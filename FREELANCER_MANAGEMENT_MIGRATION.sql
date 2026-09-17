-- ============================================================
-- Freelancer Management — Migration Script
-- PostgreSQL syntax — safe to run on a live DB
-- All statements use IF NOT EXISTS / partial unique indexes so this
-- can be re-run any number of times without error or data loss.
--
-- NOTE: the backend also creates this exact schema automatically on
-- startup (initFreelancerSchema() in backend/freelancers.js, called from
-- initDb() in backend/server.js). Running this script manually is not
-- strictly required, but it matches the project's existing convention
-- (see DATABASE_MIGRATION.sql / SALES_FEATURE_MIGRATION.sql) and lets you
-- apply the schema before restarting the backend container.
-- ============================================================

-- 1. Freelancer profiles ------------------------------------------------
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

-- 2. Daily attendance (= the payable day) --------------------------------
CREATE TABLE IF NOT EXISTS freelancer_attendance (
  id TEXT PRIMARY KEY,
  freelancer_id TEXT NOT NULL REFERENCES freelancers(id),
  work_date DATE NOT NULL,
  agreed_daily_rate NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
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
CREATE UNIQUE INDEX IF NOT EXISTS uniq_attendance_active_per_day
  ON freelancer_attendance(freelancer_id, work_date) WHERE status = 'CONFIRMED';
CREATE INDEX IF NOT EXISTS idx_attendance_date ON freelancer_attendance(work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_freelancer ON freelancer_attendance(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON freelancer_attendance(status);
CREATE INDEX IF NOT EXISTS idx_attendance_payment_status ON freelancer_attendance(payment_status);
CREATE INDEX IF NOT EXISTS idx_attendance_sales_lead ON freelancer_attendance(sales_lead_id);
CREATE INDEX IF NOT EXISTS idx_attendance_team_lead ON freelancer_attendance(team_lead_id);

CREATE TABLE IF NOT EXISTS freelancer_attendance_id_seq (id BIGSERIAL PRIMARY KEY);

-- 3. Activities worked that day (snapshotted at confirmation time) ------
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

-- 4. Explicit per-project cost allocation of the daily wage --------------
CREATE TABLE IF NOT EXISTS freelancer_attendance_allocations (
  id BIGSERIAL PRIMARY KEY,
  attendance_id TEXT NOT NULL REFERENCES freelancer_attendance(id) ON DELETE CASCADE,
  activity_id TEXT,
  activity_reference TEXT,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_attalloc_attendance ON freelancer_attendance_allocations(attendance_id);

-- 5. Payments -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS freelancer_payments (
  id TEXT PRIMARY KEY,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  payment_method TEXT,
  recipient_freelancer_id TEXT NOT NULL REFERENCES freelancers(id),
  recipient_name_snapshot TEXT,
  reference TEXT,
  proof_attachment TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'RECORDED',
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

-- 6. CEO review links (expiring, revocable, unguessable read-only tokens) -
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

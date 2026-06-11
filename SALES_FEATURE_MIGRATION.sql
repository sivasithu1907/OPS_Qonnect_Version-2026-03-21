-- ============================================================
-- Qonnect Platform — Sales Appointment Requests Feature
-- Migration: SALES_FEATURE_MIGRATION.sql
-- Run ONCE on existing database, or let server.js auto-run on restart
-- (server.js uses CREATE TABLE IF NOT EXISTS so it is idempotent)
-- ============================================================

-- 1. Create the sales_appointment_requests table
CREATE TABLE IF NOT EXISTS sales_appointment_requests (
    id                          TEXT PRIMARY KEY,
    customer_id                 TEXT,
    customer_name               TEXT NOT NULL,
    contact_number              TEXT NOT NULL,
    location_url                TEXT NOT NULL,
    house_number                TEXT NOT NULL,
    odoo_reference              TEXT NOT NULL,
    activity_type               TEXT NOT NULL,
    service_category            TEXT NOT NULL,
    sales_lead_user_id          TEXT NOT NULL,
    sales_lead_name             TEXT NOT NULL,
    remarks                     TEXT,
    status                      TEXT NOT NULL DEFAULT 'PENDING_SCHEDULING',
    scheduled_date              DATE,
    scheduled_start_time        TEXT,
    scheduled_end_time          TEXT,
    assigned_field_engineer_id  TEXT,
    linked_activity_id          TEXT,
    created_by                  TEXT NOT NULL,
    updated_by                  TEXT,
    created_at                  TIMESTAMPTZ DEFAULT now(),
    updated_at                  TIMESTAMPTZ DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_sar_status       ON sales_appointment_requests(status);
CREATE INDEX IF NOT EXISTS idx_sar_sales_lead   ON sales_appointment_requests(sales_lead_user_id);
CREATE INDEX IF NOT EXISTS idx_sar_created      ON sales_appointment_requests(created_at DESC);

-- 3. Ensure existing SALES-level users have the correct system role
--    (Previously SALES level users had role='FIELD_ENGINEER' or role='NONE')
--    This safely updates them to role='SALES' so they can log in and get routed correctly.
UPDATE users
    SET role = 'SALES'
    WHERE level = 'SALES'
      AND role NOT IN ('ADMIN', 'TEAM_LEAD');

-- 4. Verification query (run manually to confirm)
-- SELECT id, name, email, role, level, status FROM users WHERE role = 'SALES';
-- SELECT count(*) FROM sales_appointment_requests;

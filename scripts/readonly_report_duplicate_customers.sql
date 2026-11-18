-- READ-ONLY report: customers that share the same mobile number once it is normalised.
--
-- Run from the project folder on the server (nothing is modified):
--   docker compose exec -T db psql -U fieldops -d fieldops -v ON_ERROR_STOP=1 < scripts/readonly_report_duplicate_customers.sql
-- It contains SELECT statements only: it changes nothing, merges nothing, deletes nothing.
--
-- "Same number" uses the SAME rule as the application (backend/customers.js phoneKey / utils/phoneUtils.ts):
--   digits only; a leading "+" or "(+" means international as written; a leading "00" is dropped;
--   a bare 8-digit number is a Qatar local number and gets the 974 prefix.
--   50000001 = +974 5000 0001 = 97450000001 = 0097450000001  ->  97450000001
--
-- Do NOT add a UNIQUE index on the phone until section 3 shows no groups (or each group has been reviewed by the
-- business and resolved — merging historical customers is a manual, per-case decision; this script never does it).

BEGIN READ ONLY;

-- 1. Summary
WITH k AS (
  SELECT id, name, phone,
         (CASE
            WHEN ltrim(phone) LIKE '+%' OR ltrim(phone) LIKE '(+%' THEN regexp_replace(phone, '[^0-9]', '', 'g')
            WHEN regexp_replace(phone, '[^0-9]', '', 'g') LIKE '00%' THEN substr(regexp_replace(phone, '[^0-9]', '', 'g'), 3)
            WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 8 THEN '974' || regexp_replace(phone, '[^0-9]', '', 'g')
            ELSE regexp_replace(phone, '[^0-9]', '', 'g')
          END) AS phone_key
  FROM customers
  WHERE coalesce(phone, '') <> ''
), d AS (SELECT phone_key, count(*) AS n FROM k WHERE phone_key <> '' GROUP BY phone_key HAVING count(*) > 1)
SELECT (SELECT count(*) FROM customers)                        AS customers_total,
       (SELECT count(*) FROM customers WHERE coalesce(phone,'') = '') AS customers_without_phone,
       (SELECT count(*) FROM d)                                AS duplicate_groups,
       (SELECT coalesce(sum(n), 0) FROM d)                     AS customers_in_duplicate_groups;

-- 2. Every duplicate group with the records it touches (for the business to review)
WITH k AS (
  SELECT c.id, c.name, c.phone, c.address, c.building_number, c.created_at, c.is_active,
         (CASE
            WHEN ltrim(c.phone) LIKE '+%' OR ltrim(c.phone) LIKE '(+%' THEN regexp_replace(c.phone, '[^0-9]', '', 'g')
            WHEN regexp_replace(c.phone, '[^0-9]', '', 'g') LIKE '00%' THEN substr(regexp_replace(c.phone, '[^0-9]', '', 'g'), 3)
            WHEN length(regexp_replace(c.phone, '[^0-9]', '', 'g')) = 8 THEN '974' || regexp_replace(c.phone, '[^0-9]', '', 'g')
            ELSE regexp_replace(c.phone, '[^0-9]', '', 'g')
          END) AS phone_key
  FROM customers c
  WHERE coalesce(c.phone, '') <> ''
), g AS (SELECT phone_key FROM k WHERE phone_key <> '' GROUP BY phone_key HAVING count(*) > 1)
SELECT k.phone_key, k.id, k.name, k.phone, k.address, k.building_number, k.is_active, k.created_at,
       (SELECT count(*) FROM tickets    t WHERE t.customer_id = k.id)                 AS tickets,
       (SELECT count(*) FROM activities a WHERE a.customer_id = k.id)                 AS activities,
       (SELECT count(*) FROM sales_appointment_requests s WHERE s.customer_id = k.id) AS sales_requests
FROM k JOIN g USING (phone_key)
ORDER BY k.phone_key, k.created_at NULLS LAST, k.id;

-- 3. Is a unique index safe? (expect 0 rows). If it returns rows, resolve them first.
WITH k AS (
  SELECT (CASE
            WHEN ltrim(phone) LIKE '+%' OR ltrim(phone) LIKE '(+%' THEN regexp_replace(phone, '[^0-9]', '', 'g')
            WHEN regexp_replace(phone, '[^0-9]', '', 'g') LIKE '00%' THEN substr(regexp_replace(phone, '[^0-9]', '', 'g'), 3)
            WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 8 THEN '974' || regexp_replace(phone, '[^0-9]', '', 'g')
            ELSE regexp_replace(phone, '[^0-9]', '', 'g')
          END) AS phone_key
  FROM customers WHERE coalesce(phone, '') <> ''
)
SELECT phone_key, count(*) AS customers FROM k WHERE phone_key <> '' GROUP BY phone_key HAVING count(*) > 1 ORDER BY 2 DESC;

-- 4. Customers whose location is not a usable link (these show "Location Missing" and need a Google Maps URL the next
--    time they are edited in the Clients form). Informational only.
SELECT count(*) FILTER (WHERE coalesce(address, '') = '')                                  AS no_location,
       count(*) FILTER (WHERE coalesce(address, '') <> '' AND address !~* '^https?://')     AS text_address_only,
       count(*) FILTER (WHERE address ~* '^https?://')                                      AS has_link
FROM customers;

ROLLBACK;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- PROPOSAL ONLY — NOT APPLIED, NOT PART OF ANY MIGRATION IN THIS PATCH.
-- The application already prevents duplicates (backend check under a per-number advisory lock). A database-level
-- guarantee could be added AFTER section 3 above returns zero rows on the production data:
--
--   CREATE UNIQUE INDEX CONCURRENTLY customers_phone_key_uidx ON customers ((
--     CASE
--       WHEN ltrim(phone) LIKE '+%' OR ltrim(phone) LIKE '(+%' THEN regexp_replace(phone, '[^0-9]', '', 'g')
--       WHEN regexp_replace(phone, '[^0-9]', '', 'g') LIKE '00%' THEN substr(regexp_replace(phone, '[^0-9]', '', 'g'), 3)
--       WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 8 THEN '974' || regexp_replace(phone, '[^0-9]', '', 'g')
--       ELSE regexp_replace(phone, '[^0-9]', '', 'g')
--     END))
--   WHERE coalesce(phone, '') <> '';
--
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS customers_phone_key_uidx;
-- Caveat: with the index in place a duplicate insert raises a unique-violation (SQLSTATE 23505); the routes in this
-- patch would need to map that to the same 409 DUPLICATE_PHONE answer before the index is created.

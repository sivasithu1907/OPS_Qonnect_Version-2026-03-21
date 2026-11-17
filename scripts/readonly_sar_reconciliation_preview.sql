-- ============================================================================
-- READ-ONLY PREVIEW of what the backend's start-up SAR reconciliation would change.
--
--   * SELECT statements only, inside a READ ONLY transaction that is rolled back.
--     It cannot change data; a write attempt would be refused by PostgreSQL.
--   * Uses EXACTLY the approved status mapping of reconcileSarStatuses()
--     (backend/server.js) and the same selection rule:
--         SAR.linked_activity_id -> activity, SAR.status <> 'LINKED', SAR.status <> mapped status.
--     (PLANNED/ASSIGNED->SCHEDULED, ON_MY_WAY/ARRIVED/IN_PROGRESS->IN_PROGRESS,
--      CARRY_FORWARD->CARRY_FORWARD, DONE->COMPLETED, CANCELLED->CANCELLED)
--   * Prints SAR id, customer name and statuses only: no phone numbers, links or notes.
--   * Does NOT run or replace the reconciliation. Run it BEFORE the first start of a new build.
--
-- Usage (nothing is modified):
--   docker compose exec -T db psql -U fieldops -d fieldops -v ON_ERROR_STOP=1 < scripts/readonly_sar_reconciliation_preview.sql
-- ============================================================================
BEGIN TRANSACTION READ ONLY;

\echo '== 1. Summary: SAR rows the start-up reconciliation WOULD change, by (current -> new) status'
WITH mapping(activity_status, sar_status) AS (VALUES
  ('PLANNED','SCHEDULED'),('ASSIGNED','SCHEDULED'),('ON_MY_WAY','IN_PROGRESS'),('ARRIVED','IN_PROGRESS'),
  ('IN_PROGRESS','IN_PROGRESS'),('CARRY_FORWARD','CARRY_FORWARD'),('DONE','COMPLETED'),('CANCELLED','CANCELLED'))
SELECT sar.status AS sar_status_now, m.sar_status AS would_become, a.status AS activity_status, COUNT(*) AS sar_rows
  FROM sales_appointment_requests sar
  JOIN activities a ON a.id = sar.linked_activity_id
  JOIN mapping m    ON m.activity_status = a.status
 WHERE sar.status <> 'LINKED' AND sar.status <> m.sar_status
 GROUP BY 1,2,3 ORDER BY 4 DESC, 1, 2;

\echo '== 2. Row detail (what would change). review_flag = REVIEW when the current SAR status is not one of the five automatic lifecycle values, i.e. a person or another workflow may have set it on purpose'
WITH mapping(activity_status, sar_status) AS (VALUES
  ('PLANNED','SCHEDULED'),('ASSIGNED','SCHEDULED'),('ON_MY_WAY','IN_PROGRESS'),('ARRIVED','IN_PROGRESS'),
  ('IN_PROGRESS','IN_PROGRESS'),('CARRY_FORWARD','CARRY_FORWARD'),('DONE','COMPLETED'),('CANCELLED','CANCELLED'))
SELECT sar.id AS sar_id, sar.customer_name, sar.status AS sar_status_now, m.sar_status AS would_become,
       a.id AS activity_id, a.reference AS activity_ref, a.status AS activity_status,
       to_char(a.updated_at AT TIME ZONE 'Asia/Qatar','YYYY-MM-DD HH24:MI') AS activity_updated_qatar,
       to_char(sar.updated_at AT TIME ZONE 'Asia/Qatar','YYYY-MM-DD HH24:MI') AS sar_updated_qatar,
       CASE WHEN sar.status IN ('SCHEDULED','IN_PROGRESS','CARRY_FORWARD','COMPLETED','CANCELLED') THEN 'routine drift' ELSE 'REVIEW' END AS review_flag
  FROM sales_appointment_requests sar
  JOIN activities a ON a.id = sar.linked_activity_id
  JOIN mapping m    ON m.activity_status = a.status
 WHERE sar.status <> 'LINKED' AND sar.status <> m.sar_status
 ORDER BY review_flag DESC, a.updated_at DESC, sar.id;

\echo '== 3. SAR rows that would NOT be touched, and why (counts only)'
WITH mapping(activity_status, sar_status) AS (VALUES
  ('PLANNED','SCHEDULED'),('ASSIGNED','SCHEDULED'),('ON_MY_WAY','IN_PROGRESS'),('ARRIVED','IN_PROGRESS'),
  ('IN_PROGRESS','IN_PROGRESS'),('CARRY_FORWARD','CARRY_FORWARD'),('DONE','COMPLETED'),('CANCELLED','CANCELLED'))
SELECT reason, COUNT(*) AS sar_rows FROM (
  SELECT CASE
           WHEN sar.linked_activity_id IS NULL                       THEN 'no linked activity'
           WHEN sar.status = 'LINKED'                                THEN 'status LINKED (intentionally excluded)'
           WHEN a.id IS NULL                                         THEN 'linked activity id does not exist (orphan link)'
           WHEN m.activity_status IS NULL                            THEN 'activity status has no approved mapping (' || a.status || ')'
           WHEN sar.status = m.sar_status                            THEN 'already correct'
           ELSE 'WOULD CHANGE (see 1 and 2)' END AS reason
    FROM sales_appointment_requests sar
    LEFT JOIN activities a ON a.id = sar.linked_activity_id
    LEFT JOIN mapping m    ON m.activity_status = a.status
) x GROUP BY reason ORDER BY 2 DESC;

\echo '== 4. Totals'
SELECT (SELECT COUNT(*) FROM sales_appointment_requests) AS sar_rows_total,
       (SELECT COUNT(*) FROM sales_appointment_requests WHERE linked_activity_id IS NOT NULL) AS sar_rows_linked;

ROLLBACK;

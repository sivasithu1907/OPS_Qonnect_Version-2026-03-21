-- ============================================================================
-- READ-ONLY diagnostic: find jobs whose photos may already have been replaced
-- by the "HAS_PHOTOS" placeholder (QA-03, audited commit 1afd2db behaviour).
--
--   * Contains SELECT statements only, inside a READ ONLY transaction that is
--     rolled back at the end. It cannot change data.
--   * Does NOT repair anything. Original photo bytes that were overwritten are
--     not in these tables any more; recovery (if any) can only come from a
--     database backup taken BEFORE the overwrite — a separate decision.
--   * Photo contents are never printed (they are large) — only ids and counts.
--
-- Run from the project folder on the server (nothing is modified):
--   docker compose exec -T db psql -U fieldops -d fieldops -v ON_ERROR_STOP=1 < scripts/readonly_check_photo_placeholders.sql
-- ============================================================================
BEGIN TRANSACTION READ ONLY;

\echo '== 1. Summary: how many records currently hold only/also the placeholder'
SELECT 'tickets'    AS kind,
       COUNT(*)                                                         AS total_records,
       COUNT(*) FILTER (WHERE photos::text LIKE '%HAS_PHOTOS%')         AS with_placeholder,
       COUNT(*) FILTER (WHERE photos = '["HAS_PHOTOS"]'::jsonb)         AS placeholder_only,
       COUNT(*) FILTER (WHERE photos IS NOT NULL AND photos <> '[]'::jsonb AND photos::text NOT LIKE '%HAS_PHOTOS%') AS with_real_photos
  FROM tickets
UNION ALL
SELECT 'activities',
       COUNT(*),
       COUNT(*) FILTER (WHERE details::text LIKE '%HAS_PHOTOS%'),
       COUNT(*) FILTER (WHERE details->'photos' = '["HAS_PHOTOS"]'::jsonb),
       COUNT(*) FILTER (WHERE details ? 'photos' AND details->'photos' <> '[]'::jsonb AND (details->'photos')::text NOT LIKE '%HAS_PHOTOS%')
  FROM activities;

\echo '== 2. Tickets whose stored photos contain the placeholder (original photos already replaced)'
SELECT id, customer_name, status, assigned_tech_id, updated_at,
       jsonb_array_length(photos) AS entries_in_photos
  FROM tickets
 WHERE photos::text LIKE '%HAS_PHOTOS%'
 ORDER BY updated_at DESC NULLS LAST;

\echo '== 3. Activities whose stored photos contain the placeholder'
SELECT id, type, status, lead_tech_id, planned_date, updated_at,
       jsonb_array_length(COALESCE(details->'photos','[]'::jsonb)) AS entries_in_photos
  FROM activities
 WHERE details::text LIKE '%HAS_PHOTOS%'
 ORDER BY updated_at DESC NULLS LAST;

\echo '== 4. By month of last update (shows when the overwriting happened)'
SELECT to_char(date_trunc('month', updated_at), 'YYYY-MM') AS month, 'ticket' AS kind, COUNT(*) AS records
  FROM tickets WHERE photos::text LIKE '%HAS_PHOTOS%' GROUP BY 1
UNION ALL
SELECT to_char(date_trunc('month', updated_at), 'YYYY-MM'), 'activity', COUNT(*)
  FROM activities WHERE details::text LIKE '%HAS_PHOTOS%' GROUP BY 1
ORDER BY 1, 2;

\echo '== 5. REVIEW CANDIDATES ONLY (not proof of loss): finished jobs that have no photo at all'
\echo '      Many jobs legitimately have none; use together with section 2/3 and field knowledge.'
SELECT 'ticket' AS kind, id, customer_name AS label, status, updated_at
  FROM tickets
 WHERE status IN ('RESOLVED','CLOSED','COMPLETED')
   AND (photos IS NULL OR photos = '[]'::jsonb)
UNION ALL
SELECT 'activity', id, COALESCE(details->>'customerName', type), status, updated_at
  FROM activities
 WHERE status = 'DONE'
   AND (NOT (details ? 'photos') OR details->'photos' = '[]'::jsonb)
 ORDER BY updated_at DESC NULLS LAST
 LIMIT 200;

\echo '== 6. Is there any history that could help? (audit log entries for these records)'
SELECT entity_type, COUNT(*) AS audit_rows, MIN(created_at) AS first_entry, MAX(created_at) AS last_entry
  FROM audit_logs
 WHERE entity_type IN ('TICKET','ACTIVITY')
 GROUP BY 1;

ROLLBACK;

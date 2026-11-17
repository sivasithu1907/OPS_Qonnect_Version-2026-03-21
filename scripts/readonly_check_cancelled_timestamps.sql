-- ============================================================================
-- READ-ONLY check: CANCELLED activities that still carry a completion time.
-- A cancelled job must never look "completed" in reports (QA-09 follow-up).
-- SELECT only, READ ONLY transaction, rolled back. Prints ids/counts, no customer data.
--   docker compose exec -T db psql -U fieldops -d fieldops -v ON_ERROR_STOP=1 < scripts/readonly_check_cancelled_timestamps.sql
-- ============================================================================
BEGIN TRANSACTION READ ONLY;
\echo '== 1. Cancelled activities: with / without completed_at and started_at'
SELECT COUNT(*) AS cancelled_total,
       COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS with_completed_at,
       COUNT(*) FILTER (WHERE started_at   IS NOT NULL) AS with_started_at,
       COUNT(*) FILTER (WHERE started_at IS NOT NULL AND completed_at IS NOT NULL) AS would_count_in_avg_duration
  FROM activities WHERE status = 'CANCELLED';
\echo '== 2. The cancelled activities that carry a completed_at (id, reference, times)'
SELECT id, reference, started_at, completed_at FROM activities
 WHERE status = 'CANCELLED' AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 50;
ROLLBACK;

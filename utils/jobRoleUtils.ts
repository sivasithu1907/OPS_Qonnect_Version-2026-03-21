/**
 * jobRoleUtils.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for "who is involved in this job, and in what role".
 *
 * Before this file existed, this question was answered independently in at
 * least 9 places across the app (Activity Planner calendar, Operations
 * Monitor's timeline and staff panel, the TV Display calendar, the Mobile
 * Lead/Tech Portal schedule and history views, CompletedJobSummary), each
 * with a slightly different — and sometimes incomplete — version of the
 * same comparison. Every "this person's row is empty even though they're
 * genuinely on the job" bug found in this app so far traced back to one of
 * those copies missing a role (most often supportingEngineerIds).
 *
 * Going forward, every place that needs to answer "is person X on job Y"
 * should call isInvolvedInJob() or getJobRole() from here instead of
 * re-deriving the comparison inline.
 */

// Minimal shape covering the fields used across tickets and activities.
// Intentionally loose (not importing the full Activity/Ticket types) so this
// can be called from any context without type friction — callers pass
// whatever object they have; only the relevant fields are read.
export interface JobLike {
  leadTechId?: string | null;
  primaryEngineerId?: string | null;
  supportingEngineerIds?: string[] | null;
  assistantTechIds?: string[] | null;
  assignedTechId?: string | null; // tickets use this single field instead of the four above
  salesLeadId?: string | null;
  assignedTeamId?: string | null;
}

export type JobRole = 'LEAD' | 'PRIMARY' | 'SUPPORTING' | 'TECHNICAL_ASSOCIATE' | 'ASSIGNED' | 'SALES_LEAD' | 'TEAM' | null;

/**
 * Returns true if personId is involved in this job in ANY capacity —
 * lead, primary engineer, supporting engineer, technical associate,
 * ticket assignee, sales lead, or via team assignment.
 *
 * This is intentionally permissive (OR across every role) because "is this
 * job mine" should almost always mean "any capacity", not just "am I the
 * lead". Use getJobRole() instead when the caller needs to distinguish
 * which capacity, e.g. to render a "Lead" vs "Supporting" tag.
 */
export function isInvolvedInJob(job: JobLike, personId: string | null | undefined): boolean {
  if (!personId) return false;
  return (
    job.leadTechId === personId ||
    job.primaryEngineerId === personId ||
    job.assignedTechId === personId ||
    job.salesLeadId === personId ||
    job.assignedTeamId === personId ||
    (job.supportingEngineerIds || []).includes(personId) ||
    (job.assistantTechIds || []).includes(personId)
  );
}

/**
 * Returns the most relevant single role for personId on this job, for
 * display purposes (e.g. a "Lead" / "Supporting" / "TA" tag on a card).
 * Precedence: Lead/Primary > Supporting > Technical Associate > Assigned
 * (ticket) > Sales Lead > Team. A person rarely occupies more than one of
 * these on the same job, but if they do, this is the order that makes the
 * most sense to show first.
 */
export function getJobRole(job: JobLike, personId: string | null | undefined): JobRole {
  if (!personId) return null;
  if (job.leadTechId === personId) return 'LEAD';
  if (job.primaryEngineerId === personId) return 'PRIMARY';
  if ((job.supportingEngineerIds || []).includes(personId)) return 'SUPPORTING';
  if ((job.assistantTechIds || []).includes(personId)) return 'TECHNICAL_ASSOCIATE';
  if (job.assignedTechId === personId) return 'ASSIGNED';
  if (job.salesLeadId === personId) return 'SALES_LEAD';
  if (job.assignedTeamId === personId) return 'TEAM';
  return null;
}

/** Short display label for a JobRole, e.g. for a tag/badge. */
export function jobRoleLabel(role: JobRole): string {
  switch (role) {
    case 'LEAD': return 'Lead';
    case 'PRIMARY': return 'Lead';
    case 'SUPPORTING': return 'Supporting';
    case 'TECHNICAL_ASSOCIATE': return 'TA';
    case 'ASSIGNED': return 'Assigned';
    case 'SALES_LEAD': return 'Sales Lead';
    case 'TEAM': return 'Team';
    default: return '';
  }
}

/**
 * Returns every person ID genuinely involved in this job, deduplicated.
 * Useful for "notify everyone on this job" or "count this job toward
 * everyone's workload" style logic.
 */
export function getAllInvolvedIds(job: JobLike): string[] {
  const ids = [
    job.leadTechId,
    job.primaryEngineerId,
    job.assignedTechId,
    job.salesLeadId,
    job.assignedTeamId,
    ...(job.supportingEngineerIds || []),
    ...(job.assistantTechIds || []),
  ].filter((id): id is string => !!id);
  return Array.from(new Set(ids));
}

/**
 * Returns the IDs of everyone involved EXCEPT personId — useful for
 * building "who else is on this job" tag lists on a specific person's own
 * card, where they should never see themselves listed as their own
 * supporter/colleague.
 */
export function getOtherInvolvedIds(job: JobLike, personId: string | null | undefined): string[] {
  return getAllInvolvedIds(job).filter(id => id !== personId);
}

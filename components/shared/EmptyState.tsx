/**
 * EmptyState.tsx — Sprint 2.2 premium empty state library.
 *
 * One shared component for consistent, positive, action-guiding empty states
 * across every module.  Individual pages use the <EmptyState> primitive or
 * one of the pre-configured named exports — never raw "No Data" text.
 *
 * Design principles:
 *  • Positive framing — the system is healthy, not broken.
 *  • Guide the user — tell them why and what they can do.
 *  • Action buttons only when the user actually has permission.
 *  • Never colour-only — icon shape + text always communicate the state.
 *  • Consistent spacing: py-16 for full-page, py-10 for inline panels.
 */
import React from 'react';
import {
  Calendar, Ticket, ClipboardList, Users, BarChart2, MessageCircle,
  Inbox, Star, RefreshCw, ShieldCheck, Contact, Search, Activity,
  Smartphone, CheckCircle2, FileText, Zap, Clock
} from 'lucide-react';

/* ── Primitive ──────────────────────────────────────────────────────────── */
interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  /** Optional CTA — only rendered when the consumer passes it (permission guard is the consumer's job). */
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  };
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  size = 'md',
  className = '',
}) => {
  const padding = size === 'sm' ? 'py-8' : size === 'lg' ? 'py-20' : 'py-14';
  const iconBox = size === 'sm' ? 'w-10 h-10' : size === 'lg' ? 'w-16 h-16' : 'w-12 h-12';
  const iconSize = size === 'sm' ? 'text-xl' : size === 'lg' ? 'text-3xl' : 'text-2xl';
  const titleClass = size === 'sm' ? 'text-sm font-semibold' : size === 'lg' ? 'text-lg font-bold' : 'text-base font-semibold';
  const descClass = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div className={`flex flex-col items-center justify-center ${padding} text-center px-6 ${className}`}>
      {/* Icon container — Qonnect amber-tinted, consistent rounding */}
      <div className={`${iconBox} rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mb-4 ${iconSize} text-slate-400`}>
        {icon}
      </div>

      <h3 className={`${titleClass} text-slate-700 mb-1.5`}>{title}</h3>
      <p className={`${descClass} text-slate-500 max-w-xs leading-relaxed`}>{description}</p>

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={`mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all active:scale-[0.97] ${
            action.variant === 'secondary'
              ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              : 'bg-[#FFCC00] text-slate-900 hover:bg-amber-400 shadow-sm'
          }`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

/* ── Pre-configured named empty states ──────────────────────────────────── */

/** Activity Planner — when a kanban column or list view has no activities */
export const EmptyActivities: React.FC<{
  context?: 'column' | 'list' | 'period';
  onCreateActivity?: () => void;
}> = ({ context = 'list', onCreateActivity }) => {
  const messages = {
    column: {
      title: 'Nothing here yet',
      description: 'No activities in this status.',
    },
    list: {
      title: 'All clear',
      description: 'No planned activities for this period. Create one to get started.',
    },
    period: {
      title: 'Quiet period',
      description: 'There are no activities scheduled for the selected date range.',
    },
  };
  const { title, description } = messages[context];

  return (
    <EmptyState
      icon={<Calendar size={context === 'column' ? 18 : 22} />}
      title={title}
      description={description}
      size={context === 'column' ? 'sm' : 'md'}
      action={onCreateActivity ? { label: '+ Create Activity', onClick: onCreateActivity } : undefined}
    />
  );
};

/** Active Tickets */
export const EmptyTickets: React.FC<{
  filtered?: boolean;
  onClearFilters?: () => void;
  onCreateTicket?: () => void;
}> = ({ filtered, onClearFilters, onCreateTicket }) => (
  <EmptyState
    icon={<Ticket size={22} />}
    title={filtered ? 'No matching tickets' : 'All caught up'}
    description={
      filtered
        ? 'No tickets match the current filters. Try adjusting your search or status selection.'
        : 'There are no open tickets right now. Every reported issue has been resolved.'
    }
    action={
      filtered && onClearFilters
        ? { label: 'Clear Filters', onClick: onClearFilters, variant: 'secondary' }
        : !filtered && onCreateTicket
        ? { label: '+ New Ticket', onClick: onCreateTicket }
        : undefined
    }
  />
);

/** SAR list */
export const EmptySAR: React.FC<{
  filtered?: boolean;
  isSales?: boolean;
  onCreateSAR?: () => void;
  onClearFilters?: () => void;
}> = ({ filtered, isSales, onCreateSAR, onClearFilters }) => (
  <EmptyState
    icon={<ClipboardList size={22} />}
    title={filtered ? 'No requests found' : 'No pending requests'}
    description={
      filtered
        ? 'Try adjusting your search or status filter.'
        : isSales
        ? 'Submit your first appointment request to get started.'
        : 'All sales appointment requests have been scheduled or resolved.'
    }
    action={
      filtered && onClearFilters
        ? { label: 'Clear Filters', onClick: onClearFilters, variant: 'secondary' }
        : !filtered && onCreateSAR
        ? { label: '+ New Request', onClick: onCreateSAR }
        : undefined
    }
  />
);

/** Clients */
export const EmptyClients: React.FC<{
  filtered?: boolean;
  onClearFilters?: () => void;
  onCreateClient?: () => void;
}> = ({ filtered, onClearFilters, onCreateClient }) => (
  <EmptyState
    icon={<Contact size={22} />}
    title={filtered ? 'No clients match' : 'No clients yet'}
    description={
      filtered
        ? 'No clients match the current search. Try a different name or phone number.'
        : 'Add your first client to start managing service records and history.'
    }
    action={
      filtered && onClearFilters
        ? { label: 'Clear Search', onClick: onClearFilters, variant: 'secondary' }
        : !filtered && onCreateClient
        ? { label: '+ Add Client', onClick: onCreateClient }
        : undefined
    }
  />
);

/** Operations Monitor */
export const EmptyOpsMonitor: React.FC = () => (
  <EmptyState
    icon={<Activity size={22} />}
    title="No active operations"
    description="There are no live field events right now. Check back when activities are underway."
    size="lg"
  />
);

/** Master Dashboard — table with no jobs */
export const EmptyJobsTable: React.FC<{ filtered?: boolean }> = ({ filtered }) => (
  <EmptyState
    icon={<BarChart2 size={22} />}
    title={filtered ? 'No jobs match the filters' : 'No jobs yet'}
    description={
      filtered
        ? 'Try widening the date range or clearing status filters.'
        : 'Tickets and activities will appear here as they are created.'
    }
    size="sm"
  />
);

/** WhatsApp / messages */
export const EmptyMessages: React.FC = () => (
  <EmptyState
    icon={<MessageCircle size={22} />}
    title="No messages yet"
    description="WhatsApp conversation will appear here once a customer sends a message."
  />
);

/** Service Feedback */
export const EmptyFeedback: React.FC<{ followUpOnly?: boolean }> = ({ followUpOnly }) => (
  <EmptyState
    icon={<Star size={22} />}
    title={followUpOnly ? 'No follow-ups pending' : 'No feedback yet'}
    description={
      followUpOnly
        ? 'All clients who requested follow-up have been contacted.'
        : 'Customer feedback will appear here after jobs are completed and reviews are submitted.'
    }
  />
);

/** Audit log */
export const EmptyAuditLog: React.FC = () => (
  <EmptyState
    icon={<ShieldCheck size={22} />}
    title="No audit events"
    description="No system activity matches the current filters. Try a different date range or action type."
    size="sm"
  />
);

/** AMC Contracts */
export const EmptyAMC: React.FC = () => (
  <EmptyState
    icon={<RefreshCw size={22} />}
    title="No AMC contracts yet"
    description="Set up an Annual Maintenance Contract to automatically schedule service visits ahead of each due date."
  />
);

/** Team management */
export const EmptyTeam: React.FC<{ onAddUser?: () => void }> = ({ onAddUser }) => (
  <EmptyState
    icon={<Users size={22} />}
    title="No team members"
    description="Add engineers and technical associates to start assigning jobs and tracking field performance."
    action={onAddUser ? { label: '+ Add User', onClick: onAddUser } : undefined}
  />
);

/** Search / filter (generic fallback) */
export const EmptySearch: React.FC<{ query?: string; onClear?: () => void }> = ({ query, onClear }) => (
  <EmptyState
    icon={<Search size={22} />}
    title={query ? `No results for "${query}"` : 'No results found'}
    description="Try a different keyword or adjust your filters."
    action={onClear ? { label: 'Clear Search', onClick: onClear, variant: 'secondary' } : undefined}
    size="sm"
  />
);

/** Lead Portal — no assigned tickets */
export const EmptyLeadPortal: React.FC = () => (
  <EmptyState
    icon={<Smartphone size={22} />}
    title="No assigned work"
    description="There are no tickets or activities assigned to this team right now. New jobs will appear here."
    size="lg"
  />
);

/** Tech Portal — no active assignments */
export const EmptyTechPortal: React.FC = () => (
  <EmptyState
    icon={<CheckCircle2 size={22} />}
    title="No active assignments"
    description="You have no open jobs right now. Pull to refresh when a new job is assigned to you."
    size="lg"
  />
);

/** Settings — no data for a tab */
export const EmptySettings: React.FC<{ label: string }> = ({ label }) => (
  <EmptyState
    icon={<FileText size={18} />}
    title={`No ${label} configured`}
    description={`${label} settings will appear here once they are enabled.`}
    size="sm"
  />
);

/** Notifications — all read */
export const EmptyNotifications: React.FC = () => (
  <EmptyState
    icon={<Zap size={18} />}
    title="You're all caught up"
    description="No new alerts. We'll let you know when something needs your attention."
    size="sm"
  />
);

/** Kanban column specific (tiny) */
export const EmptyKanbanColumn: React.FC<{ label: string }> = ({ label }) => (
  <div className="text-center py-8 flex flex-col items-center gap-2 text-slate-400" aria-hidden="true">
    <Clock size={16} className="opacity-40" />
    <span className="text-xs font-medium">No {label} activities</span>
  </div>
);

export default EmptyState;

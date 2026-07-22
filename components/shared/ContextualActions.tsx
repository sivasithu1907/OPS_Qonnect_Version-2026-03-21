/**
 * ContextualActions.tsx — Sprint 2.3 shared productivity layer.
 *
 * A compact horizontal action strip for detail panels. Renders only the
 * actions that are meaningful for the current record, hiding anything
 * the user can't do (no phone → no call/WA; no map URL → no navigate).
 *
 * Design rules:
 *  • Icon + label for primary actions, icon-only on small screens.
 *  • Qonnect yellow for the primary CTA; neutral for secondary actions.
 *  • Never requires new backend calls — only wraps existing href/onClick.
 *  • Keyboard accessible (focusable, visible focus ring).
 *  • Gracefully handles missing data — no dead buttons rendered.
 */
import React from 'react';
import {
  Phone, MessageCircle, Navigation, Ticket, Calendar, Edit,
  History, ClipboardList, ExternalLink, CheckCircle2, RotateCcw,
  UserCheck, Play, Eye
} from 'lucide-react';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFCC00] focus-visible:ring-offset-1';

// ── Single action definition ─────────────────────────────────────────────────
export interface ActionDef {
  id: string;
  icon: React.ReactNode;
  label: string;
  /** href opens in a new tab (tel: / https: / https://wa.me/) */
  href?: string;
  onClick?: () => void;
  /** Visual variant */
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning';
  /** Hidden from render when false */
  visible?: boolean;
  disabled?: boolean;
  title?: string;
}

interface ContextualActionsProps {
  actions: ActionDef[];
  /** Compact mode for small panels — icons only */
  compact?: boolean;
  className?: string;
}

const VARIANT_STYLES: Record<string, string> = {
  primary:   'bg-[#FFCC00] text-slate-900 hover:bg-amber-400 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300',
  danger:    'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100',
  success:   'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100',
  warning:   'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100',
};

export const ContextualActions: React.FC<ContextualActionsProps> = ({
  actions,
  compact = false,
  className = '',
}) => {
  const visible = actions.filter(a => a.visible !== false);
  if (visible.length === 0) return null;

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`} role="toolbar" aria-label="Contextual actions">
      {visible.map(action => {
        const cls = `inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none ${VARIANT_STYLES[action.variant || 'secondary']} ${FOCUS_RING}`;
        const content = (
          <>
            <span aria-hidden="true" className="shrink-0">{action.icon}</span>
            {!compact && <span>{action.label}</span>}
          </>
        );
        const title = compact ? action.label : action.title;

        if (action.href) {
          return (
            <a
              key={action.id}
              href={action.href}
              target={action.href.startsWith('tel:') || action.href.startsWith('mailto:') ? undefined : '_blank'}
              rel="noopener noreferrer"
              className={cls}
              title={title}
              aria-label={action.label}
            >
              {content}
            </a>
          );
        }
        return (
          <button
            key={action.id}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className={cls}
            title={title}
            aria-label={action.label}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
};

// ── Pre-built action factories ────────────────────────────────────────────────
// These are pure functions that return ActionDef objects. Pages compose
// them to build their action bar — no business logic lives here.

/** Call a phone number directly (tel: link) */
export const callAction = (phone: string | undefined): ActionDef => ({
  id: 'call',
  icon: <Phone size={13} />,
  label: 'Call',
  href: phone ? `tel:${phone}` : undefined,
  visible: !!phone,
  variant: 'success',
  title: `Call ${phone}`,
});

/** Open WhatsApp with a pre-filled message context */
export const whatsappAction = (phone: string | undefined, message = ''): ActionDef => {
  const normalized = phone?.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  const wa = normalized ? `https://wa.me/${normalized}${message ? `?text=${encodeURIComponent(message)}` : ''}` : undefined;
  return {
    id: 'whatsapp',
    icon: <MessageCircle size={13} />,
    label: 'WhatsApp',
    href: wa,
    visible: !!normalized,
    variant: 'success',
    title: 'Open WhatsApp',
  };
};

/** Open a location URL in maps */
export const navigateAction = (url: string | undefined): ActionDef => ({
  id: 'navigate',
  icon: <Navigation size={13} />,
  label: 'Navigate',
  href: url,
  visible: !!url,
  variant: 'secondary',
  title: 'Open in Maps',
});

/** Open external Odoo link */
export const odooAction = (url: string | undefined): ActionDef => ({
  id: 'odoo',
  icon: <ExternalLink size={13} />,
  label: 'Odoo',
  href: url,
  visible: !!url,
  variant: 'secondary',
  title: 'Open in Odoo',
});

/** Edit / open edit form */
export const editAction = (onClick: () => void, label = 'Edit'): ActionDef => ({
  id: 'edit',
  icon: <Edit size={13} />,
  label,
  onClick,
  variant: 'secondary',
});

/** Create ticket for this context */
export const createTicketAction = (onClick: () => void): ActionDef => ({
  id: 'create_ticket',
  icon: <Ticket size={13} />,
  label: 'Create Ticket',
  onClick,
  variant: 'secondary',
});

/** Create activity for this context */
export const createActivityAction = (onClick: () => void): ActionDef => ({
  id: 'create_activity',
  icon: <Calendar size={13} />,
  label: 'Create Activity',
  onClick,
  variant: 'secondary',
});

/** Create SAR for this context */
export const createSARAction = (onClick: () => void): ActionDef => ({
  id: 'create_sar',
  icon: <ClipboardList size={13} />,
  label: 'Create SAR',
  onClick,
  variant: 'secondary',
});

/** View history / timeline */
export const historyAction = (onClick: () => void): ActionDef => ({
  id: 'history',
  icon: <History size={13} />,
  label: 'History',
  onClick,
  variant: 'secondary',
});

/** Assign engineer */
export const assignAction = (onClick: () => void, assigned = false): ActionDef => ({
  id: 'assign',
  icon: <UserCheck size={13} />,
  label: assigned ? 'Reassign' : 'Assign',
  onClick,
  variant: 'warning',
});

/** Start work — transitions status to IN_PROGRESS */
export const startAction = (onClick: () => void): ActionDef => ({
  id: 'start',
  icon: <Play size={13} />,
  label: 'Start',
  onClick,
  variant: 'primary',
});

/** Mark complete */
export const completeAction = (onClick: () => void): ActionDef => ({
  id: 'complete',
  icon: <CheckCircle2 size={13} />,
  label: 'Complete',
  onClick,
  variant: 'success',
});

/** Carry forward */
export const carryForwardAction = (onClick: () => void): ActionDef => ({
  id: 'carry_forward',
  icon: <RotateCcw size={13} />,
  label: 'Carry Forward',
  onClick,
  variant: 'warning',
});

/** View detail (generic) */
export const viewAction = (onClick: () => void, label = 'View'): ActionDef => ({
  id: 'view',
  icon: <Eye size={13} />,
  label,
  onClick,
  variant: 'secondary',
});

export default ContextualActions;

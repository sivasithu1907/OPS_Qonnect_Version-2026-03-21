/**
 * StatusBadge.tsx — single shared source of truth for status pills.
 * ─────────────────────────────────────────────────────────────────────────
 * Consolidates what were six separate, drifted implementations of the same
 * "icon + colour + text" status badge across TicketManagement, MyJobTaskView,
 * MobileTechPortal, MobileLeadPortal, and SalesAppointmentRequests — each
 * with slightly different icon choices and colour scales for the same
 * status. This is the canonical mapping; individual screens should no
 * longer define their own.
 *
 * Deliberately status-value driven (a plain string), not tied to any one
 * enum (TicketStatus / Activity status / SalesRequestStatus), since all
 * three domains share most of the same underlying vocabulary (IN_PROGRESS,
 * CANCELLED, CARRY_FORWARD, etc). Unknown/未-mapped statuses fall back to a
 * neutral clock badge rather than throwing or rendering blank.
 */
import React from 'react';
import {
  Clock, Car, Home, Play, CheckCircle2, RotateCcw, X, XCircle,
  UserCheck, ArrowRight, CalendarCheck, AlertCircle, RefreshCw,
} from 'lucide-react';

export interface StatusMeta {
  icon: React.ReactNode;
  /** Soft-tint badge classes: bg + text colour, e.g. "bg-amber-100 text-amber-700" */
  badge: string;
  /** Human label override — most callers just title-case the raw status, but a few (e.g. SAR) need a custom label */
  label?: string;
}

// One icon per concept, reused across every status family:
//   Clock          → waiting / new / pending / not yet started
//   UserCheck      → assigned to someone
//   Car            → travelling to site
//   Home           → arrived on site
//   Play           → actively being worked
//   RotateCcw      → carried forward / rescheduled
//   CheckCircle2   → done / resolved / completed
//   X / XCircle    → cancelled
//   ArrowRight     → linked to another record
//   CalendarCheck  → scheduled for a future date
//   AlertCircle    → waiting on an external decision (e.g. assignment)
export const STATUS_META: Record<string, StatusMeta> = {
  NEW:                 { icon: <Clock size={11} />,        badge: 'bg-slate-100 text-slate-600' },
  OPEN:                { icon: <Clock size={11} />,        badge: 'bg-blue-100 text-blue-700' },
  PLANNED:             { icon: <Clock size={11} />,        badge: 'bg-purple-100 text-purple-700' },
  PENDING_SCHEDULING:  { icon: <Clock size={11} />,        badge: 'bg-amber-100 text-amber-700', label: 'Pending Scheduling' },
  ASSIGNED:            { icon: <UserCheck size={11} />,    badge: 'bg-purple-100 text-purple-700' },
  WAITING_ASSIGNMENT:  { icon: <AlertCircle size={11} />,  badge: 'bg-amber-100 text-amber-700', label: 'Waiting Assignment' },
  SCHEDULED:           { icon: <CalendarCheck size={11} />, badge: 'bg-blue-100 text-blue-700' },
  ON_MY_WAY:           { icon: <Car size={11} />,          badge: 'bg-cyan-100 text-cyan-700' },
  ARRIVED:             { icon: <Home size={11} />,         badge: 'bg-indigo-100 text-indigo-700' },
  IN_PROGRESS:         { icon: <Play size={11} className="fill-current" />, badge: 'bg-amber-100 text-amber-700' },
  CARRY_FORWARD:       { icon: <RotateCcw size={11} />,    badge: 'bg-orange-100 text-orange-700' },
  LINKED:              { icon: <ArrowRight size={11} />,   badge: 'bg-purple-100 text-purple-700' },
  DONE:                { icon: <CheckCircle2 size={11} />, badge: 'bg-emerald-100 text-emerald-700' },
  RESOLVED:            { icon: <CheckCircle2 size={11} />, badge: 'bg-emerald-100 text-emerald-700' },
  COMPLETED:           { icon: <CheckCircle2 size={11} />, badge: 'bg-emerald-100 text-emerald-700' },
  CANCELLED:           { icon: <XCircle size={11} />,      badge: 'bg-slate-200 text-slate-500' },
  DELAYED:             { icon: <AlertCircle size={11} />,  badge: 'bg-red-100 text-red-700' },
};

const FALLBACK: StatusMeta = { icon: <Clock size={11} />, badge: 'bg-slate-100 text-slate-600' };

export const getStatusMeta = (status: string): StatusMeta => STATUS_META[status] || FALLBACK;

interface StatusBadgeProps {
  status: string;
  /** Override the display text (falls back to STATUS_META[status].label, then a title-cased version of the raw status) */
  label?: string;
  className?: string;
}

/** Shared "icon + colour + text" status pill — status is never colour-only. */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, className = '' }) => {
  const meta = getStatusMeta(status);
  const text = label ?? meta.label ?? status.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase whitespace-nowrap ${meta.badge} ${className}`}>
      {meta.icon}{text}
    </span>
  );
};

export default StatusBadge;

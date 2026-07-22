/**
 * Skeletons.tsx — Sprint 2.2 shared skeleton loader library.
 *
 * One file, one import.  Every module that has an async load state picks the
 * skeleton that matches its actual layout — so the screen never flashes blank
 * and users always understand what is coming.
 *
 * Design rules:
 *  • Match the real layout's spacing and column structure exactly.
 *  • Use .qn-skeleton (shimmer) for individual bones.
 *  • No colour-only indicators — shape alone communicates structure.
 *  • Respect prefers-reduced-motion (shimmer is CSS-only; shape remains).
 */
import React from 'react';

/* ── Primitive bone ─────────────────────────────────────────────────────── */
interface BoneProps {
  className?: string;
  style?: React.CSSProperties;
}
export const Bone: React.FC<BoneProps> = ({ className = '', style }) => (
  <div className={`qn-skeleton ${className}`} style={style} aria-hidden="true" />
);

/* ── KPI card (Master Dashboard, Service Dashboard) ─────────────────────── */
export const KpiCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl border border-slate-100 p-5 flex flex-col gap-3" aria-hidden="true">
    <div className="flex items-center justify-between">
      <Bone className="h-3.5 w-24 rounded-full" />
      <Bone className="h-8 w-8 rounded-xl" />
    </div>
    <Bone className="h-8 w-20 rounded-xl mt-1" />
    <Bone className="h-2.5 w-16 rounded-full" />
  </div>
);

export const KpiRowSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
    {Array.from({ length: count }).map((_, i) => <KpiCardSkeleton key={i} />)}
  </div>
);

/* ── Generic table ──────────────────────────────────────────────────────── */
export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({ rows = 6, cols = 5 }) => (
  <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden" aria-hidden="true">
    {/* header */}
    <div className="flex items-center gap-4 px-5 py-3.5 bg-slate-50 border-b border-slate-100">
      {Array.from({ length: cols }).map((_, i) => (
        <Bone key={i} className="h-3 rounded-full flex-1" style={{ maxWidth: i === 0 ? 120 : undefined }} />
      ))}
    </div>
    {/* rows */}
    {Array.from({ length: rows }).map((_, r) => (
      <div key={r} className="flex items-center gap-4 px-5 py-3.5 border-b border-slate-50 last:border-0">
        {Array.from({ length: cols }).map((_, c) => (
          <Bone key={c} className="h-3 rounded-full flex-1" style={{ opacity: 1 - c * 0.06 }} />
        ))}
      </div>
    ))}
  </div>
);

/* ── Ticket list (left panel, 2-panel layout) ───────────────────────────── */
export const TicketListSkeleton: React.FC<{ rows?: number }> = ({ rows = 7 }) => (
  <div className="flex flex-col" aria-hidden="true">
    {/* search/filter bar */}
    <div className="px-4 py-3 border-b border-slate-100 flex gap-2">
      <Bone className="h-9 flex-1 rounded-xl" />
      <Bone className="h-9 w-9 rounded-xl" />
    </div>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="px-4 py-3.5 border-b border-slate-50 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Bone className="h-3 w-28 rounded-full" />
          <Bone className="h-5 w-16 rounded-full" />
        </div>
        <Bone className="h-3.5 w-40 rounded-full" />
        <div className="flex items-center gap-2">
          <Bone className="h-2.5 w-16 rounded-full" />
          <Bone className="h-2.5 w-12 rounded-full" />
        </div>
      </div>
    ))}
  </div>
);

/* ── Activity / kanban card ─────────────────────────────────────────────── */
export const ActivityCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-xl border border-slate-100 p-3.5 flex flex-col gap-2.5" aria-hidden="true">
    <div className="flex items-center justify-between">
      <Bone className="h-3 w-24 rounded-full" />
      <Bone className="h-5 w-14 rounded-full" />
    </div>
    <Bone className="h-3.5 w-36 rounded-full" />
    <div className="flex items-center gap-2 mt-1">
      <Bone className="h-6 w-6 rounded-full" />
      <Bone className="h-2.5 w-20 rounded-full" />
    </div>
  </div>
);

/* ── Kanban board (Activity Planner) ─────────────────────────────────────── */
export const KanbanSkeleton: React.FC = () => (
  <div className="flex gap-4 p-4 overflow-x-auto" aria-hidden="true">
    {Array.from({ length: 5 }).map((_, col) => (
      <div key={col} className="flex-none w-64 bg-slate-50 rounded-2xl border border-slate-100 p-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Bone className="h-3.5 w-20 rounded-full" />
          <Bone className="h-5 w-7 rounded-full" />
        </div>
        {Array.from({ length: col === 0 ? 3 : col === 1 ? 5 : col === 2 ? 2 : col === 3 ? 4 : 1 }).map((_, i) => (
          <ActivityCardSkeleton key={i} />
        ))}
      </div>
    ))}
  </div>
);

/* ── Client list ─────────────────────────────────────────────────────────── */
export const ClientListSkeleton: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
  <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden" aria-hidden="true">
    {/* search bar */}
    <div className="px-4 py-3 border-b border-slate-100 flex gap-3">
      <Bone className="h-9 flex-1 rounded-xl" />
      <Bone className="h-9 w-28 rounded-xl" />
    </div>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-slate-50 last:border-0">
        <Bone className="h-9 w-9 rounded-full shrink-0" />
        <div className="flex flex-col gap-1.5 flex-1">
          <Bone className="h-3.5 w-36 rounded-full" />
          <Bone className="h-2.5 w-24 rounded-full" />
        </div>
        <Bone className="h-5 w-16 rounded-full" />
      </div>
    ))}
  </div>
);

/* ── SAR list ───────────────────────────────────────────────────────────── */
export const SarListSkeleton: React.FC<{ rows?: number }> = ({ rows = 6 }) => (
  <div className="flex flex-col gap-3" aria-hidden="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Bone className="h-4 w-28 rounded-full" />
          <Bone className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex items-center gap-3">
          <Bone className="h-3 w-20 rounded-full" />
          <Bone className="h-3 w-16 rounded-full" />
        </div>
        <Bone className="h-3 w-48 rounded-full" />
      </div>
    ))}
  </div>
);

/* ── Operations Monitor ──────────────────────────────────────────────────── */
export const OpsMonitorSkeleton: React.FC = () => (
  <div className="flex flex-col gap-4 p-4" aria-hidden="true">
    {/* KPI strip */}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[48, 64, 40, 56].map((w, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-col gap-2">
          <Bone className="h-3 rounded-full" style={{ width: w }} />
          <Bone className="h-7 w-12 rounded-xl" />
        </div>
      ))}
    </div>
    {/* engineer grid */}
    <div className="bg-white rounded-2xl border border-slate-100 p-4">
      <Bone className="h-4 w-40 rounded-full mb-4" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
            <Bone className="h-9 w-9 rounded-full shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1">
              <Bone className="h-3 w-full rounded-full" />
              <Bone className="h-2.5 w-3/4 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

/* ── Lead Portal home ────────────────────────────────────────────────────── */
export const LeadPortalSkeleton: React.FC = () => (
  <div className="flex flex-col gap-4 p-4" aria-hidden="true">
    {/* header */}
    <div className="flex items-center justify-between">
      <Bone className="h-7 w-32 rounded-xl" />
      <Bone className="h-9 w-9 rounded-full" />
    </div>
    {/* summary cards */}
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-100 p-3 flex flex-col gap-2">
          <Bone className="h-3 w-14 rounded-full" />
          <Bone className="h-7 w-10 rounded-xl" />
        </div>
      ))}
    </div>
    {/* ticket cards */}
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <Bone className="h-3 w-24 rounded-full" />
          <Bone className="h-5 w-16 rounded-full" />
        </div>
        <Bone className="h-4 w-40 rounded-full" />
        <div className="flex gap-2">
          <Bone className="h-2.5 w-16 rounded-full" />
          <Bone className="h-2.5 w-12 rounded-full" />
        </div>
      </div>
    ))}
  </div>
);

/* ── Tech Portal home ────────────────────────────────────────────────────── */
export const TechPortalSkeleton: React.FC = () => (
  <div className="flex flex-col gap-4 p-4" aria-hidden="true">
    <Bone className="h-7 w-40 rounded-xl" />
    {Array.from({ length: 3 }).map((_, i) => (
      <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Bone className="h-4 w-28 rounded-full" />
          <Bone className="h-6 w-20 rounded-full" />
        </div>
        <Bone className="h-3 w-36 rounded-full" />
        <div className="flex gap-2">
          <Bone className="h-8 flex-1 rounded-xl" />
          <Bone className="h-8 flex-1 rounded-xl" />
        </div>
      </div>
    ))}
  </div>
);

/* ── Calendar / schedule view ────────────────────────────────────────────── */
export const CalendarSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden" aria-hidden="true">
    {/* month header */}
    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
      <Bone className="h-8 w-8 rounded-lg" />
      <Bone className="h-5 w-36 rounded-full" />
      <Bone className="h-8 w-8 rounded-lg" />
    </div>
    {/* day-of-week row */}
    <div className="grid grid-cols-7 border-b border-slate-100">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="px-2 py-2 flex justify-center">
          <Bone className="h-3 w-6 rounded-full" />
        </div>
      ))}
    </div>
    {/* 5-week grid */}
    {Array.from({ length: 5 }).map((_, w) => (
      <div key={w} className="grid grid-cols-7 border-b border-slate-50 last:border-0">
        {Array.from({ length: 7 }).map((_, d) => (
          <div key={d} className="p-2 min-h-[72px] border-r border-slate-50 last:border-0">
            <Bone className="h-2.5 w-5 rounded-full mb-1.5" />
            {Math.random() > 0.6 && <Bone className="h-4 w-full rounded" />}
          </div>
        ))}
      </div>
    ))}
  </div>
);

/* ── Master Dashboard full ───────────────────────────────────────────────── */
export const MasterDashboardSkeleton: React.FC = () => (
  <div className="flex flex-col gap-5 p-5" aria-hidden="true">
    <KpiRowSkeleton count={4} />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <Bone className="h-4 w-32 rounded-full mb-4" />
        {/* bar chart placeholder */}
        <div className="flex items-end gap-3 h-32">
          {[60, 85, 45, 70, 55, 90, 40].map((h, i) => (
            <div key={i} className="flex-1 flex flex-col justify-end gap-1">
              <Bone className="w-full rounded-t" style={{ height: `${h}%` }} />
              <Bone className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <Bone className="h-4 w-28 rounded-full mb-4" />
        {/* pie placeholder */}
        <div className="flex items-center justify-center h-32">
          <Bone className="h-24 w-24 rounded-full" style={{ borderRadius: '50%' }} />
        </div>
      </div>
    </div>
    <TableSkeleton rows={5} cols={6} />
  </div>
);

/* ── Audit log ──────────────────────────────────────────────────────────── */
export const AuditLogSkeleton: React.FC = () => (
  <TableSkeleton rows={8} cols={5} />
);

/* ── WhatsApp / message thread ──────────────────────────────────────────── */
export const MessageThreadSkeleton: React.FC = () => (
  <div className="flex flex-col gap-3 p-4" aria-hidden="true">
    {[true, false, true, true, false, true].map((right, i) => (
      <div key={i} className={`flex ${right ? 'justify-end' : 'justify-start'}`}>
        <Bone
          className="h-10 rounded-2xl"
          style={{ width: `${40 + Math.random() * 30}%`, borderRadius: right ? '18px 4px 18px 18px' : '4px 18px 18px 18px' }}
        />
      </div>
    ))}
  </div>
);

/* ── Service Feedback ────────────────────────────────────────────────────── */
export const FeedbackSkeleton: React.FC<{ count?: number }> = ({ count = 5 }) => (
  <div className="flex flex-col gap-3" aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Bone className="h-4 w-32 rounded-full" />
          <Bone className="h-3 w-20 rounded-full" />
        </div>
        {/* stars */}
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, s) => <Bone key={s} className="h-4 w-4 rounded" />)}
        </div>
        <Bone className="h-3 w-full rounded-full" />
        <Bone className="h-3 w-3/4 rounded-full" />
      </div>
    ))}
  </div>
);

/* ── AMC contracts ───────────────────────────────────────────────────────── */
export const AmcSkeleton: React.FC = () => (
  <div className="flex flex-col gap-3" aria-hidden="true">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 flex items-center gap-4">
        <Bone className="h-10 w-10 rounded-xl shrink-0" />
        <div className="flex flex-col gap-1.5 flex-1">
          <Bone className="h-4 w-40 rounded-full" />
          <Bone className="h-3 w-24 rounded-full" />
        </div>
        <Bone className="h-6 w-20 rounded-full" />
        <Bone className="h-8 w-24 rounded-xl" />
      </div>
    ))}
  </div>
);

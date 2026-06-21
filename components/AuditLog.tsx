import React, { useState, useEffect, useCallback, useMemo } from 'react';
import toast from './Toast';
import api from '../services/api';
import {
  ShieldCheck, Search, RefreshCw, ChevronLeft, ChevronRight,
  User, FileText, Ticket as TicketIcon, Activity as ActivityIcon,
  Contact, Users, LogIn, LogOut, KeyRound, X
} from 'lucide-react';

interface AuditLogEntry {
  id: number;
  actorId: string | null;
  actorName: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  details: Record<string, any>;
  ipAddress: string | null;
  createdAt: string;
}

const ACTION_OPTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE',
  'LOGIN', 'LOGIN_FAILED', 'PASSWORD_CHANGE', 'IMPORT',
];

const ENTITY_OPTIONS = ['TICKET', 'ACTIVITY', 'CUSTOMER', 'USER', 'TEAM', 'SALES_REQUEST', 'SYSTEM', 'RECURRING_SCHEDULE'];

const ENTITY_ICON: Record<string, React.ReactNode> = {
  TICKET: <TicketIcon size={14} />,
  ACTIVITY: <ActivityIcon size={14} />,
  CUSTOMER: <Contact size={14} />,
  USER: <User size={14} />,
  TEAM: <Users size={14} />,
  SALES_REQUEST: <FileText size={14} />,
  SYSTEM: <ShieldCheck size={14} />,
  RECURRING_SCHEDULE: <RefreshCw size={14} />,
};

const ACTION_STYLE: Record<string, string> = {
  CREATE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  UPDATE: 'bg-blue-50 text-blue-700 border-blue-200',
  STATUS_CHANGE: 'bg-amber-50 text-amber-700 border-amber-200',
  DELETE: 'bg-red-50 text-red-700 border-red-200',
  LOGIN: 'bg-slate-100 text-slate-600 border-slate-200',
  LOGIN_FAILED: 'bg-red-50 text-red-700 border-red-200',
  PASSWORD_CHANGE: 'bg-purple-50 text-purple-700 border-purple-200',
  IMPORT: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const ACTION_ICON: Record<string, React.ReactNode> = {
  LOGIN: <LogIn size={14} />,
  LOGIN_FAILED: <LogIn size={14} />,
  PASSWORD_CHANGE: <KeyRound size={14} />,
};

function formatAction(action: string) {
  return action.replace(/_/g, ' ');
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Renders the details JSON compactly and safely — never assumes shape.
function DetailsSummary({ details }: { details: Record<string, any> }) {
  if (!details || Object.keys(details).length === 0) return <span className="text-slate-400">—</span>;
  const parts: string[] = [];
  if (details.from !== undefined && details.to !== undefined) {
    parts.push(`${details.from || '—'} → ${details.to}`);
  }
  if (details.fieldsUpdated) parts.push(`fields: ${Array.isArray(details.fieldsUpdated) ? details.fieldsUpdated.join(', ') : details.fieldsUpdated}`);
  if (details.carryForwardNote) parts.push(`reason: ${details.carryForwardNote}`);
  if (details.nextPlannedAt) parts.push(`next: ${formatWhen(details.nextPlannedAt)}`);
  if (details.email) parts.push(details.email);
  if (details.role) parts.push(`role: ${details.role}`);
  if (parts.length === 0) {
    // Fall back to a compact key:value rendering for anything not specifically handled above
    parts.push(Object.entries(details).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', '));
  }
  return <span className="text-slate-600">{parts.join(' · ')}</span>;
}

const AuditLog: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const limit = 50;
  const [offset, setOffset] = useState(0);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { limit, offset };
      if (q.trim()) params.q = q.trim();
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entityType = entityFilter;
      if (startDate) params.startDate = `${startDate}T00:00:00`;
      if (endDate) params.endDate = `${endDate}T23:59:59`;

      const res = await api.auditLogs.list(params);
      setLogs(res.logs || []);
      setTotal(res.total || 0);
    } catch (e: any) {
      console.error('Failed to load audit logs:', e);
      setError(e?.message === 'Unauthorized' ? null : 'Failed to load audit logs.');
      if (e?.message && e.message !== 'Unauthorized') toast.error('Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, [q, actionFilter, entityFilter, startDate, endDate, offset]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Reset to first page whenever a filter changes
  useEffect(() => { setOffset(0); }, [q, actionFilter, entityFilter, startDate, endDate]);

  const hasFilters = q || actionFilter || entityFilter || startDate || endDate;
  const clearFilters = () => { setQ(''); setActionFilter(''); setEntityFilter(''); setStartDate(''); setEndDate(''); };

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-900 rounded-xl">
              <ShieldCheck size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900">Audit Log</h1>
              <p className="text-slate-500 text-sm">Who did what, and when — across tickets, activities, customers, and users.</p>
            </div>
          </div>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          {hasFilters && (
            <button onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-600 hover:bg-red-100">
              <X size={12} /> Clear Filters
            </button>
          )}
          <div className="flex-1 relative min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search by person, record, or reference..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
            />
          </div>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-600">
            <option value="">All Actions</option>
            {ACTION_OPTIONS.map(a => <option key={a} value={a}>{formatAction(a)}</option>)}
          </select>
          <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-600">
            <option value="">All Record Types</option>
            {ENTITY_OPTIONS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
        )}

        {!error && (
          <table className="w-full text-sm">
            <thead className="bg-white sticky top-0 z-10 border-b border-slate-200">
              <tr className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-6 py-3">When</th>
                <th className="px-3 py-3">Who</th>
                <th className="px-3 py-3">Action</th>
                <th className="px-3 py-3">Record</th>
                <th className="px-3 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr
                  key={log.id}
                  onClick={() => setSelected(log)}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-3 text-slate-500 whitespace-nowrap">{formatWhen(log.createdAt)}</td>
                  <td className="px-3 py-3">
                    <div className="font-bold text-slate-900">{log.actorName}</div>
                    {log.actorRole && <div className="text-[11px] text-slate-400">{log.actorRole.replace(/_/g, ' ')}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${ACTION_STYLE[log.action] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                      {ACTION_ICON[log.action]}
                      {formatAction(log.action)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5 text-slate-700">
                      <span className="text-slate-400">{ENTITY_ICON[log.entityType]}</span>
                      <span className="font-medium">{log.entityLabel || log.entityId || '—'}</span>
                    </div>
                    {log.entityId && <div className="text-[11px] text-slate-400">{log.entityId}</div>}
                  </td>
                  <td className="px-3 py-3 max-w-[360px] truncate">
                    <DetailsSummary details={log.details} />
                  </td>
                </tr>
              ))}

              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-slate-400">
                    No activity found for the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <RefreshCw size={16} className="animate-spin" /> Loading audit log…
          </div>
        )}
      </div>

      {/* Pagination */}
      {!error && total > 0 && (
        <div className="px-6 py-3 bg-white border-t border-slate-200 shrink-0 flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOffset(o => Math.max(0, o - limit))}
              disabled={offset === 0}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-slate-500 text-xs font-medium">Page {page} of {totalPages}</span>
            <button
              onClick={() => setOffset(o => o + limit)}
              disabled={offset + limit >= total}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-900">Audit entry</h3>
              <button onClick={() => setSelected(null)}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
            </div>
            <div className="p-5 space-y-3 text-sm max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">When</div>
                  <div className="text-slate-900">{formatWhen(selected.createdAt)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Who</div>
                  <div className="text-slate-900">{selected.actorName}{selected.actorRole ? ` (${selected.actorRole.replace(/_/g, ' ')})` : ''}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Action</div>
                  <div className="text-slate-900">{formatAction(selected.action)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Record type</div>
                  <div className="text-slate-900">{selected.entityType.replace(/_/g, ' ')}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Record</div>
                  <div className="text-slate-900">{selected.entityLabel || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Reference</div>
                  <div className="text-slate-900">{selected.entityId || '—'}</div>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Details</div>
                <pre className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[12px] text-slate-700 whitespace-pre-wrap break-words">
                  {Object.keys(selected.details || {}).length > 0 ? JSON.stringify(selected.details, null, 2) : '—'}
                </pre>
              </div>
              {selected.ipAddress && (
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">IP address</div>
                  <div className="text-slate-500 text-xs">{selected.ipAddress}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(AuditLog);

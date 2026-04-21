
import React, { useState, useMemo } from 'react';
import { Ticket, Activity, Technician, Customer, TicketStatus } from '../types';
import { getActivityStatusLabel } from '../constants';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid
} from 'recharts';
import {
  Search, Eye, X, Calendar, Clock, User, MapPin, Phone,
  CheckCircle2, RotateCcw, Briefcase, Activity as ActivityIcon,
  Ticket as TicketIcon, Camera, ChevronDown, ExternalLink, Filter, TrendingUp
} from 'lucide-react';

interface MasterDashboardProps {
  tickets: Ticket[];
  activities: Activity[];
  technicians: Technician[];
  customers: Customer[];
}

const showPhotoLightbox = (src: string) => {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;cursor:pointer;';
  overlay.onclick = () => overlay.remove();
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.5);';
  const close = document.createElement('div');
  close.textContent = '✕';
  close.style.cssText = 'position:absolute;top:20px;right:24px;color:white;font-size:28px;font-weight:bold;cursor:pointer;background:rgba(0,0,0,0.5);width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;';
  overlay.appendChild(img);
  overlay.appendChild(close);
  document.body.appendChild(overlay);
};

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b', '#06b6d4', '#f97316'];

const MasterDashboard: React.FC<MasterDashboardProps> = ({ tickets, activities, technicians, customers }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState<'all' | 'tickets' | 'activities'>('all');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [assignedFilter, setAssignedFilter] = useState('ALL');
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('month');
  const [previewItem, setPreviewItem] = useState<any>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Build unique categories and engineers for filter dropdowns
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    tickets.forEach(t => { if (t.category) cats.add(t.category); });
    activities.forEach(a => { if (a.type) cats.add(a.type); if ((a as any).serviceCategory) cats.add((a as any).serviceCategory); });
    return Array.from(cats).sort();
  }, [tickets, activities]);

  const allEngineers = useMemo(() => {
    const ids = new Set<string>();
    tickets.forEach(t => { if (t.assignedTechId) ids.add(t.assignedTechId); });
    activities.forEach(a => { if (a.leadTechId) ids.add(a.leadTechId); if ((a as any).primaryEngineerId) ids.add((a as any).primaryEngineerId); });
    return Array.from(ids).map(id => technicians.find(t => t.id === id)).filter(Boolean) as any[];
  }, [tickets, activities, technicians]);

  // Normalize all jobs into unified list
  const allJobs = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const monthAgo = new Date(now.getTime() - 30 * 86400000);

    const ticketJobs = tickets.map(t => ({
      id: t.id, kind: 'ticket' as const, reference: t.id,
      title: t.customerName || 'Unknown', subtitle: t.category,
      type: t.type || 'Under Warranty', category: t.category,
      status: t.status, priority: t.priority,
      date: new Date(t.createdAt),
      dateLabel: new Date(t.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric' }),
      techId: t.assignedTechId,
      techName: technicians.find(tc => tc.id === t.assignedTechId)?.name || 'Unassigned',
      customerId: t.customerId, raw: t,
    }));

    const activityJobs = activities.map(a => {
      const cust = customers.find(c => c.id === a.customerId);
      return {
        id: a.id, kind: 'activity' as const, reference: a.reference,
        title: cust?.name || 'Unknown', subtitle: a.type,
        type: (a as any).serviceCategory || 'ELV Systems', category: a.type,
        status: a.status, priority: a.priority,
        date: new Date(a.plannedDate || a.createdAt),
        dateLabel: new Date(a.plannedDate || a.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric' }),
        techId: (a as any).primaryEngineerId || a.leadTechId,
        techName: technicians.find(tc => tc.id === ((a as any).primaryEngineerId || a.leadTechId))?.name || 'Unassigned',
        customerId: a.customerId, raw: a,
      };
    });

    let combined = [...ticketJobs, ...activityJobs];

    if (dateRange === 'today') combined = combined.filter(j => j.date.toDateString() === todayStr);
    else if (dateRange === 'week') combined = combined.filter(j => j.date >= weekAgo);
    else if (dateRange === 'month') combined = combined.filter(j => j.date >= monthAgo);
    if (typeFilter === 'tickets') combined = combined.filter(j => j.kind === 'ticket');
    else if (typeFilter === 'activities') combined = combined.filter(j => j.kind === 'activity');
    if (statusFilter !== 'ALL') combined = combined.filter(j => j.status === statusFilter);
    if (categoryFilter !== 'ALL') combined = combined.filter(j => j.category === categoryFilter || j.type === categoryFilter || j.subtitle === categoryFilter);
    if (assignedFilter !== 'ALL') combined = combined.filter(j => j.techId === assignedFilter);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      combined = combined.filter(j =>
        j.reference.toLowerCase().includes(q) || j.title.toLowerCase().includes(q) ||
        j.subtitle.toLowerCase().includes(q) || j.techName.toLowerCase().includes(q)
      );
    }

    return combined.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [tickets, activities, technicians, customers, searchQuery, statusFilter, typeFilter, categoryFilter, assignedFilter, dateRange]);

  // Metrics
  const metrics = useMemo(() => {
    const all = allJobs;
    return {
      total: all.length,
      active: all.filter(j => ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED', 'ASSIGNED'].includes(j.status)).length,
      planned: all.filter(j => ['PLANNED', 'NEW', 'OPEN'].includes(j.status)).length,
      completed: all.filter(j => ['DONE', 'RESOLVED'].includes(j.status)).length,
      carryForward: all.filter(j => j.status === 'CARRY_FORWARD').length,
      cancelled: all.filter(j => j.status === 'CANCELLED').length,
    };
  }, [allJobs]);

  // Chart data — Status distribution pie
  const statusPieData = useMemo(() => {
    const counts: Record<string, number> = {};
    allJobs.forEach(j => { counts[j.status] = (counts[j.status] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }));
  }, [allJobs]);

  // Chart data — Jobs by engineer bar
  const engineerBarData = useMemo(() => {
    const counts: Record<string, { name: string, tickets: number, activities: number }> = {};
    allJobs.forEach(j => {
      if (!counts[j.techName]) counts[j.techName] = { name: j.techName, tickets: 0, activities: 0 };
      if (j.kind === 'ticket') counts[j.techName].tickets++;
      else counts[j.techName].activities++;
    });
    return Object.values(counts).sort((a, b) => (b.tickets + b.activities) - (a.tickets + a.activities)).slice(0, 8);
  }, [allJobs]);

  // Chart data — Daily velocity (last 7 days)
  const velocityData = useMemo(() => {
    const days: Record<string, { date: string, created: number, completed: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      days[key] = { date: key, created: 0, completed: 0 };
    }
    allJobs.forEach(j => {
      const key = j.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      if (days[key]) days[key].created++;
      const completedAt = (j.raw as any).completedAt;
      if (completedAt) {
        const ck = new Date(completedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        if (days[ck]) days[ck].completed++;
      }
    });
    return Object.values(days);
  }, [allJobs]);

  const statusColors: Record<string, string> = {
    'NEW': 'bg-purple-100 text-purple-700', 'OPEN': 'bg-blue-100 text-blue-700',
    'PLANNED': 'bg-amber-100 text-amber-700', 'ASSIGNED': 'bg-indigo-100 text-indigo-700',
    'ON_MY_WAY': 'bg-cyan-100 text-cyan-700', 'ARRIVED': 'bg-indigo-100 text-indigo-700',
    'IN_PROGRESS': 'bg-blue-100 text-blue-700', 'DONE': 'bg-emerald-100 text-emerald-700',
    'RESOLVED': 'bg-emerald-100 text-emerald-700', 'CARRY_FORWARD': 'bg-orange-100 text-orange-700',
    'CANCELLED': 'bg-slate-100 text-slate-500',
  };

  const fmtDt = (iso: string) => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Master Dashboard</h1>
            <p className="text-slate-500 text-sm">Complete operational overview — tickets & activities combined</p>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-6 gap-3 mb-4">
          {[
            { label: 'Total', value: metrics.total, color: 'bg-slate-900 text-white', filter: 'ALL' },
            { label: 'Active', value: metrics.active, color: 'bg-blue-50 text-blue-700 border border-blue-200', filter: 'IN_PROGRESS' },
            { label: 'Planned', value: metrics.planned, color: 'bg-amber-50 text-amber-700 border border-amber-200', filter: 'PLANNED' },
            { label: 'Completed', value: metrics.completed, color: 'bg-emerald-50 text-emerald-700 border border-emerald-200', filter: 'DONE' },
            { label: 'Carry Fwd', value: metrics.carryForward, color: 'bg-orange-50 text-orange-700 border border-orange-200', filter: 'CARRY_FORWARD' },
            { label: 'Cancelled', value: metrics.cancelled, color: 'bg-slate-50 text-slate-500 border border-slate-200', filter: 'CANCELLED' },
          ].map(kpi => (
            <button key={kpi.label} onClick={() => setStatusFilter(statusFilter === kpi.filter ? 'ALL' : kpi.filter)}
              className={`p-3 rounded-xl text-center transition-all hover:shadow-md ${statusFilter === kpi.filter ? 'ring-2 ring-slate-900 shadow-md scale-[1.02]' : ''} ${kpi.color}`}>
              <div className="text-xl font-black">{kpi.value}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{kpi.label}</div>
            </button>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          {/* Status Pie */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Status Distribution</h3>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={2} dataKey="value">
                  {statusPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <RTooltip formatter={(v: number, n: string) => [v, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {statusPieData.map((d, i) => (
                <span key={d.name} className="text-[8px] flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  {d.name} ({d.value})
                </span>
              ))}
            </div>
          </div>

          {/* Engineer Workload Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Jobs by Engineer</h3>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={engineerBarData} layout="vertical" margin={{ left: 0, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 9 }} />
                <RTooltip />
                <Bar dataKey="activities" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} name="Activities" />
                <Bar dataKey="tickets" stackId="a" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Tickets" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Velocity Chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">7-Day Velocity</h3>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={velocityData} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} />
                <RTooltip />
                <Bar dataKey="created" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Created" />
                <Bar dataKey="completed" fill="#10b981" radius={[4, 4, 0, 0]} name="Completed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by reference, client, engineer..."
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white" />
          </div>
          {/* Type */}
          <div className="flex bg-slate-100 rounded-xl p-0.5 shrink-0">
            {(['all', 'tickets', 'activities'] as const).map(v => (
              <button key={v} onClick={() => setTypeFilter(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${typeFilter === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {v === 'all' ? 'All' : v === 'tickets' ? 'Tickets' : 'Activities'}
              </button>
            ))}
          </div>
          {/* Category */}
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none shrink-0">
            <option value="ALL">All Categories</option>
            {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {/* Assigned To */}
          <select value={assignedFilter} onChange={e => setAssignedFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none shrink-0">
            <option value="ALL">All Engineers</option>
            {allEngineers.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {/* Date Range */}
          <div className="flex bg-slate-100 rounded-xl p-0.5 shrink-0">
            {(['today', 'week', 'month', 'all'] as const).map(v => (
              <button key={v} onClick={() => setDateRange(v)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold ${dateRange === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm text-left table-fixed">
          <thead className="bg-white text-slate-500 font-semibold uppercase text-[10px] tracking-wider sticky top-0 z-10 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 w-[5%]">Type</th>
              <th className="px-4 py-3 w-[9%]">Ref</th>
              <th className="px-4 py-3 w-[18%]">Client</th>
              <th className="px-4 py-3 w-[11%]">Category</th>
              <th className="px-4 py-3 w-[7%]">Priority</th>
              <th className="px-4 py-3 w-[10%]">Status</th>
              <th className="px-4 py-3 w-[10%]">Date</th>
              <th className="px-4 py-3 w-[14%]">Assigned To</th>
              <th className="px-4 py-3 w-[8%] text-center">Photos</th>
              <th className="px-4 py-3 w-[8%] text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {allJobs.length === 0 ? (
              <tr><td colSpan={10} className="px-6 py-12 text-center text-slate-400 italic">No jobs found</td></tr>
            ) : (
              allJobs.map(job => {
                const photos = (job.raw as any).photos || [];
                return (
                <tr key={`${job.kind}-${job.id}`} className="hover:bg-slate-50 group">
                  <td className="px-4 py-3">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${job.kind === 'ticket' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                      {job.kind === 'ticket' ? 'TKT' : 'ACT'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 truncate">{job.reference}</td>
                  <td className="px-4 py-3"><div className="font-medium text-slate-800 truncate">{job.title}</div></td>
                  <td className="px-4 py-3 text-xs text-slate-600 truncate">{job.subtitle}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                      job.priority === 'URGENT' ? 'bg-red-50 text-red-700 border-red-200' :
                      job.priority === 'HIGH' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                      'bg-slate-50 text-slate-600 border-slate-200'
                    }`}>{job.priority}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors[job.status] || 'bg-slate-100 text-slate-500'}`}>
                      {job.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{job.dateLabel}</td>
                  <td className="px-4 py-3 text-xs text-slate-700 truncate">{job.techName}</td>
                  <td className="px-4 py-3 text-center">
                    {photos.length > 0 ? (
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">{photos.length}</span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setPreviewItem(job)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded transition-colors opacity-0 group-hover:opacity-100">
                      <Eye size={12} /> View
                    </button>
                  </td>
                </tr>
              )})
            )}
          </tbody>
        </table>
      </div>

      {/* Preview Popup */}
      {previewItem && (() => {
        const d = previewItem.raw;
        const isTicket = previewItem.kind === 'ticket';
        const cust = customers.find(c => c.id === (d.customerId || previewItem.customerId));
        const tech = technicians.find(t => t.id === (d.assignedTechId || (d as any).primaryEngineerId || d.leadTechId));
        const salesLd = !isTicket ? technicians.find(t => t.id === (d as any).salesLeadId) : null;
        const assistants = !isTicket ? ((d as any).assistantTechIds || []).map((id: string) => technicians.find(t => t.id === id)).filter(Boolean) : [];
        const photos = (d as any).photos || [];
        const statusColor = d.status === 'DONE' || d.status === 'RESOLVED' ? 'bg-emerald-500' : d.status === 'CARRY_FORWARD' ? 'bg-orange-500' : d.status === 'IN_PROGRESS' ? 'bg-blue-500' : d.status === 'CANCELLED' ? 'bg-slate-400' : 'bg-amber-400';
        const issueText = isTicket ? (d.messages?.find((m: any) => m.sender === 'CLIENT')?.content || d.notes || (d as any).ai_summary || '') : (d.description || '');
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setPreviewItem(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${statusColor}`} />
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isTicket ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>{isTicket ? 'TICKET' : 'ACTIVITY'}</span>
                      <span className="text-[10px] font-mono text-slate-400">{previewItem.reference}</span>
                    </div>
                    <h3 className="font-bold text-lg text-slate-900">{isTicket ? d.category : d.type}</h3>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1.5 rounded-full text-xs font-bold text-white ${statusColor}`}>{(d.status || '').replace(/_/g, ' ')}</span>
                  <button onClick={() => setPreviewItem(null)} className="p-1.5 hover:bg-slate-200 rounded-lg"><X size={18} className="text-slate-400" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-1">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase">Customer</h4>
                  <div className="text-sm font-bold text-slate-800">{cust?.name || (isTicket ? d.customerName : 'Unknown')}</div>
                  {(cust?.phone || d.phoneNumber) && <div className="text-xs text-slate-500">{cust?.phone || d.phoneNumber}</div>}
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 grid grid-cols-3 gap-3">
                  <div><span className="text-[10px] text-slate-400 block">{isTicket ? 'Category' : 'Type'}</span><span className="text-xs font-medium">{isTicket ? d.category : d.type}</span></div>
                  <div><span className="text-[10px] text-slate-400 block">Priority</span><span className="text-xs font-medium">{d.priority}</span></div>
                  {!isTicket && (d as any).durationHours && <div><span className="text-[10px] text-slate-400 block">Duration</span><span className="text-xs font-medium">{(d as any).durationHours}h</span></div>}
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-1.5">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase">Timing</h4>
                  <div className="flex justify-between text-xs"><span className="text-slate-400">{isTicket ? 'Created' : 'Planned'}</span><span>{fmtDt(isTicket ? d.createdAt : d.plannedDate)}</span></div>
                  {(d as any).startedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Started</span><span className="text-emerald-600">{fmtDt((d as any).startedAt)}</span></div>}
                  {(d as any).completedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Completed</span><span className="text-emerald-600">{fmtDt((d as any).completedAt)}</span></div>}
                </div>
                {(salesLd || tech || assistants.length > 0) && (
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
                    {salesLd && <div className="pb-2 border-b border-slate-200"><div className="text-[10px] font-bold text-indigo-600 uppercase mb-1">Sales Lead</div><div className="text-xs font-medium text-indigo-700">{salesLd.name}</div></div>}
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Team</div>
                    {tech && <div className="flex items-center gap-2 text-xs"><span className="w-2 h-2 rounded-full bg-purple-500" /><span className="font-medium">{tech.name}</span></div>}
                    {assistants.map((a: any) => <div key={a.id} className="flex items-center gap-2 text-xs"><span className="w-2 h-2 rounded-full bg-teal-500" /><span>{a.name}</span><span className="text-[10px] text-slate-400">TA</span></div>)}
                  </div>
                )}
                {issueText && <div className="bg-slate-50 rounded-xl p-4 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Description</div><p className="text-xs text-slate-700 whitespace-pre-wrap">{issueText}</p></div>}
                {(d as any).completionNote && <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100"><div className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Completion</div><p className="text-xs text-emerald-800 whitespace-pre-wrap">{(d as any).completionNote}</p></div>}
                {((d as any).remarks || d.notes) && ((d as any).remarks || d.notes) !== (d as any).completionNote && <div className="bg-slate-50 rounded-xl p-4 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Remarks</div><p className="text-xs whitespace-pre-wrap">{(d as any).remarks || d.notes}</p></div>}
                {(d as any).carryForwardNote && <div className="bg-amber-50 rounded-xl p-4 border border-amber-200"><div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Carry Forward</div><p className="text-xs text-amber-800 whitespace-pre-wrap">{(d as any).carryForwardNote}</p></div>}
                {/* Visit History */}
                {((d as any).visitHistory || (d as any).visit_history || []).length > 0 && (() => {
                    const visits = (d as any).visitHistory || (d as any).visit_history || [];
                    return (
                        <div className="space-y-3">
                            <div className="text-[10px] font-bold text-slate-400 uppercase">Visit history ({visits.length} visit{visits.length > 1 ? 's' : ''})</div>
                            <div className="relative border-l-2 border-slate-200 ml-2 space-y-3">
                                {visits.map((v: any, i: number) => {
                                    const isCF = v.status === 'CARRY_FORWARD'; const isDone = v.status === 'DONE';
                                    const cardBg = isDone ? 'bg-emerald-50 border-emerald-200' : isCF ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200';
                                    const hdrColor = isDone ? 'text-emerald-800' : isCF ? 'text-orange-800' : 'text-blue-800';
                                    const badgeStyle = isDone ? 'bg-emerald-100 text-emerald-700' : isCF ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700';
                                    const dotColor = isDone ? 'bg-emerald-500' : isCF ? 'bg-orange-500' : 'bg-blue-500';
                                    const dur = v.startedAt && v.completedAt ? Math.round((new Date(v.completedAt).getTime() - new Date(v.startedAt).getTime()) / 60000) : null;
                                    const fmtT = (iso: string) => iso ? new Date(iso).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'}) : '\u2014';
                                    const fmtD2 = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short', year:'numeric'}) : '\u2014';
                                    return (
                                        <div key={i} className="relative pl-5">
                                            <div className={`absolute -left-[7px] top-2 w-3 h-3 rounded-full border-2 border-white shadow-sm ${dotColor}`} />
                                            <div className={`rounded-xl p-3 border ${cardBg}`}>
                                                <div className="flex justify-between items-center mb-1.5">
                                                    <span className={`font-bold text-xs ${hdrColor}`}>Visit {i + 1} \u2014 {fmtD2(v.date)}</span>
                                                    <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${badgeStyle}`}>{(v.status || '').replace(/_/g, ' ')}</span>
                                                </div>
                                                <div className="text-[10px] text-slate-500">{fmtT(v.startedAt)} \u2192 {v.completedAt ? fmtT(v.completedAt) : 'ongoing'}{dur !== null ? ` (${dur >= 60 ? Math.floor(dur/60)+'h '+dur%60+'m' : dur+'m'})` : ''}</div>
                                                {v.remarks && <div className="bg-white/60 rounded-lg p-2 mt-2 border border-white/80"><div className="text-[8px] font-bold text-slate-400 uppercase mb-0.5">Remark</div><p className="text-[11px] text-slate-700 whitespace-pre-wrap">{v.remarks}</p></div>}
                                                {v.completionNote && <div className="bg-emerald-50/50 rounded-lg p-2 mt-1.5 border border-emerald-100"><div className="text-[8px] font-bold text-emerald-600 uppercase mb-0.5">Completion</div><p className="text-[11px] text-emerald-800 whitespace-pre-wrap">{v.completionNote}</p></div>}
                                                {v.carryForwardReason && <div className="bg-orange-50/50 rounded-lg p-2 mt-1.5 border border-orange-200"><div className="text-[8px] font-bold text-orange-600 uppercase mb-0.5">Carry forward reason</div><p className="text-[11px] text-orange-800 whitespace-pre-wrap">{v.carryForwardReason}</p></div>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}
                {photos.length > 0 && (
                  <div><div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Photos ({photos.length})</div>
                    <div className="grid grid-cols-4 gap-2">{photos.map((p: any, i: number) => <img key={i} src={p.url || p} alt="" className="w-full h-20 object-cover rounded-lg border cursor-pointer hover:shadow-md" onClick={() => showPhotoLightbox(p.url || p)} />)}</div>
                  </div>
                )}
                {(d as any).odooLink && <div className="flex items-center gap-2 text-xs"><span className="text-slate-400">Odoo:</span><a href={(d as any).odooLink} target="_blank" rel="noreferrer" className="text-purple-600 hover:underline truncate">{(d as any).odooLink}</a></div>}
              </div>
              <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0">
                <button onClick={() => setPreviewItem(null)} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm">Close</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default MasterDashboard;


import React, { useState, useMemo } from 'react';
import { Ticket, Activity, Technician, Customer, TicketStatus } from '../types';
import { getActivityStatusLabel } from '../constants';
import {
  Search, Filter, Eye, X, Calendar, Clock, User, MapPin, Phone,
  CheckCircle2, AlertCircle, RotateCcw, Briefcase, Activity as ActivityIcon,
  Ticket as TicketIcon, ChevronDown, ExternalLink, Camera
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

const MasterDashboard: React.FC<MasterDashboardProps> = ({ tickets, activities, technicians, customers }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState<'all' | 'tickets' | 'activities'>('all');
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('all');
  const [previewItem, setPreviewItem] = useState<any>(null);

  // Normalize all jobs into a unified list
  const allJobs = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const monthAgo = new Date(now.getTime() - 30 * 86400000);

    const ticketJobs = tickets.map(t => ({
      id: t.id,
      kind: 'ticket' as const,
      reference: t.id,
      title: t.customerName || 'Unknown',
      subtitle: t.category,
      type: t.type || 'Under Warranty',
      status: t.status,
      priority: t.priority,
      date: new Date(t.createdAt),
      dateLabel: new Date(t.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric' }),
      techName: technicians.find(tc => tc.id === t.assignedTechId)?.name || 'Unassigned',
      customerId: t.customerId,
      raw: t,
    }));

    const activityJobs = activities.map(a => {
      const cust = customers.find(c => c.id === a.customerId);
      return {
        id: a.id,
        kind: 'activity' as const,
        reference: a.reference,
        title: cust?.name || 'Unknown',
        subtitle: a.type,
        type: a.serviceCategory || 'ELV Systems',
        status: a.status,
        priority: a.priority,
        date: new Date(a.plannedDate || a.createdAt),
        dateLabel: new Date(a.plannedDate || a.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric' }),
        techName: technicians.find(tc => tc.id === ((a as any).primaryEngineerId || a.leadTechId))?.name || 'Unassigned',
        customerId: a.customerId,
        raw: a,
      };
    });

    let combined = [...ticketJobs, ...activityJobs];

    // Date filter
    if (dateRange === 'today') combined = combined.filter(j => j.date.toDateString() === todayStr);
    else if (dateRange === 'week') combined = combined.filter(j => j.date >= weekAgo);
    else if (dateRange === 'month') combined = combined.filter(j => j.date >= monthAgo);

    // Type filter
    if (typeFilter === 'tickets') combined = combined.filter(j => j.kind === 'ticket');
    else if (typeFilter === 'activities') combined = combined.filter(j => j.kind === 'activity');

    // Status filter
    if (statusFilter !== 'ALL') combined = combined.filter(j => j.status === statusFilter);

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      combined = combined.filter(j =>
        j.reference.toLowerCase().includes(q) ||
        j.title.toLowerCase().includes(q) ||
        j.subtitle.toLowerCase().includes(q) ||
        j.techName.toLowerCase().includes(q) ||
        j.id.toLowerCase().includes(q)
      );
    }

    return combined.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [tickets, activities, technicians, customers, searchQuery, statusFilter, typeFilter, dateRange]);

  // KPI Metrics
  const metrics = useMemo(() => {
    const all = [...tickets.map(t => ({ status: t.status, kind: 'ticket' })), ...activities.map(a => ({ status: a.status, kind: 'activity' }))];
    return {
      total: all.length,
      active: all.filter(j => ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED', 'ASSIGNED'].includes(j.status)).length,
      planned: all.filter(j => ['PLANNED', 'NEW', 'OPEN'].includes(j.status)).length,
      completed: all.filter(j => ['DONE', 'RESOLVED'].includes(j.status)).length,
      carryForward: all.filter(j => j.status === 'CARRY_FORWARD').length,
      cancelled: all.filter(j => j.status === 'CANCELLED').length,
    };
  }, [tickets, activities]);

  const statusColors: Record<string, string> = {
    'NEW': 'bg-purple-100 text-purple-700',
    'OPEN': 'bg-blue-100 text-blue-700',
    'PLANNED': 'bg-amber-100 text-amber-700',
    'ASSIGNED': 'bg-indigo-100 text-indigo-700',
    'ON_MY_WAY': 'bg-cyan-100 text-cyan-700',
    'ARRIVED': 'bg-indigo-100 text-indigo-700',
    'IN_PROGRESS': 'bg-blue-100 text-blue-700',
    'DONE': 'bg-emerald-100 text-emerald-700',
    'RESOLVED': 'bg-emerald-100 text-emerald-700',
    'CARRY_FORWARD': 'bg-orange-100 text-orange-700',
    'CANCELLED': 'bg-slate-100 text-slate-500',
  };

  const fmtDt = (iso: string) => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Master Dashboard</h1>
            <p className="text-slate-500 text-sm">Complete operational overview — all tickets and activities</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-slate-900">{allJobs.length}</div>
            <div className="text-xs text-slate-400">Results</div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-6 gap-3 mb-4">
          {[
            { label: 'Total', value: metrics.total, color: 'bg-slate-900 text-white', filter: 'ALL' },
            { label: 'Active', value: metrics.active, color: 'bg-blue-50 text-blue-700 border border-blue-200', filter: 'IN_PROGRESS' },
            { label: 'Planned', value: metrics.planned, color: 'bg-amber-50 text-amber-700 border border-amber-200', filter: 'PLANNED' },
            { label: 'Completed', value: metrics.completed, color: 'bg-emerald-50 text-emerald-700 border border-emerald-200', filter: 'DONE' },
            { label: 'Carry Fwd', value: metrics.carryForward, color: 'bg-orange-50 text-orange-700 border border-orange-200', filter: 'CARRY_FORWARD' },
            { label: 'Cancelled', value: metrics.cancelled, color: 'bg-slate-50 text-slate-500 border border-slate-200', filter: 'CANCELLED' },
          ].map(kpi => (
            <button
              key={kpi.label}
              onClick={() => setStatusFilter(statusFilter === kpi.filter ? 'ALL' : kpi.filter)}
              className={`p-3 rounded-xl text-center transition-all ${statusFilter === kpi.filter ? 'ring-2 ring-slate-900 shadow-md' : ''} ${kpi.color}`}
            >
              <div className="text-xl font-black">{kpi.value}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{kpi.label}</div>
            </button>
          ))}
        </div>

        {/* Filters Row */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by reference, client, engineer, type..."
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all"
            />
          </div>
          {/* Type Filter */}
          <div className="flex bg-slate-100 rounded-xl p-0.5 shrink-0">
            {[
              { label: 'All', value: 'all' as const },
              { label: 'Tickets', value: 'tickets' as const },
              { label: 'Activities', value: 'activities' as const },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setTypeFilter(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${typeFilter === opt.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Date Range */}
          <div className="flex bg-slate-100 rounded-xl p-0.5 shrink-0">
            {[
              { label: 'Today', value: 'today' as const },
              { label: 'Week', value: 'week' as const },
              { label: 'Month', value: 'month' as const },
              { label: 'All Time', value: 'all' as const },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${dateRange === opt.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {opt.label}
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
              <th className="px-4 py-3 w-[6%]">Type</th>
              <th className="px-4 py-3 w-[10%]">Reference</th>
              <th className="px-4 py-3 w-[20%]">Client</th>
              <th className="px-4 py-3 w-[12%]">Category</th>
              <th className="px-4 py-3 w-[8%]">Priority</th>
              <th className="px-4 py-3 w-[11%]">Status</th>
              <th className="px-4 py-3 w-[11%]">Date</th>
              <th className="px-4 py-3 w-[14%]">Assigned To</th>
              <th className="px-4 py-3 w-[8%] text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {allJobs.length === 0 ? (
              <tr><td colSpan={9} className="px-6 py-12 text-center text-slate-400 italic">No jobs found matching your filters</td></tr>
            ) : (
              allJobs.map(job => (
                <tr key={`${job.kind}-${job.id}`} className="hover:bg-slate-50 group transition-colors">
                  <td className="px-4 py-3">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${job.kind === 'ticket' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                      {job.kind === 'ticket' ? 'TKT' : 'ACT'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 truncate">{job.reference}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800 truncate">{job.title}</div>
                  </td>
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
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setPreviewItem(job)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Eye size={12} /> View
                    </button>
                  </td>
                </tr>
              ))
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
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${statusColor}`} />
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isTicket ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                        {isTicket ? 'TICKET' : 'ACTIVITY'}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">{previewItem.reference}</span>
                    </div>
                    <h3 className="font-bold text-lg text-slate-900">{isTicket ? d.category : d.type}</h3>
                    {(d as any).serviceCategory && <div className="text-xs text-slate-500">{(d as any).serviceCategory}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1.5 rounded-full text-xs font-bold text-white ${statusColor}`}>{(d.status || '').replace(/_/g, ' ')}</span>
                  <button onClick={() => setPreviewItem(null)} className="p-1.5 hover:bg-slate-200 rounded-lg"><X size={18} className="text-slate-400" /></button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* Customer */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-1">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><User size={10} /> Customer</h4>
                  <div className="text-sm font-bold text-slate-800">{cust?.name || (isTicket ? d.customerName : 'Unknown')}</div>
                  {(cust?.phone || d.phoneNumber) && <div className="text-xs text-slate-500 flex items-center gap-1"><Phone size={10} /> {cust?.phone || d.phoneNumber}</div>}
                </div>

                {/* Service */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 grid grid-cols-3 gap-3">
                  <div><span className="text-[10px] text-slate-400 block">{isTicket ? 'Category' : 'Type'}</span><span className="text-xs font-medium text-slate-700">{isTicket ? d.category : d.type}</span></div>
                  <div><span className="text-[10px] text-slate-400 block">Priority</span><span className={`text-xs font-bold ${d.priority === 'URGENT' ? 'text-red-600' : d.priority === 'HIGH' ? 'text-orange-500' : 'text-slate-600'}`}>{d.priority}</span></div>
                  {!isTicket && (d as any).durationHours && <div><span className="text-[10px] text-slate-400 block">Duration</span><span className="text-xs font-medium">{(d as any).durationHours}h</span></div>}
                </div>

                {/* Timing */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-1.5">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><Clock size={10} /> Timing</h4>
                  <div className="flex justify-between text-xs"><span className="text-slate-400">{isTicket ? 'Created' : 'Planned'}</span><span className="text-slate-700">{fmtDt(isTicket ? d.createdAt : d.plannedDate)}</span></div>
                  {(d as any).startedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Started</span><span className="text-emerald-600">{fmtDt((d as any).startedAt)}</span></div>}
                  {(d as any).completedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Completed</span><span className="text-emerald-600">{fmtDt((d as any).completedAt)}</span></div>}
                </div>

                {/* Resources */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
                  {salesLd && (
                    <div className="pb-2 border-b border-slate-200">
                      <div className="text-[10px] font-bold text-indigo-600 uppercase mb-1">Sales Lead</div>
                      <div className="flex items-center gap-2 text-xs"><span className="w-2 h-2 rounded-full bg-indigo-500" /><span className="font-medium text-indigo-700">{salesLd.name}</span></div>
                    </div>
                  )}
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Assigned Team</div>
                  {tech && <div className="flex items-center gap-2 text-xs"><span className="w-2 h-2 rounded-full bg-purple-500" /><span className="font-medium text-slate-700">{tech.name}</span><span className="text-[10px] text-slate-400">{isTicket ? 'Assigned' : 'Engineer'}</span></div>}
                  {assistants.map((a: any) => <div key={a.id} className="flex items-center gap-2 text-xs"><span className="w-2 h-2 rounded-full bg-teal-500" /><span className="text-slate-700">{a.name}</span><span className="text-[10px] text-slate-400">TA</span></div>)}
                </div>

                {/* Description */}
                {issueText && <div className="bg-slate-50 rounded-xl p-4 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Description</div><p className="text-xs text-slate-700 whitespace-pre-wrap">{issueText}</p></div>}

                {/* Completion */}
                {(d as any).completionNote && <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100"><div className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Completion Summary</div><p className="text-xs text-emerald-800 whitespace-pre-wrap">{(d as any).completionNote}</p></div>}

                {/* Remarks (dedup) */}
                {((d as any).remarks || d.notes) && ((d as any).remarks || d.notes) !== (d as any).completionNote && <div className="bg-slate-50 rounded-xl p-4 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Remarks</div><p className="text-xs text-slate-700 whitespace-pre-wrap">{(d as any).remarks || d.notes}</p></div>}

                {/* Carry Forward */}
                {(d as any).carryForwardNote && <div className="bg-amber-50 rounded-xl p-4 border border-amber-200"><div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Carry Forward</div><p className="text-xs text-amber-800 whitespace-pre-wrap">{(d as any).carryForwardNote}</p>{(d as any).nextPlannedAt && <div className="text-[10px] text-amber-600 mt-1">Re-scheduled: {fmtDt((d as any).nextPlannedAt)}</div>}</div>}

                {/* Photos */}
                {photos.length > 0 && (
                  <div><div className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-1"><Camera size={10} /> Photos ({photos.length})</div>
                    <div className="grid grid-cols-4 gap-2">{photos.map((p: any, i: number) => <img key={i} src={p.url || p} alt="" className="w-full h-20 object-cover rounded-lg border border-slate-200 cursor-pointer hover:shadow-md" onClick={() => showPhotoLightbox(p.url || p)} />)}</div>
                  </div>
                )}

                {/* Location */}
                {((d as any).houseNumber || (d as any).locationUrl) && (
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <MapPin size={12} />
                    {(d as any).houseNumber && !(d as any).houseNumber.startsWith('http') && <span>House: {(d as any).houseNumber}</span>}
                    {(d as any).locationUrl && <a href={(d as any).locationUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View Map</a>}
                  </div>
                )}

                {/* Odoo */}
                {(d as any).odooLink && <div className="flex items-center gap-2 text-xs"><span className="text-slate-400">Odoo:</span><a href={(d as any).odooLink} target="_blank" rel="noreferrer" className="text-purple-600 hover:underline truncate">{(d as any).odooLink}</a></div>}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0">
                <button onClick={() => setPreviewItem(null)} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800">Close</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default MasterDashboard;

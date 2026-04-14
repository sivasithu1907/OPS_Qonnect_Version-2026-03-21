
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Team, Site, Technician, Activity, Ticket, Customer } from '../types';
import { 
  MapPin, Clock, Activity as ActivityIcon, Calendar, 
  CheckCircle2, AlertCircle, Ticket as TicketIcon, 
  Zap, Users, ChevronRight, Monitor, RefreshCw
} from 'lucide-react';

interface TVDisplayModeProps {
  teams: Team[];
  sites: Site[];
  technicians: Technician[];
  activities: Activity[];
  tickets: Ticket[];
  customers: Customer[];
  onRefresh?: () => void;
}

const TVDisplayMode: React.FC<TVDisplayModeProps> = ({ 
  teams, sites, technicians, activities, tickets, customers, onRefresh 
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activePanel, setActivePanel] = useState<'monitor' | 'calendar'>('monitor');

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      onRefresh?.();
    }, 60000);
    return () => clearInterval(timer);
  }, [onRefresh]);

  // Auto-toggle between panels every 30 seconds
  useEffect(() => {
    const toggle = setInterval(() => {
      setActivePanel(p => p === 'monitor' ? 'calendar' : 'monitor');
    }, 30000);
    return () => clearInterval(toggle);
  }, []);

  // Clock update
  useEffect(() => {
    const clock = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  const normalizeStatus = (status: string | undefined) => {
    if (!status) return '';
    return status.toUpperCase().replace(/\s/g, '_').replace('INPROGRESS', 'IN_PROGRESS');
  };

  // --- Operations Staff ---
  const operationsStaff = useMemo(() => {
    return technicians.filter(t =>
      (t.systemRole === 'TEAM_LEAD' || t.systemRole === 'FIELD_ENGINEER') &&
      t.systemRole !== 'ADMIN' &&
      t.isActive !== false &&
      t.status !== 'LEAVE'
    ).sort((a, b) => {
      if (a.level === 'TEAM_LEAD' && b.level !== 'TEAM_LEAD') return -1;
      if (a.level !== 'TEAM_LEAD' && b.level === 'TEAM_LEAD') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [technicians]);

  // --- Today's Metrics ---
  const metrics = useMemo(() => {
    const todayDate = new Date().toDateString();
    const activeActs = activities.filter(a =>
      ['IN_PROGRESS', 'PLANNED', 'ON_MY_WAY', 'ARRIVED'].includes(normalizeStatus(a.status)) &&
      new Date(a.plannedDate || a.createdAt).toDateString() === todayDate
    ).length;
    const activeTickets = tickets.filter(t => ['IN_PROGRESS', 'ASSIGNED', 'ON_MY_WAY', 'ARRIVED'].includes(normalizeStatus(t.status))).length;
    const completedToday = (
      activities.filter(a => a.status === 'DONE' && new Date((a as any).completedAt || a.updatedAt).toDateString() === todayDate).length +
      tickets.filter(t => normalizeStatus(t.status) === 'RESOLVED' && new Date((t as any).completedAt || t.updatedAt).toDateString() === todayDate).length
    );
    const alertsCount = activities.filter(a => (a.escalationLevel || 0) > 0 && a.status !== 'DONE' && a.status !== 'CANCELLED').length;
    return { activeJobs: activeActs + activeTickets, completedToday, alertsCount, plannedToday: activities.filter(a => new Date(a.plannedDate).toDateString() === todayDate).length };
  }, [activities, tickets]);

  // --- Calendar Week ---
  const calendarDays = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1); // Monday
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(d);
      day.setDate(day.getDate() + i);
      return day;
    });
  }, []);

  const assignableLeads = technicians.filter(t => 
    (t.systemRole === 'TEAM_LEAD' || t.systemRole === 'FIELD_ENGINEER') && 
    t.status !== 'LEAVE' && t.isActive !== false
  );

  // --- Status Colors ---
  const getStatusColor = (status: string) => {
    const s = normalizeStatus(status);
    if (s === 'IN_PROGRESS') return 'bg-blue-500';
    if (s === 'ON_MY_WAY') return 'bg-cyan-500';
    if (s === 'ARRIVED') return 'bg-indigo-500';
    if (s === 'DONE' || s === 'RESOLVED') return 'bg-emerald-500';
    if (s === 'CARRY_FORWARD') return 'bg-orange-500';
    if (s === 'CANCELLED') return 'bg-slate-400';
    return 'bg-amber-400';
  };

  const getStatusBg = (status: string) => {
    const s = normalizeStatus(status);
    if (s === 'IN_PROGRESS') return 'bg-blue-50 border-blue-200 text-blue-800';
    if (s === 'ON_MY_WAY') return 'bg-cyan-50 border-cyan-200 text-cyan-800';
    if (s === 'ARRIVED') return 'bg-indigo-50 border-indigo-200 text-indigo-800';
    if (s === 'DONE' || s === 'RESOLVED') return 'bg-emerald-50 border-emerald-200 text-emerald-800';
    if (s === 'CARRY_FORWARD') return 'bg-orange-50 border-orange-200 text-orange-800';
    return 'bg-amber-50 border-amber-200 text-amber-800';
  };

  return (
    <div className="fixed inset-0 bg-slate-950 text-white overflow-hidden flex flex-col" style={{ fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      
      {/* ── TOP BAR ── */}
      <div className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-4">
          <div className="bg-amber-500 text-slate-900 w-10 h-10 rounded-xl flex items-center justify-center font-black text-xl">Q</div>
          <div>
            <div className="text-lg font-bold tracking-tight">Qonnect Field Operations</div>
            <div className="text-xs text-slate-400">Live Operations Display</div>
          </div>
        </div>
        
        {/* KPI Strip */}
        <div className="flex items-center gap-8">
          <div className="text-center">
            <div className="text-2xl font-black text-amber-400">{metrics.activeJobs}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Active</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-black text-emerald-400">{metrics.completedToday}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Completed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-black text-blue-400">{metrics.plannedToday}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Planned</div>
          </div>
          {metrics.alertsCount > 0 && (
            <div className="text-center">
              <div className="text-2xl font-black text-red-400 animate-pulse">{metrics.alertsCount}</div>
              <div className="text-[10px] text-red-400 uppercase tracking-wider font-bold">Alerts</div>
            </div>
          )}
        </div>

        {/* Clock */}
        <div className="text-right">
          <div className="text-3xl font-black tracking-tight tabular-nums">
            {currentTime.toLocaleTimeString('en-GB', { timeZone: 'Asia/Qatar', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="text-xs text-slate-500">
            {currentTime.toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* ── PANEL TABS ── */}
      <div className="flex items-center gap-2 px-8 py-2 bg-slate-900/50 border-b border-slate-800/50 shrink-0">
        <button 
          onClick={() => setActivePanel('monitor')}
          className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${activePanel === 'monitor' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}
        >
          Operations Monitor
        </button>
        <button 
          onClick={() => setActivePanel('calendar')}
          className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${activePanel === 'calendar' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}
        >
          Weekly Calendar
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <RefreshCw size={12} className="animate-spin-slow" />
          Auto-refresh active
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 overflow-hidden">
        
        {/* ==================== OPERATIONS MONITOR ==================== */}
        {activePanel === 'monitor' && (
          <div className="h-full grid grid-cols-[1fr_320px] gap-0">
            {/* Team Grid */}
            <div className="overflow-y-auto p-6">
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                {operationsStaff.map(tech => {
                  const todayActs = activities.filter(a => {
                    const isToday = new Date(a.plannedDate).toDateString() === new Date().toDateString();
                    if (a.status === 'CANCELLED') return false;
                    if ((a as any).primaryEngineerId === tech.id) return true;
                    if (a.leadTechId === tech.id && isToday) return true;
                    return false;
                  });
                  const todayTickets = tickets.filter(t => 
                    t.assignedTechId === tech.id && 
                    ['IN_PROGRESS', 'ASSIGNED', 'ON_MY_WAY', 'ARRIVED'].includes(normalizeStatus(t.status))
                  );
                  const allJobs = [...todayActs, ...todayTickets];
                  const isActive = allJobs.some(j => ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'].includes(normalizeStatus((j as any).status)));

                  return (
                    <div key={tech.id} className={`rounded-2xl border p-5 transition-all ${
                      isActive ? 'bg-slate-800/80 border-blue-500/30 shadow-lg shadow-blue-500/5' : 'bg-slate-900/50 border-slate-800'
                    }`}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="relative">
                          <img src={tech.avatar} className="w-12 h-12 rounded-full bg-slate-700 object-cover" alt="" />
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 ${
                            isActive ? 'bg-blue-500 animate-pulse' : tech.status === 'AVAILABLE' ? 'bg-emerald-500' : 'bg-slate-500'
                          }`} />
                        </div>
                        <div>
                          <div className="font-bold text-base text-white">{tech.name}</div>
                          <div className="text-xs text-slate-400">
                            {tech.systemRole === 'TEAM_LEAD' ? 'Team Lead' : 'Field Engineer'}
                          </div>
                        </div>
                        {isActive && <span className="ml-auto text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded-full">LIVE</span>}
                      </div>

                      {/* Jobs list */}
                      <div className="space-y-2">
                        {allJobs.length === 0 && (
                          <div className="text-xs text-slate-600 italic py-2">No jobs today</div>
                        )}
                        {todayActs.slice(0, 3).map((a: any) => {
                          const cust = customers.find(c => c.id === a.customerId);
                          return (
                            <div key={a.id} className={`rounded-xl p-3 border text-xs ${getStatusBg(a.status)}`}>
                              <div className="flex justify-between items-start mb-1">
                                <span className="font-bold">{a.reference || a.id}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${getStatusColor(a.status)} text-white`}>
                                  {a.status.replace(/_/g, ' ')}
                                </span>
                              </div>
                              <div className="font-medium truncate">{cust?.name || a.type}</div>
                              <div className="text-[10px] opacity-70 mt-0.5">
                                {new Date(a.plannedDate).toLocaleTimeString('en-GB', { timeZone: 'Asia/Qatar', hour: '2-digit', minute: '2-digit' })}
                                {a.houseNumber && ` · ${a.houseNumber}`}
                              </div>
                            </div>
                          );
                        })}
                        {todayTickets.slice(0, 2).map((t: any) => (
                          <div key={t.id} className={`rounded-xl p-3 border text-xs ${getStatusBg(t.status)}`}>
                            <div className="flex justify-between items-start mb-1">
                              <span className="font-bold flex items-center gap-1"><TicketIcon size={10} /> {t.id}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${getStatusColor(t.status)} text-white`}>
                                {t.status.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <div className="font-medium truncate">{t.customerName}</div>
                          </div>
                        ))}
                        {allJobs.length > 5 && (
                          <div className="text-[10px] text-slate-500 text-center">+{allJobs.length - 5} more</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Feed Sidebar */}
            <div className="border-l border-slate-800 bg-slate-900/50 flex flex-col">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Live Feed</span>
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              </div>
              <div className="flex-1 overflow-y-auto">
                {(() => {
                  const today = new Date().toDateString();
                  const feedItems = [
                    ...tickets
                      .filter(t => new Date(t.updatedAt).toDateString() === today)
                      .map(t => ({
                        id: t.id, type: 'ticket' as const,
                        ref: t.id, client: t.customerName,
                        desc: t.category, time: new Date(t.updatedAt), status: t.status
                      })),
                    ...activities
                      .filter(a => a.type !== 'WHATSAPP_SUPPORT' && new Date(a.updatedAt || a.createdAt).toDateString() === today)
                      .map(a => ({
                        id: a.id, type: 'activity' as const,
                        ref: a.reference, client: customers.find(c => c.id === a.customerId)?.name || a.houseNumber || 'Unknown',
                        desc: a.description || a.type, time: new Date(a.updatedAt || a.createdAt), status: a.status
                      }))
                  ].sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 15);

                  return feedItems.map((item, i) => (
                    <div key={`${item.id}-${i}`} className="p-3 border-b border-slate-800/50">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-mono text-slate-500">{item.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${getStatusColor(item.status)} text-white`}>
                          {item.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="text-xs font-bold text-slate-300">{item.ref}</div>
                      <div className="text-[10px] text-slate-500 truncate">{item.client}</div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ==================== CALENDAR VIEW ==================== */}
        {activePanel === 'calendar' && (
          <div className="h-full flex flex-col p-6">
            {/* Calendar Header */}
            <div className="grid grid-cols-8 gap-0 mb-0 shrink-0">
              <div className="p-3 text-xs font-bold text-slate-500 uppercase">Engineer</div>
              {calendarDays.map(d => (
                <div key={d.toString()} className="p-3 text-center">
                  <div className="text-xs font-bold text-slate-400 uppercase">{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                  <div className={`text-lg font-black mt-1 ${d.toDateString() === new Date().toDateString() ? 'text-amber-400' : 'text-slate-300'}`}>
                    {d.getDate()}
                  </div>
                </div>
              ))}
            </div>

            {/* Calendar Body */}
            <div className="flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/50">
              {assignableLeads.map(lead => (
                <div key={lead.id} className="grid grid-cols-8 gap-0 border-b border-slate-800/50 min-h-[90px]">
                  <div className="p-3 border-r border-slate-800/50 flex flex-col justify-center">
                    <div className="font-bold text-sm text-slate-300">{lead.name}</div>
                    <div className="text-[10px] text-slate-500">{lead.systemRole === 'TEAM_LEAD' ? 'Team Lead' : 'FE'}</div>
                  </div>
                  {calendarDays.map(d => {
                    const dayActs = activities.filter(a => {
                      if (!a.plannedDate) return false;
                      if (new Date(a.plannedDate).toDateString() !== d.toDateString()) return false;
                      return a.leadTechId === lead.id || a.salesLeadId === lead.id;
                    });
                    return (
                      <div key={d.toString()} className={`p-1.5 border-r border-slate-800/30 ${d.toDateString() === new Date().toDateString() ? 'bg-amber-500/5' : ''}`}>
                        {dayActs.map(act => (
                          <div key={act.id} className={`mb-1 p-1.5 rounded-lg border text-[10px] ${getStatusBg(act.status)}`}>
                            <div className="font-bold truncate">{act.type}</div>
                            <div className="truncate opacity-70">{customers.find(c => c.id === act.customerId)?.name || act.houseNumber || ''}</div>
                            <div className="opacity-60">{new Date(act.plannedDate).toLocaleTimeString('en-GB', { timeZone: 'Asia/Qatar', hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── BOTTOM STATUS BAR ── */}
      <div className="h-8 bg-slate-900 border-t border-slate-800 flex items-center justify-between px-8 text-[10px] text-slate-500 shrink-0">
        <span>Qonnect Field Operations Platform — TV Display Mode</span>
        <span className="flex items-center gap-2">
          <Monitor size={10} />
          Read-Only · Auto-Refresh 60s · Panel Toggle 30s
        </span>
      </div>
    </div>
  );
};

export default TVDisplayMode;

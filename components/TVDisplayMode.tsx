
import React, { useState, useEffect, useMemo } from 'react';
import OperationsDashboard from './OperationsDashboard';
import { Monitor, RefreshCw, Calendar, Activity as ActivityIcon } from 'lucide-react';

const TVDisplayMode: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activePanel, setActivePanel] = useState<'monitor' | 'calendar'>('monitor');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [tickets, setTickets] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);

  const fetchTVData = async () => {
    try {
      const res = await fetch('/api/tv-data');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTickets(data.tickets || []);
      setActivities(data.activities || []);
      setTechnicians(data.technicians || []);
      setTeams(data.teams || []);
      setSites(data.sites || []);
      setCustomers(data.customers || []);
      setLoading(false);
      setError('');
    } catch (e: any) {
      console.error('TV data fetch failed:', e);
      setError(e.message || 'Failed to load');
      setLoading(false);
    }
  };

  useEffect(() => { fetchTVData(); }, []);

  useEffect(() => {
    const timer = setInterval(() => { setCurrentTime(new Date()); fetchTVData(); }, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const toggle = setInterval(() => {
      setActivePanel(p => p === 'monitor' ? 'calendar' : 'monitor');
    }, 45000);
    return () => clearInterval(toggle);
  }, []);

  useEffect(() => {
    const clock = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  const calendarDays = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1);
    return Array.from({ length: 7 }, (_, i) => { const day = new Date(d); day.setDate(day.getDate() + i); return day; });
  }, []);

  const assignableLeads = technicians.filter((t: any) =>
    (t.systemRole === 'TEAM_LEAD' || t.systemRole === 'FIELD_ENGINEER') &&
    t.status !== 'LEAVE' && t.isActive !== false
  );

  const normalizeStatus = (s: string) => (s || '').toUpperCase().replace(/\s/g, '_');
  const getStatusBg = (status: string) => {
    const s = normalizeStatus(status);
    if (s === 'IN_PROGRESS') return 'bg-blue-100 border-blue-300 text-blue-900';
    if (s === 'ON_MY_WAY') return 'bg-cyan-100 border-cyan-300 text-cyan-900';
    if (s === 'ARRIVED') return 'bg-indigo-100 border-indigo-300 text-indigo-900';
    if (s === 'DONE' || s === 'RESOLVED') return 'bg-emerald-100 border-emerald-300 text-emerald-900';
    if (s === 'CARRY_FORWARD') return 'bg-orange-100 border-orange-300 text-orange-900';
    return 'bg-amber-100 border-amber-300 text-amber-900';
  };

  // Status badge colors for calendar cards (pill-style, high contrast)
  const getStatusBadgeStyle = (status: string) => {
    const s = normalizeStatus(status);
    if (s === 'IN_PROGRESS') return 'bg-blue-600 text-white';
    if (s === 'ON_MY_WAY') return 'bg-cyan-600 text-white';
    if (s === 'ARRIVED') return 'bg-indigo-600 text-white';
    if (s === 'DONE' || s === 'RESOLVED') return 'bg-emerald-600 text-white';
    if (s === 'CARRY_FORWARD') return 'bg-amber-500 text-white';
    if (s === 'CANCELLED') return 'bg-slate-500 text-white';
    return 'bg-slate-400 text-white'; // PLANNED
  };
  const getStatusLabel = (status: string) => {
    const s = normalizeStatus(status);
    if (s === 'IN_PROGRESS') return 'IN PROGRESS';
    if (s === 'ON_MY_WAY') return 'ON WAY';
    if (s === 'CARRY_FORWARD') return 'CARRY FWD';
    return s.replace(/_/g, ' ');
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="bg-amber-500 text-slate-900 w-16 h-16 rounded-2xl flex items-center justify-center font-black text-3xl mx-auto mb-4">Q</div>
          <div className="text-xl font-bold text-white mb-2">Qonnect TV Display</div>
          <div className="text-sm text-slate-400">Loading operations data...</div>
        </div>
      </div>
    );
  }

  if (error && tickets.length === 0) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl font-bold text-red-400 mb-2">Connection Error</div>
          <div className="text-sm text-slate-400 mb-4">{error}</div>
          <button onClick={fetchTVData} className="px-4 py-2 bg-amber-500 text-slate-900 rounded-lg font-bold text-sm">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-100 overflow-hidden flex flex-col">
      
      {/* TV TOP BAR */}
      <div className="h-12 bg-slate-900 flex items-center justify-between px-6 shrink-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-amber-500 text-slate-900 w-8 h-8 rounded-lg flex items-center justify-center font-black text-lg">Q</div>
          <span className="text-white font-bold text-sm">Qonnect Field Operations</span>
          <div className="flex items-center gap-1 ml-4">
            <button 
              onClick={() => setActivePanel('monitor')}
              className={`px-3 py-1 rounded text-xs font-bold transition-colors flex items-center gap-1 ${activePanel === 'monitor' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}
            >
              <ActivityIcon size={12} /> Timeline
            </button>
            <button 
              onClick={() => setActivePanel('calendar')}
              className={`px-3 py-1 rounded text-xs font-bold transition-colors flex items-center gap-1 ${activePanel === 'calendar' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}
            >
              <Calendar size={12} /> Calendar
            </button>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <RefreshCw size={10} /> Auto-refresh 60s
          </div>
          <div className="text-white font-black text-xl tabular-nums tracking-tight">
            {currentTime.toLocaleTimeString('en-GB', { timeZone: 'Asia/Qatar', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="text-xs text-slate-400">
            {currentTime.toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', weekday: 'short', day: '2-digit', month: 'short' })}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-hidden">
        
        {/* OPERATIONS MONITOR — Uses the REAL timeline dispatch board */}
        {activePanel === 'monitor' && (
          <OperationsDashboard
            teams={teams as any}
            sites={sites as any}
            technicians={technicians as any}
            activities={activities as any}
            tickets={tickets as any}
            customers={customers as any}
            readOnly={true}
            tvMode={true}
          />
        )}

        {/* CALENDAR VIEW */}
        {activePanel === 'calendar' && (
          <div className="h-full flex flex-col bg-white">
            <div className="grid grid-cols-8 border-b border-slate-200 bg-slate-50 shrink-0">
              <div className="p-3 border-r border-slate-200 font-bold text-xs text-slate-500 uppercase flex items-center justify-center">Engineer</div>
              {calendarDays.map(d => (
                <div key={d.toString()} className="p-2 text-center border-r border-slate-200 last:border-0">
                  <div className="text-xs font-bold text-slate-600 uppercase">{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                  <div className={`text-lg font-black mt-0.5 ${d.toDateString() === new Date().toDateString() ? 'text-amber-600 bg-amber-50 w-8 h-8 rounded-full flex items-center justify-center mx-auto' : 'text-slate-700'}`}>
                    {d.getDate()}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {assignableLeads.map((lead: any) => (
                <div key={lead.id} className="grid grid-cols-8 border-b border-slate-100 min-h-[80px]">
                  <div className="p-3 border-r border-slate-200 bg-slate-50/50 flex flex-col justify-center">
                    <div className="font-bold text-slate-800 text-sm">{lead.name}</div>
                    <div className="text-[10px] text-slate-500">{lead.systemRole === 'TEAM_LEAD' ? 'Team Lead' : 'Field Engineer'}</div>
                  </div>
                  {calendarDays.map(d => {
                    const dayActs = activities.filter((a: any) => {
                      if (!a.plannedDate) return false;
                      if (new Date(a.plannedDate).toDateString() !== d.toDateString()) return false;
                      return a.leadTechId === lead.id || a.salesLeadId === lead.id;
                    });
                    return (
                      <div key={d.toString()} className={`p-1 border-r border-slate-100 last:border-0 ${d.toDateString() === new Date().toDateString() ? 'bg-amber-50/30' : ''}`}>
                        {dayActs.map((act: any) => (
                          <div key={act.id} className={`mb-1 p-1.5 rounded border text-[10px] relative ${getStatusBg(act.status)}`}>
                            <div className="flex items-start justify-between gap-1">
                              <div className="font-bold truncate flex-1">{act.type}</div>
                              <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[8px] font-black leading-none whitespace-nowrap ${getStatusBadgeStyle(act.status)}`}>
                                {getStatusLabel(act.status)}
                              </span>
                            </div>
                            <div className="truncate opacity-80">{customers.find((c: any) => c.id === act.customerId)?.name || act.houseNumber || ''}</div>
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

      {/* BOTTOM STATUS BAR */}
      <div className="h-6 bg-slate-900 flex items-center justify-between px-6 text-[10px] text-slate-500 shrink-0">
        <span>Qonnect Field Operations — TV Display</span>
        <span className="flex items-center gap-2"><Monitor size={10} /> Read-Only · Panel toggle 45s</span>
      </div>
    </div>
  );
};

export default TVDisplayMode;

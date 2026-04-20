
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
    // Qatar work week: Saturday to Friday
    d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); // Most recent Saturday
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
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center shadow-2xl mb-6"><svg viewBox="0 0 578 578" xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path d="M409.18,407.51a113.86,113.86,0,1,0-225.35,32.32l45-36.75a69.77,69.77,0,0,1,135.75,4.43Z" transform="translate(-8.5 -132)" fill="#fdbb40"/><rect x="251.37" y="404.96" width="30.72" height="30.72"/><rect x="293.23" y="404.96" width="30.72" height="30.72"/><rect x="251.37" y="447.04" width="30.72" height="30.72"/><rect x="293.23" y="447.04" width="30.72" height="30.72"/><path d="M297.5,220.76C186.94,220.76,97,310.71,97,421.27A200.3,200.3,0,0,0,112.27,498l36.14-29.53a156.51,156.51,0,0,1-7.3-47.21c0-86.24,70.15-156.4,156.39-156.4S453.89,335,453.89,421.27a156.33,156.33,0,0,1-7.42,47.57l36.11,29.49A200.38,200.38,0,0,0,498,421.27C498,310.71,408.06,220.76,297.5,220.76Z" transform="translate(-8.5 -132)" fill="#fdbb40"/><path d="M297.5,132c-159.35,0-289,129.64-289,289A287.17,287.17,0,0,0,41.63,555.23l35-28.57A243.44,243.44,0,0,1,52.61,421c0-135,109.86-244.89,244.89-244.89S542.39,286,542.39,421A243.47,243.47,0,0,1,518,527.49l35,28.55A287.17,287.17,0,0,0,586.5,421C586.5,261.64,456.85,132,297.5,132Z" transform="translate(-8.5 -132)" fill="#fdbb40"/><path d="M247.31,506.42l49.61-43.28,43.65,33.92,37-.7-.13,30.39,56,45.68a.78.78,0,0,0,.05-.14l66.75,54.48A289.41,289.41,0,0,0,529,593.6l-34.38-28h0l-73.11-60,.3-54.08-65.73.08-59.39-48L106.09,559.8,65.5,593.13c8.73,11.73,18.34,25.41,28.71,35.68L247.3,506.42Z" transform="translate(-8.5 -132)" fill="white"/><path d="M430.33,626.59A244.06,244.06,0,0,1,164,626.13L128.4,655.2a288.32,288.32,0,0,0,337.55.48Z" transform="translate(-8.5 -132)" fill="white"/></svg></div>
          <div className="text-xl font-bold text-white mb-2">Qonnect Field Operations Monitor</div>
          <div className="text-sm text-slate-400">Loading operations data...</div>
        </div>
      </div>
    );
  }

  if (error && tickets.length === 0) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center text-center">
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
          <div className="bg-white rounded-lg w-8 h-8 flex items-center justify-center shrink-0"><svg viewBox="0 0 578 578" xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M409.18,407.51a113.86,113.86,0,1,0-225.35,32.32l45-36.75a69.77,69.77,0,0,1,135.75,4.43Z" transform="translate(-8.5 -132)" fill="#fdbb40"/><rect x="251.37" y="404.96" width="30.72" height="30.72"/><rect x="293.23" y="404.96" width="30.72" height="30.72"/><rect x="251.37" y="447.04" width="30.72" height="30.72"/><rect x="293.23" y="447.04" width="30.72" height="30.72"/><path d="M297.5,220.76C186.94,220.76,97,310.71,97,421.27A200.3,200.3,0,0,0,112.27,498l36.14-29.53a156.51,156.51,0,0,1-7.3-47.21c0-86.24,70.15-156.4,156.39-156.4S453.89,335,453.89,421.27a156.33,156.33,0,0,1-7.42,47.57l36.11,29.49A200.38,200.38,0,0,0,498,421.27C498,310.71,408.06,220.76,297.5,220.76Z" transform="translate(-8.5 -132)" fill="#fdbb40"/><path d="M297.5,132c-159.35,0-289,129.64-289,289A287.17,287.17,0,0,0,41.63,555.23l35-28.57A243.44,243.44,0,0,1,52.61,421c0-135,109.86-244.89,244.89-244.89S542.39,286,542.39,421A243.47,243.47,0,0,1,518,527.49l35,28.55A287.17,287.17,0,0,0,586.5,421C586.5,261.64,456.85,132,297.5,132Z" transform="translate(-8.5 -132)" fill="#fdbb40"/><path d="M247.31,506.42l49.61-43.28,43.65,33.92,37-.7-.13,30.39,56,45.68a.78.78,0,0,0,.05-.14l66.75,54.48A289.41,289.41,0,0,0,529,593.6l-34.38-28h0l-73.11-60,.3-54.08-65.73.08-59.39-48L106.09,559.8,65.5,593.13c8.73,11.73,18.34,25.41,28.71,35.68L247.3,506.42Z" transform="translate(-8.5 -132)" fill="white"/><path d="M430.33,626.59A244.06,244.06,0,0,1,164,626.13L128.4,655.2a288.32,288.32,0,0,0,337.55.48Z" transform="translate(-8.5 -132)" fill="white"/></svg></div>
          <span className="text-white font-bold text-sm">Qonnect Field Operations Monitor</span>
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
                          <div key={act.id} className={`mb-1 p-1.5 rounded border text-[10px] ${getStatusBg(act.status)}`}>
                            <div className="font-bold truncate">{act.type}</div>
                            <div className="truncate font-medium opacity-90">{customers.find((c: any) => c.id === act.customerId)?.name || ''}</div>
                            {act.serviceCategory && <div className="truncate opacity-60">{act.serviceCategory}</div>}
                            {act.remarks && <div className="truncate opacity-60">{act.remarks.substring(0, 30)}</div>}
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="opacity-60">{new Date(act.plannedDate).toLocaleTimeString('en-GB', { timeZone: 'Asia/Qatar', hour: '2-digit', minute: '2-digit' })}</span>
                              <span className={`px-1 py-0.5 rounded text-[7px] font-bold leading-none ${getStatusBadgeStyle(act.status)}`}>{getStatusLabel(act.status)}</span>
                            </div>
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
        <span>Qonnect Field Operations Monitor</span>
        <span className="flex items-center gap-2"><Monitor size={10} /> Read-Only · Panel toggle 45s</span>
      </div>
    </div>
  );
};

export default TVDisplayMode;


import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Team, Site, Customer, ActivityStatus, Priority, ActivityType, Technician, ServiceCategory, Role } from '../types';
import { 
  Calendar, List, Layout, Plus, Search, Filter, Clock, 
  MoreHorizontal, ChevronLeft, ChevronRight, User, MapPin, 
  CheckCircle2, AlertCircle, X, Save, BriefcaseBusiness, Link as LinkIcon, Home
} from 'lucide-react';
import CustomerSelector from './CustomerSelector';
import { getActivityStatusLabel } from '../constants';

interface PlanningModuleProps {
  activities: Activity[];
  teams: Team[]; 
  sites: Site[];
  customers: Customer[];
  technicians?: Technician[];
  onAddActivity: (activity: Omit<Activity, 'id' | 'reference' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateActivity: (activity: Activity) => void;
  onDeleteActivity: (id: string) => void;
  onAddCustomer?: (customer: Customer) => Promise<Customer | null> | void;
  isMobile?: boolean; // New prop for mobile responsiveness
  initialActivityId?: string | null;
  onClearInitialActivity?: () => void;
  currentUserId?: string; // For self-assign logic
}

const PlanningModule: React.FC<PlanningModuleProps> = ({ 
  activities, sites, customers, technicians = [],
  onAddActivity, onUpdateActivity, onDeleteActivity, onAddCustomer = (_: Customer) => {}, // Fixed default signature
  isMobile = false,
  initialActivityId,
  onClearInitialActivity,
  currentUserId
}) => {
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

  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'calendar'>('kanban');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [viewingActivity, setViewingActivity] = useState<Activity | null>(null);
  
  // Calendar week navigation state
  const [calendarWeekStart, setCalendarWeekStart] = useState<Date>(() => {
      const d = new Date();
      // Qatar work week: Saturday to Friday
      d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); // Most recent Saturday
      d.setHours(0, 0, 0, 0);
      return d;
  });
  
  // Mobile Tab State
  const [mobileTab, setMobileTab] = useState<ActivityStatus>('PLANNED');

  // Form State
  const [plannedDatetime, setPlannedDatetime] = useState(''); // YYYY-MM-DDTHH:mm
  const [durationState, setDurationState] = useState<{ val: string, unit: 'HOURS' | 'DAYS' }>({ val: '2', unit: 'HOURS' });
  
  // Customer Selector State
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  
  // Location auto-fill state (controlled, populated from customer on select)
  const [locationUrl, setLocationUrl] = useState('');
  const [serviceCats, setServiceCats] = useState<string[]>([]);
  const [selectedLeadTechId, setSelectedLeadTechId] = useState('');

  // Sync serviceCats when editing activity changes
  React.useEffect(() => {
    if (editingActivity?.serviceCategory) {
      setServiceCats(editingActivity.serviceCategory.split(', ').filter(Boolean));
    } else {
      setServiceCats([]);
    }
    setSelectedLeadTechId(editingActivity?.leadTechId || '');
  }, [editingActivity]);
  const [houseNumber, setHouseNumber] = useState('');

  // Freelancers State (activity-level, no user record)
  const [freelancers, setFreelancers] = useState<{ name: string; role: string; phone: string }[]>([]);

  // Filter Active Staff Only
  const teamLeads = technicians.filter(t => t.systemRole === Role.TEAM_LEAD && t.status !== 'LEAVE' && t.isActive !== false);
  const fieldEngineers = technicians.filter(t => t.systemRole === Role.FIELD_ENGINEER && t.status !== 'LEAVE' && t.isActive !== false);
  const assignableLeads = technicians.filter(t => (t.systemRole === Role.TEAM_LEAD || t.systemRole === Role.FIELD_ENGINEER) && t.status !== 'LEAVE' && t.isActive !== false);
  const salesTeam = technicians.filter(t => t.level === 'SALES' && t.status !== 'LEAVE' && t.isActive !== false);
  const technicalAssociates = technicians.filter(t => t.level === 'TECHNICAL_ASSOCIATE' && t.status !== 'LEAVE' && t.isActive !== false);

  // Self Assign Logic for Team Lead
  const currentUser = technicians.find(t => t.id === currentUserId);
  const canSelfAssign = currentUser?.systemRole === Role.TEAM_LEAD;

  // Date Constants
  const currentYear = new Date().getFullYear();
  const YEARS = Array.from({ length: 5 }, (_, i) => currentYear + i);
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June', 
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

  // Handle Initial ID from Navigation
  useEffect(() => {
      if (initialActivityId) {
          const act = activities.find(a => a.id === initialActivityId);
          if (act) {
              setEditingActivity(act);
              setIsModalOpen(true);
          }
          // Clear ID to prevent reopen loops if needed, though parent handles unmount usually
          if (onClearInitialActivity) onClearInitialActivity();
      }
  }, [initialActivityId, activities]);

  // Initialize form state when opening modal
  useEffect(() => {
    if (isModalOpen) {
        if (editingActivity) {
            const d = new Date(editingActivity.plannedDate);
            const pad = (n: number) => String(n).padStart(2,'0');
            setPlannedDatetime(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
            setDurationState({
                val: editingActivity.durationHours.toString(),
                unit: editingActivity.durationUnit || 'HOURS'
            });
            setSelectedCustomerId(editingActivity.customerId || '');
            setLocationUrl(editingActivity.locationUrl || '');
            setHouseNumber(editingActivity.houseNumber || '');
            setFreelancers((editingActivity as any).freelancers || []);
        } else {
            const now = new Date();
            now.setDate(now.getDate() + 1);
            now.setHours(9, 0, 0, 0);
            setPlannedDatetime(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T09:00`);
            setDurationState({ val: '2', unit: 'HOURS' });
            setSelectedCustomerId('');
            setLocationUrl('');
            setHouseNumber('');
            setFreelancers([]);
        }
    }
  }, [isModalOpen, editingActivity]);

  const getDaysInMonth = (year: string, month: string) => {
      if (!year || !month) return 31;
      return new Date(parseInt(year), parseInt(month) + 1, 0).getDate();
  };

  const getDisplayLocation = (act: Activity) => {
      const site = sites.find(s => s.id === act.siteId);
      if (site) return site.name;
      // If houseNumber is a URL, don't show raw URL
      if (act.houseNumber && !act.houseNumber.startsWith('http')) return `House: ${act.houseNumber}`;
      const cust = customers.find(c => c.id === act.customerId);
      if (cust?.buildingNumber && !cust.buildingNumber.startsWith('http')) return `Bldg: ${cust.buildingNumber}`;
      if (cust?.name) return cust.name;
      if (act.locationUrl || act.houseNumber?.startsWith('http') || cust?.address?.startsWith('http')) return 'Map linked';
      return 'N/A';
  };

  // Determine available associates — ONLY block on TIME OVERLAP, allow multiple jobs per day
  const selectedDateString = useMemo(() => {
      if (!plannedDatetime) return '';
      return new Date(plannedDatetime).toDateString();
  }, [plannedDatetime]);

  const availableAssociates = useMemo(() => {
      // If no date/time selected yet, show all TAs (no filtering)
      if (!plannedDatetime) return technicalAssociates;
      
      const newStart = new Date(plannedDatetime).getTime();
      const durationMs = Number(durationState.val) * (durationState.unit === 'DAYS' ? 86400000 : 3600000);
      const newEnd = newStart + durationMs;
      
      return technicalAssociates.filter(tech => {
          // Check EVERY activity to see if this TA has a TIME CONFLICT
          // A conflict means: the TA is assigned to another job AND the time ranges overlap
          // NO date-only blocking — multiple jobs per day are fine if times don't overlap
          const hasTimeConflict = activities.some(act => {
              // Skip the activity being edited
              if (editingActivity && act.id === editingActivity.id) return false;
              // Skip completed/cancelled/carry-forwarded — they're done
              if (['DONE', 'CANCELLED', 'CARRY_FORWARD'].includes(act.status)) return false;
              
              // Is this TA assigned to this activity in ANY role?
              const isAssigned = 
                  (act.assistantTechIds || []).includes(tech.id) ||
                  ((act as any).supportingEngineerIds || []).includes(tech.id) ||
                  (act as any).primaryEngineerId === tech.id ||
                  act.leadTechId === tech.id;
              
              if (!isAssigned) return false;
              
              // Now check TIME OVERLAP (this is the ONLY blocking criterion)
              const actStart = new Date(act.plannedDate).getTime();
              const actDuration = (act.durationHours || 2) * 3600000;
              const actEnd = actStart + actDuration;
              
              // For IN_PROGRESS jobs: they started but haven't ended — treat as blocking until estimated end
              // Use startedAt if available for more accurate timing
              const realStart = (act as any).startedAt ? new Date((act as any).startedAt).getTime() : actStart;
              const realEnd = (act as any).completedAt ? new Date((act as any).completedAt).getTime() : actEnd;
              
              // Overlap check: newStart < existingEnd AND newEnd > existingStart
              return newStart < realEnd && newEnd > realStart;
          });
          
          return !hasTimeConflict;
      });
  }, [technicalAssociates, activities, editingActivity, plannedDatetime, durationState]);

  // --- Handlers ---
  const handleNewCustomer = async (cust: Customer): Promise<Customer | null> => {
      try {
          // onAddCustomer returns the DB-created customer with the real server-assigned ID
          const dbCustomer = await (onAddCustomer as (c: Customer) => Promise<Customer | null>)(cust);
          if (dbCustomer?.id) {
              setSelectedCustomerId(dbCustomer.id);
              return dbCustomer;
          }
          // Fallback: use temp ID if DB didn't return a customer (should not happen)
          setSelectedCustomerId(cust.id);
          return cust;
      } catch (err) {
          console.error('handleNewCustomer error:', err);
          // Propagate error so CustomerSelector can show it (modal stays open)
          throw err;
      }
  };

  // --- Shared Activity Card (Mobile/Kanban) ---
  const ActivityCard: React.FC<{ act: Activity, isMobileCard?: boolean }> = ({ act, isMobileCard = false }) => {
        const customer = customers.find(c => c.id === act.customerId);
        // Note: leadTechId now points to a FIELD_ENGINEER or Self-Assigned Team Lead
        const lead = technicians.find(t => t.id === act.leadTechId);
        const isDelayed = (act.escalationLevel || 0) > 0;
        
        return (
          <div 
            onClick={() => setViewingActivity(act)} 
            className={`bg-white rounded-lg shadow-sm border cursor-pointer hover:shadow-md transition-all group ${
                isDelayed ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200'
            } ${isMobileCard ? 'p-4 mb-3 mx-1' : 'p-4'}`}
          >
             <div className="flex justify-between items-start mb-2">
                <span className="font-mono text-[10px] text-slate-400">{act.reference}</span>
                <div className="flex gap-1">
                   {isDelayed && <span className="bg-red-500 text-white text-[9px] px-1 rounded font-bold">L{act.escalationLevel}</span>}
                   <MoreHorizontal size={14} className="text-slate-300 group-hover:text-emerald-600"/>
                </div>
             </div>
             <h4 className="font-bold text-slate-800 text-sm mb-1">{act.type}</h4>
             {act.serviceCategory && <p className="text-[10px] text-indigo-600 mb-1">{act.serviceCategory}</p>}
             <p className="text-xs text-slate-500 mb-3 line-clamp-2">{act.description}</p>
             
             <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                   <User size={12} className="text-slate-400" />
                   <span className="truncate font-medium">{customer?.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                   <MapPin size={12} className="text-slate-400" />
                   <span className="truncate">{getDisplayLocation(act)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                   <Clock size={12} className="text-slate-400" />
                   <span>{new Date(act.plannedDate).toLocaleDateString()}</span>
                </div>
             </div>
          </div>
        );
  };

  // --- View Components ---

  const ListView = () => {
  const [listFilter, setListFilter] = React.useState<string>('ALL');
  const statusFilters = ['ALL', 'PLANNED', 'IN_PROGRESS', 'CARRY_FORWARD', 'DONE', 'CANCELLED'];
  const filteredActs = listFilter === 'ALL'
    ? [...activities].sort((a, b) => new Date(b.plannedDate || b.createdAt).getTime() - new Date(a.plannedDate || a.createdAt).getTime())
    : activities.filter(a => a.status === listFilter).sort((a, b) => new Date(b.plannedDate || b.createdAt).getTime() - new Date(a.plannedDate || a.createdAt).getTime());
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm flex flex-col h-[calc(100vh-14rem)]">
      <div className="flex gap-2 p-3 border-b border-slate-100 bg-slate-50/80 overflow-x-auto">
        {statusFilters.map(f => (
          <button key={f} onClick={() => setListFilter(f)}
            className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${listFilter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>
            {f.replace('_',' ')} ({f === 'ALL' ? activities.length : activities.filter(a => a.status === f).length})
          </button>
        ))}
      </div>
      <div className="overflow-x-auto flex-1 overflow-y-auto">
      <table className="w-full text-sm text-left table-fixed">
        <thead className="bg-slate-50 text-slate-500 font-semibold uppercase text-xs border-b border-slate-200">
          <tr>
            <th className="px-4 py-4 w-[10%]">Ref</th>
            <th className="px-4 py-4 w-[10%]">Type</th>
            <th className="px-4 py-4 w-[24%]">Customer / Location</th>
            <th className="px-4 py-4 w-[8%]">Priority</th>
            <th className="px-4 py-4 w-[10%]">Status</th>
            <th className="px-4 py-4 w-[12%]">Planned</th>
            <th className="px-4 py-4 w-[18%]">Resources</th>
            <th className="px-4 py-4 text-right w-[8%]">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filteredActs.map(act => {
            const customer = customers.find(c => c.id === act.customerId);
            const lead = technicians.find(t => t.id === act.leadTechId);
            const salesLead = technicians.find(t => t.id === act.salesLeadId);
            const helpersCount = act.assistantTechIds?.length || 0;
            const isDelayed = (act.escalationLevel || 0) > 0;

            return (
              <tr key={act.id} className={`hover:bg-slate-50 group ${isDelayed ? 'bg-red-50/30' : ''}`}>
                <td className="px-4 py-4 font-mono text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                        {act.reference}
                        {isDelayed && <AlertCircle size={12} className="text-red-500" />}
                    </div>
                    {act.odooLink && (
                        <a href={act.odooLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] text-purple-600 hover:underline mt-1">
                            <LinkIcon size={10} /> Odoo
                        </a>
                    )}
                </td>
                <td className="px-4 py-4 font-medium text-slate-800">
                    {act.type}
                    {act.serviceCategory && <div className="text-[10px] text-slate-500 font-normal">{act.serviceCategory}</div>}
                </td>
                <td className="px-4 py-4">
                  <div className="font-medium text-slate-900 truncate">{customer?.name || 'Unknown'}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-1 truncate">
                      <MapPin size={10} className="shrink-0" /> {getDisplayLocation(act)}
                  </div>
                  {act.locationUrl && (
                      <a href={act.locationUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[9px] text-blue-600 hover:underline flex items-center gap-1 mt-0.5">
                          <MapPin size={8} className="shrink-0" /> View Map
                      </a>
                  )}
                </td>
                <td className="px-4 py-4">
                  <span className={`px-2 py-1 rounded text-[10px] font-bold border ${
                    act.priority === 'URGENT' ? 'bg-red-50 text-red-700 border-red-200' :
                    act.priority === 'HIGH' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                    'bg-slate-50 text-slate-600 border-slate-200'
                  }`}>{act.priority}</span>
                </td>
                <td className="px-4 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                    act.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' :
                    act.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                    act.status === 'CARRY_FORWARD' ? 'bg-orange-100 text-orange-700' :
                    act.status === 'CANCELLED' ? 'bg-slate-100 text-slate-500' :
                    'bg-amber-100 text-amber-700'
                  }`}>{getActivityStatusLabel(act.status)}</span>
                </td>
                <td className="px-4 py-4 text-slate-600">
                  <div className="flex items-center gap-1">
                      <Calendar size={12} /> {new Date(act.plannedDate).toLocaleDateString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short', year:'numeric'})}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-400 mt-1">
                      <Clock size={12} /> {new Date(act.plannedDate).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}
                  </div>
                </td>
                <td className="px-4 py-4">
                     <div className="flex flex-col gap-1">
                       {lead ? (
                         <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-purple-500"/>
                              <span className="font-medium">{lead.name}</span>
                         </div>
                       ) : <span className="text-slate-400 italic text-[10px]">No Eng.</span>}
                       
                       {salesLead && (
                         <div className="flex items-center gap-2 text-xs text-indigo-600">
                            <span className="w-2 h-2 rounded-full bg-indigo-500"/>
                            <span>{salesLead.name.split(' ')[0]} (Sales)</span>
                         </div>
                       )}

                       {helpersCount > 0 && <span className="text-[10px] text-slate-500 pl-4">+ {helpersCount} Assts.</span>}

                       {((act as any).freelancers || []).length > 0 && (
                         <div className="flex flex-wrap gap-1 mt-0.5">
                           {(act as any).freelancers.map((fl: any, i: number) => (
                             <span key={i} className="text-[9px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded border border-amber-200 font-medium">
                               {fl.name} <span className="text-[7px] opacity-60">FL</span>
                             </span>
                           ))}
                         </div>
                       )}
                     </div>
                </td>
                <td className="px-4 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setViewingActivity(act)} className="text-slate-400 hover:text-blue-600 font-medium text-xs">View</button>
                    <span className="text-slate-200">|</span>
                    <button onClick={() => { setEditingActivity(act); setIsModalOpen(true); }} className="text-slate-400 hover:text-emerald-600 font-medium text-xs">Edit</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
};

  const KanbanView = () => {
    const columns: ActivityStatus[] = ['PLANNED', 'IN_PROGRESS', 'CARRY_FORWARD', 'DONE', 'CANCELLED'];
    
    return (
      <div className="flex gap-6 overflow-x-auto pb-4 h-[calc(100vh-14rem)]">
        {columns.map(status => (
          <div key={status} className="flex-1 min-w-[280px] flex flex-col bg-slate-100/50 rounded-xl border border-slate-200/60">
            <div className={`p-4 border-b border-slate-200 flex justify-between items-center ${
              status === 'PLANNED' ? 'bg-amber-50/50' : 
              status === 'IN_PROGRESS' ? 'bg-blue-50/50' : 
              status === 'CARRY_FORWARD' ? 'bg-orange-50/50' :
              status === 'DONE' ? 'bg-emerald-50/50' : 'bg-slate-50'
            }`}>
              <h3 className="font-bold text-slate-700 text-sm">{getActivityStatusLabel(status)}</h3>
              <span className="bg-white px-2 py-0.5 rounded text-xs font-bold text-slate-400 border border-slate-200">
                {activities.filter(a => a.status === status).length}
              </span>
            </div>
            
            <div className="p-3 flex-1 overflow-y-auto space-y-3 custom-scrollbar">
              {activities.filter(a => a.status === status).map(act => (
                  <ActivityCard key={act.id} act={act} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // --- Mobile Tab View ---
  const MobileTabView = () => {
      const tabs: ActivityStatus[] = ['PLANNED', 'IN_PROGRESS', 'CARRY_FORWARD', 'DONE', 'CANCELLED'];
      const filteredActs = activities.filter(a => a.status === mobileTab);

      return (
          <div className="flex flex-col h-full">
              {/* Segmented Control */}
              <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm mb-4 shrink-0 overflow-x-auto">
                  {tabs.map(t => (
                      <button 
                        key={t}
                        onClick={() => setMobileTab(t)}
                        className={`flex-1 py-2 px-3 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all ${
                            mobileTab === t ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                          {getActivityStatusLabel(t)} ({activities.filter(a => a.status === t).length})
                      </button>
                  ))}
              </div>

              {/* Card List */}
              <div className="flex-1 overflow-y-auto min-h-0 pb-20">
                  {filteredActs.length === 0 ? (
                      <div className="text-center py-10 text-slate-400 text-xs">No {getActivityStatusLabel(mobileTab)} activities</div>
                  ) : (
                      filteredActs.map(act => <ActivityCard key={act.id} act={act} isMobileCard={true} />)
                  )}
              </div>
          </div>
      );
  };

  const CalendarView = () => {
    // Use calendarWeekStart state for week days
    const days = Array.from({length: 7}, (_, i) => {
        const d = new Date(calendarWeekStart);
        d.setDate(d.getDate() + i);
        return d;
    });

    const goToPrevWeek = () => {
        setCalendarWeekStart(prev => {
            const d = new Date(prev);
            d.setDate(d.getDate() - 7);
            return d;
        });
    };
    const goToNextWeek = () => {
        setCalendarWeekStart(prev => {
            const d = new Date(prev);
            d.setDate(d.getDate() + 7);
            return d;
        });
    };
    const goToThisWeek = () => {
        const d = new Date();
        d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); // Most recent Saturday
        d.setHours(0, 0, 0, 0);
        setCalendarWeekStart(d);
    };

    const isCurrentWeek = (() => {
        const now = new Date();
        const sat = new Date(now);
        sat.setDate(sat.getDate() - ((sat.getDay() + 1) % 7)); // Most recent Saturday
        sat.setHours(0, 0, 0, 0);
        return calendarWeekStart.getTime() === sat.getTime();
    })();

    // Use Team Leads for rows in Calendar View (since they manage schedules usually)
    // Also add a "Freelancer / Unassigned" row for activities without an internal lead
    const hasUnassignedActs = activities.some(a => !a.leadTechId && ((a as any).freelancers || []).length > 0);
    
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm flex flex-col h-[calc(100vh-14rem)]">
        {/* Calendar Navigation Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-white">
            <button onClick={goToPrevWeek} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 hover:text-slate-800">
                <ChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-slate-800">
                    {days[0].toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} — {days[6].toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
                {!isCurrentWeek && (
                    <button onClick={goToThisWeek} className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full hover:bg-blue-100 transition-colors">
                        Today
                    </button>
                )}
            </div>
            <button onClick={goToNextWeek} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 hover:text-slate-800">
                <ChevronRight size={18} />
            </button>
        </div>
        {/* Header Grid */}
        <div className="grid grid-cols-8 border-b border-slate-200 bg-slate-50">
           <div className="p-4 border-r border-slate-200 font-bold text-xs text-slate-500 uppercase tracking-wider flex items-center justify-center">
             Engineer / Lead
           </div>
           {days.map(d => (
             <div key={d.toString()} className="p-3 text-center border-r border-slate-200 last:border-0">
               <div className="text-xs font-bold text-slate-700 uppercase">{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
               <div className={`text-sm font-bold mt-1 ${d.toDateString() === new Date().toDateString() ? 'text-emerald-600 bg-emerald-50 w-8 h-8 rounded-full flex items-center justify-center mx-auto' : 'text-slate-500'}`}>
                 {d.getDate()}
               </div>
             </div>
           ))}
        </div>
        
        {/* Body Grid */}
        <div className="overflow-y-auto flex-1 custom-scrollbar">
           {assignableLeads.map(lead => (
             <div key={lead.id} className="grid grid-cols-8 border-b border-slate-100 min-h-[100px]">
               <div className="p-4 border-r border-slate-200 bg-slate-50/30 flex flex-col justify-center">
                 <h4 className="font-bold text-slate-800 text-sm">{lead.name}</h4>
                 <div className="text-[10px] text-slate-500 mt-1">{(lead as any).jobRole || lead.role || lead.systemRole}</div>
                 <div className={`text-[9px] font-bold mt-0.5 ${lead.systemRole === 'TEAM_LEAD' ? 'text-purple-500' : 'text-blue-500'}`}>
                   {lead.systemRole === 'TEAM_LEAD' ? 'Team Lead' : 'Field Engineer'}
                 </div>
               </div>
               {days.map(d => {
                 const dayActs = activities.filter(a => {
                    if (!a.plannedDate) return false;
                    if (new Date(a.plannedDate).toDateString() !== d.toDateString()) return false;
                    return a.leadTechId === lead.id || a.salesLeadId === lead.id || a.assignedTeamId === lead.id;
                 });
                 
                 return (
                   <div key={d.toString()} className="p-2 border-r border-slate-100 last:border-0 relative hover:bg-slate-50/50 transition-colors">
                      {dayActs.map(act => {
                        const actFreelancers = (act as any).freelancers || [];
                        const actCustomer = customers.find(c => c.id === act.customerId);
                        const actTAs = (act.assistantTechIds || []).map(id => technicians.find(t => t.id === id)).filter(Boolean);
                        const actSupport = ((act as any).supportingEngineerIds || [])
                            .filter((id: string) => !(act.assistantTechIds || []).includes(id)) // exclude TAs already shown
                            .map((id: string) => technicians.find(t => t.id === id)).filter(Boolean);
                        const statusColor = act.status === 'DONE' ? 'bg-emerald-500' : act.status === 'IN_PROGRESS' ? 'bg-blue-500' : act.status === 'CARRY_FORWARD' ? 'bg-orange-500' : act.status === 'CANCELLED' ? 'bg-slate-400' : 'bg-slate-400';
                        return (
                        <div 
                          key={act.id} 
                          onClick={() => setViewingActivity(act)}
                          className={`mb-2 p-2 rounded border text-xs shadow-sm cursor-pointer hover:shadow-md transition-all ${
                            (act.escalationLevel || 0) > 0 ? 'bg-red-50 border-red-400 border-l-4' :
                            act.status === 'DONE' ? 'bg-emerald-50 border-emerald-200' :
                            act.status === 'CARRY_FORWARD' ? 'bg-orange-50 border-orange-200' :
                            act.priority === 'URGENT' ? 'bg-red-50 border-red-200 border-l-4 border-l-red-500' : 
                            'bg-white border-slate-200 border-l-4 border-l-blue-400'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1 mb-0.5">
                              <div className="font-bold truncate text-slate-700 flex items-center gap-1">
                                  {act.type}
                                  {(act.escalationLevel || 0) > 0 && <AlertCircle size={10} className="text-red-500"/>}
                              </div>
                              <span className={`shrink-0 px-1 py-0.5 rounded text-[7px] font-bold text-white leading-none ${statusColor}`}>
                                  {getActivityStatusLabel(act.status)}
                              </span>
                          </div>
                          {/* Client Name */}
                          {actCustomer && <div className="text-[10px] font-medium text-slate-800 truncate">{actCustomer.name}</div>}
                          <div className="text-[9px] text-slate-400 mt-0.5">{new Date(act.plannedDate).toLocaleTimeString('en-GB',{timeZone:'Asia/Qatar',hour:'2-digit',minute:'2-digit'})}{act.durationHours ? ` · ${act.durationHours}h` : ''}</div>
                          {/* TAs */}
                          {actTAs.length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-1">
                              {actTAs.map((ta: any) => (
                                <span key={ta.id} className="text-[7px] px-1 py-0.5 bg-teal-50 text-teal-700 rounded border border-teal-200 truncate max-w-[80px]">{ta.name}</span>
                              ))}
                            </div>
                          )}
                          {/* Support Engineers */}
                          {actSupport.length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-0.5">
                              {actSupport.map((se: any) => (
                                <span key={se.id} className="text-[7px] px-1 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200 truncate max-w-[80px]">{se.name}</span>
                              ))}
                            </div>
                          )}
                          {/* Freelancers */}
                          {actFreelancers.length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-0.5">
                              {actFreelancers.map((fl: any, i: number) => (
                                <span key={i} className="text-[7px] px-1 py-0.5 bg-amber-50 text-amber-700 rounded border border-amber-200">{fl.name} FL</span>
                              ))}
                            </div>
                          )}
                          {/* Odoo Link */}
                          {(act as any).odooLink && (
                            <a href={(act as any).odooLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[7px] text-purple-600 hover:underline mt-0.5 block truncate">Odoo ↗</a>
                          )}
                        </div>
                      )})}
                   </div>
                 );
               })}
             </div>
           ))}

           {/* Freelancer / Unassigned Row */}
           {hasUnassignedActs && (
             <div className="grid grid-cols-8 border-b border-slate-100 min-h-[100px] bg-amber-50/20">
               <div className="p-4 border-r border-slate-200 bg-amber-50/30 flex flex-col justify-center">
                 <h4 className="font-bold text-amber-800 text-sm">Freelancer Jobs</h4>
                 <div className="text-[10px] text-amber-600 mt-1">No internal engineer</div>
               </div>
               {days.map(d => {
                 const dayActs = activities.filter(a => {
                    if (!a.plannedDate) return false;
                    if (new Date(a.plannedDate).toDateString() !== d.toDateString()) return false;
                    return !a.leadTechId && ((a as any).freelancers || []).length > 0;
                 });
                 return (
                   <div key={d.toString()} className="p-2 border-r border-slate-100 last:border-0 relative hover:bg-amber-50/30 transition-colors">
                      {dayActs.map(act => {
                        const actFreelancers = (act as any).freelancers || [];
                        return (
                          <div 
                            key={act.id} 
                            onClick={() => setViewingActivity(act)}
                            className="mb-2 p-2 rounded border text-xs shadow-sm cursor-pointer hover:shadow-md transition-all bg-amber-50 border-amber-200 border-l-4 border-l-amber-400"
                          >
                            <div className="font-bold truncate text-amber-800">{act.type}</div>
                            <div className="text-[10px] text-amber-600 truncate mt-0.5">{getDisplayLocation(act)}</div>
                            <div className="text-[9px] text-amber-500 mt-0.5">{new Date(act.plannedDate).toLocaleTimeString('en-GB',{timeZone:'Asia/Qatar',hour:'2-digit',minute:'2-digit'})}</div>
                            <div className="flex flex-wrap gap-0.5 mt-1">
                              {actFreelancers.map((fl: any, i: number) => (
                                <span key={i} className="text-[8px] px-1 py-0.5 bg-amber-100 text-amber-700 rounded border border-amber-300 font-bold">{fl.name.split(' ')[0]} FL</span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                   </div>
                 );
               })}
             </div>
           )}
        </div>
      </div>
    );
  };

  return (
    <div className={isMobile ? "p-4 h-full flex flex-col bg-slate-50" : "p-6 h-full flex flex-col"}>
      {/* Header Toolbar - Hidden on Mobile to save space if needed, or simplified */}
      {!isMobile && (
          <div className="flex justify-between items-center mb-6 shrink-0">
            <div>
               <h1 className="text-2xl font-bold text-slate-900">Activity Planner</h1>
               <p className="text-slate-500 text-sm">Schedule and manage field operations</p>
            </div>
            
            <div className="flex items-center gap-3">
               <div className="bg-white border border-slate-200 rounded-lg p-1 flex">
                  <button onClick={() => setViewMode('list')} className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-slate-100 text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                    <List size={20} />
                  </button>
                  <button onClick={() => setViewMode('kanban')} className={`p-2 rounded-md transition-colors ${viewMode === 'kanban' ? 'bg-slate-100 text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                    <Layout size={20} />
                  </button>
                  <button onClick={() => setViewMode('calendar')} className={`p-2 rounded-md transition-colors ${viewMode === 'calendar' ? 'bg-slate-100 text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                    <Calendar size={20} />
                  </button>
               </div>
               
               <button 
                 onClick={() => { setEditingActivity(null); setIsModalOpen(true); }}
                 className="bg-slate-900 text-white px-4 py-2.5 rounded-lg font-medium flex items-center gap-2 hover:bg-slate-800 shadow-lg shadow-slate-900/10 transition-all"
               >
                 <Plus size={18} />
                 <span>Plan Activity</span>
               </button>
            </div>
          </div>
      )}

      {isMobile && (
          <div className="flex justify-between items-center mb-4 shrink-0">
              <h2 className="font-bold text-slate-800 text-lg">My Planner</h2>
              <button 
                 onClick={() => { setEditingActivity(null); setIsModalOpen(true); }}
                 className="bg-slate-900 text-white p-2 rounded-lg shadow-sm"
               >
                 <Plus size={20} />
               </button>
          </div>
      )}

      {/* Main View Area */}
      <div className="flex-1 overflow-hidden">
         {isMobile ? (
             <MobileTabView />
         ) : (
             <>
                 {viewMode === 'list' && <ListView />}
                 {viewMode === 'kanban' && <KanbanView />}
                 {viewMode === 'calendar' && <CalendarView />}
             </>
         )}
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className={`bg-white rounded-2xl shadow-2xl w-full ${isMobile ? 'h-full rounded-none' : 'max-w-2xl max-h-[90vh] rounded-2xl'} overflow-hidden flex flex-col`}>
               <div className="px-4 py-4 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
                  <h3 className="font-bold text-lg text-slate-900">
                      {editingActivity ? `Edit Activity` : 'Plan New Activity'}
                  </h3>
                  <button onClick={() => setIsModalOpen(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
               </div>
               
               <form onSubmit={(e) => {
                  e.preventDefault();
                  if (!selectedCustomerId) {
                      alert('Please select a customer.');
                      return;
                  }

                  const formData = new FormData(e.currentTarget);
                  const data = Object.fromEntries(formData.entries()) as any;
                  
                  // Construct ISO Date from datetime-local input
                  const plannedDateIso = plannedDatetime
                      ? new Date(plannedDatetime).toISOString()
                      : new Date().toISOString();

                  const activityPayload: any = {
                      type: data.type,
                      serviceCategory: serviceCats.join(', ') || 'Other',
                      customerId: selectedCustomerId,
                      priority: data.priority,
                      status: data.status || 'PLANNED',
                      plannedDate: plannedDateIso,
                      durationHours: Number(durationState.val),
                      durationUnit: durationState.unit,
                      description: data.description,
                      remarks: data.remarks || '',
                      
                      odooLink: data.odooLink,
                      locationUrl: data.locationUrl,
                      houseNumber: data.houseNumber,
                      
                      salesLeadId: data.salesLeadId || undefined,
                      leadTechId: data.leadTechId || undefined,
                      assistantTechIds: formData.getAll('assistantTechIds') as string[],
                      supportingEngineerIds: formData.getAll('supportingEngineerIds') as string[],
                      freelancers: freelancers.filter(f => f.name.trim())
                  };

                  if (editingActivity) {
                      onUpdateActivity({
                          ...editingActivity,
                          ...activityPayload,
                          updatedAt: new Date().toISOString()
                      });
                  } else {
                      onAddActivity(activityPayload);
                  }
                  setIsModalOpen(false);
               }} className="flex-1 overflow-y-auto p-6 space-y-4">
                  
                  {/* Customer Selector */}
                  <div className="space-y-1">
                      <CustomerSelector 
                        customers={customers}
                        selectedCustomerId={selectedCustomerId}
                        onSelect={(c) => {
                            setSelectedCustomerId(c.id);
                            // Auto-fill location from customer record if not already set
                            // Always fill location from customer when selecting
                            if (c.address) setLocationUrl(c.address);
                            if (c.buildingNumber) setHouseNumber(c.buildingNumber);
                        }}
                        onCreateNew={handleNewCustomer}
                      />
                  </div>

                  {/* Top Row: Type & Priority */}
                  <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-500 uppercase">Activity Type</label>
                          <select name="type" defaultValue={editingActivity?.type || 'Installation'} className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm">
                             {['Installation', 'Service', 'Maintenance', 'Inspection', 'Survey'].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                      </div>
                      <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-500 uppercase">Priority</label>
                          <select name="priority" defaultValue={editingActivity?.priority || 'MEDIUM'} className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm">
                             {Object.values(Priority).map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                      </div>
                  </div>

                  {/* Service Category (multi-select) */}
                  <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Service Category <span className="text-red-500">*</span></label>
                      <div className="flex flex-wrap gap-2 p-2.5 bg-white border border-slate-300 rounded-lg min-h-[40px]">
                        {['Wi-Fi & Networking', 'CCTV', 'Home Automation', 'Intercom', 'Smart Speaker', 'Other'].map(cat => {
                          const sel = serviceCats.includes(cat);
                          return (
                            <button key={cat} type="button" onClick={() => setServiceCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])}
                              className={`text-xs px-3 py-1.5 rounded-lg border-2 transition-all ${sel ? 'bg-amber-50 border-amber-400 text-amber-800 font-bold shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                              {sel && <span className="mr-1">✓</span>}{cat}
                            </button>
                          );
                        })}
                      </div>
                  </div>
                  
                  {/* Location Details */}
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                          <MapPin size={16} /> Location Details
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                              <label className="text-xs font-semibold text-slate-500 uppercase">Location URL</label>
                              <input type="text" name="locationUrl" value={locationUrl} onChange={e => setLocationUrl(e.target.value)} placeholder="https://maps.google..." className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm" />
                          </div>
                          <div className="space-y-1">
                              <label className="text-xs font-semibold text-slate-500 uppercase">House Number</label>
                              <input type="text" name="houseNumber" value={houseNumber} onChange={e => setHouseNumber(e.target.value)} placeholder="Villa / Apt No." className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm" />
                          </div>
                      </div>
                  </div>
                  
                  {/* Date & Time Selection (Grouped) */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                          <Calendar size={16} /> Planned Date & Time
                      </h4>
                      
                      {/* Date & Time — single datetime-local picker */}
                      <div>
                          <input
                              type="datetime-local"
                              value={plannedDatetime}
                              onChange={e => setPlannedDatetime(e.target.value)}
                              required
                              min={new Date().toISOString().slice(0,16)}
                              className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                          />
                      </div>
                  </div>

                  {/* Estimated Duration */}
                  <div className="space-y-1 pt-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Estimated Duration</label>
                      <div className="flex items-stretch shadow-sm rounded-lg overflow-hidden border border-slate-300">
                          <input 
                              type="number" 
                              value={durationState.val}
                              onChange={e => setDurationState({...durationState, val: e.target.value})}
                              min="0.5" 
                              step="0.5" 
                              required
                              className="w-1/3 bg-white p-2.5 text-sm outline-none text-center font-medium focus:bg-slate-50" 
                           />
                           <div className="w-px bg-slate-200"></div>
                           <select 
                              value={durationState.unit}
                              onChange={e => setDurationState({...durationState, unit: e.target.value as 'HOURS' | 'DAYS'})}
                              className="flex-1 bg-slate-50 p-2.5 text-sm font-medium outline-none cursor-pointer hover:bg-slate-100"
                           >
                               <option value="HOURS">Hours</option>
                               <option value="DAYS">Days</option>
                           </select>
                      </div>
                  </div>

                  {/* Odoo Reference */}
                  <div className="space-y-1">
                       <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                           <LinkIcon size={12} /> Odoo Reference (CRM Link)
                       </label>
                       <input 
                        type="text" 
                        name="odooLink" 
                        defaultValue={editingActivity?.odooLink} 
                        placeholder="https://odoo.crm..." 
                        className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" 
                       />
                  </div>
                  
                  {/* Resource Allocation Section */}
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <h4 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                          <User size={16}/> Resource Allocation
                      </h4>
                      <div className="space-y-5">
                          {/* ── Sales Lead ── */}
                          <div className="space-y-1">
                              <div className="flex items-center gap-2 mb-1">
                                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"/>
                                  <label className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Sales Lead</label>
                              </div>
                              <select name="salesLeadId" defaultValue={editingActivity?.salesLeadId || ''} disabled={salesTeam.length === 0} className={`w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm ${salesTeam.length === 0 ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}>
                                  <option value="" disabled hidden>{salesTeam.length === 0 ? 'No Sales Lead available' : 'Select Sales Lead'}</option>
                                  {salesTeam.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                              {salesTeam.length === 0 && (
                                <div className="mt-1 text-xs text-slate-400">No Sales Lead available. Add a Sales member in Team Management.</div>
                              )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-200">
                                {/* ── Field Engineer ── */}
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500"/>
                                        <label className="text-xs font-bold text-purple-700 uppercase tracking-wider">Field Engineer</label>
                                    </div>
                                    <select
                                      name="leadTechId"
                                      value={selectedLeadTechId}
                                      onChange={e => setSelectedLeadTechId(e.target.value)}
                                      disabled={(teamLeads.length + fieldEngineers.length) === 0 && !canSelfAssign}
                                      className={`w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm ${
                                        (teamLeads.length + fieldEngineers.length) === 0 && !canSelfAssign
                                          ? "bg-slate-50 text-slate-400 cursor-not-allowed"
                                          : ""
                                      }`}
                                    >
                                      {/* Placeholder: show when empty, NOT selectable, NOT listed */}
                                      <option value="" disabled hidden>
                                        Unassigned
                                      </option>

                                      {/* Team Leads */}
                                      {(canSelfAssign || teamLeads.length > 0) && (
                                        <optgroup label="Team Leads">
                                          {canSelfAssign && currentUser && (
                                            <option value={currentUser.id} className="font-bold text-blue-700 bg-blue-50">
                                              (Self) {currentUser.name}
                                            </option>
                                          )}

                                          {teamLeads
                                            .filter(t => !(canSelfAssign && currentUser && t.id === currentUser.id))
                                            .map(t => (
                                              <option key={t.id} value={t.id}>
                                                {t.name}
                                              </option>
                                            ))}
                                        </optgroup>
                                      )}

                                      {/* Field Engineers */}
                                      {fieldEngineers.length > 0 && (
                                        <optgroup label="Field Engineers">
                                          {fieldEngineers.map(t => (
                                            <option key={t.id} value={t.id}>
                                              {t.name}
                                            </option>
                                          ))}
                                        </optgroup>
                                      )}
                                    </select>
                                    {((teamLeads.length + fieldEngineers.length) === 0 && !canSelfAssign) && (
                                      <div className="mt-1 text-xs text-slate-400">No Team Leads / Field Engineers available.</div>
                                    )}

                                </div>
                                {/* ── Supporting Field Engineers (Optional) ── */}
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500"/>
                                        <label className="text-xs font-bold text-blue-700 uppercase tracking-wider">Supporting Engineers (Optional)</label>
                                    </div>
                                    <div className="bg-white border border-slate-300 rounded-lg p-2.5 max-h-32 overflow-y-auto space-y-2">
                                        {[...fieldEngineers, ...teamLeads].filter(t => t.id !== selectedLeadTechId).length > 0 ?
                                          [...fieldEngineers, ...teamLeads].filter(t => t.id !== selectedLeadTechId).map(t => (
                                            <div key={t.id} className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    name="supportingEngineerIds"
                                                    value={t.id}
                                                    defaultChecked={(editingActivity as any)?.supportingEngineerIds?.includes(t.id)}
                                                    id={`support_fe_${t.id}`}
                                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                <label htmlFor={`support_fe_${t.id}`} className="text-sm text-slate-700 cursor-pointer select-none">
                                                    {t.name} <span className="text-[10px] text-slate-400">{t.systemRole === 'TEAM_LEAD' ? 'TL' : 'FE'}</span>
                                                </label>
                                            </div>
                                        )) : <div className="text-xs text-slate-400 italic">No other engineers available.</div>}
                                    </div>
                                </div>
                                {/* ── Technical Associates ── */}
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-teal-500"/>
                                        <label className="text-xs font-bold text-teal-700 uppercase tracking-wider">Technical Associates</label>
                                    </div>
                                    <div className="bg-white border border-slate-300 rounded-lg p-2.5 max-h-32 overflow-y-auto space-y-2">
                                        {availableAssociates.length > 0 ? availableAssociates.map(t => (
                                            <div key={t.id} className="flex items-center gap-2">
                                                <input 
                                                    type="checkbox" 
                                                    name="assistantTechIds" 
                                                    value={t.id} 
                                                    defaultChecked={editingActivity?.assistantTechIds?.includes(t.id)}
                                                    id={`helper_${t.id}`}
                                                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <label htmlFor={`helper_${t.id}`} className="text-sm text-slate-700 cursor-pointer select-none">
                                                    {t.name}
                                                </label>
                                            </div>
                                        )) : (
                                            <div className="text-xs text-slate-400 italic">No available associates for this date.</div>
                                        )}
                                    </div>
                                </div>

                                {/* Freelancers (Optional) — activity-level, no user record */}
                                <div className="space-y-2 pt-2 border-t border-slate-100 mt-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-semibold text-slate-500 uppercase">Freelancers (Optional)</label>
                                        <button
                                            type="button"
                                            onClick={() => setFreelancers(prev => [...prev, { name: '', role: 'TECHNICAL_ASSOCIATE', phone: '' }])}
                                            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                                        >
                                            + Add Freelancer
                                        </button>
                                    </div>
                                    {freelancers.length === 0 && (
                                        <p className="text-[10px] text-slate-400 italic">No freelancers added. Click "+ Add Freelancer" to attach temporary resources.</p>
                                    )}
                                    {freelancers.map((fl, idx) => (
                                        <div key={idx} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2 relative">
                                            <button
                                                type="button"
                                                onClick={() => setFreelancers(prev => prev.filter((_, i) => i !== idx))}
                                                className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition-colors"
                                                title="Remove"
                                            >
                                                ✕
                                            </button>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-[10px] text-slate-400 uppercase font-bold">Name *</label>
                                                    <input
                                                        type="text"
                                                        value={fl.name}
                                                        onChange={(e) => {
                                                            const updated = [...freelancers];
                                                            updated[idx] = { ...updated[idx], name: e.target.value };
                                                            setFreelancers(updated);
                                                        }}
                                                        placeholder="e.g. Ahmed (Freelancer)"
                                                        className="w-full bg-white border border-slate-300 rounded-lg p-2 text-sm"
                                                        required
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-slate-400 uppercase font-bold">Role</label>
                                                    <select
                                                        value={fl.role}
                                                        onChange={(e) => {
                                                            const updated = [...freelancers];
                                                            updated[idx] = { ...updated[idx], role: e.target.value };
                                                            setFreelancers(updated);
                                                        }}
                                                        className="w-full bg-white border border-slate-300 rounded-lg p-2 text-sm"
                                                    >
                                                        <option value="TECHNICAL_ASSOCIATE">Technical Associate</option>
                                                        <option value="FIELD_ENGINEER">Field Engineer</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-400 uppercase font-bold">Phone (Optional)</label>
                                                <input
                                                    type="tel"
                                                    value={fl.phone}
                                                    onChange={(e) => {
                                                        const updated = [...freelancers];
                                                        updated[idx] = { ...updated[idx], phone: e.target.value };
                                                        setFreelancers(updated);
                                                    }}
                                                    placeholder="+974 XXXX XXXX"
                                                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-sm"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                          </div>
                      </div>
                  </div>

                  {editingActivity && (
                        <div className="space-y-1">
                           <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
                           <select name="status" defaultValue={editingActivity?.status} className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm">
                              {(['PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as ActivityStatus[])
                                .map(s => <option key={s} value={s}>{getActivityStatusLabel(s)}</option>)
                              }
                           </select>
                        </div>
                  )}

                  <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Description / Scope of Work</label>
                      <textarea name="description" rows={3} defaultValue={editingActivity?.description} className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="What work needs to be done..."></textarea>
                  </div>

                  {/* General Remarks (separate from carry forward reason) */}
                  <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500 uppercase">General Remarks</label>
                      <textarea name="remarks" rows={2} defaultValue={(editingActivity as any)?.remarks} className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Any additional notes or observations..."></textarea>
                  </div>

                  {editingActivity && (
                     <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                        <button type="button" onClick={() => { if(confirm('Delete this activity?')) { onDeleteActivity(editingActivity.id); setIsModalOpen(false); } }} className="text-red-500 text-sm hover:text-red-700 flex items-center gap-1">
                            <X size={16} /> Delete Activity
                        </button>
                     </div>
                  )}

                  <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 mt-2">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                        <button type="submit" className="px-6 py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 shadow-lg shadow-slate-900/20 transition-all flex items-center gap-2">
                            <Save size={18} /> {editingActivity ? 'Update Activity' : 'Plan Activity'}
                        </button>
                  </div>
               </form>
            </div>
         </div>
      )}

      {/* View Activity Detail Panel (read-only) */}
      {viewingActivity && (() => {
        const va = viewingActivity as any;
        const customer = customers.find(c => c.id === va.customerId);
        const lead = technicians.find(t => t.id === va.leadTechId);
        const salesLd = technicians.find(t => t.id === va.salesLeadId);
        const assistants = (va.assistantTechIds || []).map((id: string) => technicians.find(t => t.id === id)).filter(Boolean);
        const fls = va.freelancers || [];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setViewingActivity(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-4 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div>
                  <div className="text-xs font-mono text-slate-400">{va.reference}</div>
                  <h3 className="font-bold text-lg text-slate-900">{va.type}</h3>
                  {va.serviceCategory && <div className="text-xs text-slate-500">{va.serviceCategory}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    va.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' :
                    va.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                    va.status === 'CANCELLED' ? 'bg-slate-100 text-slate-500' :
                    'bg-amber-100 text-amber-700'
                  }`}>{va.status}</span>
                  <button onClick={() => setViewingActivity(null)} className="p-1 hover:bg-slate-200 rounded-lg">
                    <X size={18} className="text-slate-400"/>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* Customer & Location */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Customer</span>
                    <span className="font-semibold text-slate-800">{customer?.name || 'Unknown'}</span>
                  </div>
                  {customer?.phone && <div className="flex justify-between text-sm"><span className="text-slate-400">Phone</span><span className="text-slate-700">{customer.phone}</span></div>}
                  {va.houseNumber && <div className="flex justify-between text-sm"><span className="text-slate-400">House / Villa</span><span className="text-slate-700">{va.houseNumber}</span></div>}
                  {customer?.buildingNumber && <div className="flex justify-between text-sm"><span className="text-slate-400">Building</span><span className="text-slate-700">{customer.buildingNumber}</span></div>}
                  {va.locationUrl && <div className="flex justify-between text-sm"><span className="text-slate-400">Map</span><a href={va.locationUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs truncate max-w-[60%]">Open Map</a></div>}
                </div>
                {/* Timing */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-slate-400">Planned</span><span className="font-semibold text-slate-700">{new Date(va.plannedDate).toLocaleString('en-GB', { timeZone: 'Asia/Qatar', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-400">Duration</span><span className="text-slate-700">{va.durationHours}h</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-400">Priority</span><span className={`font-bold ${va.priority === 'URGENT' ? 'text-red-600' : va.priority === 'HIGH' ? 'text-orange-500' : 'text-slate-600'}`}>{va.priority}</span></div>
                  {va.startedAt && <div className="flex justify-between text-sm"><span className="text-slate-400">Started</span><span className="text-emerald-600 font-medium">{new Date(va.startedAt).toLocaleString('en-GB', { timeZone: 'Asia/Qatar', hour:'2-digit', minute:'2-digit' })}</span></div>}
                  {va.completedAt && <div className="flex justify-between text-sm"><span className="text-slate-400">Completed</span><span className="text-emerald-600 font-medium">{new Date(va.completedAt).toLocaleString('en-GB', { timeZone: 'Asia/Qatar', hour:'2-digit', minute:'2-digit' })}</span></div>}
                  {va.startedAt && va.completedAt && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Actual Duration</span>
                      <span className="font-bold text-slate-700">{Math.round((new Date(va.completedAt).getTime() - new Date(va.startedAt).getTime()) / 60000)}m</span>
                    </div>
                  )}
                </div>
                {/* Description */}
                {va.description && <div className="bg-slate-50 rounded-xl p-4 border border-slate-100"><div className="text-xs font-bold text-slate-400 uppercase mb-1">Description</div><p className="text-sm text-slate-700 leading-relaxed">{va.description}</p></div>}
                {/* Resources — split into sections */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                  {/* Sales Lead — separate section */}
                  {salesLd && (
                    <div className="pb-2 border-b border-slate-200">
                      <div className="text-[10px] font-bold text-indigo-600 uppercase mb-1.5">Sales Lead</div>
                      <div className="flex items-center gap-2 text-sm"><span className="w-2 h-2 rounded-full bg-indigo-500"/><span className="font-medium text-indigo-700">{salesLd.name}</span></div>
                    </div>
                  )}
                  {/* Assigned Team */}
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Assigned Team</div>
                    {lead && <div className="flex items-center gap-2 text-sm mb-1"><span className="w-2 h-2 rounded-full bg-purple-500"/><span className="font-medium text-slate-800">{lead.name}</span><span className="text-[10px] text-slate-400">Lead Engineer</span></div>}
                    {va.primaryEngineerId && va.primaryEngineerId !== va.leadTechId && (() => {
                      const prim = technicians.find(t => t.id === va.primaryEngineerId);
                      return prim ? <div className="flex items-center gap-2 text-sm mb-1"><span className="w-2 h-2 rounded-full bg-blue-500"/><span className="font-medium text-blue-700">{prim.name}</span><span className="text-[10px] text-slate-400">Primary (Execution)</span></div> : null;
                    })()}
                    {assistants.map((a: any) => <div key={a.id} className="flex items-center gap-2 text-sm mb-1"><span className="w-2 h-2 rounded-full bg-teal-500"/><span className="text-slate-700">{a.name}</span><span className="text-[10px] text-slate-400">Technical Associate</span></div>)}
                    {(va.supportingEngineerIds || []).filter((sid: string) => !(va.assistantTechIds || []).includes(sid) && sid !== va.primaryEngineerId).map((sid: string) => {
                      const se = technicians.find(t => t.id === sid);
                      return se ? <div key={sid} className="flex items-center gap-2 text-sm mb-1"><span className="w-2 h-2 rounded-full bg-blue-400"/><span className="text-slate-700">{se.name}</span><span className="text-[10px] text-slate-400">Supporting Engineer</span></div> : null;
                    })}
                    {fls.map((fl: any, i: number) => <div key={`fl-${i}`} className="flex items-center gap-2 text-sm mb-1"><span className="w-2 h-2 rounded-full bg-amber-500"/><span className="text-amber-800 font-medium">{fl.name}</span><span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 rounded border border-amber-200">Freelancer · {fl.role === 'FIELD_ENGINEER' ? 'FE' : 'TA'}</span>{fl.phone && <span className="text-[10px] text-slate-400 ml-auto">{fl.phone}</span>}</div>)}
                    {!lead && assistants.length === 0 && fls.length === 0 && <p className="text-xs text-slate-400 italic">No team assigned</p>}
                  </div>
                </div>
                {/* Photos */}
                {(va.photos || []).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-slate-400 uppercase">Completion Photos ({va.photos.length})</div>
                    <div className="grid grid-cols-4 gap-2">
                      {va.photos.map((p: any, i: number) => (
                        <img key={i} src={p.url || p} alt="" className="w-full h-20 object-cover rounded-lg border border-slate-200 cursor-pointer hover:shadow-md" onClick={() => showPhotoLightbox(p.url || p)} />
                      ))}
                    </div>
                  </div>
                )}
                {/* Remarks & Completion — only show when no visit history */}
                {!(va.visitHistory || []).length && (va.remarks || va.completionNote || va.carryForwardNote || va.cancellationReason) && (
                  <div className="space-y-3">
                    <div className="text-xs font-bold text-slate-400 uppercase">Notes & Remarks</div>
                    {va.remarks && va.remarks !== va.completionNote && (
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Remarks</div>
                        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{va.remarks}</p>
                      </div>
                    )}
                    {va.completionNote && (
                      <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                        <div className="text-[10px] font-bold text-emerald-500 uppercase mb-1">Completion Summary</div>
                        <p className="text-sm text-emerald-800 leading-relaxed whitespace-pre-wrap">{va.completionNote}</p>
                      </div>
                    )}
                    {va.carryForwardNote && (
                      <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                        <div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Carry Forward</div>
                        <p className="text-sm text-amber-800 leading-relaxed whitespace-pre-wrap">{va.carryForwardNote}</p>
                        {va.nextPlannedAt && (
                          <div className="text-xs text-amber-600 mt-2 font-medium">
                            Next planned: {new Date(va.nextPlannedAt).toLocaleDateString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short'})} at {new Date(va.nextPlannedAt).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}
                          </div>
                        )}
                      </div>
                    )}
                    {va.cancellationReason && (
                      <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                        <div className="text-[10px] font-bold text-red-500 uppercase mb-1">Cancellation Reason</div>
                        <p className="text-sm text-red-700 leading-relaxed whitespace-pre-wrap">{va.cancellationReason}</p>
                      </div>
                    )}
                  </div>
                )}
                {/* Visit History Cards */}
                {(va.visitHistory || []).length > 0 && (
                  <div className="space-y-3">
                    <div className="text-xs font-bold text-slate-400 uppercase">Visit History ({va.visitHistory.length} visit{va.visitHistory.length > 1 ? 's' : ''})</div>
                    <div className="relative border-l-2 border-slate-200 ml-2 space-y-3">
                      {va.visitHistory.map((v: any, i: number) => {
                        const isCF = v.status === 'CARRY_FORWARD'; const isDone = v.status === 'DONE';
                        const cardBg = isDone ? 'bg-emerald-50 border-emerald-200' : isCF ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200';
                        const hdrColor = isDone ? 'text-emerald-800' : isCF ? 'text-orange-800' : 'text-blue-800';
                        const badgeStyle = isDone ? 'bg-emerald-100 text-emerald-700' : isCF ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700';
                        const dotColor = isDone ? 'bg-emerald-500' : isCF ? 'bg-orange-500' : 'bg-blue-500';
                        const dur = v.startedAt && v.completedAt ? Math.round((new Date(v.completedAt).getTime() - new Date(v.startedAt).getTime()) / 60000) : null;
                        const fT = (iso: string) => iso ? new Date(iso).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'}) : '—';
                        const fD = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short', year:'numeric'}) : '—';
                        return (
                          <div key={i} className="relative pl-5">
                            <div className={`absolute -left-[7px] top-2 w-3 h-3 rounded-full border-2 border-white shadow-sm ${dotColor}`} />
                            <div className={`rounded-xl p-3 border ${cardBg}`}>
                              <div className="flex justify-between items-center mb-1.5"><span className={`font-bold text-xs ${hdrColor}`}>Visit {i + 1} — {fD(v.date)}</span><span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${badgeStyle}`}>{(v.status || '').replace(/_/g, ' ')}</span></div>
                              <div className="text-[10px] text-slate-500">{fT(v.startedAt)} → {v.completedAt ? fT(v.completedAt) : 'ongoing'}{dur !== null ? ` (${dur >= 60 ? Math.floor(dur/60)+'h '+dur%60+'m' : dur+'m'})` : ''}</div>
                              {v.remarks && <div className="bg-white/60 rounded-lg p-2 mt-2 border border-white/80"><div className="text-[8px] font-bold text-slate-400 uppercase mb-0.5">Remark</div><p className="text-[11px] text-slate-700 whitespace-pre-wrap">{v.remarks}</p></div>}
                              {v.completionNote && <div className="bg-emerald-50/50 rounded-lg p-2 mt-1.5 border border-emerald-100"><div className="text-[8px] font-bold text-emerald-600 uppercase mb-0.5">Completion</div><p className="text-[11px] text-emerald-800 whitespace-pre-wrap">{v.completionNote}</p></div>}
                              {v.carryForwardReason && isCF && <div className="bg-orange-50/50 rounded-lg p-2 mt-1.5 border border-orange-200"><div className="text-[8px] font-bold text-orange-600 uppercase mb-0.5">CF reason</div><p className="text-[11px] text-orange-800 whitespace-pre-wrap">{v.carryForwardReason}</p></div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {va.odooLink && <div className="flex items-center gap-2 text-sm"><span className="text-slate-400">Odoo:</span><a href={va.odooLink} target="_blank" rel="noreferrer" className="text-purple-600 hover:underline">{va.odooLink}</a></div>}
              </div>
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-3">
                <button onClick={() => setViewingActivity(null)} className="flex-1 py-2.5 text-slate-500 font-bold hover:bg-slate-200 rounded-xl">Close</button>
                <button onClick={() => { setEditingActivity(viewingActivity); setViewingActivity(null); setIsModalOpen(true); }} className="flex-1 py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800">Edit Activity</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default PlanningModule;

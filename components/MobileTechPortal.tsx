
import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, TicketStatus, Technician, Activity } from '../types';
import { ChevronLeft, MapPin, Navigation, CheckCircle2, Camera, LogOut, Clock, AlertTriangle, Play, Check, Smartphone, X, Calendar, KeyRound } from 'lucide-react';
import { INPUT_STYLES } from '../constants';
import { MyJobTaskView } from './MyJobTaskView';

interface MobileTechPortalProps {
  tickets: Ticket[];
  activities?: Activity[]; // Now accepts activities
  customers?: any[]; // For activity customer name lookup
  currentTechId: string;
  onUpdateStatus: (ticketId: string, status: TicketStatus) => void;
  onUpdateActivity?: (activity: Activity) => void;
  isStandalone?: boolean;
  onLogout?: () => void;
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
  // Handler for custom actions
  onUpdateTicket?: (ticket: Ticket) => void; 
}

const MobileTechPortal: React.FC<MobileTechPortalProps> = ({ 
    tickets, 
    activities = [], 
    customers = [],
    currentTechId, 
    onUpdateStatus, 
    onUpdateActivity,
    isStandalone = false, 
    onLogout, onChangePassword,
    onUpdateTicket // Optional if needed, but we can reuse onUpdateStatus for basic status changes
}) => {
  // --- Responsive Check ---
  // When embedded via fullscreen bypass (isStandalone=true), always render mobile
  // When accessed standalone, check actual screen width
  const [isMobile, setIsMobile] = useState(isStandalone || window.innerWidth < 768);

  useEffect(() => {
    if (!isStandalone) {
      const handleResize = () => setIsMobile(window.innerWidth < 768);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, [isStandalone]);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [completionStep, setCompletionStep] = useState(false);
  const [completionNotes, setCompletionNotes] = useState('');
  const [reportingDelayActivity, setReportingDelayActivity] = useState<Activity | null>(null);

  // Carry Forward State
  const [isCarryForwardOpen, setIsCarryForwardOpen] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [cpForm, setCpForm] = useState({ current: '', next: '', confirm: '' });
  const [cpError, setCpError] = useState('');
  const [cpSuccess, setCpSuccess] = useState(false);
  const [carryForwardRemark, setCarryForwardRemark] = useState('');
  const [carryForwardDatetime, setCarryForwardDatetime] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [photoJobId, setPhotoJobId] = useState<string | null>(null);
  const [photoJobType, setPhotoJobType] = useState<'ticket' | 'activity'>('activity');
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = React.useRef<HTMLInputElement>(null);

  // Combine Tickets and Activities into a single "Job" concept for display
  // Prioritize Delayed Jobs
  // Tickets: Show ONLY tickets assigned to currentTechId
  // Exclude: RESOLVED, CANCELLED
  const completedJobs = [
      ...tickets
        .filter(t => t.assignedTechId === currentTechId &&
            (t.status === TicketStatus.RESOLVED || t.status === TicketStatus.CANCELLED))
        .map(t => ({ kind: 'ticket' as const, data: t, sortDate: t.updatedAt || (t as any).updated_at || t.createdAt })),
      ...activities
        .filter(a => (a.leadTechId === currentTechId || (a.assistantTechIds || []).includes(currentTechId)) && (a.status === 'DONE' || a.status === 'CANCELLED'))
        .map(a => ({ kind: 'activity' as const, data: a, sortDate: a.updatedAt || a.createdAt })),
  ].sort((a, b) => new Date(b.sortDate || 0).getTime() - new Date(a.sortDate || 0).getTime())
   .slice(0, 50);

  const myJobs = [
      ...tickets
        .filter(t => t.assignedTechId === currentTechId && t.status !== TicketStatus.CANCELLED && t.status !== TicketStatus.RESOLVED)
        .map(t => ({
          type: 'ticket' as const, 
          data: t, 
          date: t.appointmentTime || t.createdAt, 
          priority: t.priority, 
          delayed: false
      })),
      ...activities
        .filter(a => (a.leadTechId === currentTechId || (a.assistantTechIds || []).includes(currentTechId)) && a.status !== 'DONE' && a.status !== 'CANCELLED')
        .map(a => ({
          type: 'activity' as const, 
          data: a, 
          date: a.plannedDate, 
          priority: a.priority, 
          delayed: (a.escalationLevel || 0) > 0
      }))
  ].sort((a, b) => {
      // Sort by Delayed first, then Date
      if (a.delayed && !b.delayed) return -1;
      if (!a.delayed && b.delayed) return 1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  const activeJobItem = myJobs.find(j => j.data.id === selectedJobId);
  const activeJob = activeJobItem?.data;

  // ── Photo upload handler ──
  const handlePhotoClick = (jobId: string, jobType: 'ticket' | 'activity') => {
      setPhotoJobId(jobId);
      setPhotoJobType(jobType);
      photoInputRef.current?.click();
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !photoJobId) return;
      setPhotoUploading(true);
      try {
          // Convert to base64 for storage in JSONB details column
          const reader = new FileReader();
          reader.onloadend = async () => {
              const base64 = (reader.result as string);
              const photoEntry = { url: base64, takenAt: new Date().toISOString(), name: file.name };
              if (photoJobType === 'activity') {
                  const act = activities.find(a => a.id === photoJobId);
                  if (act && onUpdateActivity) {
                      const existing = (act as any).photos || [];
                      onUpdateActivity({ ...act, photos: [...existing, photoEntry] } as any);
                  }
              } else {
                  const ticket = tickets.find(t => t.id === photoJobId);
                  if (ticket) {
                      onUpdateTicket?.({ ...ticket, photos: [...((ticket as any).photos || []), photoEntry] } as any);
                  }
              }
              setPhotoUploading(false);
              setPhotoJobId(null);
              // Reset file input so same file can be picked again
              if (photoInputRef.current) photoInputRef.current.value = '';
          };
          reader.readAsDataURL(file);
      } catch (err) {
          console.error('Photo upload failed:', err);
          setPhotoUploading(false);
      }
  };

  const handleBack = () => {
      if (completionStep) setCompletionStep(false);
      else setSelectedJobId(null);
  };

  const handleStatusUpdate = (ticketId: string, status: TicketStatus, note?: string) => {
      if (onUpdateTicket) {
          const t = tickets.find(x => x.id === ticketId);
          if (t) {
              const updates: any = { ...t, status, updatedAt: new Date().toISOString() };
              if (status === TicketStatus.RESOLVED && note) {
                  updates.completionNote = note;
                  updates.completedAt = new Date().toISOString();
              }
              onUpdateTicket(updates);
          }
      } else {
          onUpdateStatus(ticketId, status);
      }
  };

  const handleComplete = () => {
      if (activeJobItem?.type === 'ticket') {
          // Keep existing behavior for tickets
          onUpdateStatus(activeJobItem.data.id, TicketStatus.RESOLVED);
      } else if (activeJobItem?.type === 'activity' && onUpdateActivity) {
          const a = activeJobItem.data as Activity;
          const note = completionNotes.trim();
          onUpdateActivity({
              ...a,
              status: 'DONE',
              remarks: note ? (a.remarks ? a.remarks + '\n' + note : note) : a.remarks,
              updatedAt: new Date().toISOString()
          });
      }
      setCompletionNotes('');
      setCompletionStep(false);
      setSelectedJobId(null);
  };

  const handleStart = () => {
      if (activeJobItem?.type === 'ticket') {
          onUpdateStatus(activeJobItem.data.id, TicketStatus.IN_PROGRESS);
          // In a fuller implementation, we would also set startedAt here via an enhanced update handler
      } else if (activeJobItem?.type === 'activity' && onUpdateActivity) {
          onUpdateActivity({ ...activeJobItem.data as Activity, status: 'IN_PROGRESS' });
      }
  };

  const handleCarryForwardClick = () => {
      const now = new Date();
      // Round to next 15 mins
      const m = now.getMinutes();
      const rem = m % 15;
      const add = 15 - rem;
      now.setMinutes(m + add);
      
      // If we pushed past 5pm, maybe default to next day 9am? (Optional DX)
      if (now.getHours() >= 17) {
          now.setDate(now.getDate() + 1);
          now.setHours(9, 0, 0, 0);
      }

      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');

      setCarryForwardDatetime(`${yyyy}-${mm}-${dd}T${hh}:${min}`);
      setCarryForwardRemark('');
      setIsCarryForwardOpen(true);
  };

  const handleConfirmCarryForward = () => {
      if (!carryForwardRemark.trim() || !carryForwardDatetime) return;

      const nextIso = new Date(carryForwardDatetime).toISOString();

      if (activeJobItem?.type === 'ticket') {
          const t = activeJobItem.data as Ticket;
          if (onUpdateTicket) {
              onUpdateTicket({
                  ...t,
                  status: TicketStatus.CARRY_FORWARD,
                  carryForwardNote: carryForwardRemark,
                  nextPlannedAt: nextIso,
                  updatedAt: new Date().toISOString()
              });
          } else {
              onUpdateStatus(t.id, TicketStatus.CARRY_FORWARD);
          }
      } else if (activeJobItem?.type === 'activity') {
          const a = activeJobItem.data as Activity;
          if (onUpdateActivity) {
              onUpdateActivity({
                  ...a,
                  status: 'PLANNED', // Re-queue
                  plannedDate: nextIso,
                  remarks: carryForwardRemark ? (a.remarks ? a.remarks + '\n' + carryForwardRemark : carryForwardRemark) : a.remarks,
                  updatedAt: new Date().toISOString()
              });
          }
      }

      setIsCarryForwardOpen(false);
      setSelectedJobId(null);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
  };

  const handleDelaySubmit = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!onUpdateActivity || !reportingDelayActivity) return;
      const formData = new FormData(e.currentTarget);
      const reason = formData.get('reason') as string;
      const custom = formData.get('customReason') as string;

      onUpdateActivity({
          ...reportingDelayActivity,
          delayReason: reason === 'Other' ? custom : reason
      });
      setReportingDelayActivity(null);
  };

  const timeOptions = useMemo(() => {
      const opts = [];
      for (let h = 0; h < 24; h++) {
          for (let m = 0; m < 60; m += 15) {
              opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
          }
      }
      return opts;
  }, []);

  if (!isMobile) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
              <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                      <Smartphone size={32} />
                  </div>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                        Oops! This View Works Best on Mobile 📱</h2>
                  <p className="text-gray-600 leading-relaxed">
                    The Tech Portal is built for field mobility.
                    <br />
                    Please access this module from a mobile device for the best experience.
                </p>
              </div>
          </div>
      );
  }

  // Simplified container for mobile use (takes full height/width)
  const containerClasses = "w-full h-full bg-slate-900 flex flex-col";

  return (
    <>
    <div className="h-full w-full bg-slate-900">
        {/* Phone Container / Full Screen Container */}
        <div className={containerClasses}>
            
            {/* Header */}
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between z-10 shrink-0">
                {selectedJobId ? (
                    <button onClick={handleBack}><ChevronLeft size={24} /></button>
                ) : (
                    <div className="flex items-center gap-3">
                        <h1 className="font-bold text-lg">My Jobs</h1>
                        {onChangePassword && <button onClick={() => { setShowChangePwd(true); setCpForm({current:'',next:'',confirm:''}); setCpError(''); setCpSuccess(false); }} className="p-2 bg-slate-700 rounded-full hover:bg-slate-600 active:scale-95 transition-all" title="Change Password"><KeyRound size={16} className="text-slate-300"/></button>}
                        {onLogout && <button onClick={onLogout} className="p-2 bg-slate-700 rounded-full hover:bg-slate-600 active:scale-95 transition-all" title="Exit Portal"><LogOut size={16} className="text-slate-300"/></button>}
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"/>
                    <span className="text-xs font-medium text-emerald-400">ONLINE</span>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 bg-slate-50 rounded-t-[2rem] overflow-hidden relative">
                
                {/* Job List */}
                {!selectedJobId && (
                    <div className="p-4 space-y-4 pt-6 h-full overflow-y-auto no-scrollbar">
                        <div className="flex items-center justify-between px-2 mb-1">
                            <p className="text-sm text-slate-500 font-medium">{showHistory ? 'COMPLETED JOBS' : "TODAY'S SCHEDULE"}</p>
                            <button
                                onClick={() => setShowHistory(s => !s)}
                                className={`text-[10px] font-bold px-2 py-1 rounded-full transition-colors ${showHistory ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-600'}`}
                            >
                                {showHistory ? '← Active' : 'History'}
                            </button>
                        </div>

                        {/* Active jobs */}
                        {!showHistory && myJobs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                                <CheckCircle2 size={48} className="mb-2"/>
                                <p>All clear for now!</p>
                            </div>
                        ) : !showHistory ? (
                            myJobs.map(item => {
                                const isActivity = item.type === 'activity';
                                const job = item.data as any; // Unified access
                                
                                if (!isActivity) {
                                    return <MyJobTaskView key={job.id} ticket={job} onUpdateStatus={handleStatusUpdate} onSelect={() => setSelectedJobId(job.id)} />;
                                }

                                const delayed = item.delayed;
                                const isStarted = job.status === 'IN_PROGRESS';

                                return (
                                    <div 
                                        key={job.id} 
                                        className={`bg-white p-4 rounded-2xl shadow-sm border active:scale-95 transition-transform relative overflow-hidden ${
                                            delayed ? 'border-red-400 ring-2 ring-red-100' : 'border-slate-100'
                                        }`}
                                        onClick={() => setSelectedJobId(job.id)}
                                    >
                                        {/* Delay Badge */}
                                        {delayed && (
                                            <div className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl shadow-sm z-10">
                                                DELAYED
                                            </div>
                                        )}
                                        
                                        {/* In Progress Badge */}
                                        {isStarted && (
                                            <div className="absolute top-0 right-0 bg-blue-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl shadow-sm z-10">
                                                STARTED
                                            </div>
                                        )}

                                        <div className="flex justify-between mb-2">
                                            <span className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-1 rounded-full">
                                                {new Date(item.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                            </span>
                                            <span className="text-xs font-bold text-slate-400 mr-12">{job.reference}</span>
                                        </div>
                                        
                                        <div>
                                            <h3 className="font-bold text-slate-800 text-lg mb-1">{job.type}</h3>
                                            <div className="flex items-center gap-1 text-slate-500 text-sm mb-3">
                                                <MapPin size={14} />
                                                <span>{job.houseNumber || 'Location URL'}</span>
                                            </div>
                                            <div className="bg-slate-50 p-2 rounded-lg text-xs text-slate-600 line-clamp-2">
                                                {job.description}
                                            </div>
                                        </div>

                                        {/* Report Delay Button (For Activities) */}
                                        {delayed && (
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); setReportingDelayActivity(job as Activity); }}
                                                className="mt-3 w-full py-2 bg-red-50 text-red-600 text-xs font-bold rounded-lg border border-red-100 flex items-center justify-center gap-1"
                                            >
                                                <AlertTriangle size={12} /> Report Reason
                                            </button>
                                        )}
                                    </div>
                                );
                            })
                        ) : null}

                        {/* History list */}
                        {showHistory && (
                            completedJobs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                                    <CheckCircle2 size={48} className="mb-2"/>
                                    <p>No completed jobs yet</p>
                                </div>
                            ) : (
                                completedJobs.map(item => {
                                    const isAct = item.kind === 'activity';
                                    const job = item.data as any;
                                    const label     = isAct ? (job.type || 'Activity') : (job.customerName || job.id);
                                    const sub       = isAct ? (job.serviceCategory || job.description?.substring(0,40) || '') : (job.category || '');
                                    const statusVal = job.status || '';
                                    const dt        = new Date(item.sortDate || job.updatedAt || job.createdAt);
                                    return (
                                        <div key={job.id}
                                            onClick={() => setSelectedJobId(job.id)}
                                            className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-3 cursor-pointer active:scale-[0.99] transition-transform"
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <div className="text-[10px] font-bold text-slate-400 mb-0.5">{job.reference || job.id}</div>
                                                    <div className="font-bold text-slate-800">{label}</div>
                                                </div>
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusVal === 'RESOLVED' || statusVal === 'DONE' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                                    {statusVal.replace('_',' ')}
                                                </span>
                                            </div>
                                            {sub && <div className="text-xs text-slate-500 mb-1">{sub}</div>}
                                            <div className="text-xs text-slate-400">{dt.toLocaleDateString()} {dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
                                        </div>
                                    );
                                })
                            )
                        )}
                    </div>
                )}

                {/* Ticket Detail — full screen when ticket tapped */}
                {activeJob && activeJobItem?.type !== 'activity' && !completionStep && (
                    <div className="flex flex-col h-full overflow-y-auto p-4 pt-6">
                        <MyJobTaskView
                            ticket={activeJob as any}
                            onUpdateStatus={handleStatusUpdate}
                        />
                    </div>
                )}

                {/* Activity Detail — rich job view matching ticket layout */}
                {activeJob && activeJobItem?.type === 'activity' && !completionStep && (() => {
                    const act = activeJob as Activity;
                    const actCustomer = (customers as any[]).find((cu: any) => cu.id === act.customerId);
                    const actStatus = act.status;
                    const actSteps = [
                        { key: 'PLANNED',     label: 'Assigned' },
                        { key: 'IN_PROGRESS', label: 'Working'  },
                        { key: 'DONE',        label: 'Done'     },
                    ];
                    const actStep    = actSteps.findIndex(s => s.key === actStatus);
                    const actProgress = actStatus === 'DONE' ? 100 : Math.max(5, ((actStep + 1) / actSteps.length) * 100);
                    return (
                    <div className="flex flex-col h-full overflow-y-auto bg-slate-50">
                        {/* Progress bar */}
                        <div className="h-1 bg-slate-200 shrink-0">
                            <div className="h-1 bg-emerald-500 transition-all duration-500" style={{ width: `${actProgress}%` }}/>
                        </div>
                        <div className="p-5 space-y-4">
                            {/* Header */}
                            <div className="flex justify-between items-start">
                                <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{act.reference || act.id}</div>
                                    <h2 className="text-xl font-bold text-slate-900">{act.type}</h2>
                                    {actCustomer && <div className="text-sm text-slate-500 mt-0.5">{actCustomer.name}</div>}
                                </div>
                                <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${
                                    actStatus === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700' :
                                    actStatus === 'DONE'        ? 'bg-emerald-100 text-emerald-700' :
                                    'bg-purple-100 text-purple-700'
                                }`}>{actStatus.replace('_',' ')}</span>
                            </div>
                            {/* Scope of work */}
                            {act.description && (
                                <div className="bg-white rounded-xl p-4 border border-slate-100">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Scope of Work</div>
                                    <p className="text-sm text-slate-700 leading-relaxed">{act.description}</p>
                                </div>
                            )}
                            {/* Job details */}
                            <div className="bg-white rounded-xl p-4 border border-slate-100 space-y-3">
                                {act.serviceCategory && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400 font-medium">Category</span>
                                        <span className="font-semibold text-slate-700">{act.serviceCategory}</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400 font-medium">Priority</span>
                                    <span className={`font-bold ${act.priority === 'URGENT' ? 'text-red-600' : act.priority === 'HIGH' ? 'text-orange-500' : 'text-slate-600'}`}>{act.priority}</span>
                                </div>
                                {act.plannedDate && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400 font-medium">Planned</span>
                                        <span className="font-semibold text-slate-700">{new Date(act.plannedDate).toLocaleDateString()} {new Date(act.plannedDate).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                                    </div>
                                )}
                                {(act.houseNumber || act.locationUrl) && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400 font-medium">Location</span>
                                        <span className="font-semibold text-slate-700 text-right max-w-[55%] truncate">{act.houseNumber || act.locationUrl}</span>
                                    </div>
                                )}
                            </div>
                            {/* Step progress indicators */}
                            {actStatus !== 'DONE' && (
                                <div className="flex items-center justify-between bg-white rounded-xl p-4 border border-slate-100">
                                    {actSteps.map((step, i) => (
                                        <React.Fragment key={step.key}>
                                            <div className="flex flex-col items-center">
                                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                                                    i < actStep   ? 'bg-emerald-500 border-emerald-500 text-white' :
                                                    i === actStep ? 'bg-slate-900 border-slate-900 text-white' :
                                                    'bg-white border-slate-200 text-slate-400'
                                                }`}>{i < actStep ? '✓' : i + 1}</div>
                                                <span className={`text-[9px] mt-1 font-medium ${i === actStep ? 'text-slate-900' : 'text-slate-400'}`}>{step.label}</span>
                                            </div>
                                            {i < actSteps.length - 1 && <div className={`flex-1 h-0.5 mx-2 mb-3 ${i < actStep ? 'bg-emerald-500' : 'bg-slate-200'}`}/>}
                                        </React.Fragment>
                                    ))}
                                </div>
                            )}
                            {/* Navigate + Photos */}
                            <div className="grid grid-cols-2 gap-3">
                                {act.locationUrl ? (
                                    <a href={act.locationUrl} target="_blank" rel="noopener noreferrer"
                                        className="flex flex-col items-center justify-center p-3 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 active:scale-95 transition-transform">
                                        <Navigation size={22} className="mb-1 text-blue-500"/>
                                        <span className="text-xs font-semibold">Navigate</span>
                                    </a>
                                ) : (
                                    <div className="flex flex-col items-center justify-center p-3 bg-slate-50 rounded-xl text-slate-400">
                                        <Navigation size={22} className="mb-1"/>
                                        <span className="text-xs font-semibold">Navigate</span>
                                    </div>
                                )}
                                <button
                                    onClick={() => handlePhotoClick(act.id, 'activity')}
                                    disabled={photoUploading}
                                    className="flex flex-col items-center justify-center p-3 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 active:scale-95 transition-transform disabled:opacity-50">
                                    <Camera size={22} className="mb-1"/>
                                    <span className="text-xs font-semibold">{photoUploading && photoJobId === act.id ? 'Saving...' : 'Photos'}</span>
                                </button>
                            </div>
                            {/* Workflow action buttons */}
                            <div className="space-y-3 pb-6">
                                {actStatus === 'PLANNED' && (
                                    <button onClick={handleStart}
                                        className="w-full py-4 rounded-2xl bg-amber-500 text-white font-bold shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2">
                                        <Play size={20} className="fill-current"/> Start Work
                                    </button>
                                )}
                                {actStatus === 'IN_PROGRESS' && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <button onClick={handleCarryForwardClick}
                                            className="w-full py-4 rounded-2xl bg-slate-200 text-slate-700 font-bold active:bg-slate-300">
                                            Carry Forward
                                        </button>
                                        <button onClick={() => setCompletionStep(true)}
                                            className="w-full py-4 rounded-2xl bg-emerald-500 text-white font-bold shadow-lg active:bg-emerald-600 flex items-center justify-center gap-2">
                                            <Check size={20}/> Complete
                                        </button>
                                    </div>
                                )}
                                {actStatus === 'DONE' && (
                                    <div className="flex items-center justify-center gap-2 py-4 bg-emerald-50 rounded-2xl text-emerald-700 font-bold">
                                        <CheckCircle2 size={20}/> Job Completed
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    );
                })()}

                {/* Completion Screen (Only for Activities) */}
                {activeJob && completionStep && (
                    <div className="p-6 pt-10 h-full bg-white flex flex-col">
                         <h2 className="text-2xl font-bold text-slate-900 mb-6">Job Completion</h2>
                         
                         <div className="space-y-4 flex-1">
                             <div>
                                 <label className="block text-sm font-medium text-slate-700 mb-1">Resolution Notes</label>
                                 <textarea className={INPUT_STYLES} placeholder="What did you fix?" rows={4} value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} />
                             </div>
                             
                             <button
                                 onClick={() => activeJob && handlePhotoClick((activeJob as any).id, activeJobItem?.type === 'activity' ? 'activity' : 'ticket')}
                                 className="flex items-center gap-3 p-4 border border-slate-200 rounded-xl bg-slate-50 w-full active:bg-slate-100 transition-colors">
                                 <div className="w-10 h-10 bg-slate-200 rounded-lg flex items-center justify-center">
                                     <Camera size={20} className="text-slate-500" />
                                 </div>
                                 <span className="text-sm font-medium text-slate-600">
                                     {photoUploading ? 'Saving photo...' : 'Add Proof of Work (tap to photo)'}
                                 </span>
                             </button>
                         </div>

                         <div className="flex gap-3">
                             <button onClick={() => setCompletionStep(false)} className="flex-1 py-4 text-slate-500 font-bold">Back</button>
                             <button 
                                onClick={handleComplete}
                                className="flex-[2] py-4 rounded-xl bg-emerald-600 text-white font-bold shadow-xl active:bg-emerald-700"
                             >
                                 Submit & Close
                             </button>
                         </div>
                    </div>
                )}

                {/* Report Delay Modal */}
                {reportingDelayActivity && (
                    <div className="absolute inset-0 z-50 bg-black/50 flex items-end">
                        <div className="bg-white w-full rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300">
                            <h3 className="text-lg font-bold text-slate-900 mb-4">Report Delay Reason</h3>
                            <p className="text-xs text-slate-500 mb-4">Why is this job delayed?</p>
                            <form onSubmit={handleDelaySubmit} className="space-y-3">
                                {['Stuck in traffic', 'Previous job overrun', 'Client not available', 'Waiting for materials', 'Need support', 'Other'].map(r => (
                                    <label key={r} className="flex items-center gap-3 p-3 border rounded-xl has-[:checked]:bg-blue-50 has-[:checked]:border-blue-200">
                                        <input type="radio" name="reason" value={r} className="text-blue-600" required />
                                        <span className="text-sm font-medium text-slate-700">{r}</span>
                                    </label>
                                ))}
                                <input name="customReason" placeholder="If Other, please specify..." className={INPUT_STYLES} />
                                
                                <div className="flex gap-3 mt-4">
                                    <button type="button" onClick={() => setReportingDelayActivity(null)} className="flex-1 py-3 text-slate-500 font-bold">Cancel</button>
                                    <button type="submit" className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold shadow-lg">Report</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Carry Forward Modal */}
                {isCarryForwardOpen && (
                    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setIsCarryForwardOpen(false)}>
                        <div className="bg-white w-full max-w-md rounded-t-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold text-slate-900">Carry Forward</h3>
                                <button onClick={() => setIsCarryForwardOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-500">
                                    <X size={20} />
                                </button>
                            </div>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reason / Remark <span className="text-red-500">*</span></label>
                                    <textarea 
                                        value={carryForwardRemark}
                                        onChange={e => setCarryForwardRemark(e.target.value)}
                                        className={INPUT_STYLES}
                                        rows={3}
                                        placeholder="Why is the job being carried forward?"
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Next Date &amp; Time <span className="text-red-500">*</span></label>
                                    <input
                                        type="datetime-local"
                                        value={carryForwardDatetime}
                                        onChange={e => setCarryForwardDatetime(e.target.value)}
                                        className={INPUT_STYLES}
                                        min={new Date().toISOString().slice(0,16)}
                                    />
                                </div>
                                
                                <div className="pt-4 flex gap-3">
                                    <button 
                                        onClick={() => setIsCarryForwardOpen(false)}
                                        className="flex-1 py-3.5 rounded-xl font-bold text-slate-500 bg-slate-100"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={handleConfirmCarryForward}
                                        disabled={!carryForwardRemark.trim() || !carryForwardDatetime}
                                        className="flex-[2] py-3.5 rounded-xl font-bold text-white bg-slate-900 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Confirm
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Toast Notification */}
                {showToast && (
                    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-300">
                        <CheckCircle2 size={18} className="text-emerald-400" />
                        <span className="font-bold text-sm">Job Carried Forward</span>
                    </div>
                )}

            </div>
        </div>
    </div>

      {/* Hidden photo file input */}
      <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoUpload}
      />

      {/* Change Password Modal */}
      {showChangePwd && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-900">Change Password</h3>
              <button onClick={() => setShowChangePwd(false)} className="text-slate-400 p-1">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {cpSuccess ? (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                  <p className="text-emerald-700 font-bold">✅ Password changed!</p>
                  <button onClick={() => setShowChangePwd(false)} className="mt-3 px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm">Done</button>
                </div>
              ) : (
                <>
                  {cpError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{cpError}</div>}
                  <div className="space-y-1"><label className="text-xs font-bold text-slate-500 uppercase">Current Password</label>
                    <input type="password" value={cpForm.current} onChange={e => setCpForm(p => ({...p, current: e.target.value}))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="Current password"/></div>
                  <div className="space-y-1"><label className="text-xs font-bold text-slate-500 uppercase">New Password</label>
                    <input type="password" value={cpForm.next} onChange={e => setCpForm(p => ({...p, next: e.target.value}))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="Min 8 characters"/></div>
                  <div className="space-y-1"><label className="text-xs font-bold text-slate-500 uppercase">Confirm Password</label>
                    <input type="password" value={cpForm.confirm} onChange={e => setCpForm(p => ({...p, confirm: e.target.value}))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="Repeat new password"/></div>
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowChangePwd(false)} className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 text-sm">Cancel</button>
                    <button onClick={() => {
                      setCpError('');
                      if (!cpForm.current) { setCpError('Enter current password'); return; }
                      if (cpForm.next.length < 8) { setCpError('Min 8 characters'); return; }
                      if (cpForm.next !== cpForm.confirm) { setCpError('Passwords do not match'); return; }
                      onChangePassword?.(cpForm.current, cpForm.next)
                        .then(() => setCpSuccess(true))
                        .catch((err: any) => setCpError(err?.message || 'Failed'));
                    }} className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold text-sm">Change</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MobileTechPortal;

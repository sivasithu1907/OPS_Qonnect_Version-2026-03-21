
import React, { useState, useEffect, useMemo } from 'react';
import toast from './Toast';
import { Ticket, TicketStatus, Technician, Activity } from '../types';
import { ChevronLeft, ChevronRight, MapPin, Navigation, CheckCircle2, Camera, LogOut, Clock, AlertTriangle, Play, Check, Smartphone, X, Calendar, KeyRound, Phone, Car, Home, History, RotateCcw, Grid, Briefcase } from 'lucide-react';
import { INPUT_STYLES } from '../constants';
import { MyJobTaskView } from './MyJobTaskView';

interface MobileTechPortalProps {
  tickets: Ticket[];
  activities?: Activity[]; // Now accepts activities
  customers?: any[]; // For activity customer name lookup
  technicians?: any[]; // For current tech name/avatar
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
    technicians = [],
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
  const [carryForwardIssue, setCarryForwardIssue] = useState('');
  const [carryForwardRemark, setCarryForwardRemark] = useState('');
  const [carryForwardDatetime, setCarryForwardDatetime] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyDetailJob, setHistoryDetailJob] = useState<any>(null); // For history popup
  const [photoJobId, setPhotoJobId] = useState<string | null>(null);
  const [photoJobType, setPhotoJobType] = useState<'ticket' | 'activity'>('activity');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showPhotoSourcePicker, setShowPhotoSourcePicker] = useState(false);
  const photoInputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);

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
      setShowPhotoSourcePicker(true);
  };

  const handlePhotoFromCamera = () => {
      setShowPhotoSourcePicker(false);
      cameraInputRef.current?.click();
  };

  const handlePhotoFromGallery = () => {
      setShowPhotoSourcePicker(false);
      photoInputRef.current?.click();
  };

  const MAX_PHOTOS = 5;

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0 || !photoJobId) return;
      setPhotoUploading(true);
      try {
          // Get existing photos count
          let existingPhotos: any[] = [];
          if (photoJobType === 'activity') {
              const act = activities.find(a => a.id === photoJobId);
              existingPhotos = (act as any)?.photos || [];
          } else {
              const ticket = tickets.find(t => t.id === photoJobId);
              existingPhotos = (ticket as any)?.photos || [];
          }
          
          const remaining = MAX_PHOTOS - existingPhotos.length;
          if (remaining <= 0) {
              toast.error(`Maximum ${MAX_PHOTOS} photos allowed per job.`);
              setPhotoUploading(false);
              return;
          }

          const filesToProcess = Array.from(files).slice(0, remaining);
          const newPhotos: any[] = [];

          for (const file of filesToProcess) {
              const base64 = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.readAsDataURL(file);
              });
              newPhotos.push({ url: base64, takenAt: new Date().toISOString(), name: file.name });
          }

          if (photoJobType === 'activity') {
              const act = activities.find(a => a.id === photoJobId);
              if (act && onUpdateActivity) {
                  onUpdateActivity({ ...act, photos: [...existingPhotos, ...newPhotos] } as any);
              }
          } else {
              const ticket = tickets.find(t => t.id === photoJobId);
              if (ticket) {
                  onUpdateTicket?.({ ...ticket, photos: [...existingPhotos, ...newPhotos] } as any);
              }
          }
          setPhotoUploading(false);
          setPhotoJobId(null);
          if (photoInputRef.current) photoInputRef.current.value = '';
          if (cameraInputRef.current) cameraInputRef.current.value = '';
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
          // Route through handleStatusUpdate so completionNote is preserved
          handleStatusUpdate(activeJobItem.data.id, TicketStatus.RESOLVED, completionNotes.trim() || undefined);
      } else if (activeJobItem?.type === 'activity' && onUpdateActivity) {
          const a = activeJobItem.data as Activity;
          const note = completionNotes.trim();
          onUpdateActivity({
              ...a,
              status: 'DONE',
              completionNote: note || undefined,
              updatedAt: new Date().toISOString()
          });
      }
      setCompletionNotes('');
      setCompletionStep(false);
      setSelectedJobId(null);
  };

  const handleStart = () => {
      if (activeJobItem?.type === 'ticket') {
          handleStatusUpdate(activeJobItem.data.id, TicketStatus.IN_PROGRESS);
      } else if (activeJobItem?.type === 'activity' && onUpdateActivity) {
          const a = activeJobItem.data as Activity;
          onUpdateActivity({
              ...a,
              status: 'IN_PROGRESS',
              primaryEngineerId: currentTechId,
              supportingEngineerIds: (a.assistantTechIds || []).filter(id => id !== currentTechId),
          });
      }
  };

  const handleActivityOnMyWay = () => {
      if (activeJobItem?.type === 'activity' && onUpdateActivity) {
          const a = activeJobItem.data as Activity;
          onUpdateActivity({
              ...a,
              status: 'ON_MY_WAY' as any,
              // Capture who is actually executing this activity
              primaryEngineerId: currentTechId,
              supportingEngineerIds: (a.assistantTechIds || []).filter(id => id !== currentTechId),
          });
      }
  };

  const handleActivityArrived = () => {
      if (activeJobItem?.type === 'activity' && onUpdateActivity) {
          onUpdateActivity({ ...activeJobItem.data as Activity, status: 'ARRIVED' as any });
      }
  };

  const handleActivityStartWork = () => {
      if (activeJobItem?.type === 'activity' && onUpdateActivity) {
          const a = activeJobItem.data as Activity;
          onUpdateActivity({
              ...a,
              status: 'IN_PROGRESS',
              // Record who is actually doing this work
              primaryEngineerId: a.primaryEngineerId || currentTechId,
              supportingEngineerIds: a.supportingEngineerIds || (a.assistantTechIds || []).filter(id => id !== currentTechId),
          });
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
      setCarryForwardIssue('');
      setCarryForwardRemark('');
      setIsCarryForwardOpen(true);
  };

  const handleConfirmCarryForward = () => {
      if (!carryForwardIssue.trim() || !carryForwardDatetime) return;

      const nextIso = new Date(carryForwardDatetime).toISOString();
      const combinedNote = carryForwardIssue ? `Reason: ${carryForwardIssue}${carryForwardRemark ? '\nRemark: ' + carryForwardRemark : ''}` : carryForwardRemark;

      if (activeJobItem?.type === 'ticket') {
          const t = activeJobItem.data as Ticket;
          if (onUpdateTicket) {
              onUpdateTicket({
                  ...t,
                  status: TicketStatus.CARRY_FORWARD,
                  carryForwardNote: combinedNote,
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
                  status: 'CARRY_FORWARD' as any,
                  carryForwardNote: combinedNote,
                  currentVisitRemark: carryForwardRemark || '',
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
  // Container class defined below in render section

  // --- 4-Tab navigation state ---
  const [activeTab, setActiveTab] = useState<'home' | 'carry' | 'history' | 'more'>('home');
  
  // Date selector for Home tab
  const [selectedDate, setSelectedDate] = useState<string>(() => {
      const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });

  // Current tech info
  const currentTech = technicians.find((t: any) => t.id === currentTechId);

  // Generate date range — 2 prev, today center, 2 next (5 total)
  const dateRange = useMemo(() => {
      const dates: { key: string; day: string; weekday: string; month: string; isToday: boolean }[] = [];
      const today = new Date();
      for (let i = -2; i <= 2; i++) {
          const d = new Date(today);
          d.setDate(today.getDate() + i);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          dates.push({
              key,
              day: String(d.getDate()).padStart(2, '0'),
              weekday: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
              month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
              isToday: i === 0
          });
      }
      return dates;
  }, []);

  // In-progress count for summary card
  const inProgressJobs = myJobs.filter(j => {
      const s = (j.data as any).status;
      return ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'].includes(s);
  });

  // Jobs filtered by selected date
  const todayKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const isPastDate = selectedDate < todayKey;
  const isFutureDate = selectedDate > todayKey;

  // For past dates: show completed jobs from that day
  // For today: show active jobs
  // For future: show planned jobs
  const dateFilteredJobs = useMemo(() => {
      const matchDate = (iso: string) => {
          if (!iso) return false;
          const dt = new Date(iso);
          return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}` === selectedDate;
      };
      if (isPastDate) {
          return completedJobs.filter(item => matchDate(item.sortDate))
              .map(item => ({ type: item.kind as any, data: item.data, date: item.sortDate, priority: (item.data as any).priority || 'MEDIUM', delayed: false }));
      }
      if (selectedDate === todayKey) {
          // TODAY: jobs planned for today + jobs currently in progress + completed today
          const inProgressStatuses = ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED', 'STARTED'];
          const todayPlanned = myJobs.filter(j => {
              const status = (j.data as any).status;
              // Always show in-progress jobs on today (regardless of planned date)
              if (inProgressStatuses.includes(status)) return true;
              // Show jobs planned/scheduled for today
              return matchDate(j.date);
          });
          const doneToday = completedJobs.filter(item => matchDate(item.sortDate))
              .map(item => ({ type: item.kind as any, data: item.data, date: item.sortDate, priority: (item.data as any).priority || 'MEDIUM', delayed: false }));
          const ids = new Set(todayPlanned.map(j => j.data.id));
          return [...todayPlanned, ...doneToday.filter(j => !ids.has(j.data.id))];
      }
      // Future: filter by date
      return myJobs.filter(j => matchDate(j.date));
  }, [myJobs, completedJobs, selectedDate, isPastDate, todayKey]);

  // Carry forward jobs
  const carryForwardJobs = useMemo(() => {
      return [
          ...tickets
            .filter(t => t.assignedTechId === currentTechId && t.status === TicketStatus.CARRY_FORWARD)
            .map(t => ({ type: 'ticket' as const, data: t, date: t.nextPlannedAt || t.updatedAt || t.createdAt, priority: t.priority, delayed: false })),
          ...activities
            .filter(a => (a.leadTechId === currentTechId || (a.assistantTechIds || []).includes(currentTechId)) && a.status === 'CARRY_FORWARD')
            .map(a => ({ type: 'activity' as const, data: a, date: a.updatedAt || a.plannedDate || a.createdAt, priority: a.priority, delayed: false }))
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [tickets, activities, currentTechId]);

  // History grouped by date
  const historyGrouped = useMemo(() => {
      const groups: Record<string, typeof completedJobs> = {};
      completedJobs.forEach(item => {
          const dt = new Date(item.sortDate);
          const today = new Date();
          const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
          let label: string;
          if (dt.toDateString() === today.toDateString()) label = 'Today';
          else if (dt.toDateString() === yesterday.toDateString()) label = 'Yesterday';
          else label = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          if (!groups[label]) groups[label] = [];
          groups[label].push(item);
      });
      return groups;
  }, [completedJobs]);

  // Date ref (no scroll needed — only 5 dates)
  const dateScrollRef = React.useRef<HTMLDivElement>(null);

  // Simplified container for mobile use (takes full height/width)
  const containerClasses = "w-full h-full bg-slate-100 flex flex-col";

  // Helper: Render a job card (used in Home and Carry Forward tabs)
  const renderJobCard = (item: typeof myJobs[0], showStartOption = false) => {
      const isActivity = item.type === 'activity';
      const job = item.data as any;
      
      if (!isActivity) {
          return <MyJobTaskView key={job.id} ticket={job} onUpdateStatus={handleStatusUpdate} onSelect={() => setSelectedJobId(job.id)} />;
      }

      const delayed = item.delayed;
      const isStarted = job.status === 'IN_PROGRESS';
      const actCust = customers?.find((cu: any) => cu.id === job.customerId);
      const actSteps5 = ['PLANNED','ON_MY_WAY','ARRIVED','IN_PROGRESS','DONE'];
      const actRawIdx = actSteps5.indexOf(job.status);
      const actStepIdx = actRawIdx === -1 ? 0 : actRawIdx;
      const actProgress = job.status === 'DONE' ? 100 : Math.max(5, ((actStepIdx + 1) / actSteps5.length) * 100);

      return (
          <div 
              key={job.id} 
              className={`bg-white rounded-2xl shadow-sm border overflow-hidden active:scale-[0.99] transition-transform relative ${
                  delayed ? 'border-red-400 ring-2 ring-red-100' : 'border-slate-100'
              }`}
              onClick={() => setSelectedJobId(job.id)}
          >
              <div className="h-1 bg-slate-100">
                  <div className="h-1 bg-emerald-500 transition-all duration-500" style={{ width: `${actProgress}%` }}/>
              </div>
              <div className="p-4">
                  <div className="flex justify-between items-start mb-2">
                      <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{job.reference || job.id}</div>
                          <h3 className="text-base font-bold text-slate-900">{actCust?.name || job.type}</h3>
                          {actCust && <div className="text-xs text-slate-500 mt-0.5">{job.type}{job.serviceCategory ? ` · ${job.serviceCategory}` : ''}</div>}
                      </div>
                      <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${
                          delayed ? 'bg-red-100 text-red-700' :
                          isStarted ? 'bg-amber-100 text-amber-700' :
                          job.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' :
                          job.status === 'CARRY_FORWARD' ? 'bg-orange-100 text-orange-700' :
                          'bg-purple-100 text-purple-700'
                      }`}>
                          {delayed ? 'DELAYED' : job.status.replace(/_/g,' ')}
                      </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600 mb-2">
                      <MapPin size={12} className="text-slate-400 shrink-0"/>
                      <span className="truncate flex-1">{job.houseNumber || job.locationUrl || 'No location'}</span>
                      {job.locationUrl && (
                          <a href={job.locationUrl} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="shrink-0 flex items-center gap-1 text-[10px] text-blue-600 font-bold px-2 py-0.5 bg-blue-50 rounded-lg">
                              <Navigation size={10}/> Map
                          </a>
                      )}
                  </div>
                  {actCust?.phone && (
                      <a href={`tel:${actCust.phone}`} onClick={e => e.stopPropagation()}
                          className="flex items-center justify-center gap-2 w-full py-2 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl font-bold text-xs mb-3 active:bg-slate-100">
                          <Phone size={12}/> Call Customer
                      </a>
                  )}
                  {/* Step progress */}
                  {job.status !== 'DONE' && job.status !== 'CANCELLED' && (
                      <div className="flex items-center justify-between px-1">
                          {[
                              { key: 'PLANNED', label: 'Assigned' },
                              { key: 'ON_MY_WAY', label: 'On Way' },
                              { key: 'ARRIVED', label: 'Arrived' },
                              { key: 'IN_PROGRESS', label: 'Working' },
                          ].map((step, i) => (
                              <React.Fragment key={step.key}>
                                  <div className="flex flex-col items-center">
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                                          i < actStepIdx  ? 'bg-emerald-500 border-emerald-500 text-white' :
                                          i === actStepIdx? 'bg-slate-900 border-slate-900 text-white' :
                                          'bg-white border-slate-200 text-slate-400'
                                      }`}>{i < actStepIdx ? '✓' : i+1}</div>
                                      <span className={`text-[8px] mt-0.5 font-medium ${i===actStepIdx?'text-slate-900':'text-slate-400'}`}>{step.label}</span>
                                  </div>
                                  {i < 3 && <div className={`flex-1 h-0.5 mx-1 mb-3 ${i<actStepIdx?'bg-emerald-500':'bg-slate-200'}`}/>}
                              </React.Fragment>
                          ))}
                      </div>
                  )}
                  {delayed && (
                      <button 
                          onClick={(e) => { e.stopPropagation(); setReportingDelayActivity(job as Activity); }}
                          className="w-full mt-2 py-2 bg-red-50 text-red-600 text-xs font-bold rounded-lg border border-red-100 flex items-center justify-center gap-1">
                          <AlertTriangle size={12} /> Report Reason
                      </button>
                  )}
              </div>
          </div>
      );
  };

  return (
    <>
    <div className="h-full w-full bg-slate-100">
        <div className={containerClasses}>
            
            {/* Header with profile pic */}
            {!selectedJobId && !completionStep && (
                <div className="bg-white border-b border-slate-200 px-4 pt-4 pb-3 flex items-center justify-between shrink-0 z-30 shadow-sm">
                    <div>
                        <h2 className="font-bold text-lg text-slate-900 leading-none">
                            {activeTab === 'home' ? 'My Schedule' : activeTab === 'carry' ? 'Carry Forward' : activeTab === 'history' ? 'Completed' : 'More'}
                        </h2>
                        <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">Field Engineer Portal</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"/>
                            <span className="text-[10px] font-medium text-emerald-600">ONLINE</span>
                        </div>
                        <div className="w-9 h-9 rounded-full ring-2 ring-amber-400 flex items-center justify-center overflow-hidden bg-amber-50">
                            {currentTech?.avatar ? (
                                <img src={currentTech.avatar} className="w-full h-full object-cover" alt="" />
                            ) : (
                                <span className="font-bold text-xs text-amber-700">{currentTech?.name?.split(' ').map((w: string) => w[0]).join('').slice(0,2) || 'FE'}</span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-hidden relative min-h-0">
                
                {/* === JOB DETAIL VIEW (overrides everything when a job is tapped) === */}
                {selectedJobId && !completionStep && (
                    <div className="h-full flex flex-col">
                        {/* Detail header with back button */}
                        <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 shrink-0 shadow-sm">
                            <button onClick={handleBack} className="p-1"><ChevronLeft size={24} className="text-slate-600"/></button>
                            <h2 className="font-bold text-slate-900">Job Details</h2>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {/* Ticket detail */}
                            {activeJob && activeJobItem?.type !== 'activity' && (
                                <MyJobTaskView ticket={activeJob as any} onUpdateStatus={handleStatusUpdate} isDetailView={true} />
                            )}
                            {/* Activity detail — reuse existing rich view */}
                            {activeJob && activeJobItem?.type === 'activity' && (() => {
                                const act = activeJob as Activity;
                                const actCustomer = (customers as any[]).find((cu: any) => cu.id === act.customerId);
                                const actStatus = act.status;
                                const actSteps = [
                                    { key: 'PLANNED', label: 'Assigned' },
                                    { key: 'ON_MY_WAY', label: 'On the Way' },
                                    { key: 'ARRIVED', label: 'Arrived' },
                                    { key: 'IN_PROGRESS', label: 'Working' },
                                    { key: 'DONE', label: 'Done' },
                                ];
                                const actStep = actSteps.findIndex(s => s.key === actStatus) === -1 ? 0 : actSteps.findIndex(s => s.key === actStatus);
                                const actProgressVal = actStatus === 'DONE' ? 100 : Math.max(5, ((actStep + 1) / actSteps.length) * 100);
                                return (
                                <div className="flex flex-col h-full overflow-y-auto bg-slate-50">
                                    <div className="h-1 bg-slate-200 shrink-0"><div className="h-1 bg-emerald-500 transition-all duration-500" style={{ width: `${actProgressVal}%` }}/></div>
                                    <div className="p-5 space-y-4">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{act.reference || act.id}</div>
                                                <h2 className="text-xl font-bold text-slate-900">{actCustomer?.name || act.type}</h2>
                                                {actCustomer && <div className="text-sm text-slate-500 mt-0.5">{act.type}{act.serviceCategory ? ` · ${act.serviceCategory}` : ''}</div>}
                                            </div>
                                            <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${
                                                (actStatus as any) === 'ON_MY_WAY' ? 'bg-cyan-100 text-cyan-700' :
                                                (actStatus as any) === 'ARRIVED' ? 'bg-indigo-100 text-indigo-700' :
                                                actStatus === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700' :
                                                actStatus === 'DONE' ? 'bg-emerald-100 text-emerald-700' :
                                                actStatus === 'CARRY_FORWARD' ? 'bg-orange-100 text-orange-700' :
                                                'bg-purple-100 text-purple-700'
                                            }`}>{actStatus.replace(/_/g,' ')}</span>
                                        </div>
                                        {actCustomer?.phone && (
                                            <a href={`tel:${actCustomer.phone}`} className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl font-bold text-xs hover:bg-slate-100 transition-colors">
                                                <Phone size={14}/> Call Customer — {actCustomer.phone}
                                            </a>
                                        )}
                                        {act.description && (
                                            <div className="bg-white rounded-xl p-4 border border-slate-100">
                                                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Scope of Work</div>
                                                <p className="text-sm text-slate-700 leading-relaxed">{act.description}</p>
                                            </div>
                                        )}
                                        <div className="bg-white rounded-xl p-4 border border-slate-100 space-y-3">
                                            {act.serviceCategory && <div className="flex justify-between text-sm"><span className="text-slate-400 font-medium">Category</span><span className="font-semibold text-slate-700">{act.serviceCategory}</span></div>}
                                            <div className="flex justify-between text-sm"><span className="text-slate-400 font-medium">Priority</span><span className={`font-bold ${act.priority === 'URGENT' ? 'text-red-600' : act.priority === 'HIGH' ? 'text-orange-500' : 'text-slate-600'}`}>{act.priority}</span></div>
                                            {act.plannedDate && <div className="flex justify-between text-sm"><span className="text-slate-400 font-medium">Planned</span><span className="font-semibold text-slate-700">{new Date(act.plannedDate).toLocaleDateString()} {new Date(act.plannedDate).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div>}
                                            {(act.houseNumber || act.locationUrl) && <div className="flex justify-between text-sm"><span className="text-slate-400 font-medium">Location</span><span className="font-semibold text-slate-700 text-right max-w-[55%] truncate">{act.houseNumber || act.locationUrl}</span></div>}
                                        </div>
                                        {/* Step progress */}
                                        {actStatus !== 'DONE' && actStatus !== 'CARRY_FORWARD' && (
                                            <div className="flex items-center justify-between bg-white rounded-xl p-4 border border-slate-100">
                                                {actSteps.slice(0,4).map((step, i) => (
                                                    <React.Fragment key={step.key}>
                                                        <div className="flex flex-col items-center">
                                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                                                                i < actStep ? 'bg-emerald-500 border-emerald-500 text-white' :
                                                                i === actStep ? 'bg-slate-900 border-slate-900 text-white' :
                                                                'bg-white border-slate-200 text-slate-400'
                                                            }`}>{i < actStep ? '✓' : i + 1}</div>
                                                            <span className={`text-[9px] mt-1 font-medium ${i === actStep ? 'text-slate-900' : 'text-slate-400'}`}>{step.label}</span>
                                                        </div>
                                                        {i < 3 && <div className={`flex-1 h-0.5 mx-2 mb-3 ${i < actStep ? 'bg-emerald-500' : 'bg-slate-200'}`}/>}
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        )}
                                        {/* Photos */}
                                        {(act as any).photos?.length > 0 && (
                                            <div className="bg-white rounded-xl p-4 border border-slate-100">
                                                <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Photos ({(act as any).photos.length}/{MAX_PHOTOS})</div>
                                                <div className="grid grid-cols-4 gap-2">{(act as any).photos.map((p: any, i: number) => (
                                                    <img key={i} src={p.url || p} alt="" className="w-full aspect-square object-cover rounded-lg border border-slate-200 cursor-pointer" onClick={() => showPhotoLightbox(p.url || p)} />
                                                ))}</div>
                                            </div>
                                        )}
                                        {/* Action buttons */}
                                        {actStatus !== 'DONE' && actStatus !== 'CANCELLED' && (
                                            <div className="space-y-2 pt-2">
                                                {actStatus === 'PLANNED' || actStatus === 'CARRY_FORWARD' ? (
                                                    <button onClick={handleActivityOnMyWay} className="w-full py-3.5 rounded-xl bg-cyan-600 text-white font-bold shadow-lg active:scale-[0.98] flex items-center justify-center gap-2">
                                                        <Navigation size={16}/> On My Way
                                                    </button>
                                                ) : (actStatus as any) === 'ON_MY_WAY' ? (
                                                    <button onClick={handleActivityArrived} className="w-full py-3.5 rounded-xl bg-indigo-600 text-white font-bold shadow-lg active:scale-[0.98] flex items-center justify-center gap-2">
                                                        <MapPin size={16}/> I've Arrived
                                                    </button>
                                                ) : (actStatus as any) === 'ARRIVED' ? (
                                                    <button onClick={handleActivityStartWork} className="w-full py-3.5 rounded-xl bg-amber-600 text-white font-bold shadow-lg active:scale-[0.98] flex items-center justify-center gap-2">
                                                        <Play size={16}/> Start Work
                                                    </button>
                                                ) : actStatus === 'IN_PROGRESS' ? (
                                                    <>
                                                        <button onClick={() => handlePhotoClick(act.id, 'activity')} className="w-full py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm flex items-center justify-center gap-2 border border-slate-200 active:bg-slate-200">
                                                            <Camera size={14}/> Add Photo ({(act as any).photos?.length || 0}/{MAX_PHOTOS})
                                                        </button>
                                                        <button onClick={() => setCompletionStep(true)} className="w-full py-3.5 rounded-xl bg-emerald-600 text-white font-bold shadow-lg active:scale-[0.98] flex items-center justify-center gap-2">
                                                            <CheckCircle2 size={16}/> Complete Job
                                                        </button>
                                                    </>
                                                ) : null}
                                                {['PLANNED','ON_MY_WAY','ARRIVED','IN_PROGRESS','CARRY_FORWARD'].includes(actStatus) && (
                                                    <button onClick={handleCarryForwardClick} className="w-full py-2.5 rounded-xl bg-orange-50 border border-orange-200 text-orange-700 font-bold text-sm active:bg-orange-100 flex items-center justify-center gap-2">
                                                        <RotateCcw size={14}/> Carry Forward
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* === COMPLETION STEP === */}
                {completionStep && (
                    <div className="h-full flex flex-col bg-white">
                        <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 shrink-0 shadow-sm">
                            <button onClick={() => setCompletionStep(false)} className="p-1"><ChevronLeft size={24} className="text-slate-600"/></button>
                            <h2 className="font-bold text-slate-900">Complete Job</h2>
                        </div>
                        <div className="p-5 flex-1 flex flex-col overflow-y-auto">
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
                            <div className="flex gap-3 pt-4">
                                <button onClick={() => setCompletionStep(false)} className="flex-1 py-4 text-slate-500 font-bold">Back</button>
                                <button onClick={handleComplete} className="flex-[2] py-4 rounded-xl bg-emerald-600 text-white font-bold shadow-xl active:bg-emerald-700">Submit & Close</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* === TAB CONTENT (only when no job selected and no completion step) === */}
                {!selectedJobId && !completionStep && (
                    <div className="h-full overflow-y-auto pb-24">

                        {/* HOME TAB — Date selector + summary + jobs */}
                        {activeTab === 'home' && (
                            <div>
                                {/* Date Picker — 5 days centered on today */}
                                <div className="bg-white border-b border-slate-100 px-4 py-3">
                                    <div ref={dateScrollRef} className="flex justify-between gap-2">
                                        {dateRange.map(d => (
                                            <button
                                                key={d.key}
                                                onClick={() => setSelectedDate(d.key)}
                                                className={`flex-1 flex flex-col items-center py-2.5 rounded-2xl transition-all ${
                                                    selectedDate === d.key 
                                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 scale-105' 
                                                        : d.isToday 
                                                            ? 'bg-blue-50 text-blue-700 border-2 border-blue-200'
                                                            : 'bg-slate-50 text-slate-600'
                                                }`}
                                            >
                                                <span className={`text-[9px] font-bold ${selectedDate === d.key ? 'text-blue-100' : 'text-slate-400'}`}>{d.weekday}</span>
                                                <span className="text-xl font-bold leading-tight">{d.day}</span>
                                                <span className={`text-[8px] font-bold ${selectedDate === d.key ? 'text-blue-200' : 'text-slate-400'}`}>{d.month}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Summary Cards — Total Jobs + In Progress */}
                                <div className="px-4 pt-3 pb-1">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3">
                                            <div className="p-2 bg-blue-50 rounded-lg"><Briefcase size={18} className="text-blue-600" /></div>
                                            <div>
                                                <div className="text-xl font-bold text-slate-900">{dateFilteredJobs.length}</div>
                                                <div className="text-[9px] font-bold text-slate-400 uppercase">{isPastDate ? 'Completed' : 'Total Jobs'}</div>
                                            </div>
                                        </div>
                                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3">
                                            <div className="p-2 bg-amber-50 rounded-lg"><Clock size={18} className="text-amber-600" /></div>
                                            <div>
                                                <div className="text-xl font-bold text-amber-600">{inProgressJobs.length}</div>
                                                <div className="text-[9px] font-bold text-slate-400 uppercase">In Progress</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* In Progress Section (only if there are in-progress jobs and viewing today) */}
                                {!isPastDate && !isFutureDate && inProgressJobs.length > 0 && (
                                    <div className="px-4 pt-3">
                                        <div className="flex items-center justify-between px-1 mb-2">
                                            <p className="text-xs font-bold text-amber-600 uppercase flex items-center gap-1"><Clock size={12} /> In Progress</p>
                                            <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{inProgressJobs.length}</span>
                                        </div>
                                        {inProgressJobs.map(item => renderJobCard(item))}
                                    </div>
                                )}

                                {/* Scheduled / Completed jobs for selected date (exclude in-progress shown above) */}
                                <div className="p-4 space-y-3">
                                    {(() => {
                                        const inProgressIds = new Set(inProgressJobs.map(j => j.data.id));
                                        const showingInProgress = !isPastDate && !isFutureDate && inProgressJobs.length > 0;
                                        const scheduleJobs = showingInProgress 
                                            ? dateFilteredJobs.filter(j => !inProgressIds.has(j.data.id))
                                            : dateFilteredJobs;
                                        return (
                                            <>
                                                <div className="flex items-center justify-between px-1">
                                                    <p className="text-xs font-bold text-slate-500 uppercase">
                                                        {isPastDate ? 'Completed on this day' : selectedDate === todayKey ? "Today's Schedule" : 'Planned'}
                                                    </p>
                                                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{scheduleJobs.length}</span>
                                                </div>
                                                {scheduleJobs.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                                        <CheckCircle2 size={40} className="mb-2 text-slate-300"/>
                                                        <p className="font-medium text-sm">{isPastDate ? 'No jobs on this date' : showingInProgress ? 'All jobs are in progress' : 'No jobs scheduled'}</p>
                                                    </div>
                                                ) : scheduleJobs.map(item => renderJobCard(item))}
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}

                        {/* CARRY FORWARD TAB */}
                        {activeTab === 'carry' && (
                            <div className="p-4 space-y-3">
                                <div className="flex items-center justify-between px-1 mb-2">
                                    <p className="text-xs font-bold text-slate-500 uppercase">Carry Forward Jobs</p>
                                    <span className="text-[10px] font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">{carryForwardJobs.length}</span>
                                </div>
                                {carryForwardJobs.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                                        <RotateCcw size={48} className="mb-3 text-slate-300"/>
                                        <p className="font-medium">No carry forward jobs</p>
                                        <p className="text-xs text-slate-400 mt-1">All caught up!</p>
                                    </div>
                                ) : carryForwardJobs.map(item => renderJobCard(item, true))}
                            </div>
                        )}

                        {/* HISTORY TAB — Completed jobs grouped by date */}
                        {activeTab === 'history' && (
                            <div className="p-4 space-y-3">
                                <div className="flex items-center justify-between px-1 mb-2">
                                    <p className="text-xs font-bold text-slate-500 uppercase">Completed Jobs</p>
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">{completedJobs.length}</span>
                                </div>
                                {completedJobs.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                                        <History size={48} className="mb-3 text-slate-300"/>
                                        <p className="font-medium">No completed jobs yet</p>
                                    </div>
                                ) : Object.entries(historyGrouped).map(([dateLabel, items]) => (
                                    <div key={dateLabel} className="mb-3">
                                        <div className="flex items-center gap-2 mb-2 px-1">
                                            <div className="h-px flex-1 bg-slate-200" />
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{dateLabel}</span>
                                            <span className="text-[10px] text-slate-300 font-bold">{items.length}</span>
                                            <div className="h-px flex-1 bg-slate-200" />
                                        </div>
                                        {items.map(item => {
                                            const isAct = item.kind === 'activity';
                                            const job = item.data as any;
                                            const label = isAct ? (job.type || 'Activity') : (job.customerName || job.id);
                                            const sub = isAct ? (job.serviceCategory || '') : (job.category || '');
                                            const dt = new Date(item.sortDate);
                                            return (
                                                <div key={job.id} onClick={() => setHistoryDetailJob({ ...job, kind: item.kind })}
                                                    className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-2 cursor-pointer active:scale-[0.99] transition-transform">
                                                    <div className="flex justify-between items-start mb-1">
                                                        <div>
                                                            <div className="text-[10px] font-bold text-slate-400">{job.reference || job.id}</div>
                                                            <div className="font-bold text-slate-800 text-sm">{label}</div>
                                                        </div>
                                                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${job.status === 'RESOLVED' || job.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                                            {(job.status || '').replace(/_/g,' ')}
                                                        </span>
                                                    </div>
                                                    {sub && <div className="text-xs text-slate-500">{sub}</div>}
                                                    <div className="text-[10px] text-slate-400 mt-1">{dt.toLocaleDateString()} {dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* MORE TAB — Profile + sections like Lead Portal */}
                        {activeTab === 'more' && (
                            <div className="p-4 space-y-5">
                                {/* Profile Card */}
                                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                                    <div className="flex items-center gap-4">
                                        <div className="relative">
                                            {currentTech?.avatar ? (
                                                <img src={currentTech.avatar} className="w-16 h-16 rounded-full object-cover ring-2 ring-amber-400" alt="" />
                                            ) : (
                                                <div className="w-16 h-16 rounded-full bg-amber-50 ring-2 ring-amber-400 flex items-center justify-center">
                                                    <span className="font-bold text-lg text-amber-700">{currentTech?.name?.split(' ').map((w: string) => w[0]).join('').slice(0,2) || 'FE'}</span>
                                                </div>
                                            )}
                                            <div className="absolute bottom-0 right-0 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white" />
                                        </div>
                                        <div>
                                            <h3 className="text-slate-900 font-bold text-lg">{currentTech?.name || 'Field Engineer'}</h3>
                                            <p className="text-slate-500 text-sm">Field Engineer</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Summary */}
                                <div>
                                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 px-1">Summary</h4>
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm text-center">
                                            <div className="text-xl font-bold text-amber-600">{myJobs.length}</div>
                                            <div className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Active</div>
                                        </div>
                                        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm text-center">
                                            <div className="text-xl font-bold text-orange-600">{carryForwardJobs.length}</div>
                                            <div className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Carry Fwd</div>
                                        </div>
                                        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm text-center">
                                            <div className="text-xl font-bold text-emerald-600">{completedJobs.length}</div>
                                            <div className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Done</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Account Section */}
                                <div>
                                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 px-1">Account</h4>
                                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                                        {onChangePassword && (
                                            <button onClick={() => { setShowChangePwd(true); setCpForm({current:'',next:'',confirm:''}); setCpError(''); setCpSuccess(false); }}
                                                className="w-full flex items-center gap-3 p-4 active:bg-slate-50 transition-colors">
                                                <div className="p-2 bg-slate-100 rounded-lg"><KeyRound size={18} className="text-slate-500" /></div>
                                                <span className="flex-1 text-left text-slate-900 font-medium">Password & Security</span>
                                                <ChevronRight size={16} className="text-slate-300" />
                                            </button>
                                        )}
                                        {onLogout && (
                                            <button onClick={onLogout} className="w-full flex items-center gap-3 p-4 active:bg-red-50 transition-colors">
                                                <div className="p-2 bg-red-50 rounded-lg"><LogOut size={18} className="text-red-400" /></div>
                                                <span className="flex-1 text-left text-red-500 font-medium">Logout</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Floating Bottom Nav — 4 tabs (only when no job selected) */}
            {!selectedJobId && !completionStep && (
                <div className="absolute bottom-0 left-0 right-0 z-30 px-3" style={{paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))"}}>
                    <div className="bg-white/90 backdrop-blur-2xl rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-slate-200/60 flex justify-between px-2 py-1.5">
                        {[
                            { key: 'home' as const, icon: Calendar, label: 'Schedule' },
                            { key: 'carry' as const, icon: RotateCcw, label: 'Carry Fwd', badge: carryForwardJobs.length },
                            { key: 'history' as const, icon: History, label: 'Completed' },
                            { key: 'more' as const, icon: Grid, label: 'More' },
                        ].map(tab => {
                            const isActive = activeTab === tab.key;
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.key}
                                    onClick={() => setActiveTab(tab.key)}
                                    className={`flex flex-col items-center justify-center py-1.5 flex-1 rounded-xl transition-all duration-200 relative ${isActive ? 'bg-slate-900 text-white scale-105' : 'text-slate-400 active:scale-95'}`}
                                >
                                    <div className="relative">
                                        <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                                        {tab.badge && tab.badge > 0 && (
                                            <span className={`absolute -top-1.5 -right-2.5 min-w-[16px] h-4 ${isActive ? 'bg-orange-400 text-white' : 'bg-orange-500 text-white'} text-[9px] font-bold rounded-full flex items-center justify-center px-1`}>{tab.badge}</span>
                                        )}
                                    </div>
                                    <span className={`text-[8px] font-bold mt-0.5 uppercase tracking-wide ${isActive ? 'text-white' : 'text-slate-400'}`}>{tab.label}</span>
                                </button>
                            );
                        })}
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
                            <button onClick={() => setIsCarryForwardOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-500"><X size={20} /></button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reason <span className="text-red-500">*</span></label>
                                <textarea value={carryForwardIssue} onChange={e => setCarryForwardIssue(e.target.value)} className={INPUT_STYLES} rows={3} placeholder="Why is this job being carried forward?" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Remark / Description</label>
                                <textarea value={carryForwardRemark} onChange={e => setCarryForwardRemark(e.target.value)} className={INPUT_STYLES} rows={3} placeholder="Additional notes..." />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Next Date & Time <span className="text-red-500">*</span></label>
                                <input type="datetime-local" value={carryForwardDatetime} onChange={e => setCarryForwardDatetime(e.target.value)} className={INPUT_STYLES} min={new Date().toISOString().slice(0,16)} />
                            </div>
                            <div className="pt-4 flex gap-3">
                                <button onClick={() => setIsCarryForwardOpen(false)} className="flex-1 py-3.5 rounded-xl font-bold text-slate-500 bg-slate-100">Cancel</button>
                                <button onClick={handleConfirmCarryForward} disabled={!carryForwardIssue.trim() || !carryForwardDatetime}
                                    className="flex-[2] py-3.5 rounded-xl font-bold text-white bg-slate-900 shadow-lg disabled:opacity-50">Confirm</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {showToast && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-300">
                    <CheckCircle2 size={18} className="text-emerald-400" />
                    <span className="font-bold text-sm">Job Carried Forward</span>
                </div>
            )}

            {/* History Detail Popup */}
            {historyDetailJob && (() => {
                const hj = historyDetailJob;
                const isAct = hj.kind === 'activity';
                const custName = isAct ? ((customers as any[]).find((c: any) => c.id === hj.customerId)?.name || 'Unknown') : (hj.customerName || 'Unknown');
                const custPhone = isAct ? ((customers as any[]).find((c: any) => c.id === hj.customerId)?.phone || '') : (hj.phoneNumber || '');
                const fmtDt = (iso: string) => iso ? `${new Date(iso).toLocaleDateString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short', year:'numeric'})} ${new Date(iso).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}` : '—';
                const photos = hj.photos || [];
                return (
                    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setHistoryDetailJob(null)}>
                        <div className="bg-white w-full max-w-md rounded-t-[2rem] max-h-[85vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                            <div className="p-5 border-b border-slate-100 flex justify-between items-center shrink-0">
                                <div>
                                    <div className="text-[10px] font-mono text-slate-400">{hj.reference || hj.id}</div>
                                    <h3 className="font-bold text-lg text-slate-900">{isAct ? hj.type : hj.category}</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${hj.status === 'DONE' || hj.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-700' : hj.status === 'CANCELLED' ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-700'}`}>{(hj.status || '').replace(/_/g, ' ')}</span>
                                    <button onClick={() => setHistoryDetailJob(null)} className="p-1.5 bg-slate-100 rounded-full"><X size={16} className="text-slate-500"/></button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-5 space-y-4">
                                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-1">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase">Customer</div>
                                    <div className="text-sm font-bold text-slate-800">{custName}</div>
                                    {custPhone && <div className="text-xs text-slate-500 flex items-center gap-1"><Phone size={10}/> {custPhone}</div>}
                                </div>
                                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-1.5">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase">Timing</div>
                                    <div className="flex justify-between text-xs"><span className="text-slate-400">{isAct ? 'Planned' : 'Created'}</span><span className="text-slate-700">{fmtDt(isAct ? hj.plannedDate : hj.createdAt)}</span></div>
                                    {hj.startedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Started</span><span className="text-emerald-600">{fmtDt(hj.startedAt)}</span></div>}
                                    {hj.completedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Completed</span><span className="text-emerald-600">{fmtDt(hj.completedAt)}</span></div>}
                                    {hj.startedAt && hj.completedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Duration</span><span className="font-bold text-slate-700">{Math.round((new Date(hj.completedAt).getTime() - new Date(hj.startedAt).getTime()) / 60000)}m</span></div>}
                                </div>
                                {(hj.description || hj.notes) && <div className="bg-slate-50 rounded-xl p-3 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Description</div><p className="text-xs text-slate-700 whitespace-pre-wrap">{hj.description || hj.notes}</p></div>}
                                {hj.completionNote && <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100"><div className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Completion Summary</div><p className="text-xs text-emerald-800 whitespace-pre-wrap">{hj.completionNote}</p></div>}
                                {hj.carryForwardNote && <div className="bg-amber-50 rounded-xl p-3 border border-amber-200"><div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Carry Forward</div><p className="text-xs text-amber-800 whitespace-pre-wrap">{hj.carryForwardNote}</p></div>}
                                {(hj.houseNumber || hj.locationUrl) && <div className="bg-blue-50 rounded-xl p-3 border border-blue-100 space-y-1"><div className="text-[10px] font-bold text-blue-600 uppercase">Location</div>{hj.houseNumber && <div className="text-xs text-slate-700">{hj.houseNumber}</div>}{hj.locationUrl && <a href={hj.locationUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline">Open Map</a>}</div>}
                                {photos.length > 0 && <div className="space-y-2"><div className="text-[10px] font-bold text-slate-400 uppercase">Photos ({photos.length})</div><div className="grid grid-cols-3 gap-2">{photos.map((p: any, i: number) => (<img key={i} src={p.url || p} alt="" className="w-full h-20 object-cover rounded-lg border border-slate-200" onClick={() => showPhotoLightbox(p.url || p)} />))}</div></div>}
                            </div>
                            <div className="p-4 border-t border-slate-100 shrink-0"><button onClick={() => setHistoryDetailJob(null)} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold">Close</button></div>
                        </div>
                    </div>
                );
            })()}

        </div>
    </div>

      {/* Hidden photo file inputs — separate for camera and gallery */}
      <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoUpload}
      />
      <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handlePhotoUpload}
      />

      {/* Photo Source Picker Modal */}
      {showPhotoSourcePicker && (
          <div className="fixed inset-0 z-[200] bg-black/60 flex items-end justify-center" onClick={() => setShowPhotoSourcePicker(false)}>
              <div className="bg-white w-full max-w-sm rounded-t-2xl p-6 space-y-3 animate-in slide-in-from-bottom" onClick={e => e.stopPropagation()}>
                  <h3 className="text-lg font-bold text-slate-900 text-center mb-4">Upload Photo</h3>
                  <button 
                      onClick={handlePhotoFromCamera}
                      className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
                  >
                      <Camera size={20} /> Open Camera
                  </button>
                  <button 
                      onClick={handlePhotoFromGallery}
                      className="w-full py-3.5 bg-slate-100 text-slate-800 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform border border-slate-200"
                  >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                      Choose from Gallery
                  </button>
                  <button 
                      onClick={() => setShowPhotoSourcePicker(false)}
                      className="w-full py-3 text-slate-500 font-bold text-sm"
                  >
                      Cancel
                  </button>
              </div>
          </div>
      )}

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

export default React.memo(MobileTechPortal);

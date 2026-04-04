import React, { useState } from 'react';
import { Ticket, TicketStatus, TicketType } from '../types';
import { Phone, MapPin, ShieldCheck, CheckCircle2, Clock, X, Navigation, Play, Car, Home, Camera } from 'lucide-react';

interface MyJobTaskViewProps {
  ticket: Ticket;
  onUpdateStatus: (ticketId: string, status: TicketStatus, note?: string) => void;
  onSelect?: (ticket: Ticket) => void;
  /** When true renders the full-screen detail layout. When false (default) renders the compact list card. */
  isDetailView?: boolean;
}

export const MyJobTaskView: React.FC<MyJobTaskViewProps> = ({ ticket, onUpdateStatus, onSelect, isDetailView = false }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [remark, setRemark] = useState('');

  const isWarranty   = ticket.type === TicketType.WARRANTY;
  const isChargeable = ticket.type === TicketType.CHARGEABLE;
  const isCompleted  = ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CANCELLED;

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    switch (ticket.status) {
      case TicketStatus.NEW:
      case TicketStatus.OPEN:
      case TicketStatus.ASSIGNED:    return onUpdateStatus(ticket.id, TicketStatus.ON_MY_WAY);
      case TicketStatus.ON_MY_WAY:   return onUpdateStatus(ticket.id, TicketStatus.ARRIVED);
      case TicketStatus.ARRIVED:     return onUpdateStatus(ticket.id, TicketStatus.IN_PROGRESS);
      case TicketStatus.IN_PROGRESS: return setIsModalOpen(true);
    }
  };

  const handleFinalize = () => {
    if (remark.length < 5) return;
    onUpdateStatus(ticket.id, TicketStatus.RESOLVED, remark);
    setIsModalOpen(false);
  };

  const getActionConfig = (): { label: string; icon: React.ReactNode; color: string } | null => {
    switch (ticket.status) {
      case TicketStatus.NEW:
      case TicketStatus.OPEN:
      case TicketStatus.ASSIGNED:    return { label: 'On My Way',       icon: <Car size={20}/>,                           color: 'bg-blue-600 text-white' };
      case TicketStatus.ON_MY_WAY:   return { label: 'Arrived at Site', icon: <Home size={20}/>,                          color: 'bg-indigo-600 text-white' };
      case TicketStatus.ARRIVED:     return { label: 'Start Work',      icon: <Play size={20} className="fill-current"/>, color: 'bg-amber-500 text-white' };
      case TicketStatus.IN_PROGRESS: return { label: 'Complete Job',    icon: <CheckCircle2 size={20}/>,                  color: 'bg-emerald-600 text-white' };
      default: return null;
    }
  };

  const actionConfig = getActionConfig();

  const steps = [
    { key: TicketStatus.ASSIGNED,    label: 'Assigned'   },
    { key: TicketStatus.ON_MY_WAY,   label: 'On the Way' },
    { key: TicketStatus.ARRIVED,     label: 'Arrived'    },
    { key: TicketStatus.IN_PROGRESS, label: 'Working'    },
    { key: TicketStatus.RESOLVED,    label: 'Done'       },
  ];

  const normalizedStatus = (ticket.status === TicketStatus.OPEN || (ticket.status as string) === 'NEW')
    ? TicketStatus.ASSIGNED : ticket.status;
  const currentStep = steps.findIndex(s => s.key === normalizedStatus);
  const progress    = isCompleted ? 100 : Math.max(5, ((currentStep + 1) / steps.length) * 100);

  const issueText = (ticket.messages as any[])?.find((m: any) => m.sender === 'CLIENT')?.content
    || (ticket as any).notes
    || (ticket as any).ai_summary
    || ticket.category;

  const statusColor =
    ticket.status === TicketStatus.ASSIGNED    ? 'bg-purple-100 text-purple-700' :
    ticket.status === TicketStatus.ON_MY_WAY   ? 'bg-cyan-100 text-cyan-700' :
    ticket.status === TicketStatus.ARRIVED     ? 'bg-indigo-100 text-indigo-700' :
    ticket.status === TicketStatus.IN_PROGRESS ? 'bg-amber-100 text-amber-700' :
    ticket.status === TicketStatus.RESOLVED    ? 'bg-emerald-100 text-emerald-700' :
    'bg-slate-100 text-slate-600';

  // ── COMPACT LIST CARD (used in job list) — matches activity card style exactly ──
  if (!isDetailView) {
    return (
      <>
        <div
          className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden active:scale-[0.99] transition-transform"
          onClick={() => onSelect?.(ticket)}
        >
          {/* Progress bar — same as activity card */}
          <div className="h-1 bg-slate-100">
            <div className="h-1 bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }}/>
          </div>

          <div className="p-5">
            {/* Header — customer name bold, category as subtitle */}
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{ticket.id}</div>
                <h3 className="text-lg font-bold text-slate-900">{ticket.customerName}</h3>
                <div className="text-sm text-slate-500 mt-0.5">
                  {ticket.category}
                  {isWarranty   && <span className="ml-2 text-emerald-600 font-bold text-[10px]">✓ Warranty</span>}
                  {isChargeable && <span className="ml-2 text-amber-600 font-bold text-[10px]">QAR 199</span>}
                </div>
              </div>
              <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${statusColor}`}>
                {ticket.status.replace(/_/g,' ')}
              </span>
            </div>

            {/* Location — same as activity card */}
            <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
              <MapPin size={14} className="text-slate-400 shrink-0"/>
              <span className="truncate flex-1">{ticket.houseNumber || ticket.locationUrl || 'No location set'}</span>
              {ticket.locationUrl && (
                <a href={ticket.locationUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
                  className="shrink-0 flex items-center gap-1 text-[10px] text-blue-600 font-bold px-2 py-1 bg-blue-50 rounded-lg">
                  <Navigation size={10}/> Map
                </a>
              )}
            </div>

            {/* Issue description — same as activity card */}
            {issueText && (
              <div className="bg-slate-50 rounded-xl p-3 mb-4 text-xs text-slate-700 leading-relaxed line-clamp-2">
                {issueText}
              </div>
            )}

            {/* Call customer */}
            {ticket.phoneNumber ? (
              <a href={`tel:${ticket.phoneNumber}`} onClick={e=>e.stopPropagation()}
                className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl font-bold text-xs mb-4 hover:bg-slate-100 transition-colors">
                <Phone size={14}/> Call Customer
              </a>
            ) : (
              <div className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-400 rounded-xl text-xs mb-4">
                <Phone size={14}/> No phone number
              </div>
            )}

            {/* 5-step progress — same for both ticket and activity */}
            {!isCompleted && (
              <div className="flex items-center justify-between px-1">
                {steps.slice(0,4).map((step, i) => (
                  <React.Fragment key={step.key}>
                    <div className="flex flex-col items-center">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                        i < currentStep  ? 'bg-emerald-500 border-emerald-500 text-white' :
                        i === currentStep? 'bg-slate-900 border-slate-900 text-white' :
                        'bg-white border-slate-200 text-slate-400'
                      }`}>{i < currentStep ? '✓' : i+1}</div>
                      <span className={`text-[9px] mt-0.5 font-medium ${i===currentStep?'text-slate-900':'text-slate-400'}`}>{step.label}</span>
                    </div>
                    {i < 3 && <div className={`flex-1 h-0.5 mx-1 mb-3 ${i<currentStep?'bg-emerald-500':'bg-slate-200'}`}/>}
                  </React.Fragment>
                ))}
              </div>
            )}
            {isCompleted && (
              <div className="flex items-center justify-center gap-2 py-2 bg-emerald-50 rounded-xl text-emerald-700 font-bold text-xs">
                <CheckCircle2 size={14}/> Completed
              </div>
            )}
          </div>
        </div>

        {/* Complete modal — only needed if user completes from list (edge case) */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={()=>setIsModalOpen(false)}>
            <div className="bg-white w-full max-w-md rounded-t-[2rem] p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-slate-900">Complete Job</h3>
                <button onClick={()=>setIsModalOpen(false)} className="p-2 bg-slate-100 rounded-full"><X size={20}/></button>
              </div>
              <textarea value={remark} onChange={e=>setRemark(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none mb-4"
                placeholder="Describe what was fixed / installed..." rows={4} autoFocus/>
              <div className="flex items-center gap-2 text-[10px] bg-blue-50 p-3 rounded-lg text-blue-700 mb-4">
                <Clock size={12}/> Customer will receive a WhatsApp notification.
              </div>
              <div className="grid grid-cols-3 gap-3">
                <button onClick={()=>setIsModalOpen(false)} className="py-3.5 rounded-xl font-bold text-slate-500 bg-slate-100">Cancel</button>
                <button onClick={handleFinalize} disabled={remark.length<5}
                  className="col-span-2 py-3.5 rounded-xl font-bold text-white bg-emerald-600 shadow-lg disabled:opacity-50">Mark as Resolved</button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── FULL-SCREEN DETAIL VIEW (used when job is tapped) ──
  return (
    <>
      <div className="flex flex-col h-full overflow-y-auto bg-slate-50">
        {/* Progress bar */}
        <div className="h-1 bg-slate-200 shrink-0">
          <div className="h-1 bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }}/>
        </div>

        <div className="p-5 space-y-4">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{ticket.id}</div>
              <h2 className="text-xl font-bold text-slate-900">{ticket.customerName}</h2>
              <div className="text-sm text-slate-500 mt-0.5">
                {ticket.category}
                {isWarranty   && <span className="ml-2 text-emerald-600 font-bold text-[10px]">✓ Warranty</span>}
                {isChargeable && <span className="ml-2 text-amber-600 font-bold text-[10px]">QAR 199</span>}
              </div>
            </div>
            <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${statusColor}`}>
              {ticket.status.replace(/_/g,' ')}
            </span>
          </div>

          {/* Call */}
          {ticket.phoneNumber && (
            <a href={`tel:${ticket.phoneNumber}`} onClick={e=>e.stopPropagation()}
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-xs hover:bg-slate-100 transition-colors">
              <Phone size={14}/> Call Customer — {ticket.phoneNumber}
            </a>
          )}

          {/* Issue */}
          {issueText && (
            <div className="bg-white rounded-xl p-4 border border-slate-100">
              <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Issue / Scope of Work</div>
              <p className="text-sm text-slate-700 leading-relaxed">{issueText}</p>
            </div>
          )}

          {/* Details grid */}
          <div className="bg-white rounded-xl p-4 border border-slate-100 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 font-medium">Category</span>
              <span className="font-semibold text-slate-700">{ticket.category}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 font-medium">Priority</span>
              <span className={`font-bold ${ticket.priority==='URGENT'?'text-red-600':ticket.priority==='HIGH'?'text-orange-500':'text-slate-600'}`}>{ticket.priority}</span>
            </div>
            {ticket.appointmentTime && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400 font-medium">Appointment</span>
                <span className="font-semibold text-slate-700">
                  {new Date(ticket.appointmentTime).toLocaleDateString('en-GB',{timeZone:'Asia/Qatar',day:'2-digit',month:'short',year:'numeric'})}
                  {' '}{new Date(ticket.appointmentTime).toLocaleTimeString('en-GB',{timeZone:'Asia/Qatar',hour:'2-digit',minute:'2-digit'})}
                </span>
              </div>
            )}
            {(ticket.houseNumber||ticket.locationUrl) && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400 font-medium">Location</span>
                <span className="font-semibold text-slate-700 text-right max-w-[55%] truncate">{ticket.houseNumber||ticket.locationUrl}</span>
              </div>
            )}
          </div>

          {/* Steps */}
          {!isCompleted && (
            <div className="flex items-center justify-between bg-white rounded-xl p-4 border border-slate-100">
              {steps.slice(0,4).map((step,i)=>(
                <React.Fragment key={step.key}>
                  <div className="flex flex-col items-center">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                      i<currentStep?'bg-emerald-500 border-emerald-500 text-white':
                      i===currentStep?'bg-slate-900 border-slate-900 text-white':
                      'bg-white border-slate-200 text-slate-400'
                    }`}>{i<currentStep?'✓':i+1}</div>
                    <span className={`text-[9px] mt-1 font-medium ${i===currentStep?'text-slate-900':'text-slate-400'}`}>{step.label}</span>
                  </div>
                  {i<3 && <div className={`flex-1 h-0.5 mx-2 mb-3 ${i<currentStep?'bg-emerald-500':'bg-slate-200'}`}/>}
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Navigate + Photos */}
          <div className="grid grid-cols-2 gap-3">
            {ticket.locationUrl ? (
              <a href={ticket.locationUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
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
            <div className="flex flex-col items-center justify-center p-3 bg-white border border-slate-200 rounded-xl text-slate-600">
              <Camera size={22} className="mb-1"/>
              <span className="text-xs font-semibold">Photos</span>
            </div>
          </div>

          {/* Action */}
          <div className="pb-6">
            {actionConfig && !isCompleted && (
              <button onClick={handleAction}
                className={`w-full py-4 rounded-2xl font-bold shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2 ${actionConfig.color}`}>
                {actionConfig.icon} {actionConfig.label}
              </button>
            )}
            {isCompleted && (
              <div className="flex items-center justify-center gap-2 py-4 bg-emerald-50 rounded-2xl text-emerald-700 font-bold">
                <CheckCircle2 size={20}/> Job Completed
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Complete modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={()=>setIsModalOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-t-[2rem] p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-900">Complete Job</h3>
              <button onClick={()=>setIsModalOpen(false)} className="p-2 bg-slate-100 rounded-full"><X size={20}/></button>
            </div>
            <textarea value={remark} onChange={e=>setRemark(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none mb-4"
              placeholder="Describe what was fixed / installed..." rows={4} autoFocus/>
            <div className="flex items-center gap-2 text-[10px] bg-blue-50 p-3 rounded-lg text-blue-700 mb-4">
              <Clock size={12}/> Customer will receive a WhatsApp notification.
            </div>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={()=>setIsModalOpen(false)} className="py-3.5 rounded-xl font-bold text-slate-500 bg-slate-100">Cancel</button>
              <button onClick={handleFinalize} disabled={remark.length<5}
                className="col-span-2 py-3.5 rounded-xl font-bold text-white bg-emerald-600 shadow-lg disabled:opacity-50">Mark as Resolved</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

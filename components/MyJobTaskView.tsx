
import React, { useState } from 'react';
import { Ticket, TicketStatus, TicketType } from '../types';
import { Phone, MapPin, ShieldCheck, CheckCircle2, Clock, X, Navigation, Play, Car, Home } from 'lucide-react';

interface MyJobTaskViewProps {
  ticket: Ticket;
  onUpdateStatus: (ticketId: string, status: TicketStatus, note?: string) => void;
  onSelect?: (ticket: Ticket) => void;
}

export const MyJobTaskView: React.FC<MyJobTaskViewProps> = ({ ticket, onUpdateStatus, onSelect }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [remark, setRemark] = useState('');

  const isWarranty  = ticket.type === TicketType.WARRANTY;
  const isChargeable = ticket.type === TicketType.CHARGEABLE;

  // Full field execution flow matching activity flow:
  // ASSIGNED → ON_MY_WAY → ARRIVED → IN_PROGRESS → RESOLVED
  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    switch (ticket.status) {
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
      case TicketStatus.ASSIGNED:
        return { label: 'On My Way', icon: <Car size={18}/>, color: 'bg-blue-600 text-white' };
      case TicketStatus.ON_MY_WAY:
        return { label: 'Arrived at Site', icon: <Home size={18}/>, color: 'bg-indigo-600 text-white' };
      case TicketStatus.ARRIVED:
        return { label: 'Start Work', icon: <Play size={18} className="fill-current"/>, color: 'bg-amber-500 text-white' };
      case TicketStatus.IN_PROGRESS:
        return { label: 'Complete Job', icon: <CheckCircle2 size={18}/>, color: 'bg-emerald-600 text-white' };
      default: return null;
    }
  };

  const actionConfig = getActionConfig();
  const isCompleted = ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CANCELLED;

  const steps = [
    { key: TicketStatus.ASSIGNED,    label: 'Assigned' },
    { key: TicketStatus.ON_MY_WAY,   label: 'On Way'   },
    { key: TicketStatus.ARRIVED,     label: 'Arrived'  },
    { key: TicketStatus.IN_PROGRESS, label: 'Working'  },
    { key: TicketStatus.RESOLVED,    label: 'Done'     },
  ];
  const currentStep = steps.findIndex(s => s.key === ticket.status);
  const progress = isCompleted ? 100 : Math.max(5, ((currentStep + 1) / steps.length) * 100);

  const issueText = (ticket.messages as any[])?.find((m: any) => m.sender === 'CLIENT')?.content
    || (ticket as any).notes
    || (ticket as any).ai_summary
    || ticket.category;

  return (
    <div
      className="bg-white rounded-2xl border border-slate-100 shadow-sm mb-4 overflow-hidden active:scale-[0.99] transition-transform"
      onClick={() => onSelect?.(ticket)}
    >
      {/* Progress bar */}
      <div className="h-1 bg-slate-100">
        <div className="h-1 bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }}/>
      </div>

      <div className="p-5">
        {/* Header */}
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{ticket.id}</div>
            <h3 className="text-lg font-bold text-slate-900">{ticket.customerName}</h3>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
              ticket.status === TicketStatus.ASSIGNED    ? 'bg-purple-100 text-purple-700' :
              ticket.status === TicketStatus.ON_MY_WAY  ? 'bg-cyan-100 text-cyan-700' :
              ticket.status === TicketStatus.ARRIVED    ? 'bg-indigo-100 text-indigo-700' :
              ticket.status === TicketStatus.IN_PROGRESS? 'bg-amber-100 text-amber-700' :
              ticket.status === TicketStatus.RESOLVED   ? 'bg-emerald-100 text-emerald-700' :
              'bg-slate-100 text-slate-600'
            }`}>
              {ticket.status.replace(/_/g, ' ')}
            </span>
            {isChargeable && <span className="text-[10px] font-bold text-amber-600">QAR 199</span>}
            {isWarranty && (
              <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                <ShieldCheck size={10}/> Warranty
              </span>
            )}
          </div>
        </div>

        {/* Location */}
        <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
          <MapPin size={14} className="text-slate-400 shrink-0"/>
          <span className="truncate flex-1">{ticket.houseNumber || ticket.locationUrl || 'No location set'}</span>
          {ticket.locationUrl && (
            <a
              href={ticket.locationUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="shrink-0 flex items-center gap-1 text-[10px] text-blue-600 font-bold px-2 py-1 bg-blue-50 rounded-lg"
            >
              <Navigation size={10}/> Map
            </a>
          )}
        </div>

        {/* Issue description */}
        <div className="bg-slate-50 rounded-xl p-3 mb-4 text-xs text-slate-700 leading-relaxed line-clamp-2">
          {issueText}
        </div>

        {/* Chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {ticket.type && <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg">{ticket.type}</span>}
          <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg">{ticket.category}</span>
        </div>

        {/* Call */}
        <a
          href={`tel:${ticket.phoneNumber}`}
          onClick={e => e.stopPropagation()}
          className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl font-bold text-xs mb-4 hover:bg-slate-100 transition-colors"
        >
          <Phone size={14}/> Call Customer
        </a>

        {/* Step progress dots */}
        {!isCompleted && (
          <div className="flex items-center justify-between mb-4 px-1">
            {steps.slice(0, 4).map((step, i) => (
              <React.Fragment key={step.key}>
                <div className="flex flex-col items-center">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                    i < currentStep  ? 'bg-emerald-500 border-emerald-500 text-white' :
                    i === currentStep? 'bg-slate-900 border-slate-900 text-white' :
                    'bg-white border-slate-200 text-slate-400'
                  }`}>
                    {i < currentStep ? '✓' : i + 1}
                  </div>
                  <span className={`text-[9px] mt-0.5 font-medium ${i === currentStep ? 'text-slate-900' : 'text-slate-400'}`}>
                    {step.label}
                  </span>
                </div>
                {i < 3 && <div className={`flex-1 h-0.5 mx-1 mb-3 ${i < currentStep ? 'bg-emerald-500' : 'bg-slate-200'}`}/>}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Action button */}
        {actionConfig && !isCompleted && (
          <button
            onClick={handleAction}
            className={`w-full py-3.5 rounded-2xl font-bold text-sm shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2 ${actionConfig.color}`}
          >
            {actionConfig.icon} {actionConfig.label}
          </button>
        )}

        {isCompleted && (
          <div className="flex items-center justify-center gap-2 py-3 bg-emerald-50 rounded-xl text-emerald-700 font-bold text-sm">
            <CheckCircle2 size={18}/> Job Completed
          </div>
        )}
      </div>

      {/* Finalize modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-white w-full max-w-md rounded-t-[2rem] p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-900">Complete Job</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-500">
                <X size={20}/>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                  Work Done <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={remark}
                  onChange={e => setRemark(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  placeholder="Describe what was fixed / installed..."
                  rows={4}
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2 text-[10px] bg-blue-50 p-3 rounded-lg text-blue-700">
                <Clock size={12}/>
                Customer will receive a WhatsApp notification with your remarks.
              </div>
              <div className="grid grid-cols-3 gap-3 pt-2">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="py-3.5 rounded-xl font-bold text-slate-500 bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFinalize}
                  disabled={remark.length < 5}
                  className="col-span-2 py-3.5 rounded-xl font-bold text-white bg-emerald-600 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Mark as Resolved
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

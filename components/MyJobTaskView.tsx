
import React, { useState } from 'react';
import { Ticket, TicketStatus, TicketType } from '../types';
import { Phone, MessageCircle, MapPin, ShieldCheck, CheckCircle2, Clock, X } from 'lucide-react';

interface MyJobTaskViewProps {
  ticket: Ticket;
  onUpdateStatus: (ticketId: string, status: TicketStatus, note?: string) => void;
}

export const MyJobTaskView: React.FC<MyJobTaskViewProps> = ({ ticket, onUpdateStatus }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [remark, setRemark] = useState('');

  const isWarranty = ticket.type === TicketType.WARRANTY;
  const isChargeable = ticket.type === TicketType.CHARGEABLE;
  const fee = isChargeable ? 'QAR 199' : 'FREE';

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (ticket.status === TicketStatus.NEW || ticket.status === TicketStatus.OPEN) {
      onUpdateStatus(ticket.id, TicketStatus.ASSIGNED);
    } else if (ticket.status === TicketStatus.ASSIGNED) {
      onUpdateStatus(ticket.id, TicketStatus.ON_MY_WAY);
    } else if (ticket.status === TicketStatus.ON_MY_WAY) {
      onUpdateStatus(ticket.id, TicketStatus.ARRIVED);
    } else if (ticket.status === TicketStatus.ARRIVED) {
      setIsModalOpen(true);
    }
  };

  const handleFinalize = () => {
    if (remark.length < 5) return;
    onUpdateStatus(ticket.id, TicketStatus.RESOLVED, remark);
    setIsModalOpen(false);
  };

  const getButtonText = () => {
    switch (ticket.status) {
      case TicketStatus.NEW:
      case TicketStatus.OPEN: return 'Accept & Start Journey';
      case TicketStatus.ASSIGNED: return 'Update: On My Way';
      case TicketStatus.ON_MY_WAY: return 'Update: Arrived';
      case TicketStatus.ARRIVED: return 'Finalize & Mark Done';
      case TicketStatus.RESOLVED: return 'Job Completed';
      default: return null;
    }
  };

  const btnText = getButtonText();
  const isCompleted = ticket.status === TicketStatus.RESOLVED;

  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm mb-4 relative overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{ticket.id}</div>
          <h3 className="text-lg font-bold text-slate-900">{ticket.customerName}</h3>
        </div>
        {isCompleted ? (
           <div className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
             <CheckCircle2 size={14}/> Done
           </div>
        ) : (
           <div className="flex flex-col items-end gap-1">
             <span className={`px-3 py-1 rounded-full text-[10px] font-bold border ${
                isChargeable ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-blue-50 text-blue-700 border-blue-100'
             }`}>
               {fee}
             </span>
             {isWarranty && (
               <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                 <ShieldCheck size={10}/> Warranty
               </span>
             )}
           </div>
        )}
      </div>

      {/* Location */}
      <div className="flex items-center gap-2 text-sm text-slate-600 mb-4">
        <MapPin size={16} className="text-slate-400 shrink-0" />
        <span className="truncate">{ticket.houseNumber || ticket.locationUrl || 'No location set'}</span>
      </div>

      {/* Type Chip */}
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg">
          {ticket.type}
        </span>
        <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg">
          {ticket.category}
        </span>
      </div>

      {/* Issue Description */}
      {(ticket.messages?.find((m: any) => m.sender === 'CLIENT')?.content || (ticket as any).notes || (ticket as any).ai_summary) && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
          <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">Issue Description</p>
          <p className="text-xs text-slate-700 leading-relaxed">
            {ticket.messages?.find((m: any) => m.sender === 'CLIENT')?.content
              || (ticket as any).notes
              || (ticket as any).ai_summary}
          </p>
        </div>
      )}

      {/* Actions Row */}
      <div className="flex gap-3 mb-4">
        <a href={`tel:${ticket.phoneNumber}`} className="flex-1 py-2.5 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors">
          <Phone size={14} /> Call
        </a>
        <button className="flex-1 py-2.5 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors">
          <MessageCircle size={14} /> Chat
        </button>
      </div>

      {/* Messages Preview */}
      {ticket.messages.length > 0 && (
        <div className="bg-slate-50 rounded-xl p-3 mb-4 space-y-2">
          {ticket.messages.slice(-2).map(m => (
            <div key={m.id} className="text-xs text-slate-600 flex gap-2">
              <span className="font-bold shrink-0 text-slate-400">{m.sender === 'CLIENT' ? 'Client:' : 'You:'}</span>
              <span className="truncate">{m.content}</span>
            </div>
          ))}
        </div>
      )}

      {/* Workflow Button */}
      {btnText && !isCompleted && (
        <button 
          onClick={handleAction}
          className="w-full py-3.5 bg-slate-900 text-white rounded-2xl font-bold text-sm shadow-lg shadow-slate-900/10 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
        >
          {btnText}
        </button>
      )}

      {/* Remarks Modal (Bottom Sheet) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setIsModalOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-t-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-900">Finalize Job</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-500">
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Job Remarks <span className="text-red-500">*</span></label>
                <textarea 
                  value={remark}
                  onChange={e => setRemark(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  placeholder="Describe work done..."
                  rows={4}
                  autoFocus
                />
              </div>
              
              <div className="flex items-center gap-2 text-[10px] text-slate-500 bg-blue-50 p-3 rounded-lg text-blue-700">
                <Clock size={12} />
                Client will receive WhatsApp notification with your remarks.
              </div>

              <div className="grid grid-cols-3 gap-3 pt-2">
                <button onClick={() => setIsModalOpen(false)} className="py-3.5 rounded-xl font-bold text-slate-500 bg-slate-100">
                  Cancel
                </button>
                <button 
                  onClick={handleFinalize}
                  disabled={remark.length < 5}
                  className="col-span-2 py-3.5 rounded-xl font-bold text-white bg-emerald-600 shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Complete Job
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

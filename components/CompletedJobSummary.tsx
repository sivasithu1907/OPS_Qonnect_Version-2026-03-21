
import React from 'react';
import { Ticket, Activity, Technician, Customer } from '../types';
import { 
  User, Phone, MapPin, Calendar, Clock, CheckCircle2, 
  X, ExternalLink, Camera, RotateCcw, MessageSquare, 
  Briefcase, UserCheck, Image as ImageIcon, AlertTriangle
} from 'lucide-react';

interface CompletedJobSummaryProps {
  type: 'ticket' | 'activity';
  item: Ticket | Activity;
  technicians: Technician[];
  customers: Customer[];
  onClose: () => void;
}

const CompletedJobSummary: React.FC<CompletedJobSummaryProps> = ({ type, item, technicians, customers, onClose }) => {
  const d = item as any;
  const isTicket = type === 'ticket';
  
  // Resolve customer
  const customer = isTicket 
    ? customers.find(c => c.id === (item as Ticket).customerId) 
    : customers.find(c => c.id === (item as Activity).customerId);
  
  // Resolve assigned tech
  const assignedTech = isTicket
    ? technicians.find(t => t.id === (item as Ticket).assignedTechId)
    : technicians.find(t => t.id === (d.primaryEngineerId || (item as Activity).leadTechId));
  
  const plannedLead = !isTicket ? technicians.find(t => t.id === (item as Activity).leadTechId) : null;
  const salesLead = !isTicket ? technicians.find(t => t.id === d.salesLeadId) : null;
  const assistants = !isTicket ? (d.assistantTechIds || []).map((id: string) => technicians.find(t => t.id === id)).filter(Boolean) : [];
  const supportEngineers = !isTicket ? (d.supportingEngineerIds || []).filter((id: string) => !(d.assistantTechIds || []).includes(id) && id !== d.primaryEngineerId).map((id: string) => technicians.find(t => t.id === id)).filter(Boolean) : [];
  const freelancers = d.freelancers || [];
  const photos = d.photos || [];
  const visitHistory = d.visitHistory || [];

  // Timing
  const startedAt = d.startedAt;
  const completedAt = d.completedAt;
  const actualDuration = startedAt && completedAt 
    ? Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60000) 
    : null;

  const fmtTime = (iso: string) => iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Qatar', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (iso: string) => `${fmtDate(iso)} at ${fmtTime(iso)}`;

  const statusColor = 
    d.status === 'DONE' || d.status === 'RESOLVED' ? 'bg-emerald-500' :
    d.status === 'CARRY_FORWARD' ? 'bg-orange-500' :
    d.status === 'CANCELLED' ? 'bg-slate-500' : 'bg-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${statusColor}`} />
            <div>
              <div className="text-xs font-mono text-slate-400">{isTicket ? d.id : d.reference}</div>
              <h3 className="font-bold text-lg text-slate-900">{isTicket ? d.category : d.type}</h3>
              {d.serviceCategory && <div className="text-xs text-slate-500">{d.serviceCategory}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1.5 rounded-full text-xs font-bold text-white ${statusColor}`}>
              {(d.status || '').replace(/_/g, ' ')}
            </span>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
              <X size={18} className="text-slate-400" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          
          {/* Customer */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><User size={10} /> Customer</h4>
            <div className="text-sm font-bold text-slate-800">{customer?.name || (isTicket ? (item as Ticket).customerName : 'Unknown')}</div>
            {(isTicket ? (item as Ticket).phoneNumber : customer?.phone) && (
              <div className="text-xs text-slate-500 flex items-center gap-1"><Phone size={10} /> {isTicket ? (item as Ticket).phoneNumber : customer?.phone}</div>
            )}
          </div>

          {/* Service Info */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><Briefcase size={10} /> Service Details</h4>
            <div className="grid grid-cols-2 gap-3">
              {isTicket && (
                <>
                  <div><span className="text-[10px] text-slate-400 block">Type</span><span className="text-xs font-medium text-slate-700">{d.type || '—'}</span></div>
                  <div><span className="text-[10px] text-slate-400 block">Category</span><span className="text-xs font-medium text-slate-700">{d.category}</span></div>
                </>
              )}
              {!isTicket && (
                <>
                  <div><span className="text-[10px] text-slate-400 block">Activity Type</span><span className="text-xs font-medium text-slate-700">{d.type}</span></div>
                  <div><span className="text-[10px] text-slate-400 block">Service Category</span><span className="text-xs font-medium text-slate-700">{d.serviceCategory || '—'}</span></div>
                </>
              )}
              <div><span className="text-[10px] text-slate-400 block">Priority</span><span className={`text-xs font-bold ${d.priority === 'URGENT' ? 'text-red-600' : d.priority === 'HIGH' ? 'text-orange-500' : 'text-slate-600'}`}>{d.priority}</span></div>
              {!isTicket && d.durationHours && (
                <div><span className="text-[10px] text-slate-400 block">Planned Duration</span><span className="text-xs font-medium text-slate-700">{d.durationHours}h</span></div>
              )}
            </div>
          </div>

          {/* Timing */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><Clock size={10} /> Timing</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[10px] text-slate-400 block">{isTicket ? 'Created' : 'Planned Date'}</span>
                <span className="text-xs font-medium text-slate-700">{fmtDateTime(isTicket ? d.createdAt : d.plannedDate)}</span>
              </div>
              {startedAt && (
                <div>
                  <span className="text-[10px] text-slate-400 block">Actual Start</span>
                  <span className="text-xs font-medium text-emerald-700">{fmtDateTime(startedAt)}</span>
                </div>
              )}
              {completedAt && (
                <div>
                  <span className="text-[10px] text-slate-400 block">Actual Completion</span>
                  <span className="text-xs font-medium text-emerald-700">{fmtDateTime(completedAt)}</span>
                </div>
              )}
              {actualDuration !== null && (
                <div>
                  <span className="text-[10px] text-slate-400 block">Actual Duration</span>
                  <span className="text-xs font-bold text-slate-800">{actualDuration >= 60 ? `${Math.floor(actualDuration/60)}h ${actualDuration%60}m` : `${actualDuration}m`}</span>
                </div>
              )}
            </div>
          </div>

          {/* Location */}
          {(d.houseNumber || d.locationUrl) && (
            <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100 space-y-2">
              <h4 className="text-[10px] font-bold text-blue-700 uppercase flex items-center gap-1"><MapPin size={10} /> Location</h4>
              {d.houseNumber && <div className="text-xs font-medium text-slate-700">{d.houseNumber}</div>}
              {d.locationUrl && (
                <a href={d.locationUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:underline">
                  <ExternalLink size={10} /> Open Map
                </a>
              )}
            </div>
          )}

          {/* Assigned Resources */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><UserCheck size={10} /> Assigned Resources</h4>
            <div className="space-y-2">
              {assignedTech && (
                <div className="flex items-center gap-2">
                  <img src={assignedTech.avatar} className="w-7 h-7 rounded-full bg-slate-200 object-cover" alt="" />
                  <div>
                    <div className="text-xs font-bold text-slate-800">{assignedTech.name}</div>
                    <div className="text-[10px] text-slate-400">{isTicket ? 'Assigned Engineer' : 'Primary Engineer'}</div>
                  </div>
                </div>
              )}
              {plannedLead && plannedLead.id !== assignedTech?.id && (
                <div className="flex items-center gap-2 text-xs"><div className="w-2 h-2 rounded-full bg-purple-500" /><span className="text-slate-700">{plannedLead.name}</span><span className="text-[10px] text-slate-400">Planned Lead</span></div>
              )}
              {salesLead && (
                <div className="flex items-center gap-2 text-xs"><div className="w-2 h-2 rounded-full bg-indigo-500" /><span className="text-indigo-700">{salesLead.name}</span><span className="text-[10px] text-slate-400">Sales Lead</span></div>
              )}
              {assistants.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 text-xs"><div className="w-2 h-2 rounded-full bg-teal-500" /><span className="text-slate-700">{a.name}</span><span className="text-[10px] text-slate-400">Technical Associate</span></div>
              ))}
              {supportEngineers.map((se: any) => (
                <div key={se.id} className="flex items-center gap-2 text-xs"><div className="w-2 h-2 rounded-full bg-blue-400" /><span className="text-slate-700">{se.name}</span><span className="text-[10px] text-slate-400">Supporting Engineer</span></div>
              ))}
              {freelancers.map((fl: any, i: number) => (
                <div key={`fl-${i}`} className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-amber-800 font-medium">{fl.name}</span>
                  <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 rounded border border-amber-200">FL{fl.role ? ` · ${fl.role === 'FIELD_ENGINEER' ? 'FE' : 'TA'}` : ''}</span>
                </div>
              ))}
              {!assignedTech && !plannedLead && freelancers.length === 0 && (
                <div className="text-xs text-slate-400 italic">No resources assigned</div>
              )}
            </div>
          </div>

          {/* Description / Scope */}
          {(d.description || (isTicket && d.messages)) && (
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-1 flex items-center gap-1"><MessageSquare size={10} /> {isTicket ? 'Issue / Scope' : 'Description'}</h4>
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                {isTicket 
                  ? (d.messages?.find((m: any) => m.sender === 'CLIENT')?.content || d.ai_summary || d.notes || d.category)
                  : d.description}
              </p>
            </div>
          )}

          {/* Remarks & Completion Notes */}
          {(d.remarks || d.completionNote || d.notes || d.assignmentNote) && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase">Notes & Completion Summary</h4>
              {d.completionNote && (
                <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                  <div className="text-[10px] font-bold text-emerald-600 uppercase mb-1 flex items-center gap-1"><CheckCircle2 size={10} /> Completion Summary</div>
                  <p className="text-xs text-emerald-800 whitespace-pre-wrap leading-relaxed">{d.completionNote}</p>
                </div>
              )}
              {(d.remarks || d.notes) && (d.remarks || d.notes) !== d.completionNote && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Remarks</div>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap">{d.remarks || d.notes}</p>
                </div>
              )}
              {d.assignmentNote && (
                <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                  <div className="text-[10px] font-bold text-indigo-500 uppercase mb-1">Assignment Note</div>
                  <p className="text-xs text-indigo-800 whitespace-pre-wrap">{d.assignmentNote}</p>
                </div>
              )}
            </div>
          )}

          {/* Carry Forward Info */}
          {d.carryForwardNote && (
            <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 space-y-2">
              <h4 className="text-[10px] font-bold text-amber-600 uppercase flex items-center gap-1"><RotateCcw size={10} /> Carry Forward</h4>
              <p className="text-xs text-amber-800 whitespace-pre-wrap leading-relaxed">{d.carryForwardNote}</p>
              {d.nextPlannedAt && (
                <div className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                  <Calendar size={10} /> Re-scheduled: {fmtDateTime(d.nextPlannedAt)}
                </div>
              )}
            </div>
          )}

          {/* Cancellation Reason */}
          {d.cancellationReason && (
            <div className="bg-red-50 rounded-xl p-4 border border-red-100">
              <div className="text-[10px] font-bold text-red-500 uppercase mb-1 flex items-center gap-1"><AlertTriangle size={10} /> Cancellation Reason</div>
              <p className="text-xs text-red-700 whitespace-pre-wrap">{d.cancellationReason}</p>
            </div>
          )}

          {/* Visit History */}
          {visitHistory.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><Clock size={10} /> Visit History ({visitHistory.length} visits)</h4>
              <div className="relative border-l-2 border-slate-200 ml-2 space-y-3">
                {visitHistory.map((visit: any, i: number) => (
                  <div key={i} className="relative pl-5">
                    <div className={`absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-white shadow-sm ${
                      visit.status === 'DONE' ? 'bg-emerald-500' : visit.status === 'CARRY_FORWARD' ? 'bg-orange-500' : 'bg-slate-400'
                    }`} />
                    <div className="bg-slate-50 rounded-lg p-3 border border-slate-100 text-xs space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-700">Visit {i + 1}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          visit.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'
                        }`}>{(visit.status || '').replace(/_/g, ' ')}</span>
                      </div>
                      <div className="text-slate-500">{visit.date ? fmtDate(visit.date) : '—'}</div>
                      {visit.startedAt && <div className="text-slate-500">Start: {fmtTime(visit.startedAt)}</div>}
                      {visit.completedAt && <div className="text-slate-500">End: {fmtTime(visit.completedAt)}</div>}
                      {visit.remarks && <div className="text-slate-600 mt-1">{visit.remarks}</div>}
                      {visit.carryForwardReason && <div className="text-amber-700 mt-1">CF: {visit.carryForwardReason}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Completion Photos */}
          {photos.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><Camera size={10} /> Completion Photos ({photos.length})</h4>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo: any, i: number) => (
                  <div key={i} className="relative group">
                    <img 
                      src={photo.url || photo} 
                      alt={photo.name || `Photo ${i + 1}`}
                      className="w-full h-24 object-cover rounded-lg border border-slate-200 cursor-pointer hover:shadow-lg transition-shadow"
                      onClick={() => window.open(photo.url || photo, '_blank')}
                    />
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[8px] px-1.5 py-0.5 rounded-b-lg truncate">
                      {photo.name || `Photo ${i + 1}`}
                      {photo.takenAt && ` · ${fmtTime(photo.takenAt)}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* External Refs */}
          {d.odooLink && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Odoo:</span>
              <a href={d.odooLink} target="_blank" rel="noreferrer" className="text-purple-600 hover:underline truncate">{d.odooLink}</a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0">
          <button onClick={onClose} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompletedJobSummary;

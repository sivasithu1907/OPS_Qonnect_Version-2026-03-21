/**
 * SalesAppointmentRequests.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Full-feature page for the Sales Appointment Request workflow.
 *
 * SALES users  : create + edit their own PENDING_SCHEDULING requests; read-only
 *                view of all other requests; cannot set date/time or engineer.
 * TEAM_LEAD /
 * ADMIN users  : see all requests; schedule (date/time + engineer); convert to
 *                planned Activity via POST /api/sales-appointment-requests/:id/schedule
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import toast from './Toast';
import {
  Plus, Search, X, Calendar, Clock, User as UserIcon,
  MapPin, Phone, FileText, Tag, ChevronDown, ChevronUp,
  CheckCircle2, AlertCircle, Loader2, Edit2, Eye,
  ClipboardList, RefreshCw, Filter, Building, ExternalLink,
  CalendarCheck, Users, ArrowRight, Inbox, Trash2,
  LayoutList, LayoutGrid, ChevronLeft, ChevronRight as ChevronRightIcon,
  KeyRound, EyeOff, Eye as EyeIcon
} from 'lucide-react';
import { Role, SalesAppointmentRequest, SalesRequestStatus, Technician } from '../types';
import { INPUT_STYLES, SEARCH_INPUT_STYLES, SALES_ACTIVITY_TYPES, SERVICE_CATEGORIES } from '../constants';
import api from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CurrentUser {
  id: string;
  techId?: string;
  name: string;
  email: string;
  role: string;
}

interface Props {
  currentUser: CurrentUser;
  technicians: Technician[];
  activities?: any[]; // For resource occupancy calendar
  onActivityCreated?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<SalesRequestStatus, { label: string; color: string; bg: string; dot: string }> = {
  PENDING_SCHEDULING: { label: 'Pending Scheduling', color: 'text-amber-700',  bg: 'bg-amber-50  border-amber-200',  dot: 'bg-amber-400'  },
  SCHEDULED:          { label: 'Scheduled',          color: 'text-blue-700',   bg: 'bg-blue-50   border-blue-200',   dot: 'bg-blue-500'   },
  IN_PROGRESS:        { label: 'In Progress',         color: 'text-amber-700',  bg: 'bg-amber-50  border-amber-200',  dot: 'bg-amber-500'  },
  COMPLETED:          { label: 'Completed',           color: 'text-emerald-700',bg: 'bg-emerald-50 border-emerald-200',dot: 'bg-emerald-500'},
  DONE:               { label: 'Done',                color: 'text-emerald-700',bg: 'bg-emerald-50 border-emerald-200',dot: 'bg-emerald-500'},
  CANCELLED:          { label: 'Cancelled',           color: 'text-slate-500',  bg: 'bg-slate-50  border-slate-200',  dot: 'bg-slate-400'  },
};

const EMPTY_FORM = {
  customerName: '',
  contactNumber: '+974 ',
  locationUrl: '',
  houseNumber: '',
  odooReference: '',
  activityType: 'Installation',
  serviceCategory: [] as string[],
  remarks: '',
};

// ─── Helper ───────────────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: SalesRequestStatus }) => {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING_SCHEDULING;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.color} ${cfg.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
};

const FieldError = ({ msg }: { msg?: string }) =>
  msg ? <p className="mt-1 text-xs text-red-600">{msg}</p> : null;

// ─── Main Component ───────────────────────────────────────────────────────────

const SalesAppointmentRequests: React.FC<Props> = ({ currentUser, technicians, activities = [], onActivityCreated }) => {
  const isSales     = currentUser.role === Role.SALES;
  const isScheduler = currentUser.role === Role.ADMIN || currentUser.role === Role.TEAM_LEAD;
  const myId        = currentUser.techId || currentUser.id;

  // ── State ──────────────────────────────────────────────────────────────────
  const [requests, setRequests]       = useState<SalesAppointmentRequest[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [searchQ, setSearchQ]         = useState('');
  const [statusFilter, setStatusFilter] = useState<SalesRequestStatus | 'ALL'>('ALL');
  // View toggle + calendar month
  const [view, setView]               = useState<'list' | 'calendar'>('list');
  // Sales: "my requests" tab vs "all requests" tab
  const [myOnly, setMyOnly]           = useState<boolean>(true);
  // Calendar day popup — managed inside CalendarView component
  const [calMonth, setCalMonth]       = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Create / Edit form
  const [showForm, setShowForm]       = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [formData, setFormData]       = useState({ ...EMPTY_FORM });
  const [formErrors, setFormErrors]   = useState<Record<string, string>>({});
  const [submitting, setSubmitting]   = useState(false);

  // Customer search
  const [custSearch, setCustSearch]   = useState('');
  const [custResults, setCustResults] = useState<any[]>([]);
  const [custLoading, setCustLoading] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>();

  // Schedule modal (TEAM_LEAD / ADMIN only)
  const [scheduleTarget, setScheduleTarget] = useState<SalesAppointmentRequest | null>(null);
  const [schedForm, setSchedForm] = useState({
    scheduledDate: '',
    scheduledStartTime: '',
    assistantTechIds: [] as string[],
    assignedFieldEngineerId: '',
    durationHours: '2',
  });
  const [schedErrors, setSchedErrors] = useState<Record<string, string>>({});
  const [scheduling, setScheduling]   = useState(false);

  // Detail drawer
  const [detailItem, setDetailItem]   = useState<SalesAppointmentRequest | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<SalesAppointmentRequest | null>(null);
  const [deleting, setDeleting]         = useState(false);

  // (Password change handled in App.tsx header key icon for SALES)

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api.get('/api/sales-appointment-requests');
      setRequests(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // ── Customer search by phone number (debounced) ───────────────────────────
  useEffect(() => {
    // Strip non-digits for search, need at least 4 local digits
    const digits = custSearch.replace(/[^0-9]/g, '');
    if (digits.length < 4) { setCustResults([]); return; }
    const t = setTimeout(async () => {
      setCustLoading(true);
      try {
        const all = await api.get('/api/customers');
        // Normalise both sides: digits only
        const normalise = (v: string) => (v || '').replace(/[^0-9]/g, '');
        const q = normalise(custSearch);
        setCustResults(
          (all as any[]).filter((c: any) =>
            normalise(c.phone || '').includes(q)
          ).slice(0, 8)
        );
      } catch { /* silent */ }
      finally { setCustLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [custSearch]);

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return requests.filter(r => {
      // Sales "My Requests" tab: show only own requests
      if (isSales && myOnly && r.createdBy !== myId) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (searchQ.trim()) {
        const q = searchQ.toLowerCase();
        if (
          !r.customerName.toLowerCase().includes(q) &&
          !r.contactNumber.includes(q) &&
          !r.salesLeadName.toLowerCase().includes(q) &&
          !r.odooReference.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [requests, statusFilter, searchQ, isSales, myOnly, myId]);

  const pendingCount = useMemo(
    () => requests.filter(r => r.status === SalesRequestStatus.PENDING_SCHEDULING).length,
    [requests]
  );

  // ── Form helpers ───────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingId(null);
    setFormData({ ...EMPTY_FORM });
    setFormErrors({});
    setCustSearch('');
    setCustResults([]);
    setSelectedCustomerId(undefined);
    setShowForm(true);
  };

  const openEdit = (r: SalesAppointmentRequest) => {
    setEditingId(r.id);
    setFormData({
      customerName:   r.customerName,
      contactNumber:  r.contactNumber,
      locationUrl:    r.locationUrl,
      houseNumber:    r.houseNumber,
      odooReference:  r.odooReference,
      activityType:   r.activityType,
      serviceCategory: r.serviceCategory ? r.serviceCategory.split(', ').filter(Boolean) : [],
      remarks:        r.remarks || '',
    });
    setSelectedCustomerId(r.customerId);
    setCustSearch(r.contactNumber);   // phone-first — seed search from contact number
    setCustResults([]);
    setFormErrors({});
    setShowForm(true);
  };

  const selectCustomer = (c: any) => {
    setSelectedCustomerId(c.id);
    setCustSearch(c.phone || '');   // keep search state in sync with phone
    setCustResults([]);
    setFormData(prev => ({
      ...prev,
      customerName:  c.name || '',
      contactNumber: c.phone || prev.contactNumber,
      locationUrl:   c.address || prev.locationUrl,
      houseNumber:   c.buildingNumber || c.building_number || prev.houseNumber,
    }));
  };

  const toggleServiceCat = (cat: string) => {
    setFormData(prev => ({
      ...prev,
      serviceCategory: prev.serviceCategory.includes(cat)
        ? prev.serviceCategory.filter(c => c !== cat)
        : [...prev.serviceCategory, cat],
    }));
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!formData.customerName.trim())   errs.customerName  = 'Customer name is required';
    const phoneDigits = formData.contactNumber.replace(/[^0-9]/g, '');
    if (phoneDigits.length < 8)          errs.contactNumber = 'Enter a valid phone number (min 8 digits)';
    if (!formData.locationUrl.trim())    errs.locationUrl   = 'Location URL is required';
    if (!formData.houseNumber.trim())    errs.houseNumber   = 'House/Building number is required';
    if (!formData.odooReference.trim())  errs.odooReference = 'Odoo Reference is required';
    if (!formData.activityType)          errs.activityType  = 'Activity type is required';
    if (formData.serviceCategory.length === 0) errs.serviceCategory = 'Select at least one service category';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      const payload = {
        customerId:      selectedCustomerId,
        customerName:    formData.customerName.trim(),
        contactNumber:   formData.contactNumber.trim(),
        locationUrl:     formData.locationUrl.trim(),
        houseNumber:     formData.houseNumber.trim(),
        odooReference:   formData.odooReference.trim(),
        activityType:    formData.activityType,
        serviceCategory: formData.serviceCategory.join(', '),
        remarks:         formData.remarks.trim() || null,
      };
      if (editingId) {
        await api.put(`/api/sales-appointment-requests/${editingId}`, payload);
      } else {
        await api.post('/api/sales-appointment-requests', payload);
      }
      setShowForm(false);
      fetchRequests();
    } catch (e: any) {
      setFormErrors({ _global: e.message || 'Failed to save request' });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Schedule form helpers ──────────────────────────────────────────────────
  const openSchedule = (r: SalesAppointmentRequest) => {
    setScheduleTarget(r);
    setSchedForm({
      scheduledDate:            r.scheduledDate?.slice(0, 10) || '',
      scheduledStartTime:       r.scheduledStartTime || '',
      assistantTechIds:         [],
      assignedFieldEngineerId:  r.assignedFieldEngineerId || '',
      durationHours:            '2',
    });
    setSchedErrors({});
  };

  const validateSchedule = () => {
    const errs: Record<string, string> = {};
    if (!schedForm.scheduledDate)           errs.scheduledDate  = 'Date is required';
    if (!schedForm.scheduledStartTime)      errs.scheduledStartTime = 'Start time is required';
    if (!schedForm.assignedFieldEngineerId) errs.assignedFieldEngineerId = 'Assign a field engineer';
    setSchedErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del(`/api/sales-appointment-requests/${deleteTarget.id}`);
      setDeleteTarget(null);
      setDetailItem(null);
      fetchRequests();
      onActivityCreated?.(); // refresh Activity Planner so linked activity disappears
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete request');
    } finally {
      setDeleting(false);
    }
  };


  const canDelete = (r: SalesAppointmentRequest) =>
    isScheduler ||
    (isSales && r.createdBy === myId && r.status === SalesRequestStatus.PENDING_SCHEDULING);

  const handleSchedule = async () => {    if (!scheduleTarget || !validateSchedule()) return;
    setScheduling(true);
    try {
      await api.post(`/api/sales-appointment-requests/${scheduleTarget.id}/schedule`, {
        scheduledDate:           schedForm.scheduledDate,
        scheduledStartTime:      schedForm.scheduledStartTime,
        assignedFieldEngineerId: schedForm.assignedFieldEngineerId,
        assistantTechIds:        schedForm.assistantTechIds,
        durationHours:           Number(schedForm.durationHours) || 2,
      });
      setScheduleTarget(null);
      fetchRequests();
      onActivityCreated?.();
    } catch (e: any) {
      setSchedErrors({ _global: e.message || 'Scheduling failed' });
    } finally {
      setScheduling(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────────
  const canEdit = (r: SalesAppointmentRequest) =>
    isSales && r.createdBy === myId && r.status === SalesRequestStatus.PENDING_SCHEDULING;

  const fieldEngineers = useMemo(
    () => technicians.filter(t =>
      t.isActive &&
      (t.level === 'FIELD_ENGINEER' || t.systemRole === Role.FIELD_ENGINEER || t.role === Role.FIELD_ENGINEER)
    ),
    [technicians]
  );

  const technicalAssociates = useMemo(
    () => technicians.filter(t =>
      t.isActive && t.level === 'TECHNICAL_ASSOCIATE'
    ),
    [technicians]
  );

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Page Header ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        {/* Row 1: Icon + Title + Subtitle */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <ClipboardList size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">Sales Appointment Requests</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {isSales ? 'Create and track your appointment requests' : 'Manage and schedule incoming sales requests'}
            </p>
          </div>
        </div>

        {/* Row 2: [≡⊞] [↺] [pending]   [+ New Request] */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-center gap-1.5">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button
                onClick={() => setView('list')}
                className={`p-1.5 transition-colors ${view === 'list' ? 'bg-slate-800 text-white' : 'bg-white text-slate-400 hover:bg-slate-50'}`}
                title="List view"
              >
                <LayoutList size={14} />
              </button>
              <button
                onClick={() => setView('calendar')}
                className={`p-1.5 transition-colors ${view === 'calendar' ? 'bg-slate-800 text-white' : 'bg-white text-slate-400 hover:bg-slate-50'}`}
                title="Calendar view"
              >
                <LayoutGrid size={14} />
              </button>
            </div>
            <button
              onClick={fetchRequests}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            {isScheduler && pendingCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold border border-amber-200">
                <AlertCircle size={11} />
                {pendingCount} Pending
              </span>
            )}
          </div>
          {(isSales || isScheduler) && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FFCC00] hover:bg-amber-400 text-slate-900 rounded-xl font-bold text-sm transition-colors shadow-sm shrink-0"
            >
              <Plus size={14} /> New Request
            </button>
          )}
        </div>
      </div>

      {/* ── My / All toggle (Sales only) ── */}
      {isSales && (
        <div className="px-6 pt-3 pb-0 bg-white flex gap-2 border-b-0">
          <button
            onClick={() => setMyOnly(true)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${myOnly ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}
          >
            My Requests
          </button>
          <button
            onClick={() => setMyOnly(false)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1.5 ${!myOnly ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}
          >
            All Requests
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${!myOnly ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{requests.length}</span>
          </button>
        </div>
      )}

      {/* ── Filters / Search ── */}
      <div className="px-6 py-4 bg-white border-b border-slate-100">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search by client, phone, sales lead, Odoo ref…"
              className={SEARCH_INPUT_STYLES}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['ALL', ...Object.values(SalesRequestStatus)] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s as any)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap ${
                  statusFilter === s
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {s === 'ALL' ? 'All' : STATUS_CONFIG[s as SalesRequestStatus]?.label ?? s}
                {s === SalesRequestStatus.PENDING_SCHEDULING && pendingCount > 0 && (
                  <span className="ml-1.5 bg-amber-400 text-slate-900 rounded-full px-1.5 py-0.5 text-[10px]">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="px-6 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
            <Loader2 size={32} className="animate-spin" />
            <span className="text-sm">Loading requests…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertCircle size={28} className="text-red-400" />
            <p className="text-red-600 font-medium">{error}</p>
            <button onClick={fetchRequests} className="text-sm text-blue-600 underline">Retry</button>
          </div>
        ) : view === 'calendar' ? (
          <CalendarView
            requests={filtered}
            activities={activities}
            technicians={technicians}
            calMonth={calMonth}
            onPrevMonth={() => setCalMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            onNextMonth={() => setCalMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            onSelectRequest={r => setDetailItem(r)}
          />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-400">
            <Inbox size={48} strokeWidth={1.2} />
            <div className="text-center">
              <p className="font-semibold text-slate-600">No requests found</p>
              <p className="text-sm mt-1">
                {searchQ || statusFilter !== 'ALL'
                  ? 'Try adjusting your filters'
                  : isSales
                  ? 'Click "New Request" to create your first appointment request'
                  : 'No sales appointment requests yet'}
              </p>
            </div>
            {isSales && (
              <button
                onClick={openCreate}
                className="flex items-center gap-2 px-4 py-2 bg-[#FFCC00] text-slate-900 rounded-xl font-semibold text-sm"
              >
                <Plus size={15} /> New Request
              </button>
            )}
          </div>
        ) : (
          <DateGroupedList
            requests={filtered}
            canEdit={canEdit}
            canDelete={canDelete}
            isScheduler={isScheduler}
            onEdit={r => openEdit(r)}
            onSchedule={r => openSchedule(r)}
            onView={r => setDetailItem(r)}
            onDelete={r => setDeleteTarget(r)}
            technicians={technicians}
          />
        )}
      </div>

      {/* ── Create / Edit Form Modal ── */}
      {showForm && (
        <FormModal
          editing={!!editingId}
          formData={formData}
          formErrors={formErrors}
          submitting={submitting}
          custResults={custResults}
          custLoading={custLoading}
          onCustSearchChange={v => { setCustSearch(v); }}
          onSelectCustomer={selectCustomer}
          onToggleServiceCat={toggleServiceCat}
          onFieldChange={(field, value) => setFormData(p => ({ ...p, [field]: value }))}
          onClose={() => setShowForm(false)}
          onSubmit={handleSubmit}
          salesLeadName={currentUser.name}
        />
      )}

      {/* ── Schedule Modal ── */}
      {scheduleTarget && (
        <ScheduleModal
          request={scheduleTarget}
          schedForm={schedForm}
          schedErrors={schedErrors}
          scheduling={scheduling}
          fieldEngineers={fieldEngineers}
          technicalAssociates={technicalAssociates}
          onFieldChange={(f, v) => setSchedForm(p => ({ ...p, [f]: v }))}
          onToggleAssistant={(id) => setSchedForm(p => ({
            ...p,
            assistantTechIds: p.assistantTechIds.includes(id)
              ? p.assistantTechIds.filter(x => x !== id)
              : [...p.assistantTechIds, id]
          }))}
          onClose={() => setScheduleTarget(null)}
          onSubmit={handleSchedule}
        />
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Delete Request?</h3>
                <p className="text-sm text-slate-500 mt-0.5">This action cannot be undone.</p>
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl px-4 py-3 mb-5 text-sm">
              <p className="font-semibold text-slate-800">{deleteTarget.customerName}</p>
              <p className="text-slate-500 text-xs mt-0.5">{deleteTarget.activityType} · {deleteTarget.id}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-xl transition-colors"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Drawer ── */}
      {detailItem && (
        <DetailDrawer
          request={detailItem}
          technicians={technicians}
          onClose={() => setDetailItem(null)}
          canEdit={canEdit(detailItem)}
          canDelete={canDelete(detailItem)}
          isScheduler={isScheduler}
          onEdit={() => { setDetailItem(null); openEdit(detailItem); }}
          onSchedule={() => { setDetailItem(null); openSchedule(detailItem); }}
          onDelete={() => { setDetailItem(null); setDeleteTarget(detailItem); }}
        />
      )}
    </div>
  );
};

// ─── Date Grouped List ────────────────────────────────────────────────────────

const formatDateHeader = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(date, today))     return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
};

interface GroupedListProps {
  requests: SalesAppointmentRequest[];
  canEdit: (r: SalesAppointmentRequest) => boolean;
  canDelete: (r: SalesAppointmentRequest) => boolean;
  isScheduler: boolean;
  onEdit: (r: SalesAppointmentRequest) => void;
  onSchedule: (r: SalesAppointmentRequest) => void;
  onView: (r: SalesAppointmentRequest) => void;
  onDelete: (r: SalesAppointmentRequest) => void;
  technicians: Technician[];
}

const DateGroupedList: React.FC<GroupedListProps> = ({
  requests, canEdit, canDelete, isScheduler,
  onEdit, onSchedule, onView, onDelete, technicians
}) => {
  // Group by created date (Qatar timezone YYYY-MM-DD)
  const groups = useMemo(() => {
    const map: Record<string, SalesAppointmentRequest[]> = {};
    requests.forEach(r => {
      const key = new Date(r.createdAt)
        .toLocaleDateString('en-CA', { timeZone: 'Asia/Qatar' }); // YYYY-MM-DD
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    // Sort groups newest first
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [requests]);

  return (
    <div className="space-y-6">
      {groups.map(([dateKey, groupRequests]) => (
        <div key={dateKey}>
          {/* Date section header */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
              {formatDateHeader(dateKey)}
            </span>
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 shrink-0">{groupRequests.length} request{groupRequests.length !== 1 ? 's' : ''}</span>
          </div>
          {/* Cards for this date */}
          <div className="grid gap-3">
            {groupRequests.map(r => (
              <RequestCard
                key={r.id}
                request={r}
                canEdit={canEdit(r)}
                canDelete={canDelete(r)}
                isScheduler={isScheduler}
                onEdit={() => onEdit(r)}
                onSchedule={() => onSchedule(r)}
                onView={() => onView(r)}
                onDelete={() => onDelete(r)}
                technicians={technicians}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Calendar View ────────────────────────────────────────────────────────────

interface CalendarViewProps {
  requests: SalesAppointmentRequest[];
  activities: any[];
  technicians: Technician[];
  calMonth: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectRequest?: (r: SalesAppointmentRequest) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CalendarView: React.FC<CalendarViewProps> = ({ requests, activities, technicians, calMonth, onPrevMonth, onNextMonth, onSelectRequest }) => {
  // Self-contained popup state — no dependency on parent scope
  const [dayPopup, setDayPopup] = useState<{ dateStr: string; requests: SalesAppointmentRequest[]; activities: any[] } | null>(null);
  const year  = calMonth.getFullYear();
  const month = calMonth.getMonth();

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  // Build maps: dateString → SARs + dateString → Activities
  const byDate = useMemo(() => {
    const map: Record<string, SalesAppointmentRequest[]> = {};
    // `requests` is already the filtered list — respect whatever filter is active
    requests.forEach(r => {
      // Scheduled/InProgress/Completed/Done: show on scheduledDate
      // Pending: show on createdAt (no scheduled date yet)
      const dateKey = r.scheduledDate
        ? r.scheduledDate.slice(0, 10)
        : r.status === 'PENDING_SCHEDULING'
          ? r.createdAt.slice(0, 10)
          : null;
      if (dateKey) {
        if (!map[dateKey]) map[dateKey] = [];
        if (!map[dateKey].find(x => x.id === r.id)) map[dateKey].push(r);
      }
    });
    return map;
  }, [requests]);

  // Build activity map: dateString → scheduled activities (resource occupancy)
  const actByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    activities.filter(a => a.plannedDate && a.status !== 'CANCELLED').forEach(a => {
      const key = a.plannedDate.slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(a);
    });
    return map;
  }, [activities]);

  // Count unique engineers booked per day
  const engineersBooked = useMemo(() => {
    const result: Record<string, number> = {};
    Object.entries(actByDate).forEach(([date, acts]) => {
      const eng = new Set<string>();
      acts.forEach(a => {
        if (a.leadTechId) eng.add(a.leadTechId);
        if (a.primaryEngineerId) eng.add(a.primaryEngineerId);
        (a.supportingEngineerIds || []).forEach((id: string) => eng.add(id));
      });
      result[date] = eng.size;
    });
    return result;
  }, [actByDate]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const dotColor = (status: SalesRequestStatus) => {
    const c = STATUS_CONFIG[status];
    return c?.dot ?? 'bg-slate-400';
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Month header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <button onClick={onPrevMonth} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
          <ChevronLeft size={18} />
        </button>
        <h3 className="font-bold text-slate-900 text-base">
          {calMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </h3>
        <button onClick={onNextMonth} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
          <ChevronRightIcon size={18} />
        </button>
      </div>

      {/* Weekday headers — Friday highlighted as Qatar holiday */}
      <div className="grid grid-cols-7 border-b border-slate-100">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={`py-2 text-center text-[11px] font-bold uppercase ${
            i === 5 ? 'text-red-400 bg-red-50/50' : 'text-slate-400'
          }`}>
            {d}{i === 5 && <span className="block text-[8px] font-normal text-red-300">Holiday</span>}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          const dateStr = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
          const cellRequests = dateStr ? (byDate[dateStr] || []) : [];
          const isToday = dateStr === todayStr;
          const isPast  = dateStr ? dateStr < todayStr : false;

          return (
            <div
              key={idx}
              onClick={() => {
                if (!day || !dateStr) return;
                setDayPopup({
                  dateStr,
                  requests: byDate[dateStr] || [],
                  activities: actByDate[dateStr] || [],
                });
              }}
              className={`min-h-[90px] p-1.5 border-b border-r border-slate-100 last:border-r-0 transition-colors ${
                !day ? 'bg-slate-50/50' :
                idx % 7 === 5 ? 'bg-red-50/40 hover:bg-red-50/70 cursor-pointer' :
                (actByDate[dateStr || ''] || []).length > 0 ? 'bg-blue-50/30 hover:bg-blue-50 cursor-pointer' : 'bg-white hover:bg-slate-50 cursor-pointer'
              }`}
            >
              {day && (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                      isToday ? 'bg-[#FFCC00] text-slate-900' : 'text-slate-500'
                    }`}>
                      {day}
                    </div>
                    {/* Engineer occupancy indicator */}
                    {engineersBooked[dateStr || ''] > 0 && (
                      <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-blue-100 text-blue-700" title={`${engineersBooked[dateStr || '']} engineer(s) booked`}>
                        {engineersBooked[dateStr || '']}👷
                      </span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {/* SAR entries */}
                    {cellRequests.slice(0, 2).map(r => (
                      <div
                        key={r.id}
                        className={`w-full text-left px-1.5 py-0.5 rounded text-[9px] font-medium truncate flex items-center gap-1 ${STATUS_CONFIG[r.status]?.bg} ${STATUS_CONFIG[r.status]?.color}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor(r.status)}`} />
                        <span className="truncate">{r.customerName}</span>
                      </div>
                    ))}
                    {/* Activity summary */}
                    {(actByDate[dateStr || ''] || []).length > 0 && (
                      <div className="text-[9px] font-bold text-blue-600 px-1 flex items-center gap-0.5">
                        <span>📋</span> {(actByDate[dateStr || ''] || []).length} job{(actByDate[dateStr || ''] || []).length > 1 ? 's' : ''}
                      </div>
                    )}
                    {cellRequests.length > 2 && (
                      <div className="text-[9px] text-slate-400 px-1">+{cellRequests.length - 2} more</div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
        {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
          <div key={status} className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
            {cfg.label}
          </div>
        ))}
      </div>

      {/* ── Day Popup Modal — self-contained inside CalendarView ── */}
      {dayPopup != null && (
        <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDayPopup(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-800 text-white rounded-t-2xl">
              <div>
                <h3 className="font-bold text-base">
                  {new Date(dayPopup.dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </h3>
                <p className="text-slate-300 text-xs mt-0.5">
                  {dayPopup.activities.length} job{dayPopup.activities.length !== 1 ? 's' : ''} · {dayPopup.requests.length} request{dayPopup.requests.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button onClick={() => setDayPopup(null)} className="p-1.5 hover:bg-white/10 rounded-lg">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Planned Activities */}
              {dayPopup.activities.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500"/> Scheduled Jobs
                  </h4>
                  <div className="space-y-2">
                    {dayPopup.activities.map((a: any, i: number) => {
                      const lead = technicians.find(t => t.id === a.leadTechId);
                      const primary = technicians.find(t => t.id === a.primaryEngineerId);
                      const supporting = (a.supportingEngineerIds || [])
                        .map((id: string) => technicians.find(t => t.id === id)?.name)
                        .filter(Boolean);
                      const timeStr = a.plannedDate
                        ? new Date(a.plannedDate).toLocaleTimeString('en-GB', { timeZone: 'Asia/Qatar', hour: '2-digit', minute: '2-digit' })
                        : null;
                      const statusColor = a.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' :
                                         a.status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700' :
                                         a.status === 'CARRY_FORWARD' ? 'bg-orange-100 text-orange-700' :
                                         'bg-blue-100 text-blue-700';
                      return (
                        <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-slate-800 text-sm">{a.type || 'Activity'}</span>
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusColor}`}>{(a.status || '').replace(/_/g,' ')}</span>
                              </div>
                              {a.customerName && <p className="text-xs text-slate-500 mt-0.5">{a.customerName}</p>}
                            </div>
                            <div className="text-right shrink-0">
                              {timeStr && <div className="text-xs font-bold text-slate-700">{timeStr}</div>}
                              {a.durationHours > 0 && <div className="text-[10px] text-slate-400">{a.durationHours}h</div>}
                            </div>
                          </div>
                          {a.serviceCategory && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {String(a.serviceCategory).split(', ').filter(Boolean).map((cat: string) => (
                                <span key={cat} className="text-[9px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded border border-amber-200 font-medium">{cat}</span>
                              ))}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
                            {(primary || lead) && (
                              <span className="flex items-center gap-1 bg-white border border-slate-200 rounded px-1.5 py-0.5">
                                👷 {(primary || lead)?.name}
                              </span>
                            )}
                            {supporting.map((name: string) => (
                              <span key={name} className="flex items-center gap-1 bg-white border border-slate-200 rounded px-1.5 py-0.5">
                                🔧 {name}
                              </span>
                            ))}
                            {(a.freelancers || []).map((fl: any, fi: number) => (
                              <span key={fi} className="flex items-center gap-1 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 text-orange-700">
                                🆓 {fl.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Appointment Requests */}
              {dayPopup.requests.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400"/> Appointment Requests
                  </h4>
                  <div className="space-y-2">
                    {dayPopup.requests.map(r => (
                      <button
                        key={r.id}
                        onClick={() => { setDayPopup(null); onSelectRequest && onSelectRequest(r); }}
                        className="w-full text-left bg-slate-50 border border-slate-200 rounded-xl p-3 hover:bg-slate-100 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-slate-800 text-sm">{r.customerName}</span>
                            <span className="ml-2 text-[10px] font-mono text-slate-400">{r.id}</span>
                          </div>
                          <StatusBadge status={r.status} />
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{r.activityType} · {r.salesLeadName}</p>
                        {r.scheduledStartTime && (
                          <p className="text-xs font-bold text-blue-600 mt-1">⏰ {r.scheduledStartTime}</p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {dayPopup.activities.length === 0 && dayPopup.requests.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <span className="text-3xl mb-2">📭</span>
                  <p className="text-sm font-medium">Nothing scheduled</p>
                  <p className="text-xs mt-1">This day is free</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

// ─── Request Card ─────────────────────────────────────────────────────────────

interface CardProps {
  request: SalesAppointmentRequest;
  canEdit: boolean;
  canDelete: boolean;
  isScheduler: boolean;
  onEdit: () => void;
  onSchedule: () => void;
  onView: () => void;
  onDelete: () => void;
  technicians: Technician[];
}

const RequestCard: React.FC<CardProps> = ({ request: r, canEdit, canDelete, isScheduler, onEdit, onSchedule, onView, onDelete, technicians }) => {
  const engineer = technicians.find(t => t.id === r.assignedFieldEngineerId);
  const isPending = r.status === SalesRequestStatus.PENDING_SCHEDULING;

  return (
    <div
      className={`bg-white rounded-2xl border transition-shadow hover:shadow-md cursor-pointer
        ${isPending && isScheduler ? 'border-amber-300 shadow-sm' : 'border-slate-200'}`}
      onClick={onView}
    >
      <div className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
          {/* Left: main info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <StatusBadge status={r.status} />
              <span className="text-xs text-slate-400 font-mono">{r.id}</span>
              <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-medium">{r.activityType}</span>
            </div>
            <h3 className="font-bold text-slate-900 text-base leading-snug">{r.customerName}</h3>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-sm text-slate-500">
              <span className="flex items-center gap-1"><Phone size={12} />{r.contactNumber}</span>
              {r.houseNumber && <span className="flex items-center gap-1"><Building size={12} />{r.houseNumber}</span>}
              {r.odooReference && <span className="flex items-center gap-1"><FileText size={12} />{r.odooReference}</span>}
            </div>
            {r.serviceCategory && (
              <div className="flex flex-wrap gap-1 mt-2">
                {r.serviceCategory.split(', ').filter(Boolean).map(c => (
                  <span key={c} className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 rounded border border-amber-200 font-medium">{c}</span>
                ))}
              </div>
            )}
          </div>

          {/* Right: meta */}
          <div className="flex flex-col items-start sm:items-end gap-2 shrink-0 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <UserIcon size={12} />
              <span className="font-medium text-slate-700">{r.salesLeadName}</span>
            </div>
            {r.scheduledDate && (
              <div className="flex items-center gap-1.5 text-blue-600 font-medium">
                <Calendar size={12} />
                {new Date(r.scheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                {r.scheduledStartTime && <span className="text-blue-500">{r.scheduledStartTime}</span>}
              </div>
            )}
            {engineer && (
              <div className="flex items-center gap-1.5 text-indigo-600">
                <Users size={12} />{engineer.name}
              </div>
            )}
            <div className="text-[11px] text-slate-400">
              {new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
            </div>
          </div>
        </div>

        {/* Actions row */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100" onClick={e => e.stopPropagation()}>
          <button onClick={onView} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
            <Eye size={12} /> View
          </button>
          {canEdit && (
            <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
              <Edit2 size={12} /> Edit
            </button>
          )}
          {canDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
            >
              <Trash2 size={12} /> Delete
            </button>
          )}
          {isScheduler && isPending && (
            <button onClick={onSchedule} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors ml-auto shadow-sm">
              <CalendarCheck size={12} /> Schedule
            </button>
          )}
          {isScheduler && r.status === SalesRequestStatus.SCHEDULED && (
            <button onClick={onSchedule} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors ml-auto">
              <Edit2 size={12} /> Reschedule
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Form Modal ───────────────────────────────────────────────────────────────

interface FormModalProps {
  editing: boolean;
  formData: typeof EMPTY_FORM;
  formErrors: Record<string, string>;
  submitting: boolean;
  custResults: any[];
  custLoading: boolean;
  salesLeadName: string;
  onCustSearchChange: (v: string) => void;
  onSelectCustomer: (c: any) => void;
  onToggleServiceCat: (c: string) => void;
  onFieldChange: (field: string, value: any) => void;
  onClose: () => void;
  onSubmit: () => void;
}

const FormModal: React.FC<FormModalProps> = ({
  editing, formData, formErrors, submitting,
  custResults, custLoading, salesLeadName,
  onCustSearchChange, onSelectCustomer, onToggleServiceCat, onFieldChange,
  onClose, onSubmit
}) => (
  <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
    <div
      className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 sticky top-0 bg-white z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
            <ClipboardList size={18} className="text-amber-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">
            {editing ? 'Edit Appointment Request' : 'New Appointment Request'}
          </h2>
        </div>
        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
          <X size={18} />
        </button>
      </div>

      <div className="px-6 py-5 space-y-5">

        {/* Global error */}
        {formErrors._global && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {formErrors._global}
          </div>
        )}

        {/* Sales Lead (read-only) */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Sales Lead</label>
          <div className={`${INPUT_STYLES} bg-slate-50 text-slate-500 cursor-default`}>
            {salesLeadName}
          </div>
          <p className="mt-1 text-xs text-slate-400">Automatically set to your account</p>
        </div>

        {/* Contact number — primary customer lookup field */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Contact Number <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              value={formData.contactNumber}
              onChange={e => {
                const v = e.target.value;
                onFieldChange('contactNumber', v);
                // Drive customer search from contact number
                onCustSearchChange(v);
              }}
              placeholder="+974 XXXX XXXX — type to search existing clients"
              className={`${INPUT_STYLES} ${formErrors.contactNumber ? 'border-red-400' : ''}`}
            />
            {custLoading && (
              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
            )}
            {/* Results dropdown */}
            {custResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden max-h-48 overflow-y-auto">
                {custResults.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => onSelectCustomer(c)}
                    className="w-full text-left px-4 py-3 hover:bg-amber-50 text-sm border-b border-slate-100 last:border-0 transition-colors"
                  >
                    <span className="font-semibold text-slate-800">{c.name}</span>
                    <span className="ml-2 text-amber-600 font-mono text-xs">{c.phone}</span>
                    {c.buildingNumber && <span className="ml-2 text-slate-400 text-xs">{c.buildingNumber}</span>}
                  </button>
                ))}
              </div>
            )}
            {/* No match — offer create new */}
            {!custLoading && custResults.length === 0 && formData.contactNumber.replace(/[^0-9]/g,'').length >= 4 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-amber-200 rounded-xl shadow-lg z-50 overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-sm text-slate-500">No existing client found</span>
                  <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                    <Plus size={11} /> New client will be created
                  </span>
                </div>
              </div>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Type phone number to search — select existing client or enter name below to create new
          </p>
          <FieldError msg={formErrors.contactNumber} />
        </div>

        {/* Customer Name — auto-filled from client lookup, or enter manually for new client */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Customer Name <span className="text-red-500">*</span>
          </label>
          <input
            value={formData.customerName}
            onChange={e => onFieldChange('customerName', e.target.value)}
            placeholder="Auto-filled from existing client, or enter new client name"
            className={`${INPUT_STYLES} ${formErrors.customerName ? 'border-red-400' : ''}`}
          />
          <FieldError msg={formErrors.customerName} />
        </div>

        {/* Location URL */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Location URL <span className="text-red-500">*</span>
          </label>
          <input
            value={formData.locationUrl}
            onChange={e => onFieldChange('locationUrl', e.target.value)}
            placeholder="https://maps.google.com/…"
            className={`${INPUT_STYLES} ${formErrors.locationUrl ? 'border-red-400' : ''}`}
          />
          <FieldError msg={formErrors.locationUrl} />
        </div>

        {/* House / Building Number */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            House / Building Number <span className="text-red-500">*</span>
          </label>
          <input
            value={formData.houseNumber}
            onChange={e => onFieldChange('houseNumber', e.target.value)}
            placeholder="Building 12, Villa 5A…"
            className={`${INPUT_STYLES} ${formErrors.houseNumber ? 'border-red-400' : ''}`}
          />
          <FieldError msg={formErrors.houseNumber} />
        </div>

        {/* Odoo CRM Link */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Odoo CRM Link <span className="text-red-500">*</span>
          </label>
          <input
            value={formData.odooReference}
            onChange={e => onFieldChange('odooReference', e.target.value)}
            placeholder="https://odoo.qonnect.com/web#id=XXXX&model=crm.lead"
            className={`${INPUT_STYLES} ${formErrors.odooReference ? 'border-red-400' : ''}`}
          />
          <FieldError msg={formErrors.odooReference} />
        </div>

        {/* Activity Type */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Activity Type <span className="text-red-500">*</span>
          </label>
          <select
            value={formData.activityType}
            onChange={e => onFieldChange('activityType', e.target.value)}
            className={`${INPUT_STYLES} ${formErrors.activityType ? 'border-red-400' : ''}`}
          >
            {SALES_ACTIVITY_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <FieldError msg={formErrors.activityType} />
        </div>

        {/* Service Category (multi-select chips) */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Service Category <span className="text-red-500">*</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {SERVICE_CATEGORIES.map(cat => {
              const selected = formData.serviceCategory.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => onToggleServiceCat(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                    selected
                      ? 'bg-amber-400 text-slate-900 border-amber-400 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:bg-amber-50'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
          <FieldError msg={formErrors.serviceCategory} />
        </div>

        {/* Remarks (optional) */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Remarks (Optional)</label>
          <textarea
            value={formData.remarks}
            onChange={e => onFieldChange('remarks', e.target.value)}
            rows={3}
            placeholder="Any special notes or instructions…"
            className={INPUT_STYLES}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-slate-900 bg-[#FFCC00] hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl transition-colors shadow-sm"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {editing ? 'Save Changes' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  </div>
);

// ─── Schedule Modal ───────────────────────────────────────────────────────────

interface ScheduleModalProps {
  request: SalesAppointmentRequest;
  schedForm: { scheduledDate: string; scheduledStartTime: string; assistantTechIds: string[]; assignedFieldEngineerId: string; durationHours: string };
  schedErrors: Record<string, string>;
  scheduling: boolean;
  fieldEngineers: Technician[];
  technicalAssociates: Technician[];
  onFieldChange: (f: string, v: string) => void;
  onToggleAssistant: (id: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

const ScheduleModal: React.FC<ScheduleModalProps> = ({
  request: r, schedForm, schedErrors, scheduling, fieldEngineers, technicalAssociates,
  onFieldChange, onToggleAssistant, onClose, onSubmit
}) => (
  <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
    <div
      className="bg-white rounded-2xl shadow-2xl w-full max-w-lg"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center">
            <CalendarCheck size={18} className="text-blue-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Schedule Appointment</h2>
            <p className="text-xs text-slate-500 mt-0.5">{r.customerName} — {r.activityType}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
          <X size={18} />
        </button>
      </div>

      <div className="px-6 py-5 space-y-4">

        {schedErrors._global && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {schedErrors._global}
          </div>
        )}

        {/* Request summary */}
        <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-1">
          <div className="flex gap-2"><span className="text-slate-500 w-24 shrink-0">Client</span><span className="font-semibold text-slate-800">{r.customerName}</span></div>
          <div className="flex gap-2"><span className="text-slate-500 w-24 shrink-0">Phone</span><span className="text-slate-700">{r.contactNumber}</span></div>
          <div className="flex gap-2"><span className="text-slate-500 w-24 shrink-0">Type</span><span className="text-slate-700">{r.activityType}</span></div>
          <div className="flex gap-2"><span className="text-slate-500 w-24 shrink-0">Service</span><span className="text-slate-700">{r.serviceCategory}</span></div>
          {r.remarks && <div className="flex gap-2"><span className="text-slate-500 w-24 shrink-0">Remarks</span><span className="text-slate-600 italic">{r.remarks}</span></div>}
        </div>

        {/* Date */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Appointment Date <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={schedForm.scheduledDate}
            onChange={e => onFieldChange('scheduledDate', e.target.value)}
            className={`${INPUT_STYLES} ${schedErrors.scheduledDate ? 'border-red-400' : ''}`}
          />
          <FieldError msg={schedErrors.scheduledDate} />
        </div>

        {/* Start Time only */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Start Time <span className="text-red-500">*</span>
          </label>
          <input
            type="time"
            value={schedForm.scheduledStartTime}
            onChange={e => onFieldChange('scheduledStartTime', e.target.value)}
            className={`${INPUT_STYLES} ${schedErrors.scheduledStartTime ? 'border-red-400' : ''}`}
          />
          <FieldError msg={schedErrors.scheduledStartTime} />
        </div>

        {/* Assign Field Engineer */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Assign Field Engineer <span className="text-red-500">*</span>
          </label>
          <select
            value={schedForm.assignedFieldEngineerId}
            onChange={e => onFieldChange('assignedFieldEngineerId', e.target.value)}
            className={`${INPUT_STYLES} ${schedErrors.assignedFieldEngineerId ? 'border-red-400' : ''}`}
          >
            <option value="">— Select engineer —</option>
            {fieldEngineers.map(t => (
              <option key={t.id} value={t.id}>{t.name}{t.level ? ` — ${t.level.replace(/_/g,' ')}` : ''}</option>
            ))}
          </select>
          <FieldError msg={schedErrors.assignedFieldEngineerId} />
        </div>

        {/* Technical Associates (optional multi-select) */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Technical Associates
            <span className="ml-1.5 text-xs font-normal text-slate-400">(optional)</span>
          </label>
          {technicalAssociates.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">No technical associates available</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {technicalAssociates.map(t => {
                const selected = schedForm.assistantTechIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onToggleAssistant(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                      selected
                        ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                    }`}
                  >
                    <Users size={11} />
                    {t.name}
                    {selected && <CheckCircle2 size={11} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Duration */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Duration (hours)</label>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={schedForm.durationHours}
            onChange={e => onFieldChange('durationHours', e.target.value)}
            className={INPUT_STYLES}
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={scheduling}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl transition-colors shadow-sm"
          >
            {scheduling ? <Loader2 size={14} className="animate-spin" /> : <CalendarCheck size={14} />}
            Confirm Schedule
          </button>
        </div>
      </div>
    </div>
  </div>
);

// ─── Detail Drawer ────────────────────────────────────────────────────────────

interface DetailDrawerProps {
  request: SalesAppointmentRequest;
  technicians: Technician[];
  canEdit: boolean;
  canDelete: boolean;
  isScheduler: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSchedule: () => void;
  onDelete: () => void;
}

const DetailDrawer: React.FC<DetailDrawerProps> = ({ request: r, technicians, canEdit, canDelete, isScheduler, onClose, onEdit, onSchedule, onDelete }) => {
  const engineer = technicians.find(t => t.id === r.assignedFieldEngineerId);
  const isPending = r.status === SalesRequestStatus.PENDING_SCHEDULING;

  const row = (label: string, value?: string | null, href?: string) => {
    if (!value) return null;
    return (
      <div className="flex gap-3 py-2 border-b border-slate-100 last:border-0">
        <span className="text-sm text-slate-500 w-36 shrink-0">{label}</span>
        {href
          ? <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline flex items-center gap-1 break-all">{value} <ExternalLink size={10} /></a>
          : <span className="text-sm font-medium text-slate-800 break-words">{value}</span>
        }
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 sticky top-0 bg-white">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={r.status} />
              <span className="text-xs font-mono text-slate-400">{r.id}</span>
            </div>
            <h2 className="text-base font-bold text-slate-900">{r.customerName}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="space-y-0">
            {row('Activity Type', r.activityType)}
            {row('Service Category', r.serviceCategory)}
            {row('Contact Number', r.contactNumber)}
            {row('House / Building', r.houseNumber)}
            {row('Odoo CRM Link', r.odooReference, r.odooReference)}
            {row('Location URL', r.locationUrl, r.locationUrl)}
            {row('Sales Lead', r.salesLeadName)}
            {row('Remarks', r.remarks)}
            {row('Scheduled Date', r.scheduledDate ? new Date(r.scheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : null)}
            {row('Start Time', r.scheduledStartTime)}
            {row('End Time', r.scheduledEndTime)}
            {row('Assigned Engineer', engineer?.name)}
            {row('Created', new Date(r.createdAt).toLocaleString('en-GB'))}
            {r.updatedAt !== r.createdAt && row('Updated', new Date(r.updatedAt).toLocaleString('en-GB'))}
          </div>

          {r.linkedActivityId && (
            <div className={`mt-4 px-4 py-3 rounded-xl text-sm flex items-center gap-2 border ${
                r.status === 'COMPLETED'   ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                r.status === 'IN_PROGRESS' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                'bg-blue-50 border-blue-200 text-blue-700'
            }`}>
              {r.status === 'COMPLETED'   ? <CheckCircle2 size={14} /> :
               r.status === 'IN_PROGRESS' ? <span className="text-base">🔄</span> :
               <span className="text-base">📅</span>}
              <span>
                Activity <span className="font-mono font-semibold">{r.linkedActivityId}</span>
                {r.status === 'IN_PROGRESS' && <span className="ml-1 font-semibold">— Work In Progress</span>}
                {r.status === 'COMPLETED'   && <span className="ml-1 font-semibold">— Completed</span>}
                {r.status === 'SCHEDULED'   && <span className="ml-1">— Scheduled &amp; Planned</span>}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-slate-100">
            {canEdit && (
              <button onClick={onEdit} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors">
                <Edit2 size={13} /> Edit
              </button>
            )}
            {canDelete && (
              <button onClick={onDelete} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors">
                <Trash2 size={13} /> Delete
              </button>
            )}
            {isScheduler && isPending && (
              <button onClick={onSchedule} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl transition-colors shadow-sm ml-auto">
                <CalendarCheck size={13} /> Schedule Now
              </button>
            )}
            {isScheduler && r.status === SalesRequestStatus.SCHEDULED && (
              <button onClick={onSchedule} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors ml-auto">
                <Edit2 size={13} /> Reschedule
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};

export default SalesAppointmentRequests;

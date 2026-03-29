import React, { useState, useMemo, useEffect } from 'react';
import { Ticket, Activity, Technician, Site } from '../types';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell
} from 'recharts';
import { 
    Download, FileText, Activity as ActivityIcon, 
    ArrowRight, FileSpreadsheet, Printer, Save, Trash2, X, ChevronUp, ChevronDown, CheckSquare
} from 'lucide-react';
import ReactDatePicker from "react-datepicker";

// Robust import handling for DatePicker across different module systems
const DatePicker = ((ReactDatePicker as any).default || ReactDatePicker) as typeof ReactDatePicker;

interface ReportsModuleProps {
  tickets: Ticket[];
  activities: Activity[];
  technicians: Technician[];
  sites: Site[];
}

// --- Date Helpers ---
const formatDateYYYYMMDD = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseDateYYYYMMDD = (str: string): Date => {
    if (!str) return new Date();
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const startOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth() + 1, 0);

type DatePreset = 'today' | 'lastWeekSatThu' | 'thisMonth' | 'lastMonth' | 'custom';

interface DateRangeSelectorProps {
    startDate: string;
    endDate: string;
    onRangeChange: (start: string, end: string, preset: DatePreset) => void;
    activePreset: DatePreset;
}

const DateRangeSelector: React.FC<DateRangeSelectorProps> = ({ startDate, endDate, onRangeChange, activePreset }) => {
    
    // Convert string state to Date objects for the picker
    const startObj = useMemo(() => parseDateYYYYMMDD(startDate), [startDate]);
    const endObj = useMemo(() => parseDateYYYYMMDD(endDate), [endDate]);

    const handlePickerChange = (date: Date | null, type: 'start' | 'end') => {
        if (!date) return;
        const str = formatDateYYYYMMDD(date);
        
        if (type === 'start') {
            // If new start is after end, push end to new start
            const newEnd = date > endObj ? str : endDate;
            onRangeChange(str, newEnd, 'custom');
        } else {
            // If new end is before start, push start to new end
            const newStart = date < startObj ? str : startDate;
            onRangeChange(newStart, str, 'custom');
        }
    };

    return (
        <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 flex gap-4 w-full">
                 <div className="flex-1 relative">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">From</label>
                    <DatePicker
                        selected={startObj}
                        onChange={(d) => handlePickerChange(d, 'start')}
                        dateFormat="dd/MM/yyyy"
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
                        placeholderText="Select start date"
                        onKeyDown={(e) => e.preventDefault()} // Disable typing
                    />
                 </div>
                 <div className="flex items-end mb-3 text-slate-400">
                     <ArrowRight size={20} />
                 </div>
                 <div className="flex-1 relative">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">To</label>
                    <DatePicker
                        selected={endObj}
                        onChange={(d) => handlePickerChange(d, 'end')}
                        dateFormat="dd/MM/yyyy"
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
                        placeholderText="Select end date"
                        onKeyDown={(e) => e.preventDefault()} // Disable typing
                    />
                 </div>
            </div>
        </div>
    );
};


// --- Types for Export System ---
interface ReportField {
    id: string;
    label: string;
    getValue: (item: any) => string;
}

interface ReportTemplate {
    id: string;
    name: string;
    type: 'tickets' | 'operations';
    fieldIds: string[];
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#64748b', '#8b5cf6'];

const ReportsModule: React.FC<ReportsModuleProps> = ({ tickets, activities, technicians, sites }) => {
  const [reportType, setReportType] = useState<'tickets' | 'operations'>('tickets');
  
  // Date Range State - Default: This Month (MTD)
  const [startDate, setStartDate] = useState(() => formatDateYYYYMMDD(startOfMonth(new Date())));
  const [endDate, setEndDate] = useState(() => formatDateYYYYMMDD(new Date()));
  const [currentPreset, setCurrentPreset] = useState<DatePreset>('thisMonth');

  // --- Export Modal State ---
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'pdf'>('csv');
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>([]);
  
  // Templates State
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('default');
  const [newTemplateName, setNewTemplateName] = useState('');
  const [isSaveTemplateMode, setIsSaveTemplateMode] = useState(false);

  // --- Load/Save Templates Logic ---
  useEffect(() => {
      const saved = localStorage.getItem('qonnect_report_templates');
      if (saved) {
          try {
              setTemplates(JSON.parse(saved));
          } catch (e) {
              console.error("Failed to load templates", e);
          }
      }
  }, []);

  const saveTemplatesToStorage = (newTemplates: ReportTemplate[]) => {
      setTemplates(newTemplates);
      localStorage.setItem('qonnect_report_templates', JSON.stringify(newTemplates));
  };

  // --- Field Definitions ---
  const ticketFields: ReportField[] = useMemo(() => [
      { id: 'id', label: 'Ticket ID', getValue: (t: Ticket) => t.id },
      { id: 'date', label: 'Created Date', getValue: (t: Ticket) => new Date(t.createdAt).toLocaleDateString() },
      { id: 'time', label: 'Created Time', getValue: (t: Ticket) => new Date(t.createdAt).toLocaleTimeString() },
      { id: 'customer', label: 'Customer Name', getValue: (t: Ticket) => t.customerName },
      { id: 'phone', label: 'Phone Number', getValue: (t: Ticket) => t.phoneNumber },
      { id: 'category', label: 'Category', getValue: (t: Ticket) => t.category },
      { id: 'type', label: 'Ticket Type', getValue: (t: Ticket) => t.type },
      { id: 'priority', label: 'Priority', getValue: (t: Ticket) => t.priority },
      { id: 'status', label: 'Status', getValue: (t: Ticket) => t.status },
      { id: 'tech', label: 'Assigned Engineer', getValue: (t: Ticket) => technicians.find(tech => tech.id === t.assignedTechId)?.name || 'Unassigned' },
      { id: 'desc', label: 'Description', getValue: (t: Ticket) => (t.messages?.find((m: any) => m.sender === 'CLIENT')?.content || (t as any).ai_summary || t.category || '') },
      { id: 'location', label: 'Location URL', getValue: (t: Ticket) => t.locationUrl || '' },
      { id: 'house', label: 'House Number', getValue: (t: Ticket) => t.houseNumber || '' },
      { id: 'odoo', label: 'Odoo Ref', getValue: (t: Ticket) => t.odooLink || '' },
      { id: 'updated', label: 'Last Updated', getValue: (t: Ticket) => new Date(t.updatedAt).toLocaleDateString() },
  ], [technicians]);

  const activityFields: ReportField[] = useMemo(() => [
      { id: 'ref', label: 'Reference', getValue: (a: Activity) => a.reference },
      { id: 'date', label: 'Planned Date', getValue: (a: Activity) => new Date(a.plannedDate).toLocaleDateString() },
      { id: 'time', label: 'Planned Time', getValue: (a: Activity) => new Date(a.plannedDate).toLocaleTimeString() },
      { id: 'type', label: 'Activity Type', getValue: (a: Activity) => a.type },
      { id: 'site', label: 'Site / Customer', getValue: (a: Activity) => sites.find(s => s.id === a.siteId)?.name || 'Unknown' },
      { id: 'status', label: 'Status', getValue: (a: Activity) => a.status },
      { id: 'priority', label: 'Priority', getValue: (a: Activity) => a.priority },
      { id: 'lead', label: 'Lead Engineer', getValue: (a: Activity) => technicians.find(t => t.id === a.leadTechId)?.name || 'Unassigned' },
      { id: 'sales', label: 'Sales Lead', getValue: (a: Activity) => technicians.find(t => t.id === a.salesLeadId)?.name || 'Unassigned' },
      { id: 'duration', label: 'Duration (Hrs)', getValue: (a: Activity) => a.durationHours.toString() },
      { id: 'desc', label: 'Description', getValue: (a: Activity) => a.description },
      { id: 'escalation', label: 'Escalation Level', getValue: (a: Activity) => a.escalationLevel ? `L${a.escalationLevel}` : 'Normal' },
      { id: 'delay', label: 'Delay Reason', getValue: (a: Activity) => a.delayReason || '' },
      { id: 'odoo', label: 'Odoo Ref', getValue: (a: Activity) => a.odooLink || '' },
  ], [technicians, sites]);

  const availableFields = reportType === 'tickets' ? ticketFields : activityFields;

  // --- Filter Logic ---

  const handleDateRangeChange = (start: string, end: string, preset: DatePreset) => {
      setStartDate(start);
      setEndDate(end);
      setCurrentPreset(preset);
  };

  // Helper to trigger specific presets from quick buttons
  const triggerPreset = (preset: DatePreset) => {
      const now = new Date();
      let start = new Date();
      let end = new Date();

      switch (preset) {
          case 'today':
              start = now;
              end = now;
              break;
          case 'lastWeekSatThu': 
              // LOGIC: Most recent Thursday strictly before today.
              // Start = Saturday (5 days before End)
              const currentDay = now.getDay(); // Sun=0, Thu=4
              
              // Find days to subtract to get to the most recent Thursday strictly before today
              // If today is Thu(4), we need prev Thu, so -7 days.
              // If today is Fri(5), we need yesterday (Thu), so -1 day.
              // If today is Wed(3), we need prev Thu (6 days ago).
              // Formula for "previous X day": (currentDay - targetDay + 7) % 7
              // But we want strictly before, so if result is 0, add 7.
              
              let daysToSubtract = (currentDay - 4 + 7) % 7;
              if (daysToSubtract === 0) daysToSubtract = 7;
              
              end = new Date(now);
              end.setDate(now.getDate() - daysToSubtract);
              
              start = new Date(end);
              start.setDate(end.getDate() - 5); // Saturday is 5 days before Thursday
              break;
          case 'thisMonth': 
              // MTD: Start of Month to Today
              start = startOfMonth(now); 
              end = now;
              break;
          case 'lastMonth': 
              // Full Previous Month
              const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
              start = startOfMonth(lm); 
              end = endOfMonth(lm); 
              break;
      }
      
      handleDateRangeChange(formatDateYYYYMMDD(start), formatDateYYYYMMDD(end), preset);
  };

  const filteredTickets = useMemo(() => {
      const start = parseDateYYYYMMDD(startDate);
      start.setHours(0,0,0,0);
      
      const end = parseDateYYYYMMDD(endDate);
      end.setHours(23,59,59,999);

      return tickets.filter(t => {
          const tDate = new Date(t.createdAt).getTime();
          return tDate >= start.getTime() && tDate <= end.getTime();
      });
  }, [tickets, startDate, endDate]);

  const filteredActivities = useMemo(() => {
      const start = parseDateYYYYMMDD(startDate);
      start.setHours(0,0,0,0);
      
      const end = parseDateYYYYMMDD(endDate);
      end.setHours(23,59,59,999);

      return activities.filter(a => {
          const aDate = new Date(a.plannedDate).getTime();
          return aDate >= start.getTime() && aDate <= end.getTime();
      });
  }, [activities, startDate, endDate]);

  const filteredData = reportType === 'tickets' ? filteredTickets : filteredActivities;

  // --- Chart Data Preparation ---
  const statusData = useMemo(() => {
      const counts: Record<string, number> = {};
      filteredData.forEach((item: any) => {
          const status = item.status;
          counts[status] = (counts[status] || 0) + 1;
      });
      return Object.keys(counts).map((key, index) => ({
          name: key.replace('_', ' '),
          value: counts[key],
          color: COLORS[index % COLORS.length]
      }));
  }, [filteredData]);

  const trendData = useMemo(() => {
      const s = parseDateYYYYMMDD(startDate);
      const e = parseDateYYYYMMDD(endDate);
      const diffTime = Math.abs(e.getTime() - s.getTime());
      const durationDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
      const isSingleDay = startDate === endDate;

      const buckets: Record<number, { name: string, count: number }> = {};

      filteredData.forEach((item: any) => {
          const dateObj = new Date(item.createdAt || item.plannedDate);
          let bucketTime = 0;
          let label = '';

          if (isSingleDay) {
              // Hourly Grouping
              const b = new Date(dateObj);
              b.setMinutes(0, 0, 0);
              bucketTime = b.getTime();
              label = b.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
          } else if (durationDays <= 30) { 
              // Daily Grouping
              const b = new Date(dateObj);
              b.setHours(0,0,0,0);
              bucketTime = b.getTime();
              label = b.toLocaleDateString([], { month: 'short', day: 'numeric' });
          } else if (durationDays <= 90) {
              // Weekly Grouping
              const b = new Date(dateObj);
              // Set to start of week (Sunday)
              const day = b.getDay();
              const diff = b.getDate() - day; 
              b.setDate(diff);
              b.setHours(0,0,0,0);
              bucketTime = b.getTime();
              label = `Wk of ${b.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
          } else {
              // Monthly Grouping
              const b = new Date(dateObj);
              b.setDate(1);
              b.setHours(0,0,0,0);
              bucketTime = b.getTime();
              label = b.toLocaleDateString([], { month: 'short', year: 'numeric' });
          }

          if (!buckets[bucketTime]) {
              buckets[bucketTime] = { name: label, count: 0 };
          }
          buckets[bucketTime].count++;
      });

      return Object.keys(buckets)
        .map(Number)
        .sort((a, b) => a - b)
        .map(time => ({ date: buckets[time].name, count: buckets[time].count }));
  }, [filteredData, startDate, endDate]);

  // --- Modal Logic ---

  const openExportModal = () => {
      // Default fields if none selected
      if (selectedFieldIds.length === 0) {
          const defaults = reportType === 'tickets' 
            ? ['id', 'date', 'customer', 'category', 'status', 'tech'] 
            : ['ref', 'date', 'type', 'site', 'status', 'lead'];
          setSelectedFieldIds(defaults);
      }
      setIsExportModalOpen(true);
  };

  const toggleField = (id: string) => {
      setSelectedFieldIds(prev => {
          if (prev.includes(id)) return prev.filter(f => f !== id);
          return [...prev, id];
      });
  };

  const moveField = (index: number, direction: 'up' | 'down') => {
      const newFields = [...selectedFieldIds];
      if (direction === 'up' && index > 0) {
          [newFields[index], newFields[index - 1]] = [newFields[index - 1], newFields[index]];
      } else if (direction === 'down' && index < newFields.length - 1) {
          [newFields[index], newFields[index + 1]] = [newFields[index + 1], newFields[index]];
      }
      setSelectedFieldIds(newFields);
  };

  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      setSelectedTemplateId(id);
      
      if (id === 'default') {
          const defaults = reportType === 'tickets' 
            ? ['id', 'date', 'customer', 'category', 'status', 'tech'] 
            : ['ref', 'date', 'type', 'site', 'status', 'lead'];
          setSelectedFieldIds(defaults);
      } else {
          const template = templates.find(t => t.id === id);
          if (template) setSelectedFieldIds(template.fieldIds);
      }
  };

  const saveTemplate = () => {
      if (!newTemplateName.trim()) return;
      const newTemplate: ReportTemplate = {
          id: `tpl-${Date.now()}`,
          name: newTemplateName,
          type: reportType,
          fieldIds: selectedFieldIds
      };
      const updated = [...templates, newTemplate];
      saveTemplatesToStorage(updated);
      setNewTemplateName('');
      setIsSaveTemplateMode(false);
      setSelectedTemplateId(newTemplate.id);
  };

  const deleteTemplate = (id: string) => {
      if (confirm('Delete this template?')) {
          const updated = templates.filter(t => t.id !== id);
          saveTemplatesToStorage(updated);
          setSelectedTemplateId('default');
      }
  };

  // --- Export Execution ---

  const executeExport = () => {
      const fieldsToExport = selectedFieldIds
        .map(id => availableFields.find(f => f.id === id))
        .filter((f): f is ReportField => !!f);
      
      if (fieldsToExport.length === 0) {
          alert('Please select at least one field to export.');
          return;
      }

      if (exportFormat === 'csv') {
          const headers = fieldsToExport.map(f => f.label);
          const rows = filteredData.map(item => 
            fieldsToExport.map(f => `"${String(f.getValue(item)).replace(/"/g, '""')}"`).join(',')
          );
          
          const csvContent = [headers.join(','), ...rows].join('\n');
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.setAttribute('href', url);
          link.setAttribute('download', `${reportType}_report_${startDate}.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

      } else {
          // PDF Export using jsPDF + autoTable — real file download, no print dialog
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          script.onload = () => {
              const script2 = document.createElement('script');
              script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
              script2.onload = () => {
                  try {
                      const { jsPDF } = (window as any).jspdf;
                      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

                      // Header
                      doc.setFontSize(16);
                      doc.setTextColor(15, 23, 42);
                      doc.text(
                          reportType === 'tickets' ? 'After-Sales Tickets Report' : 'Operations Activity Report',
                          14, 16
                      );
                      doc.setFontSize(9);
                      doc.setTextColor(100, 116, 139);
                      doc.text(
                          `Generated: ${new Date().toLocaleString('en-GB')}   |   Period: ${startDate} to ${endDate}   |   Records: ${filteredData.length}`,
                          14, 23
                      );

                      // Table
                      (doc as any).autoTable({
                          startY: 28,
                          head: [fieldsToExport.map(f => f.label)],
                          body: filteredData.map(item => fieldsToExport.map(f => String(f.getValue(item) ?? ''))),
                          styles: { fontSize: 8, cellPadding: 3 },
                          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
                          alternateRowStyles: { fillColor: [248, 250, 252] },
                          margin: { left: 14, right: 14 },
                      });

                      // Footer
                      const pageCount = (doc as any).internal.getNumberOfPages();
                      for (let i = 1; i <= pageCount; i++) {
                          doc.setPage(i);
                          doc.setFontSize(8);
                          doc.setTextColor(148, 163, 184);
                          doc.text(
                              `Qonnect Field Operations   |   Page ${i} of ${pageCount}`,
                              14,
                              (doc as any).internal.pageSize.getHeight() - 8
                          );
                      }

                      doc.save(`${reportType}_report_${startDate}_to_${endDate}.pdf`);
                  } catch (err) {
                      console.error('PDF generation failed:', err);
                      alert('PDF generation failed. Please try again.');
                  }
              };
              document.head.appendChild(script2);
          };
          document.head.appendChild(script);
      }
      setIsExportModalOpen(false);
  };

  return (
    <div className="p-8 h-full flex flex-col space-y-6">
        
        {/* Header & Main Controls */}
        <div className="flex flex-col gap-6 shrink-0">
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Reports & Analytics</h1>
                    <p className="text-slate-500 text-sm">Generate operational insights and export data.</p>
                </div>
                <button 
                    onClick={openExportModal}
                    className="bg-slate-900 text-white px-4 py-2.5 rounded-lg font-medium flex items-center gap-2 hover:bg-slate-800 shadow-lg shadow-slate-900/10 transition-all"
                >
                    <Download size={18} />
                    <span>Export Data</span>
                </button>
            </div>

            {/* Filter Bar */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col lg:flex-row gap-6 items-start lg:items-end">
                
                {/* Type Toggle */}
                <div className="w-full lg:w-auto">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Report Type</label>
                    <div className="flex bg-slate-100 p-1 rounded-lg">
                        <button 
                            onClick={() => setReportType('tickets')}
                            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${reportType === 'tickets' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <FileText size={16} /> Tickets
                        </button>
                        <button 
                            onClick={() => setReportType('operations')}
                            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${reportType === 'operations' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <ActivityIcon size={16} /> Operations
                        </button>
                    </div>
                </div>

                {/* Date Controls */}
                <div className="flex-1 w-full lg:w-auto">
                     <DateRangeSelector 
                        startDate={startDate} 
                        endDate={endDate} 
                        onRangeChange={handleDateRangeChange}
                        activePreset={currentPreset}
                     />
                </div>

                {/* Presets */}
                <div className="w-full lg:w-auto">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Quick Presets</label>
                    <div className="flex flex-wrap gap-2">
                         <button onClick={() => triggerPreset('today')} className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${currentPreset === 'today' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>Today</button>
                         <button onClick={() => triggerPreset('lastWeekSatThu')} className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${currentPreset === 'lastWeekSatThu' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>Last Week</button>
                         <button onClick={() => triggerPreset('thisMonth')} className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${currentPreset === 'thisMonth' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>This Month</button>
                         <button onClick={() => triggerPreset('lastMonth')} className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${currentPreset === 'lastMonth' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>Last Month</button>
                    </div>
                </div>
            </div>
        </div>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-6 custom-scrollbar pr-2">
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <p className="text-xs font-bold text-slate-500 uppercase">Total Records</p>
                    <h3 className="text-3xl font-bold text-slate-900 mt-2">{filteredData.length}</h3>
                </div>
                 <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <p className="text-xs font-bold text-slate-500 uppercase">Status Breakdown</p>
                    <div className="flex gap-1 mt-3 h-2 w-full rounded-full overflow-hidden">
                        {statusData.map((d, i) => (
                            <div key={i} style={{ width: `${(d.value / filteredData.length) * 100}%`, backgroundColor: d.color }} />
                        ))}
                    </div>
                    <div className="flex gap-3 mt-2 text-[10px] text-slate-500">
                        {statusData.slice(0, 3).map((d, i) => (
                             <div key={i} className="flex items-center gap-1">
                                 <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                                 <span>{d.name} ({Math.round((d.value/filteredData.length)*100)}%)</span>
                             </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-80">
                 <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                     <h4 className="font-bold text-slate-800 mb-4">Volume Over Time</h4>
                     <div className="flex-1 min-h-0">
                         <ResponsiveContainer width="100%" height="100%">
                             <BarChart data={trendData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} />
                                <YAxis fontSize={10} tickLine={false} axisLine={false} />
                                <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                             </BarChart>
                         </ResponsiveContainer>
                     </div>
                 </div>
                 <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                     <h4 className="font-bold text-slate-800 mb-4">Status Distribution</h4>
                     <div className="flex-1 min-h-0">
                         <ResponsiveContainer width="100%" height="100%">
                             <PieChart>
                                <Pie
                                    data={statusData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {statusData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                <Legend
                                    verticalAlign="bottom"
                                    height={48}
                                    iconType="circle"
                                    wrapperStyle={{ marginTop: 16 }}
                                />

                             </PieChart>
                         </ResponsiveContainer>
                     </div>
                 </div>
            </div>

            {/* Data Preview */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">Data Preview</h3>
                    <span className="text-xs text-slate-500">Showing last 10 records</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-semibold uppercase text-xs">
                             <tr>
                                 {availableFields.slice(0, 6).map(f => (
                                     <th key={f.id} className="px-6 py-3 whitespace-nowrap">{f.label}</th>
                                 ))}
                             </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                             {filteredData.slice(0, 10).map((item: any, idx) => (
                                 <tr key={idx} className="hover:bg-slate-50">
                                     {availableFields.slice(0, 6).map(f => (
                                         <td key={f.id} className="px-6 py-3 whitespace-nowrap text-slate-700">
                                             {f.getValue(item)}
                                         </td>
                                     ))}
                                 </tr>
                             ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        {/* Export Modal */}
        {isExportModalOpen && (
             <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
                    <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                        <h3 className="font-bold text-lg text-slate-900">Export Configuration</h3>
                        <button onClick={() => setIsExportModalOpen(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        
                        {/* Format Selection */}
                        <div>
                             <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Export Format</label>
                             <div className="flex gap-4">
                                 <label className={`flex-1 p-4 border rounded-xl cursor-pointer transition-all flex items-center gap-3 ${exportFormat === 'csv' ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
                                     <input type="radio" name="format" value="csv" checked={exportFormat === 'csv'} onChange={() => setExportFormat('csv')} className="hidden" />
                                     <div className={`p-2 rounded-lg ${exportFormat === 'csv' ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}><FileSpreadsheet size={24}/></div>
                                     <div>
                                         <span className="font-bold text-sm block text-slate-800">CSV (Excel)</span>
                                         <span className="text-xs text-slate-500">Best for data analysis</span>
                                     </div>
                                 </label>
                                 <label className={`flex-1 p-4 border rounded-xl cursor-pointer transition-all flex items-center gap-3 ${exportFormat === 'pdf' ? 'bg-red-50 border-red-500 ring-1 ring-red-500' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
                                     <input type="radio" name="format" value="pdf" checked={exportFormat === 'pdf'} onChange={() => setExportFormat('pdf')} className="hidden" />
                                     <div className={`p-2 rounded-lg ${exportFormat === 'pdf' ? 'bg-red-200 text-red-800' : 'bg-slate-100 text-slate-500'}`}><FileText size={24}/></div>
                                     <div>
                                         <span className="font-bold text-sm block text-slate-800">PDF Download</span>
                                         <span className="text-xs text-slate-500">Best for sharing & filing</span>
                                     </div>
                                 </label>
                             </div>
                        </div>

                        {/* Templates */}
                        <div>
                            <div className="flex justify-between items-center mb-3">
                                <label className="text-xs font-bold text-slate-500 uppercase">Column Template</label>
                                <div className="flex gap-2">
                                     {!isSaveTemplateMode ? (
                                         <button onClick={() => setIsSaveTemplateMode(true)} className="text-xs text-emerald-600 hover:underline flex items-center gap-1"><Save size={12}/> Save Current</button>
                                     ) : (
                                         <div className="flex items-center gap-2">
                                             <input 
                                                value={newTemplateName} 
                                                onChange={(e) => setNewTemplateName(e.target.value)} 
                                                placeholder="Template Name" 
                                                className="text-xs border border-slate-300 rounded px-2 py-1 outline-none"
                                                autoFocus
                                             />
                                             <button onClick={saveTemplate} disabled={!newTemplateName} className="text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700">Save</button>
                                             <button onClick={() => setIsSaveTemplateMode(false)} className="text-xs text-slate-500 hover:text-slate-700"><X size={12}/></button>
                                         </div>
                                     )}
                                </div>
                            </div>
                            <div className="flex gap-2 items-center">
                                <select 
                                    value={selectedTemplateId} 
                                    onChange={handleTemplateChange}
                                    className="flex-1 bg-white border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10"
                                >
                                    <option value="default">Default Columns</option>
                                    {templates.filter(t => t.type === reportType).map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                                {selectedTemplateId !== 'default' && (
                                    <button onClick={() => deleteTemplate(selectedTemplateId)} className="p-2.5 text-slate-400 hover:text-red-600 border border-slate-300 rounded-lg hover:bg-red-50">
                                        <Trash2 size={16} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Field Selection */}
                        <div>
                             <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Select Columns</label>
                             <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 max-h-60 overflow-y-auto custom-scrollbar">
                                 {availableFields.map((field) => (
                                     <div key={field.id} onClick={() => toggleField(field.id)} className="flex items-center gap-3 p-2 hover:bg-white rounded-lg cursor-pointer group transition-colors">
                                         <div className={`w-5 h-5 rounded flex items-center justify-center border ${selectedFieldIds.includes(field.id) ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-slate-300'}`}>
                                             {selectedFieldIds.includes(field.id) && <CheckSquare size={14} className="text-white" />}
                                         </div>
                                         <span className={`text-sm ${selectedFieldIds.includes(field.id) ? 'text-slate-900 font-medium' : 'text-slate-500'}`}>{field.label}</span>
                                         
                                         {/* Ordering Buttons (Only show if selected) */}
                                         {selectedFieldIds.includes(field.id) && (
                                             <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100">
                                                  <button onClick={(e) => { e.stopPropagation(); moveField(selectedFieldIds.indexOf(field.id), 'up'); }} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"><ChevronUp size={14}/></button>
                                                  <button onClick={(e) => { e.stopPropagation(); moveField(selectedFieldIds.indexOf(field.id), 'down'); }} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"><ChevronDown size={14}/></button>
                                             </div>
                                         )}
                                     </div>
                                 ))}
                             </div>
                        </div>
                    </div>

                    <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                         <button onClick={() => setIsExportModalOpen(false)} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
                         <button onClick={executeExport} className="px-6 py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 shadow-lg shadow-slate-900/20 transition-all">
                             Download Report
                         </button>
                    </div>
                </div>
             </div>
        )}
    </div>
  );
};

export default ReportsModule;

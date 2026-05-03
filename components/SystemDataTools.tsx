
import React, { useState, useRef, useEffect } from 'react';
import { Ticket, Activity, Technician, Customer, Team, Site, Role } from '../types';
import { Database, Download, Upload, AlertTriangle, CheckCircle2, History, FileJson, ShieldAlert, Archive, Play, RefreshCw, X, Loader2 } from 'lucide-react';
import JSZip from 'jszip';

interface SystemDataToolsProps {
  data: {
    tickets: Ticket[];
    activities: Activity[];
    technicians: Technician[];
    customers: Customer[];
    teams: Team[];
    sites: Site[];
  };
  onImport: (newData: any) => void;
  currentUser: any;
}

interface ImportPreview {
    tickets: { create: number, update: number };
    activities: { create: number, update: number };
    technicians: { create: number, update: number, skippedAdmin: number };
    customers: { create: number, update: number };
    teams: { create: number, update: number };
    sites: { create: number, update: number };
}

interface SystemLog {
    id: string;
    timestamp: string;
    action: 'EXPORT' | 'IMPORT' | 'DRY_RUN';
    user: string;
    details: string;
    status: 'SUCCESS' | 'FAILED';
}

const SystemDataTools: React.FC<SystemDataToolsProps> = ({ data, onImport, currentUser }) => {
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'preview' | 'success'>('upload');
  const [dryRunMode, setDryRunMode] = useState(true);
  const [previewStats, setPreviewStats] = useState<ImportPreview | null>(null);
  const [stagedData, setStagedData] = useState<any>(null);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load logs from local storage on mount
  useEffect(() => {
      try {
          const stored = localStorage.getItem('qonnect_system_audit_log');
          if (stored) setLogs(JSON.parse(stored));
      } catch (e) {
          console.error("Failed to load audit logs");
      }
  }, []);

  const addLog = (action: SystemLog['action'], details: string, status: SystemLog['status'] = 'SUCCESS') => {
      const newLog: SystemLog = {
          id: Math.random().toString(36).substr(2, 9),
          timestamp: new Date().toISOString(),
          user: currentUser?.name || 'System',
          action,
          details,
          status
      };
      const updatedLogs = [newLog, ...logs].slice(0, 50); // Keep last 50
      setLogs(updatedLogs);
      localStorage.setItem('qonnect_system_audit_log', JSON.stringify(updatedLogs));
  };

  // --- Export Logic ---
  const handleExport = async () => {
      setLoading(true);
      try {
          const zip = new JSZip();
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          
          const manifest = {
              appName: "Qonnect Field Operations Platform",
              appVersion: "1.2.0",
              exportDate: new Date().toISOString(),
              environment: "production", // Mock env
              exportedBy: currentUser?.name
          };

          zip.file("manifest.json", JSON.stringify(manifest, null, 2));
          zip.file("data.json", JSON.stringify(data, null, 2));
          
          // Generate blob
          const content = await zip.generateAsync({ type: "blob" });
          
          // Trigger download
          const url = URL.createObjectURL(content);
          const link = document.createElement('a');
          link.href = url;
          link.download = `qonnect-backup-${timestamp}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);

          addLog('EXPORT', `Full system backup generated. Size: ${(content.size / 1024).toFixed(2)} KB`);
      } catch (error) {
          console.error("Export failed", error);
          addLog('EXPORT', 'Export process failed', 'FAILED');
          alert('Export failed. Check console.');
      } finally {
          setLoading(false);
      }
  };

  // --- Import Logic ---
  const handleFileDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          processFile(e.dataTransfer.files[0]);
      }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          processFile(e.target.files[0]);
      }
  };

  const processFile = async (file: File) => {
      setLoading(true);
      try {
          const zip = await JSZip.loadAsync(file);
          
          if (!zip.file("manifest.json") || !zip.file("data.json")) {
              throw new Error("Invalid backup archive. Missing manifest or data file.");
          }

          const manifestStr = await zip.file("manifest.json")!.async("string");
          const dataStr = await zip.file("data.json")!.async("string");
          
          const manifest = JSON.parse(manifestStr);
          const importedData = JSON.parse(dataStr);

          // Run Comparison / Dry Run Calculation
          const stats: ImportPreview = {
              tickets: calculateDiff(data.tickets, importedData.tickets),
              activities: calculateDiff(data.activities, importedData.activities),
              technicians: calculateTechDiff(data.technicians, importedData.technicians),
              customers: calculateDiff(data.customers, importedData.customers),
              teams: calculateDiff(data.teams, importedData.teams),
              sites: calculateDiff(data.sites, importedData.sites),
          };

          setPreviewStats(stats);
          setStagedData(importedData);
          setImportStep('preview');
          addLog('DRY_RUN', `Analyzed backup from ${new Date(manifest.exportDate).toLocaleDateString()}`);

      } catch (error) {
          console.error("Import parsing failed", error);
          alert("Failed to parse backup file. Please ensure it is a valid Qonnect export.");
          addLog('IMPORT', 'File parsing failed', 'FAILED');
      } finally {
          setLoading(false);
      }
  };

  const calculateDiff = (current: any[], incoming: any[] = []) => {
      let create = 0;
      let update = 0;
      const currentIds = new Set(current.map(c => c.id));
      
      incoming.forEach(item => {
          if (currentIds.has(item.id)) update++;
          else create++;
      });
      return { create, update };
  };

  const calculateTechDiff = (current: any[], incoming: any[] = []) => {
      let create = 0;
      let update = 0;
      let skippedAdmin = 0;
      
      incoming.forEach(item => {
          const existing = current.find(c => c.id === item.id);
          if (existing) {
              if (existing.systemRole === Role.ADMIN || item.systemRole === Role.ADMIN) {
                  skippedAdmin++; // Protected
              } else {
                  update++;
              }
          } else {
              create++;
          }
      });
      return { create, update, skippedAdmin };
  };

  const executeImport = () => {
      if (!stagedData) return;
      setLoading(true);

      try {
          // Merge Logic
          const merged = {
              tickets: mergeArrays(data.tickets, stagedData.tickets),
              activities: mergeArrays(data.activities, stagedData.activities),
              customers: mergeArrays(data.customers, stagedData.customers),
              teams: mergeArrays(data.teams, stagedData.teams),
              sites: mergeArrays(data.sites, stagedData.sites),
              technicians: mergeTechnicians(data.technicians, stagedData.technicians)
          };

          onImport(merged);
          addLog('IMPORT', 'System data successfully merged and updated.');
          setImportStep('success');
      } catch (e) {
          console.error("Merge failed", e);
          addLog('IMPORT', 'Merge process failed during execution', 'FAILED');
          alert('System merge failed.');
      } finally {
          setLoading(false);
      }
  };

  const mergeArrays = (current: any[], incoming: any[] = []) => {
      const merged = [...current];
      incoming.forEach(item => {
          const idx = merged.findIndex(m => m.id === item.id);
          if (idx >= 0) {
              merged[idx] = { ...merged[idx], ...item }; // Merge fields, prioritize incoming
          } else {
              merged.push(item);
          }
      });
      return merged;
  };

  const mergeTechnicians = (current: Technician[], incoming: Technician[] = []) => {
      const merged = [...current];
      incoming.forEach(item => {
          const idx = merged.findIndex(m => m.id === item.id);
          if (idx >= 0) {
              // Safety Check: Do not overwrite ADMINS
              if (merged[idx].systemRole !== Role.ADMIN) {
                  merged[idx] = { ...merged[idx], ...item };
              }
          } else {
              merged.push(item);
          }
      });
      return merged;
  };

  const resetImport = () => {
      setImportStep('upload');
      setPreviewStats(null);
      setStagedData(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- UI Components ---

  return (
    <div className="p-8 max-w-6xl mx-auto animate-in fade-in duration-300">
        <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <Database className="text-slate-600" /> System Data Tools
            </h1>
            <p className="text-slate-500 text-sm mt-1">
                Manage full system backups and migrations. Restricted to System Administrators.
            </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            
            {/* EXPORT CARD */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                <div className="flex items-start justify-between mb-4">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                        <Archive size={24} />
                    </div>
                    <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded">JSON Archive</span>
                </div>
                <h2 className="text-lg font-bold text-slate-800 mb-2">Export System Backup</h2>
                <p className="text-sm text-slate-500 mb-6 flex-1">
                    Generates a complete snapshot of all tickets, users, activities, and settings. 
                    Includes a manifest file for version compatibility.
                </p>
                <button 
                    onClick={handleExport}
                    disabled={loading}
                    className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-900/10 disabled:opacity-50"
                >
                    {loading ? <Loader2 className="animate-spin" /> : <Download size={18} />}
                    Download Backup ZIP
                </button>
            </div>

            {/* IMPORT CARD */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                <div className="flex items-start justify-between mb-4">
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                        <RefreshCw size={24} />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">Dry Run</span>
                        <div 
                            onClick={() => importStep === 'upload' && setDryRunMode(!dryRunMode)}
                            className={`w-8 h-4 rounded-full p-0.5 cursor-pointer transition-colors ${dryRunMode ? 'bg-emerald-500' : 'bg-slate-300'} ${importStep !== 'upload' ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${dryRunMode ? 'translate-x-4' : ''}`} />
                        </div>
                    </div>
                </div>
                
                <h2 className="text-lg font-bold text-slate-800 mb-2">Import Data</h2>
                
                {importStep === 'upload' && (
                    <div 
                        className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-6 transition-colors ${dragActive ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                        onDragEnter={() => setDragActive(true)}
                        onDragLeave={() => setDragActive(false)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleFileDrop}
                    >
                        <Upload size={32} className="text-slate-400 mb-3" />
                        <p className="text-sm font-medium text-slate-600 text-center">
                            Drag backup ZIP here or <br/>
                            <span 
                                onClick={() => fileInputRef.current?.click()} 
                                className="text-emerald-600 hover:underline cursor-pointer"
                            >
                                browse files
                            </span>
                        </p>
                        <input 
                            ref={fileInputRef} 
                            type="file" 
                            accept=".zip" 
                            onChange={handleFileSelect} 
                            className="hidden" 
                        />
                    </div>
                )}

                {importStep === 'preview' && previewStats && (
                    <div className="flex-1 space-y-4">
                        <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg flex items-center gap-2 text-xs text-amber-800">
                            <ShieldAlert size={16} /> Review changes before confirming.
                        </div>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between border-b pb-1">
                                <span className="text-slate-500">Tickets</span>
                                <span className="font-mono text-slate-800">+{previewStats.tickets.create} / ~{previewStats.tickets.update}</span>
                            </div>
                            <div className="flex justify-between border-b pb-1">
                                <span className="text-slate-500">Activities</span>
                                <span className="font-mono text-slate-800">+{previewStats.activities.create} / ~{previewStats.activities.update}</span>
                            </div>
                            <div className="flex justify-between border-b pb-1">
                                <span className="text-slate-500">Staff</span>
                                <span className="font-mono text-slate-800">+{previewStats.technicians.create} / ~{previewStats.technicians.update}</span>
                            </div>
                            {previewStats.technicians.skippedAdmin > 0 && (
                                <div className="text-[10px] text-slate-400 text-right italic">
                                    {previewStats.technicians.skippedAdmin} Admin records protected
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2 pt-2">
                            <button onClick={resetImport} className="flex-1 py-2 text-slate-500 font-bold bg-slate-100 rounded-lg hover:bg-slate-200">Cancel</button>
                            <button onClick={executeImport} className="flex-1 py-2 text-white font-bold bg-emerald-600 rounded-lg hover:bg-emerald-700 shadow-lg shadow-emerald-900/20">
                                {dryRunMode ? 'Confirm Dry Run' : 'Execute Import'}
                            </button>
                        </div>
                    </div>
                )}

                {importStep === 'success' && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                        <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-3">
                            <CheckCircle2 size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-800">Import Successful</h3>
                        <p className="text-sm text-slate-500 mt-1 mb-4">System data has been merged.</p>
                        <button onClick={resetImport} className="text-sm font-bold text-slate-600 hover:underline">Start New Import</button>
                    </div>
                )}
            </div>
        </div>

        {/* LOG TABLE */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                <History size={16} className="text-slate-500" />
                <h3 className="font-bold text-sm text-slate-700 uppercase tracking-wide">Audit Log</h3>
            </div>
            <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-medium text-xs uppercase sticky top-0">
                        <tr>
                            <th className="px-6 py-3">Timestamp</th>
                            <th className="px-6 py-3">User</th>
                            <th className="px-6 py-3">Action</th>
                            <th className="px-6 py-3">Details</th>
                            <th className="px-6 py-3 text-right">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {logs.length === 0 ? (
                            <tr><td colSpan={5} className="p-6 text-center text-slate-400 italic">No activity recorded</td></tr>
                        ) : logs.map(log => (
                            <tr key={log.id} className="hover:bg-slate-50">
                                <td className="px-6 py-3 font-mono text-slate-500 text-xs">
                                    {new Date(log.timestamp).toLocaleString()}
                                </td>
                                <td className="px-6 py-3 font-medium text-slate-700">{log.user}</td>
                                <td className="px-6 py-3">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        log.action === 'EXPORT' ? 'bg-blue-50 text-blue-700' :
                                        log.action === 'IMPORT' ? 'bg-purple-50 text-purple-700' :
                                        'bg-slate-100 text-slate-600'
                                    }`}>
                                        {log.action}
                                    </span>
                                </td>
                                <td className="px-6 py-3 text-slate-600">{log.details}</td>
                                <td className="px-6 py-3 text-right">
                                    <span className={`text-xs font-bold ${log.status === 'SUCCESS' ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {log.status}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
  );
};

export default SystemDataTools;

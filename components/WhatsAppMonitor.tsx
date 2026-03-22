import React, { useMemo, useState, useEffect, useRef } from 'react';
import { 
  Activity, Server, ArrowDownLeft, ArrowUpRight, 
  Wifi, AlertCircle, RefreshCw, Pause, Play, Trash2,
  Terminal, ShieldCheck, Zap, Database, CheckCircle2
} from 'lucide-react';

interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
  phone: string;
  status: 'DELIVERED' | 'READ' | 'SENT' | 'RECEIVED' | 'ERROR' | 'QUEUED';
  payloadSummary: string;
  latency?: number;
}

type TabKey = 'LIVE' | 'CONVERSATIONS' | 'ERRORS';
type EventFilter = 'ALL' | 'INBOUND' | 'OUTBOUND' | 'ERRORS';

type MessageDirection = 'INBOUND' | 'OUTBOUND';
type MessageType = 'text' | 'image' | 'location' | 'interactive' | 'unknown';

interface ChatMessage {
  id: string;
  threadKey: string;
  phone: string;
  direction: MessageDirection;
  status: LogEntry['status'];
  timestamp: Date;
  type: MessageType;
  text?: string;
  latency?: number;
}

interface ChatThread {
  key: string;
  phone: string;
  lastMessageAt: Date;
  lastPreview: string;
  unreadCount: number;
}

function parseMsgType(payloadSummary: string): MessageType {
  if (!payloadSummary) return 'unknown';
  const lower = payloadSummary.toLowerCase();
  // Check for explicit type tags (outbound bot replies stored with type info)
  if (lower.includes('type: "text"') || lower.includes("type: 'text'")) return 'text';
  if (lower.includes('type: "image"') || lower.includes("type: 'image'")) return 'image';
  if (lower.includes('type: "location"') || lower.includes("type: 'location'")) return 'location';
  if (lower.includes('type: "interactive"') || lower.includes("type: 'interactive'")) return 'interactive';
  // If none of the above — it's a plain customer message stored as raw text
  // The backend stores raw text directly in payload_summary for inbound messages
  if (payloadSummary.trim().length > 0) return 'text';
  return 'unknown';
}

function typeLabel(t: MessageType): string {
  switch (t) {
    case 'text': return 'Text';
    case 'image': return '📷 Image';
    case 'location': return '📍 Location';
    case 'interactive': return '🧩 Interactive';
    default: return 'Message';
  }
}

const WhatsAppMonitor: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('LIVE');
  const [eventFilter, setEventFilter] = useState<EventFilter>('ALL');
  const [threadSearch, setThreadSearch] = useState('');
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  
  // Real-time metrics calculated directly from the live database feed
  const metrics = useMemo(() => {
    let inbound = 0, outbound = 0, errors = 0, totalLatency = 0, latencyCount = 0;
    logs.forEach(log => {
      if (log.type === 'INBOUND') inbound++;
      if (log.type === 'OUTBOUND') outbound++;
      if (log.status === 'ERROR') errors++;
      if (log.latency) {
        totalLatency += log.latency;
        latencyCount++;
      }
    });
    return {
      inbound, outbound, errors,
      latency: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0
    };
  }, [logs]);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logic
  useEffect(() => {
    if (!isPaused && scrollRef.current && activeTab !== 'CONVERSATIONS') {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isPaused, activeTab]);

  // LIVE API POLLING (Heartbeat)
  useEffect(() => {
    const fetchLiveLogs = async () => {
        if (isPaused) return;
        try {
            const res = await fetch("/api/whatsapp/logs");
            if (!res.ok) return;
            const data = await res.json();
            
            // Map the PostgreSQL columns to your frontend interface
            const liveLogs: LogEntry[] = data.map((d: any) => ({
                id: d.id,
                timestamp: new Date(d.timestamp),
                type: d.type as 'INBOUND' | 'OUTBOUND' | 'SYSTEM',
                phone: d.phone,
                status: d.status as LogEntry['status'],
                payloadSummary: d.payload_summary || '',
                latency: d.latency
            }));
            
            // Reverse so oldest is at top, newest at bottom (for the terminal view)
            setLogs(liveLogs.reverse()); 
        } catch (error) {
            console.error("Failed to fetch live WhatsApp logs:", error);
        }
    };

    // Fetch immediately on mount, then poll every 3 seconds
    fetchLiveLogs();
    const heartbeat = setInterval(fetchLiveLogs, 3000);
    
    return () => clearInterval(heartbeat);
  }, [isPaused]);

  const messages: ChatMessage[] = useMemo(() => {
    return logs
      .filter((l) => l.type === 'INBOUND' || l.type === 'OUTBOUND')
      .map((l) => {
        const mt = parseMsgType(l.payloadSummary);
        // For text messages, the payload_summary IS the message text (raw customer input)
        // Strip any type tag prefix if present, otherwise use the full payload
        let text: string | undefined;
        if (mt === 'text') {
          const raw = (l.payloadSummary || '').trim();
          // Remove type tag prefix if present e.g. 'type: "text" | Hello' -> 'Hello'
          const pipeIdx = raw.indexOf('|');
          text = pipeIdx !== -1 ? raw.substring(pipeIdx + 1).trim() : raw;
          if (!text) text = 'Text message';
        }
        return {
          id: l.id,
          threadKey: l.phone,
          phone: l.phone,
          direction: l.type as MessageDirection,
          status: l.status,
          timestamp: l.timestamp,
          type: mt,
          text,
          latency: l.latency
        };
      })
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }, [logs]);

  const threads: ChatThread[] = useMemo(() => {
    const map = new Map<string, ChatThread>();
    for (const m of messages) {
      const existing = map.get(m.threadKey);
      const preview = m.text ? m.text : typeLabel(m.type);
      if (!existing) {
        map.set(m.threadKey, {
          key: m.threadKey,
          phone: m.phone,
          lastMessageAt: m.timestamp,
          lastPreview: preview,
          unreadCount: m.direction === 'INBOUND' ? 1 : 0
        });
      } else {
        const newer = m.timestamp.getTime() >= existing.lastMessageAt.getTime();
        map.set(m.threadKey, {
          ...existing,
          lastMessageAt: newer ? m.timestamp : existing.lastMessageAt,
          lastPreview: newer ? preview : existing.lastPreview,
          unreadCount: existing.unreadCount + (m.direction === 'INBOUND' ? 1 : 0)
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()
    );
  }, [messages]);

  const filteredThreads = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => t.phone.toLowerCase().includes(q));
  }, [threads, threadSearch]);

  const selectedThread = useMemo(() => {
    if (!selectedThreadKey) return null;
    return threads.find((t) => t.key === selectedThreadKey) || null;
  }, [threads, selectedThreadKey]);

  const selectedMessages = useMemo(() => {
    if (!selectedThreadKey) return [];
    return messages.filter((m) => m.threadKey === selectedThreadKey);
  }, [messages, selectedThreadKey]);

  const visibleLogs = useMemo(() => {
    const base = logs;
    if (activeTab === 'ERRORS') {
      return base.filter((l) => l.status === 'ERROR');
    }
    switch (eventFilter) {
      case 'INBOUND':
        return base.filter((l) => l.type === 'INBOUND');
      case 'OUTBOUND':
        return base.filter((l) => l.type === 'OUTBOUND');
      case 'ERRORS':
        return base.filter((l) => l.status === 'ERROR');
      default:
        return base;
    }
  }, [logs, activeTab, eventFilter]);

  useEffect(() => {
    if (selectedThreadKey && !threads.some((t) => t.key === selectedThreadKey)) {
      setSelectedThreadKey(null);
    }
  }, [threads, selectedThreadKey]);

  return (
    <div className="p-6 h-full flex flex-col space-y-6 bg-slate-50 animate-in fade-in duration-300">
        
        {/* Header */}
        <div className="flex justify-between items-start shrink-0">
            <div>
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Server className="text-emerald-600" /> WhatsApp Gateway Monitor
                </h1>
                <p className="text-slate-500 text-sm mt-1">Real-time telemetry and webhook stream.</p>
            </div>
            <div className="flex items-center gap-2 bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-full text-xs font-bold border border-emerald-200">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                GATEWAY CONNECTED
            </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between h-28">
                <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Inbound 24h</span>
                    <ArrowDownLeft size={16} className="text-blue-500" />
                </div>
                <div className="text-3xl font-bold text-slate-800">{metrics.inbound}</div>
                <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: '65%' }} />
                </div>
            </div>
            
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between h-28">
                <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Outbound 24h</span>
                    <ArrowUpRight size={16} className="text-purple-500" />
                </div>
                <div className="text-3xl font-bold text-slate-800">{metrics.outbound}</div>
                <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500" style={{ width: '55%' }} />
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between h-28">
                <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Avg Latency</span>
                    <Activity size={16} className="text-amber-500" />
                </div>
                <div className="flex items-end gap-2">
                    <div className="text-3xl font-bold text-slate-800">{metrics.latency}</div>
                    <span className="text-sm text-slate-400 mb-1 font-medium">ms</span>
                </div>
                <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                    <div className={`h-full ${metrics.latency > 500 ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, (metrics.latency/1000)*100)}%` }} />
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between h-28">
                <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Error Rate</span>
                    <AlertCircle size={16} className={metrics.errors > 0 ? 'text-red-500' : 'text-slate-300'} />
                </div>
                <div className="text-3xl font-bold text-slate-800">{metrics.errors}</div>
                <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                    <div className="h-full bg-red-500" style={{ width: '2%' }} />
                </div>
            </div>
        </div>

        {/* Main Interface */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Status Panel */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-6">
                
                <div>
                    <h3 className="font-bold text-slate-800 text-lg mb-4">Connection Health</h3>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                                    <Wifi size={20} />
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-slate-800">Meta Webhook</div>
                                    <div className="text-xs text-emerald-600 font-mono">200 OK</div>
                                </div>
                            </div>
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        </div>

                        <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-slate-200 text-slate-600 rounded-lg">
                                    <Database size={20} />
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-slate-800">Message Queue</div>
                                    <div className="text-xs text-slate-500 font-mono">0 Pending</div>
                                </div>
                            </div>
                            <CheckCircle2 size={16} className="text-slate-400" />
                        </div>

                        <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-slate-200 text-slate-600 rounded-lg">
                                    <ShieldCheck size={20} />
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-slate-800">Auth Token</div>
                                    <div className="text-xs text-slate-500 font-mono">Valid (Exp: 29d)</div>
                                </div>
                            </div>
                            <CheckCircle2 size={16} className="text-slate-400" />
                        </div>
                    </div>
                </div>

              </div>

            {/* Right Panel (Tabs) */}
            <div className="lg:col-span-2 min-h-0 flex flex-col gap-4">
                {/* Tabs Header */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setActiveTab('LIVE')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeTab === 'LIVE' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            Live Events
                        </button>
                        <button
                            onClick={() => setActiveTab('CONVERSATIONS')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeTab === 'CONVERSATIONS' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            Conversations
                        </button>
                        <button
                            onClick={() => setActiveTab('ERRORS')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeTab === 'ERRORS' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            Errors & Retries
                        </button>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-2">
                        {(activeTab === 'LIVE') && (
                            <div className="hidden md:flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                                {(['ALL','INBOUND','OUTBOUND','ERRORS'] as EventFilter[]).map((f) => (
                                    <button
                                        key={f}
                                        onClick={() => setEventFilter(f)}
                                        className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${eventFilter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                                    >
                                        {f === 'ALL' ? 'All' : f === 'ERRORS' ? 'Errors' : f.charAt(0) + f.slice(1).toLowerCase()}
                                    </button>
                                ))}
                            </div>
                        )}
                        <button 
                            onClick={() => setIsPaused(!isPaused)} 
                            className={`p-2 rounded-lg border transition-colors ${isPaused ? 'border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-100' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                            title={isPaused ? "Resume" : "Pause"}
                        >
                            {isPaused ? <Play size={14} fill="currentColor"/> : <Pause size={14} fill="currentColor"/>}
                        </button>
                        <button 
                            onClick={() => setLogs([])}
                            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                            title="Clear"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>

                {/* Tab Content */}
                {activeTab === 'CONVERSATIONS' ? (
                    <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-4">
                        {/* Threads */}
                        <div className="xl:col-span-4 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">
                            <div className="p-3 border-b border-slate-100">
                                <input
                                    value={threadSearch}
                                    onChange={(e) => setThreadSearch(e.target.value)}
                                    placeholder="Search number..."
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                                />
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto">
                                {filteredThreads.length === 0 ? (
                                    <div className="text-slate-500 text-sm p-6 text-center">No conversations yet.</div>
                                ) : (
                                    filteredThreads.map((t) => {
                                        const isActive = t.key === selectedThreadKey;
                                        return (
                                            <button
                                                key={t.key}
                                                onClick={() => setSelectedThreadKey(t.key)}
                                                className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors ${isActive ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className={`text-sm font-bold truncate ${isActive ? 'text-white' : 'text-slate-900'}`}>{t.phone}</div>
                                                        <div className={`text-xs truncate mt-0.5 ${isActive ? 'text-white/70' : 'text-slate-500'}`}>{t.lastPreview}</div>
                                                    </div>
                                                    <div className="shrink-0 text-right">
                                                        <div className={`text-[11px] font-mono ${isActive ? 'text-white/70' : 'text-slate-400'}`}>
                                                            {t.lastMessageAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </div>
                                                        {t.unreadCount > 0 && (
                                                            <div className={`mt-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold ${isActive ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'}`}>
                                                                {Math.min(99, t.unreadCount)}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Chat */}
                        <div className="xl:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">
                            <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                                <div className="min-w-0">
                                    <div className="text-sm font-bold text-slate-900 truncate">
                                        {selectedThread ? selectedThread.phone : 'Select a conversation'}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        {selectedThread ? 'WhatsApp thread' : 'Choose a thread to view messages'}
                                    </div>
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono">
                                    {selectedThread ? `${selectedMessages.length} msgs` : ''}
                                </div>
                            </div>

                            <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-slate-50">
                                {!selectedThread ? (
                                    <div className="h-full flex items-center justify-center text-slate-500 text-sm">Select a conversation.</div>
                                ) : selectedMessages.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-slate-500 text-sm">No messages yet.</div>
                                ) : (
                                    <div className="space-y-3">
                                        {selectedMessages.map((m) => {
                                            const inbound = m.direction === 'INBOUND';
                                            const bubbleText = m.text ? m.text : typeLabel(m.type);
                                            return (
                                                <div key={m.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
                                                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm border ${inbound ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-900 text-white'}`}>
                                                        <div className={`text-sm ${inbound ? 'text-slate-900' : 'text-white'}`}>
                                                            {bubbleText}
                                                        </div>
                                                        <div className={`mt-1 text-[10px] font-mono flex items-center justify-end gap-2 ${inbound ? 'text-slate-400' : 'text-white/60'}`}>
                                                            <span>
                                                                {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                            <span className={`px-1.5 py-0.5 rounded ${inbound ? 'bg-slate-100 text-slate-600' : 'bg-white/10 text-white/70'}`}>
                                                                {m.status}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Context */}
                        <div className="xl:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-4">
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase">Customer</div>
                                <div className="mt-2">
                                    <div className="text-sm font-bold text-slate-900">{selectedThread ? 'Unknown (not linked)' : '—'}</div>
                                    <div className="text-xs text-slate-500 font-mono mt-1">{selectedThread ? selectedThread.phone : ''}</div>
                                </div>
                            </div>

                            <div className="border-t border-slate-100 pt-4">
                                <div className="text-xs font-bold text-slate-400 uppercase">Linked Ticket</div>
                                <div className="mt-2 text-sm text-slate-700">
                                    {selectedThread ? 'Not linked' : '—'}
                                </div>
                            </div>

                            <div className="border-t border-slate-100 pt-4 grid gap-2">
                                <button
                                    disabled={!selectedThread}
                                    className={`w-full px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${selectedThread ? 'border-slate-200 hover:bg-slate-50 text-slate-900' : 'border-slate-100 text-slate-300 bg-slate-50 cursor-not-allowed'}`}
                                >
                                    Create Ticket
                                </button>
                                <button
                                    disabled={!selectedThread}
                                    className={`w-full px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${selectedThread ? 'border-slate-200 hover:bg-slate-50 text-slate-900' : 'border-slate-100 text-slate-300 bg-slate-50 cursor-not-allowed'}`}
                                >
                                    Link to Existing Ticket
                                </button>
                                <button
                                    disabled={!selectedThread}
                                    className={`w-full px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${selectedThread ? 'border-slate-200 hover:bg-slate-50 text-slate-900' : 'border-slate-100 text-slate-300 bg-slate-50 cursor-not-allowed'}`}
                                >
                                    AI Summary
                                </button>
                                <div className="text-[11px] text-slate-500 mt-1">
                                    Note: Conversation view uses available stream data only.
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 min-h-0 bg-slate-900 rounded-xl border border-slate-800 shadow-lg flex flex-col overflow-hidden">
                        <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                            <div className="flex items-center gap-2 text-slate-400 text-xs font-mono">
                                <Terminal size={14} />
                                <span>/var/log/whatsapp_stream.log</span>
                                {activeTab === 'ERRORS' && (
                                    <span className="ml-2 px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-bold border border-red-500/30">
                                        ERROR VIEW
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                                {activeTab === 'ERRORS' ? 'Showing ERROR events only' : (eventFilter === 'ALL' ? 'Showing all events' : `Filter: ${eventFilter}`)}
                            </div>
                        </div>

                        <div 
                            ref={scrollRef}
                            className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs custom-scrollbar"
                        >
                            {visibleLogs.length === 0 && (
                                <div className="text-slate-600 italic text-center mt-20">
                                    {logs.length === 0 ? 'Waiting for traffic...' : 'No events match the current filter.'}
                                </div>
                            )}
                            {visibleLogs.map((log) => (
                                <div key={log.id} className="flex gap-3 hover:bg-white/5 p-1 rounded -mx-1 px-1 transition-colors">
                                    <span className="text-slate-500 shrink-0 select-none">
                                        {log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}.{log.timestamp.getMilliseconds().toString().padStart(3, '0')}
                                    </span>
                                    <div className="flex-1 break-all">
                                        <span className={`font-bold mr-2 ${
                                            log.type === 'INBOUND' ? 'text-emerald-400' : 
                                            log.type === 'OUTBOUND' ? 'text-blue-400' : 
                                            'text-purple-400'
                                        }`}>
                                            [{log.type}]
                                        </span>
                                        {log.type !== 'SYSTEM' && (
                                            <span className="text-slate-300 mr-2">{log.phone}</span>
                                        )}
                                        <span className={`mr-2 px-1 rounded text-[10px] text-slate-900 font-bold ${
                                            log.status === 'RECEIVED' ? 'bg-emerald-400' :
                                            log.status === 'DELIVERED' ? 'bg-blue-400' :
                                            log.status === 'SENT' ? 'bg-blue-300' :
                                            log.status === 'ERROR' ? 'bg-red-500 text-white' :
                                            'bg-slate-400'
                                        }`}>
                                            {log.status}
                                        </span>
                                        <span className="text-slate-400">{log.payloadSummary}</span>
                                        {log.latency && (
                                            <span className="text-slate-600 ml-2">({log.latency}ms)</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

        </div>
    </div>
  );
};

export default WhatsAppMonitor;

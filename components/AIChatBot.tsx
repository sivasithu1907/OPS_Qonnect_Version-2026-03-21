
import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Bot, Minimize2 } from 'lucide-react';
import { getChatResponse } from '../services/geminiService';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

// --- Helper: Formatted Message Renderer ---
const FormattedMessage: React.FC<{ text: string; isUser: boolean }> = ({ text, isUser }) => {
  if (isUser) {
    return <div className="whitespace-pre-wrap break-words">{text}</div>;
  }

  // Simple Markdown Parser for Assistant
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: React.ReactNode[] = [];

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="list-disc pl-5 mb-3 space-y-1 text-slate-700">
          {currentList}
        </ul>
      );
      currentList = [];
    }
  };

  const processInline = (str: string) => {
    // Split by bold syntax **text**
    const parts = str.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    
    // Handle Empty Lines (Paragraph Spacing)
    if (!trimmed) {
      flushList();
      return; // Skip empty line rendering to let margins handle spacing
    }

    // Handle Headings
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h4 key={i} className="text-sm font-bold text-slate-900 mt-4 mb-2">
          {processInline(trimmed.replace(/^###\s+/, ''))}
        </h4>
      );
    } 
    else if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h3 key={i} className="text-base font-bold text-slate-900 mt-5 mb-2 border-b border-slate-100 pb-1">
          {processInline(trimmed.replace(/^##\s+/, ''))}
        </h3>
      );
    } 
    // Handle List Items
    else if (trimmed.match(/^[\*\-]\s/)) {
      currentList.push(
        <li key={i} className="pl-1">
          {processInline(trimmed.replace(/^[\*\-]\s+/, ''))}
        </li>
      );
    } 
    // Handle Regular Paragraphs
    else {
      flushList();
      elements.push(
        <p key={i} className="mb-2 leading-relaxed text-slate-700">
          {processInline(line)}
        </p>
      );
    }
  });

  flushList(); // Flush any remaining list items

  return <div className="text-sm leading-6">{elements}</div>;
};

const AIChatBot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', role: 'model', text: 'Hi! I am the Qonnect AI Assistant. How can I help you today?' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'; // Reset height
      if (inputValue) {
        // Set to scrollHeight but cap at 150px
        const newHeight = Math.min(textareaRef.current.scrollHeight, 150);
        textareaRef.current.style.height = `${newHeight}px`;
      }
    }
  }, [inputValue, isOpen]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, isOpen]);

  const handleSend = async () => {
    if (!inputValue.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: inputValue
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);
    
    // Reset height immediately after send
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
    }

    try {
      const history = messages.map(m => ({ role: m.role, text: m.text }));
      const responseText = await getChatResponse(history, userMsg.text);

      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText
      };
      setMessages(prev => [...prev, botMsg]);
    } catch (e) {
      console.error(e);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] hidden md:flex flex-col items-end">
      
      {/* Chat Window */}
      {isOpen && (
        <div className="bg-white w-[340px] h-[500px] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden mb-4 animate-in slide-in-from-bottom-10 fade-in duration-200">
          {/* Header */}
          <div className="bg-slate-900 p-4 flex justify-between items-center text-white shrink-0 shadow-sm z-10">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-500 p-2 rounded-xl shadow-lg shadow-emerald-900/20">
                <Bot size={20} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-sm tracking-wide">Qonnect Assistant</h3>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1.5 font-medium">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"/> Online
                </span>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white transition-colors p-1 hover:bg-slate-800 rounded-lg">
              <Minimize2 size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl p-3.5 shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-emerald-600 text-white rounded-tr-none' 
                    : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'
                }`}>
                  <FormattedMessage text={msg.text} isUser={msg.role === 'user'} />
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-4 shadow-sm flex gap-1 items-center">
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-3 bg-white border-t border-slate-100 flex items-end gap-2 shrink-0">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask anything..."
              className="flex-1 bg-slate-100 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 resize-none overflow-y-auto min-h-[44px] max-h-[150px] custom-scrollbar"
            />
            <button 
              onClick={handleSend}
              disabled={!inputValue.trim() || isTyping}
              className="bg-slate-900 text-white p-3 rounded-xl hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm mb-[1px]"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`${isOpen ? 'bg-slate-700' : 'bg-slate-900'} text-white p-4 rounded-full shadow-2xl hover:scale-105 transition-all active:scale-95 flex items-center justify-center border-4 border-slate-50`}
      >
        {isOpen ? <X size={24} /> : <MessageCircle size={28} />}
      </button>
    </div>
  );
};

export default AIChatBot;

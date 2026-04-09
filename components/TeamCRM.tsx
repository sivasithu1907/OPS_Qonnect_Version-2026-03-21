
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Technician, Role } from '../types';
import { Edit, Trash2, Eye, Plus, X, Mail, Phone, Briefcase, Camera, Upload, Shield, Wrench, BriefcaseBusiness, Users, ZoomIn, ZoomOut, Move } from 'lucide-react';
import { generateTechId } from '../utils/idUtils';

// ── Avatar Cropper Component ──
const AvatarCropper: React.FC<{
  imageSrc: string;
  onCrop: (croppedDataUrl: string) => void;
  onCancel: () => void;
}> = ({ imageSrc, onCrop, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const SIZE = 240; // preview size

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      setImg(image);
      // Fit image to cover the circle
      const minScale = SIZE / Math.min(image.width, image.height);
      setScale(minScale);
      setOffset({
        x: (SIZE - image.width * minScale) / 2,
        y: (SIZE - image.height * minScale) / 2
      });
    };
    image.src = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, offset.x, offset.y, img.width * scale, img.height * scale);
    ctx.restore();
  }, [img, scale, offset]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handleMouseUp = () => setDragging(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    setDragging(true);
    setDragStart({ x: t.clientX - offset.x, y: t.clientY - offset.y });
  };

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging) return;
    const t = e.touches[0];
    setOffset({ x: t.clientX - dragStart.x, y: t.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handleCrop = () => {
    if (!canvasRef.current) return;
    // Render final 256x256 output
    const out = document.createElement('canvas');
    out.width = 256;
    out.height = 256;
    const ctx = out.getContext('2d');
    if (!ctx || !img) return;
    const ratio = 256 / SIZE;
    ctx.beginPath();
    ctx.arc(128, 128, 128, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, offset.x * ratio, offset.y * ratio, img.width * scale * ratio, img.height * scale * ratio);
    onCrop(out.toDataURL('image/jpeg', 0.85));
  };

  const adjustZoom = (delta: number) => {
    if (!img) return;
    const minScale = SIZE / Math.max(img.width, img.height) * 0.5;
    const maxScale = SIZE / Math.min(img.width, img.height) * 3;
    const newScale = Math.max(minScale, Math.min(maxScale, scale + delta));
    // Zoom toward center
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const factor = newScale / scale;
    setOffset({
      x: cx - (cx - offset.x) * factor,
      y: cy - (cy - offset.y) * factor
    });
    setScale(newScale);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-bold text-slate-900">Adjust Photo</h3>
          <button onClick={onCancel}><X size={20} className="text-slate-400" /></button>
        </div>
        <div className="p-6 flex flex-col items-center gap-4">
          <p className="text-xs text-slate-400 flex items-center gap-1"><Move size={12} /> Drag to reposition</p>
          <div
            className="relative rounded-full overflow-hidden border-4 border-slate-200 shadow-inner cursor-grab active:cursor-grabbing"
            style={{ width: SIZE, height: SIZE, touchAction: 'none' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={() => setDragging(false)}
          >
            <canvas ref={canvasRef} width={SIZE} height={SIZE} className="w-full h-full" />
          </div>
          {/* Zoom controls */}
          <div className="flex items-center gap-3 w-full max-w-[240px]">
            <button type="button" onClick={() => adjustZoom(-0.02)} className="p-1.5 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
              <ZoomOut size={16} className="text-slate-600" />
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={img ? ((scale - SIZE / Math.max(img.width, img.height) * 0.5) / (SIZE / Math.min(img.width, img.height) * 3 - SIZE / Math.max(img.width, img.height) * 0.5) * 100) : 50}
              onChange={(e) => {
                if (!img) return;
                const minS = SIZE / Math.max(img.width, img.height) * 0.5;
                const maxS = SIZE / Math.min(img.width, img.height) * 3;
                const newScale = minS + (Number(e.target.value) / 100) * (maxS - minS);
                const cx = SIZE / 2;
                const cy = SIZE / 2;
                const factor = newScale / scale;
                setOffset({ x: cx - (cx - offset.x) * factor, y: cy - (cy - offset.y) * factor });
                setScale(newScale);
              }}
              className="flex-1 accent-emerald-600"
            />
            <button type="button" onClick={() => adjustZoom(0.02)} className="p-1.5 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
              <ZoomIn size={16} className="text-slate-600" />
            </button>
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors">Cancel</button>
          <button type="button" onClick={handleCrop} className="flex-1 py-2.5 bg-slate-900 text-white font-bold rounded-xl shadow-lg hover:bg-slate-800 transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
};

interface TeamCRMProps {
  technicians: Technician[];
  onSaveTech: (tech: Technician) => void;
  onDeleteTech: (id: string) => void;
}

const TeamCRM: React.FC<TeamCRMProps> = ({ 
    technicians, 
    onSaveTech,
    onDeleteTech,
}) => {
  const [modalType, setModalType] = useState<'add' | 'edit' | 'view' | null>(null);
  const [activeTech, setActiveTech] = useState<Technician | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [currentLevel, setCurrentLevel] = useState<string>('FIELD_ENGINEER');
  const [formSystemRole, setFormSystemRole] = useState<string>('');
  const [saveToast, setSaveToast] = useState(false);
  const [cropperImage, setCropperImage] = useState<string | null>(null); // Raw image for cropper

  const fileInputRef = useRef<HTMLInputElement>(null);

  const teamLeads = technicians.filter(t => t.level === 'TEAM_LEAD' && t.systemRole !== 'ADMIN');
  const fieldEngineers = technicians.filter(t => t.level === 'FIELD_ENGINEER' && t.systemRole !== 'ADMIN');
  const salesTeam = technicians.filter(t => t.level === 'SALES');
  const technicalAssociates = technicians.filter(t => t.level === 'TECHNICAL_ASSOCIATE');

  const openModal = (type: 'add' | 'edit' | 'view', tech?: Technician) => {
      setModalType(type);
      setActiveTech(tech || null);
      
      const level = tech?.level || 'FIELD_ENGINEER';
      setCurrentLevel(level);
      // For SALES and TECHNICAL_ASSOCIATE, system role is usually empty/none
      const isNoSystemRoleLevel = level === 'SALES' || level === 'TECHNICAL_ASSOCIATE';
      setFormSystemRole(tech?.systemRole || (isNoSystemRoleLevel ? '' : Role.FIELD_ENGINEER));

      if (tech?.avatar) {
          setAvatarPreview(tech.avatar);
      } else {
          setAvatarPreview(null);
      }
  };

  const closeModal = () => {
      setModalType(null);
      setActiveTech(null);
      setAvatarPreview(null);
      setCropperImage(null);
  };

  const handleDelete = (id: string, e?: React.MouseEvent) => {
      if (e) {
          e.preventDefault();
          e.stopPropagation();
      }

      if (window.confirm("Are you sure you want to delete this team member? This action cannot be undone.")) {
          onDeleteTech(id);
          closeModal();
      }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              setCropperImage(reader.result as string); // Open cropper with raw image
          };
          reader.readAsDataURL(file);
          // Reset input so same file can be re-selected
          if (fileInputRef.current) fileInputRef.current.value = '';
      }
  };

  const getLocalPhone = (fullPhone?: string) => {
      if (!fullPhone) return '';
      // Strip +974 with or without space, and any non-digit prefix
      return fullPhone.replace(/^\+974\s?/, '').replace(/^974/, '');
  };

  const handleLevelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const lvl = e.target.value;
      setCurrentLevel(lvl);
      // Disable system role for Technical Associates AND Sales Team
      if (lvl === 'TECHNICAL_ASSOCIATE' || lvl === 'SALES') {
          setFormSystemRole('');
      } else if (!formSystemRole) {
          // If switching from Associate/Sales to something else, reset role to a sensible default if it was empty
          setFormSystemRole(Role.FIELD_ENGINEER);
      }
  };

  const renderTechnicianTable = (techs: Technician[], title: string, Icon: any, colorClass: string) => (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
        <div className="p-6 border-b border-slate-100 flex items-center bg-slate-50">
            <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${colorClass}`}>
                    <Icon size={20} />
                </div>
                <h3 className="font-bold text-lg text-slate-800">{title}</h3>
                <span className="ml-2 text-xs font-semibold text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full">{techs.length}</span>
            </div>
        </div>
        <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase text-xs border-b border-slate-200">
                <tr>
                    <th className="px-6 py-3 w-[35%]">Name</th>
                    <th className="px-6 py-3 w-[25%]">Phone</th>
                    <th className="px-6 py-3 w-[15%]">Status</th>
                    <th className="px-6 py-3 w-[15%]">Role / Level</th>
                    <th className="px-6 py-3 w-[10%] text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {techs.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-slate-400 italic text-sm">No records found</td></tr>
                ) : techs.map(tech => (
                    <tr key={tech.id} className="hover:bg-slate-50/80 group transition-colors">
                        {/* Name */}
                        <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                                <img src={tech.avatar} className="w-9 h-9 rounded-full bg-slate-200 object-cover shrink-0 border border-slate-100" alt="" />
                                <div>
                                    <div className="font-semibold text-slate-800">{tech.name}</div>
                                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">{tech.id}</div>
                                </div>
                            </div>
                        </td>
                        {/* Phone */}
                        <td className="px-6 py-4">
                            <span className="text-slate-700 font-mono text-sm">{tech.phone || <span className="text-slate-300 italic">—</span>}</span>
                        </td>
                        {/* Status */}
                        <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                                tech.status === 'AVAILABLE' || tech.status === 'ACTIVE'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                tech.status === 'BUSY'
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                tech.status === 'LEAVE'
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                                    'bg-slate-100 text-slate-500 border border-slate-200'
                            }`}>
                                <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                                    tech.status === 'AVAILABLE' || tech.status === 'ACTIVE' ? 'bg-emerald-500' :
                                    tech.status === 'BUSY' ? 'bg-amber-500' :
                                    tech.status === 'LEAVE' ? 'bg-rose-500' : 'bg-slate-400'
                                }`}/>
                                {tech.status === 'AVAILABLE' || tech.status === 'ACTIVE' ? 'Active' :
                                 tech.status === 'LEAVE' ? 'On Leave' :
                                 tech.status === 'BUSY' ? 'Busy' :
                                 tech.status?.charAt(0) + (tech.status?.slice(1) || '').toLowerCase()}
                            </span>
                        </td>
                        {/* Role */}
                        <td className="px-6 py-4">
                            <span className="text-slate-700 text-sm font-medium">
                                {tech.jobRole || tech.role || <span className="text-slate-300 italic">—</span>}
                            </span>
                        </td>
                        {/* Actions */}
                        <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button type="button" onClick={() => openModal('view', tech)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View"><Eye size={15} className="pointer-events-none" /></button>
                                <button type="button" onClick={() => openModal('edit', tech)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Edit"><Edit size={15} className="pointer-events-none" /></button>
                                <button type="button" onClick={(e) => handleDelete(tech.id, e)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete"><Trash2 size={15} className="pointer-events-none" /></button>
                            </div>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
  );

  return (
    <div className="p-8 space-y-8 animate-in fade-in zoom-in duration-300">
      {saveToast && (
        <div className="fixed top-5 right-5 z-[300] bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-xl flex items-center gap-2 font-semibold text-sm">
          ✓ Changes saved successfully
        </div>
      )}
        
        <div className="mb-6 flex justify-between items-center">
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Team Management</h1>
                <p className="text-slate-500 text-sm">Manage Team Leads, Field Engineers, and Sales Operations.</p>
            </div>
            <button 
                type="button"
                onClick={() => openModal('add')}
                className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-slate-800 shadow-lg shadow-slate-900/10 transition-all"
            >
                <Plus size={18} /> Add Member
            </button>
        </div>

        {/* Team Leads Table */}
        {renderTechnicianTable(teamLeads, "Team Leads", Shield, "bg-purple-100 text-purple-600")}
        
        {/* Field Engineers Table */}
        {renderTechnicianTable(fieldEngineers, "Field Engineers", Wrench, "bg-orange-100 text-orange-600")}

        {/* Technical Associates Table */}
        {renderTechnicianTable(technicalAssociates, "Technical Associates", Users, "bg-cyan-100 text-cyan-600")}

        {/* Sales Team Table */}
        {renderTechnicianTable(salesTeam, "Sales Team", BriefcaseBusiness, "bg-indigo-100 text-indigo-600")}

        {/* --- Modals --- */}

        {/* View Modal */}
        {modalType === 'view' && activeTech && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative">
                    <button onClick={closeModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20}/></button>
                    <div className="bg-slate-50 p-6 flex flex-col items-center border-b border-slate-100">
                        <img src={activeTech.avatar} alt={activeTech.name} className="w-24 h-24 rounded-full border-4 border-white shadow-md mb-3 object-cover" />
                        <h2 className="text-xl font-bold text-slate-800">{activeTech.name}</h2>
                        <p className="text-slate-500 text-sm">{activeTech.role}</p>
                    </div>
                    <div className="p-6 space-y-4">
                        <div className="flex items-center gap-3 text-slate-600">
                             <Phone size={18} className="text-slate-400" />
                             <span>{activeTech.phone || 'No phone'}</span>
                        </div>
                        <div className="flex items-center gap-3 text-slate-600">
                             <Mail size={18} className="text-slate-400" />
                             <span>{activeTech.email || 'No email'}</span>
                        </div>
                        <div className="flex items-center gap-3 text-slate-600">
                            <Briefcase size={18} className="text-slate-400" />
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                activeTech.status === 'AVAILABLE' ? 'bg-emerald-100 text-emerald-700' : 
                                activeTech.status === 'BUSY' ? 'bg-amber-100 text-amber-700' :
                                'bg-rose-100 text-rose-700'
                            }`}>
                                {activeTech.status === 'AVAILABLE' ? 'Active' : 
                                 activeTech.status === 'LEAVE' ? 'On Leave' : 
                                 activeTech.status}
                            </span>
                        </div>
                    </div>
                    <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
                        <button onClick={closeModal} className="text-sm font-medium text-slate-500 hover:text-slate-800">Close</button>
                    </div>
                </div>
            </div>
        )}

        {/* Edit/Add Modal */}
        {(modalType === 'add' || modalType === 'edit') && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                 <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                         <h3 className="font-bold text-lg text-slate-900">
                             {modalType === 'edit' ? 'Edit Member' : 'New Member'}
                         </h3>
                         <button onClick={closeModal}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                    </div>
                    
                    <form onSubmit={(e) => {
                        e.preventDefault();
                        const formData = new FormData(e.currentTarget);
                        const rawData: any = Object.fromEntries(formData.entries());
                        // Standardise phone — store as full international format
                        const phoneRaw = (rawData.phone || '').replace(/\D/g, '').replace(/^974/, '');
                        const fullPhone = phoneRaw ? `+974${phoneRaw}` : '';
                        
                        // Handle potential empty system role
                        // SALES and TECHNICAL_ASSOCIATE have the system role dropdown disabled,
                        // so rawData.systemRole will be absent (disabled fields aren't in FormData).
                        // The backend needs a role value — use level-based default when empty.
                        const levelVal = rawData.level || currentLevel;
                        const finalSystemRole = rawData.systemRole || undefined;

                        const data: any = {
                            ...rawData,
                            phone: fullPhone,
                            systemRole: finalSystemRole,
                            // jobRole = job title text (e.g. "Senior Technician"), separate from systemRole
                            jobRole: rawData.jobRole || '',
                            // role = systemRole for DB (login permission), NOT job title
                            // For SALES/TECHNICAL_ASSOCIATE, role will be null — backend defaults to 'NONE'
                            role: finalSystemRole || undefined,
                            // level = department/team e.g. "SALES", "FIELD_ENGINEER"
                            level: levelVal,
                        };

                        // Normalise status: AVAILABLE → ACTIVE for DB consistency
                        const rawStatus = rawData.status || 'AVAILABLE';
                        const statusVal = (rawStatus === 'AVAILABLE') ? 'ACTIVE' : rawStatus;
                        data.isActive = statusVal === 'ACTIVE';
                        data.status = statusVal;
                        
                        if (modalType === 'add') {
                            data.id = generateTechId();
                            data.avatar = avatarPreview || `https://ui-avatars.com/api/?name=${data.name}&background=random`;
                        } else if (activeTech) {
                            data.id = activeTech.id;
                            data.avatar = avatarPreview || activeTech.avatar;
                        }

                        onSaveTech(data as Technician);
                        setSaveToast(true);
                        setTimeout(() => setSaveToast(false), 2500);
                        closeModal();
                    }} className="p-6 space-y-4 bg-white">
                        
                        <div className="flex flex-col items-center mb-4">
                            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                <div className="w-24 h-24 rounded-full bg-slate-100 border-2 border-slate-200 overflow-hidden mb-2">
                                    {avatarPreview ? (
                                        <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                                            <Camera size={32} />
                                        </div>
                                    )}
                                </div>
                                <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                    <Upload className="text-white" size={24} />
                                </div>
                            </div>
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                onChange={handleFileChange} 
                                accept="image/*" 
                                className="hidden" 
                            />
                            <button type="button" onClick={() => fileInputRef.current?.click()} className="text-sm text-emerald-600 font-medium hover:text-emerald-700">
                                {avatarPreview ? 'Change Photo' : 'Upload Photo'}
                            </button>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500 uppercase">Full Name</label>
                            <input name="name" defaultValue={activeTech?.name} required className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="e.g. John Doe"/>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Phone</label>
                                <div className="flex">
                                    <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-300 bg-slate-100 text-slate-500 text-sm font-medium">
                                        +974
                                    </span>
                                    <input 
                                        name="phone" 
                                        defaultValue={getLocalPhone(activeTech?.phone)}
                                        required 
                                        type="tel"
                                        className="rounded-none rounded-r-lg bg-white border border-slate-300 block flex-1 min-w-0 w-full p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none" 
                                        placeholder="3300 0000"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Email</label>
                                <input 
                                    name="email" 
                                    defaultValue={activeTech?.email} 
                                    required
                                    type="email" 
                                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none" 
                                    placeholder="email@example.com"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Job Role</label>
                                <input name="jobRole" defaultValue={(activeTech as any)?.jobRole || activeTech?.role || ''} className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="e.g. Senior Technician"/>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Department / Level</label>
                                <select 
                                    name="level" 
                                    value={currentLevel} 
                                    onChange={handleLevelChange} 
                                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                                >
                                    <option value="SALES">Sales Team</option>
                                    <option value="TEAM_LEAD">Team Lead</option>
                                    <option value="FIELD_ENGINEER">Field Engineer</option>
                                    <option value="TECHNICAL_ASSOCIATE">Technical Associate</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">System Role</label>
                                <select 
                                    name="systemRole" 
                                    disabled={currentLevel === 'TECHNICAL_ASSOCIATE' || currentLevel === 'SALES'}
                                    value={formSystemRole}
                                    onChange={(e) => setFormSystemRole(e.target.value)}
                                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                                >
                                    <option value="">{currentLevel === 'TECHNICAL_ASSOCIATE' || currentLevel === 'SALES' ? 'Not Required' : 'Select Role'}</option>
                                    <option value={Role.ADMIN}>Admin</option>
                                    <option value={Role.TEAM_LEAD}>Team Lead</option>
                                    <option value={Role.FIELD_ENGINEER}>Field Engineer</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Current Status</label>
                                <select name="status" defaultValue={activeTech?.status || 'AVAILABLE'} className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none">
                                    <option value="AVAILABLE">Active</option>
                                    <option value="LEAVE">On Leave</option>
                                </select>
                            </div>
                        </div>

                        <div className="pt-4 flex justify-between items-center border-t border-slate-100 mt-2">
                            {activeTech ? (
                                <button type="button" onClick={(e) => handleDelete(activeTech.id, e)} className="text-red-500 hover:text-red-700 text-sm flex items-center gap-1 hover:bg-red-50 px-2 py-1 rounded transition-colors">
                                    <Trash2 size={16} className="pointer-events-none" /> Delete
                                </button>
                            ) : <div></div>}
                            <div className="flex gap-3">
                                <button type="button" onClick={closeModal} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                                <button type="submit" className="px-6 py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 shadow-lg shadow-slate-900/20 transition-all">
                                    {activeTech ? 'Save Changes' : 'Create Record'}
                                </button>
                            </div>
                        </div>

                    </form>
                 </div>
            </div>
        )}

        {/* Avatar Cropper Modal */}
        {cropperImage && (
            <AvatarCropper
                imageSrc={cropperImage}
                onCrop={(croppedUrl) => {
                    setAvatarPreview(croppedUrl);
                    setCropperImage(null);
                }}
                onCancel={() => setCropperImage(null)}
            />
        )}
    </div>
  );
};

export default TeamCRM;

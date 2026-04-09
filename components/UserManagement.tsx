
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Technician, Role, Team } from '../types';
import { 
  Plus, Search, Edit, Trash2, Shield, Briefcase, 
  CheckCircle2, XCircle, Mail, Phone, Lock, UserCog,
  Eye, EyeOff, KeyRound, Wrench, X, ZoomIn, ZoomOut, Move, Camera
} from 'lucide-react';
import { generateTechId } from '../utils/idUtils';

// ── Avatar Cropper Component (shared) ──
const AvatarCropperUM: React.FC<{
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
  const SIZE = 240;

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      setImg(image);
      const minScale = SIZE / Math.min(image.width, image.height);
      setScale(minScale);
      setOffset({ x: (SIZE - image.width * minScale) / 2, y: (SIZE - image.height * minScale) / 2 });
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

  const handleMouseDown = (e: React.MouseEvent) => { setDragging(true); setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y }); };
  const handleMouseMove = useCallback((e: React.MouseEvent) => { if (!dragging) return; setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); }, [dragging, dragStart]);
  const handleMouseUp = () => setDragging(false);
  const handleTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; setDragging(true); setDragStart({ x: t.clientX - offset.x, y: t.clientY - offset.y }); };
  const handleTouchMove = useCallback((e: React.TouchEvent) => { if (!dragging) return; const t = e.touches[0]; setOffset({ x: t.clientX - dragStart.x, y: t.clientY - dragStart.y }); }, [dragging, dragStart]);

  const handleCrop = () => {
    const out = document.createElement('canvas'); out.width = 256; out.height = 256;
    const ctx = out.getContext('2d');
    if (!ctx || !img) return;
    const ratio = 256 / SIZE;
    ctx.beginPath(); ctx.arc(128, 128, 128, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, offset.x * ratio, offset.y * ratio, img.width * scale * ratio, img.height * scale * ratio);
    onCrop(out.toDataURL('image/jpeg', 0.85));
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
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={() => setDragging(false)}
          >
            <canvas ref={canvasRef} width={SIZE} height={SIZE} className="w-full h-full" />
          </div>
          <div className="flex items-center gap-3 w-full max-w-[240px]">
            <button type="button" onClick={() => {
              if (!img) return;
              const minS = SIZE / Math.max(img.width, img.height) * 0.5;
              const maxS = SIZE / Math.min(img.width, img.height) * 3;
              const ns = Math.max(minS, scale - 0.02);
              const cx = SIZE/2; const cy = SIZE/2; const f = ns/scale;
              setOffset({ x: cx-(cx-offset.x)*f, y: cy-(cy-offset.y)*f }); setScale(ns);
            }} className="p-1.5 bg-slate-100 rounded-lg hover:bg-slate-200"><ZoomOut size={16} className="text-slate-600"/></button>
            <input type="range" min="0" max="100"
              value={img ? ((scale - SIZE / Math.max(img.width, img.height) * 0.5) / (SIZE / Math.min(img.width, img.height) * 3 - SIZE / Math.max(img.width, img.height) * 0.5) * 100) : 50}
              onChange={(e) => {
                if (!img) return;
                const minS = SIZE / Math.max(img.width, img.height) * 0.5;
                const maxS = SIZE / Math.min(img.width, img.height) * 3;
                const ns = minS + (Number(e.target.value) / 100) * (maxS - minS);
                const cx = SIZE/2; const cy = SIZE/2; const f = ns/scale;
                setOffset({ x: cx-(cx-offset.x)*f, y: cy-(cy-offset.y)*f }); setScale(ns);
              }}
              className="flex-1 accent-emerald-600"
            />
            <button type="button" onClick={() => {
              if (!img) return;
              const maxS = SIZE / Math.min(img.width, img.height) * 3;
              const ns = Math.min(maxS, scale + 0.02);
              const cx = SIZE/2; const cy = SIZE/2; const f = ns/scale;
              setOffset({ x: cx-(cx-offset.x)*f, y: cy-(cy-offset.y)*f }); setScale(ns);
            }} className="p-1.5 bg-slate-100 rounded-lg hover:bg-slate-200"><ZoomIn size={16} className="text-slate-600"/></button>
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl">Cancel</button>
          <button type="button" onClick={handleCrop} className="flex-1 py-2.5 bg-slate-900 text-white font-bold rounded-xl shadow-lg hover:bg-slate-800">Save</button>
        </div>
      </div>
    </div>
  );
};

interface UserManagementProps {
  users: Technician[];
  teams: Team[];
  onSaveUser: (user: Technician) => void;
  onDeleteUser: (id: string) => void;
  onChangePassword?: (userId: string, currentPassword: string, newPassword: string) => Promise<void>;
}

const UserManagement: React.FC<UserManagementProps> = ({ 
    users, 
    onSaveUser,
    onDeleteUser,
    onChangePassword
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Technician | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [cropperImage, setCropperImage] = useState<string | null>(null);
  const [changePwdModal, setChangePwdModal] = useState<Technician | null>(null);
  const [changePwdForm, setChangePwdForm] = useState({ current: '', next: '', confirm: '' });
  const [changePwdError, setChangePwdError] = useState('');
  const [changePwdSuccess, setChangePwdSuccess] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Generate initials avatar URL
  const getAvatar = (user: Technician) =>
    user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'U')}&background=random&color=fff&bold=true&size=128`;

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setCropperImage(reader.result as string);
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleEdit = (user: Technician) => {
    setEditingUser(user);
    setAvatarPreview(null);
    setModalOpen(true);
    setShowPassword(false);
  };

  const handleAddNew = () => {
    setEditingUser(null);
    setAvatarPreview(null);
    setModalOpen(true);
    setShowPassword(false);
  };

  const generatePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (passwordRef.current) {
        passwordRef.current.value = password;
        setShowPassword(true);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries()) as any;
    
    // Auto-map level based on role for basic ops
    let level: Technician['level'] = 'FIELD_ENGINEER';
    if (data.systemRole === Role.TEAM_LEAD) level = 'TEAM_LEAD';
    if (data.systemRole === Role.ADMIN) level = 'TEAM_LEAD'; // Admins default to Lead level visibility

    // Construct User Object
    const phoneRaw = (data.phone || '').replace(/\D/g, '').replace(/^974/, '');
    const normalizedPhone = phoneRaw ? `+974${phoneRaw}` : '';
    const jobTitle = data.jobRole || data.position || '';
    const newUser: any = {
        id: editingUser ? editingUser.id : generateTechId(),
        name: data.name,
        email: data.email,
        phone: normalizedPhone,
        role: data.systemRole as Role,    // system role (ADMIN/TEAM_LEAD/FIELD_ENGINEER)
        jobRole: jobTitle,                // job title sent to backend as job_role
        systemRole: data.systemRole as Role,
        isActive: data.isActive === 'true',
        teamId: editingUser?.teamId, 
        status: data.isActive === 'true' ? 'ACTIVE' : 'INACTIVE',
        avatar: avatarPreview || (editingUser ? editingUser.avatar : `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name || 'U')}&background=random&color=fff&bold=true&size=128`),
        level: level,
        password: data.password || editingUser?.password
    };

    onSaveUser(newUser);
    setModalOpen(false);
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRoleBadge = (role?: Role | string) => {
      switch(role) {
          case Role.ADMIN:
          case 'ADMIN':
              return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-900 text-white"><Shield size={10} /> Admin</span>;
          case Role.TEAM_LEAD:
          case 'TEAM_LEAD':
              return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700"><Briefcase size={10} /> Team Lead</span>;
          case Role.FIELD_ENGINEER:
          case 'FIELD_ENGINEER':
              return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-600"><Wrench size={10} /> Field Engineer</span>;
          default:
              return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600"><UserCog size={10} /> {role || 'User'}</span>;
      }
  };

  const renderUserGroup = (groupUsers: Technician[], title: string, Icon: any, colorClass: string) => (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center bg-slate-50">
            <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${colorClass}`}>
                    <Icon size={18} />
                </div>
                <h3 className="font-bold text-base text-slate-800">{title}</h3>
                <span className="ml-1 text-xs font-semibold text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full">{groupUsers.length}</span>
            </div>
        </div>
        <table className="w-full text-sm text-left table-fixed">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase text-xs border-b border-slate-200">
                <tr>
                    <th className="px-6 py-3 w-[32%]">User Profile</th>
                    <th className="px-6 py-3 w-[18%]">System Role</th>
                    <th className="px-6 py-3 w-[22%]">Job Role</th>
                    <th className="px-6 py-3 w-[16%]">Status</th>
                    <th className="px-6 py-3 w-[12%] text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {groupUsers.length === 0 ? (
                    <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-slate-400 italic text-sm">
                            No records found
                        </td>
                    </tr>
                ) : (
                    groupUsers.map(user => (
                        <tr key={user.id} className="hover:bg-slate-50/80 transition-colors group">
                            {/* User Profile */}
                            <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-slate-200 overflow-hidden shrink-0 border border-slate-100">
                                        <img src={getAvatar(user)} alt={user.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6366f1&color=fff&bold=true&size=128`; }} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-semibold text-slate-900 truncate">{user.name}</div>
                                        <div className="text-xs text-slate-400 truncate">{user.email}</div>
                                    </div>
                                </div>
                            </td>
                            {/* System Role */}
                            <td className="px-6 py-4">
                                {getRoleBadge(user.systemRole)}
                            </td>
                            {/* Job Role */}
                            <td className="px-6 py-4">
                                <span className="text-slate-700 text-sm font-medium">
                                    {(user as any).jobRole || user.role || <span className="text-slate-300">—</span>}
                                </span>
                            </td>
                            {/* Status */}
                            <td className="px-6 py-4">
                                {user.isActive ? (
                                    <span className="inline-flex items-center gap-1.5 text-emerald-700 text-xs font-bold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/> Active
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 text-slate-500 text-xs font-bold bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400"/> Inactive
                                    </span>
                                )}
                            </td>
                            {/* Actions — hover only */}
                            <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => { setChangePwdModal(user); setChangePwdForm({ current: '', next: '', confirm: '' }); setChangePwdError(''); setChangePwdSuccess(false); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Change Password">
                                        <KeyRound size={15} />
                                    </button>
                                    <button onClick={() => handleEdit(user)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Edit">
                                        <Edit size={15} />
                                    </button>
                                    <button onClick={() => { if(confirm('Delete user?')) onDeleteUser(user.id) }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    </div>
  );

  const admins = filteredUsers.filter(u => u.systemRole === Role.ADMIN);
  const teamLeads = filteredUsers.filter(u => u.systemRole === Role.TEAM_LEAD);
  const fieldEngineers = filteredUsers.filter(u => u.systemRole === Role.FIELD_ENGINEER);

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-300">
        
        {/* Header */}
        <div className="flex justify-between items-center">
            <div>
                <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
                <p className="text-slate-500 text-sm">Manage system access, roles, and user profiles.</p>
            </div>
            <button 
                onClick={handleAddNew}
                className="bg-slate-900 text-white px-4 py-2.5 rounded-lg font-medium flex items-center gap-2 hover:bg-slate-800 shadow-lg shadow-slate-900/10 transition-all"
            >
                <Plus size={18} />
                <span>Create User</span>
            </button>
        </div>

        {/* Filters & Search */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
             <div className="relative flex-1">
                 <Search size={18} className="absolute left-3 top-2.5 text-slate-400" />
                 <input 
                    type="text" 
                    placeholder="Search users by name or email..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900/10"
                 />
             </div>
        </div>

        {/* Grouped Tables */}
        <div className="space-y-8">
            {renderUserGroup(admins, "Admin", Shield, "bg-slate-100 text-slate-600")}
            {renderUserGroup(teamLeads, "Team Lead", Briefcase, "bg-purple-100 text-purple-600")}
            {renderUserGroup(fieldEngineers, "Field Engineers", Wrench, "bg-blue-100 text-blue-600")}
        </div>

        {/* Modal */}
        {modalOpen && (
             <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                        <h3 className="font-bold text-lg text-slate-900">
                            {editingUser ? 'Edit User' : 'Create New User'}
                        </h3>
                        <button onClick={() => setModalOpen(false)}><XCircle size={20} className="text-slate-400 hover:text-slate-600"/></button>
                    </div>
                    
                    <form onSubmit={handleSubmit} className="p-6 space-y-4">

                        {/* Avatar Upload */}
                        <div className="flex items-center gap-4 pb-2">
                            <div className="w-16 h-16 rounded-full bg-slate-200 overflow-hidden shrink-0 border-2 border-slate-300">
                                <img
                                    src={avatarPreview || (editingUser ? getAvatar(editingUser) : `https://ui-avatars.com/api/?name=New+User&background=6366f1&color=fff&bold=true&size=128`)}
                                    alt="Avatar"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Profile Photo</p>
                                <button
                                    type="button"
                                    onClick={() => fileRef.current?.click()}
                                    className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
                                >
                                    {avatarPreview ? 'Change Photo' : 'Upload Photo'}
                                </button>
                                {avatarPreview && (
                                    <button type="button" onClick={() => setAvatarPreview(null)} className="ml-2 text-xs text-red-500 hover:text-red-700">Remove</button>
                                )}
                                <p className="text-[10px] text-slate-400 mt-1">Or initials will be used automatically</p>
                                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500 uppercase">Full Name</label>
                            <input name="name" defaultValue={editingUser?.name} required className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="e.g. John Doe"/>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Email</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-2.5 text-slate-400" size={16} />
                                    <input name="email" type="email" defaultValue={editingUser?.email} required className="w-full pl-9 bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="user@qonnect.qa"/>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Phone</label>
                                <div className="flex">
                                    <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-200 bg-slate-100 text-slate-500 text-sm font-medium">+974</span>
                                    <input name="phone" type="tel"
                                        defaultValue={editingUser?.phone ? editingUser.phone.replace(/^\+974\s?/, '').replace(/^974/, '') : ''}
                                        className="rounded-none rounded-r-lg w-full bg-slate-50 border border-slate-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10"
                                        placeholder="3300 0000"/>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                             <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">System Role</label>
                                <select name="systemRole" defaultValue={editingUser?.systemRole || Role.FIELD_ENGINEER} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10">
                                    <option value={Role.ADMIN}>Admin</option>
                                    <option value={Role.TEAM_LEAD}>Team Lead</option>
                                    <option value={Role.FIELD_ENGINEER}>Field Engineer</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Job Role</label>
                                <input name="jobRole" defaultValue={(editingUser as any)?.jobRole || editingUser?.role} placeholder="e.g. Senior Electrician" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                             <div className="space-y-1">
                                <div className="flex justify-between items-center">
                                    <label className="text-xs font-semibold text-slate-500 uppercase">Password</label>
                                    <button 
                                        type="button"
                                        onClick={generatePassword}
                                        className="text-[10px] text-emerald-600 font-bold hover:text-emerald-700 uppercase flex items-center gap-1"
                                    >
                                        <KeyRound size={10} /> Generate
                                    </button>
                                </div>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-2.5 text-slate-400" size={16} />
                                    <input 
                                        ref={passwordRef}
                                        name="password" 
                                        type={showPassword ? "text" : "password"} 
                                        placeholder={editingUser ? "Unchanged" : "Create Password"} 
                                        className="w-full pl-9 pr-10 bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" 
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none"
                                    >
                                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Account Status</label>
                                <select name="isActive" defaultValue={editingUser?.isActive?.toString() || 'true'} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10">
                                    <option value="true">Active</option>
                                    <option value="false">Inactive</option>
                                </select>
                            </div>
                        </div>

                        <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 mt-2">
                             <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                             <button type="submit" className="px-6 py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 shadow-lg shadow-slate-900/20 transition-all">
                                 {editingUser ? 'Save Changes' : 'Create User'}
                             </button>
                        </div>
                    </form>
                </div>
            </div>
        )}

        {/* ── Change Password Modal ── */}
        {changePwdModal && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                        <div>
                            <h3 className="font-bold text-lg text-slate-900">Change Password</h3>
                            <p className="text-xs text-slate-500 mt-0.5">{changePwdModal.name}</p>
                        </div>
                        <button onClick={() => setChangePwdModal(null)} className="text-slate-400 hover:text-slate-600"><XCircle size={20}/></button>
                    </div>
                    <div className="p-6 space-y-4">
                        {changePwdSuccess ? (
                            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                                <CheckCircle2 size={20} className="text-emerald-600 shrink-0"/>
                                <p className="text-sm text-emerald-800 font-medium">Password changed successfully!</p>
                            </div>
                        ) : (
                            <>
                                {changePwdError && (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{changePwdError}</div>
                                )}
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-slate-500 uppercase">Current Password</label>
                                    <input type="password" value={changePwdForm.current}
                                        onChange={e => setChangePwdForm(p => ({...p, current: e.target.value}))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10"
                                        placeholder="Enter current password"/>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-slate-500 uppercase">New Password</label>
                                    <input type="password" value={changePwdForm.next}
                                        onChange={e => setChangePwdForm(p => ({...p, next: e.target.value}))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10"
                                        placeholder="Minimum 8 characters"/>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-slate-500 uppercase">Confirm New Password</label>
                                    <input type="password" value={changePwdForm.confirm}
                                        onChange={e => setChangePwdForm(p => ({...p, confirm: e.target.value}))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10"
                                        placeholder="Repeat new password"/>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button type="button" onClick={() => setChangePwdModal(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                                    <button type="button" onClick={() => {
                                        setChangePwdError('');
                                        if (!changePwdForm.current) { setChangePwdError('Enter current password'); return; }
                                        if (changePwdForm.next.length < 8) { setChangePwdError('Min 8 characters required'); return; }
                                        if (changePwdForm.next !== changePwdForm.confirm) { setChangePwdError('Passwords do not match'); return; }
                                        onChangePassword?.(changePwdModal.id, changePwdForm.current, changePwdForm.next)
                                            .then(() => setChangePwdSuccess(true))
                                            .catch((err: any) => setChangePwdError(err?.message || 'Failed to change password'));
                                    }} className="flex-1 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800">
                                        Change Password
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Avatar Cropper Modal */}
        {cropperImage && (
            <AvatarCropperUM
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

export default UserManagement;


import React, { useState, useRef } from 'react';
import { Technician, Role, Team } from '../types';
import { 
  Plus, Search, Edit, Trash2, Shield, Briefcase, 
  CheckCircle2, XCircle, Mail, Phone, Lock, UserCog,
  Eye, EyeOff, KeyRound, Wrench
} from 'lucide-react';
import { generateTechId } from '../utils/idUtils';

interface UserManagementProps {
  users: Technician[];
  teams: Team[];
  onSaveUser: (user: Technician) => void;
  onDeleteUser: (id: string) => void;
}

const UserManagement: React.FC<UserManagementProps> = ({ 
    users, 
    onSaveUser,
    onDeleteUser 
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Technician | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleEdit = (user: Technician) => {
    setEditingUser(user);
    setModalOpen(true);
    setShowPassword(false);
  };

  const handleAddNew = () => {
    setEditingUser(null);
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
    const newUser: Technician = {
        id: editingUser ? editingUser.id : generateTechId(),
        name: data.name,
        email: data.email,
        phone: data.phone,
        role: data.position, // UI Label: Position
        systemRole: data.systemRole as Role,
        isActive: data.isActive === 'true',
        teamId: editingUser?.teamId, 
        status: editingUser ? editingUser.status : 'AVAILABLE',
        avatar: editingUser ? editingUser.avatar : `https://ui-avatars.com/api/?name=${data.name}&background=random`,
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
          case 'TECHNICIAN':
              return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-600"><Wrench size={10} /> Field Engineer</span>;
          default:
              return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600"><UserCog size={10} /> {role || 'User'}</span>;
      }
  };

  const renderUserGroup = (groupUsers: Technician[], title: string, Icon: any, colorClass: string) => (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center bg-slate-50">
            <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${colorClass}`}>
                    <Icon size={20} />
                </div>
                <h3 className="font-bold text-lg text-slate-800">{title}</h3>
            </div>
        </div>
        <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase text-xs border-b border-slate-200">
                <tr>
                    <th className="px-6 py-4 w-1/3">User Profile</th>
                    <th className="px-6 py-4">System Role</th>
                    <th className="px-6 py-4">Position</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {groupUsers.length === 0 ? (
                    <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-slate-400 italic">
                            No records found
                        </td>
                    </tr>
                ) : (
                    groupUsers.map(user => (
                        <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-slate-200 overflow-hidden shrink-0">
                                        <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
                                    </div>
                                    <div>
                                        <div className="font-bold text-slate-900">{user.name}</div>
                                        <div className="text-xs text-slate-500">{user.email}</div>
                                    </div>
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                {getRoleBadge(user.systemRole)}
                            </td>
                            <td className="px-6 py-4 text-slate-600 font-medium">
                                {user.role || <span className="text-slate-400 italic">Not Specified</span>}
                            </td>
                            <td className="px-6 py-4">
                                {user.isActive ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-bold bg-emerald-50 px-2 py-1 rounded-full">
                                        <CheckCircle2 size={12} /> Active
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 text-slate-400 text-xs font-bold bg-slate-100 px-2 py-1 rounded-full">
                                        <XCircle size={12} /> Inactive
                                    </span>
                                )}
                            </td>
                            <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                    <button onClick={() => handleEdit(user)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                                        <Edit size={16} />
                                    </button>
                                    <button onClick={() => { if(confirm('Delete user?')) onDeleteUser(user.id) }} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                        <Trash2 size={16} />
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
                                <div className="relative">
                                    <Phone className="absolute left-3 top-2.5 text-slate-400" size={16} />
                                    <input name="phone" type="tel" defaultValue={editingUser?.phone} className="w-full pl-9 bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="+974..."/>
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
                                <label className="text-xs font-semibold text-slate-500 uppercase">Position</label>
                                <input name="position" defaultValue={editingUser?.role} placeholder="e.g. Senior Electrician" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" />
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
    </div>
  );
};

export default UserManagement;

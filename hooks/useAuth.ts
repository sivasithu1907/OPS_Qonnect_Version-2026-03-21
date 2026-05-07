import { useState, useCallback, useEffect } from 'react';
import api from '../services/api';

interface User {
    id: string;
    techId: string;
    name: string;
    email: string;
    role: string;
    avatar?: string;
}

/**
 * Auth hook — manages login/logout/session restore
 * Replaces scattered auth logic in App.tsx
 */
export function useAuth() {
    const [currentUser, setCurrentUser] = useState<User | null>(() => {
        try {
            const saved = localStorage.getItem('qonnect_user');
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    });

    const [loginError, setLoginError] = useState('');

    const login = useCallback(async (email: string, password: string) => {
        try {
            setLoginError('');
            const data = await api.login(email, password);

            localStorage.setItem('qonnect_token', data.token);
            const user = {
                id: data.user.id,
                techId: data.user.id,
                name: data.user.name,
                email: data.user.email,
                role: data.user.role || data.user.systemRole,
                avatar: data.user.avatar
            };
            localStorage.setItem('qonnect_user', JSON.stringify(user));
            setCurrentUser(user);
            return user;
        } catch (e: any) {
            setLoginError(e.message || 'Invalid credentials. Please try again.');
            throw e;
        }
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('qonnect_token');
        localStorage.removeItem('qonnect_user');
        setCurrentUser(null);
    }, []);

    const isAuthenticated = !!currentUser;

    return { currentUser, login, logout, loginError, isAuthenticated, setLoginError };
}

export default useAuth;

/**
 * Centralized API Service Layer
 * All API calls go through here — single source of truth for:
 * - Auth headers
 * - Error handling
 * - Response parsing
 * - Token management
 */

const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('qonnect_token');
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
};

const handleResponse = async (res: Response) => {
    if (res.status === 401) {
        localStorage.removeItem('qonnect_token');
        localStorage.removeItem('qonnect_user');
        window.location.reload();
        throw new Error('Unauthorized');
    }
    if (!res.ok) {
        const text = await res.text().catch(() => 'Unknown error');
        throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json();
};

export const api = {
    // GET with auth
    get: async (url: string) => {
        const res = await fetch(url, { headers: getAuthHeaders() });
        return handleResponse(res);
    },

    // POST with auth
    post: async (url: string, body: any) => {
        const res = await fetch(url, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        return handleResponse(res);
    },

    // PUT with auth
    put: async (url: string, body: any) => {
        const res = await fetch(url, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        return handleResponse(res);
    },

    // DELETE with auth
    del: async (url: string) => {
        const res = await fetch(url, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        return handleResponse(res);
    },

    // Raw fetch with auth (for custom handling)
    raw: (url: string, options: RequestInit = {}) => {
        return fetch(url, {
            ...options,
            headers: {
                ...getAuthHeaders(),
                ...(options.headers || {})
            }
        });
    },

    // Combined init — single call for all data
    init: async () => {
        return api.get('/api/init');
    },

    // Combined refresh — tickets + activities + customers
    refresh: async () => {
        return api.get('/api/refresh');
    },

    // Login
    login: async (email: string, password: string) => {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({ error: 'Login failed' }));
            throw new Error(data.error || 'Invalid credentials');
        }
        return res.json();
    },

    // Tickets
    tickets: {
        list: () => api.get('/api/tickets'),
        create: (data: any) => api.post('/api/tickets', data),
        update: (id: string, data: any) => api.put(`/api/tickets/${id}`, data),
        updateStatus: (id: string, data: any) => api.put(`/api/tickets/${id}/status`, data),
        delete: (id: string) => api.del(`/api/tickets/${id}`),
        addMessage: (id: string, content: string, sender: string) =>
            api.post(`/api/tickets/${id}/message`, { content, sender }),
    },

    // Activities
    activities: {
        list: () => api.get('/api/activities'),
        create: (data: any) => api.post('/api/activities', data),
        update: (id: string, data: any) => api.put(`/api/activities/${id}`, data),
        delete: (id: string) => api.del(`/api/activities/${id}`),
    },

    // Customers
    customers: {
        list: () => api.get('/api/customers'),
        create: (data: any) => api.post('/api/customers', data),
        update: (id: string, data: any) => api.put(`/api/customers/${id}`, data),
        delete: (id: string) => api.del(`/api/customers/${id}`),
    },

    // Users
    users: {
        list: () => api.get('/api/users'),
        create: (data: any) => api.post('/api/users', data),
        update: (id: string, data: any) => api.put(`/api/users/${id}`, data),
        changePassword: (id: string, current: string, next: string) =>
            api.put(`/api/users/${id}/password`, { currentPassword: current, newPassword: next }),
        delete: (id: string) => api.del(`/api/users/${id}`),
    },

    // Teams & Sites
    teams: {
        list: () => api.get('/api/teams'),
        create: (data: any) => api.post('/api/teams', data),
        update: (id: string, data: any) => api.put(`/api/teams/${id}`, data),
        delete: (id: string) => api.del(`/api/teams/${id}`),
    },
    sites: {
        list: () => api.get('/api/sites'),
    },

    // AI
    ai: {
        analyze: (data: any) => api.post('/api/analyze', data),
        chat: (messages: any[], context: any) => api.post('/api/chat', { messages, context }),
    },

    // WhatsApp
    whatsapp: {
        logs: () => api.get('/api/whatsapp/logs'),
    },

    // Audit Log (Admin only — server enforces this independently of the UI)
    auditLogs: {
        list: (params?: Record<string, string | number>) => {
            const qs = params
                ? '?' + Object.entries(params)
                    .filter(([, v]) => v !== undefined && v !== null && v !== '')
                    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
                    .join('&')
                : '';
            return api.get(`/api/audit-logs${qs}`);
        },
    },

    // System Data Import (Admin only — actually persists to the database,
    // unlike the old client-only merge which silently discarded on refresh)
    systemImport: (data: any) => api.post('/api/system/import', data),

    // Non-blocking heads-up: does this customer already have an open or
    // recently-completed job? Used by the Sales Appointment Request form.
    checkExistingJob: (phone: string) => api.get(`/api/sales-appointment-requests/check-existing-job?phone=${encodeURIComponent(phone)}`),

    // On-demand full-detail fetches — used specifically for viewing photos.
    // Regular ticket/activity list responses only carry a lightweight
    // ['HAS_PHOTOS'] flag (no real image bytes) to keep the app fast; these
    // calls fetch the one record's real photo data only when actually needed.
    photos: {
        forTicket: (id: string) => api.get(`/api/tickets/${id}/full`).then(t => (t.photos || []).filter((p: any) => p && p !== 'HAS_PHOTOS')),
        forActivity: (id: string) => api.get(`/api/activities/${id}/full`).then(a => (a.photos || []).filter((p: any) => p && p !== 'HAS_PHOTOS')),
    },

    // Sales Appointment Requests
    salesRequests: {
        list:     ()           => api.get('/api/sales-appointment-requests'),
        create:   (data: any)  => api.post('/api/sales-appointment-requests', data),
        update:   (id: string, data: any) => api.put(`/api/sales-appointment-requests/${id}`, data),
        delete:   (id: string) => api.del(`/api/sales-appointment-requests/${id}`),
        schedule: (id: string, data: any) => api.post(`/api/sales-appointment-requests/${id}/schedule`, data),
        pendingDashboard: () => api.get('/api/dashboard/pending-sales-requests'),
    },
};

export default api;

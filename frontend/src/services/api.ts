const rawApiBase = import.meta.env.VITE_API_BASE || '/api';
// Clean up any accidental double slashes or trailing slashes
const API_BASE = rawApiBase.trim().replace(/\/+$/, '');

export function getToken(): string | null {
  return localStorage.getItem('medikiosk_token');
}

export function setAuthSession(token: string, user: any) {
  localStorage.setItem('medikiosk_token', token);
  localStorage.setItem('medikiosk_user', JSON.stringify(user));
}

export function clearAuthSession() {
  localStorage.removeItem('medikiosk_token');
  localStorage.removeItem('medikiosk_user');
}

export function getCurrentUser(): any | null {
  const userStr = localStorage.getItem('medikiosk_user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

export const getStoredUser = getCurrentUser;

export function setKioskSession(token: string) {
  localStorage.setItem('medikiosk_kiosk_token', token);
}

export function clearKioskSession() {
  localStorage.removeItem('medikiosk_kiosk_token');
}

export function getKioskToken(): string | null {
  return localStorage.getItem('medikiosk_kiosk_token');
}

async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const isKioskFlow = typeof window !== 'undefined' && (window.location.pathname.startsWith('/kiosk') || path.startsWith('/conversation') || path.startsWith('/consent'));
  const token = isKioskFlow ? (getKioskToken() || getToken()) : (getToken() || getKioskToken());

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const fullUrl = `${API_BASE}${cleanPath}`;

  try {
    const response = await fetch(fullUrl, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      clearAuthSession();
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(error.error || `Request failed (${response.status})`);
    }

    return response.json();
  } catch (err: any) {
    console.error(`❌ API Error [${fullUrl}]:`, err);
    throw new Error(err.message?.includes('Failed to fetch') 
      ? `Cannot connect to server at ${API_BASE}. Please ensure the backend is awake or check connection.`
      : (err.message || 'Network error'));
  }
}

export const api = {
  health: () => request('/health'),

  auth: {
    login: (email: string, password: string) =>
      request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    register: (data: any) =>
      request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    demoLogin: (role: string) =>
      request('/auth/demo-login', {
        method: 'POST',
        headers: { 'X-Demo-Key': import.meta.env.VITE_DEMO_LOGIN_KEY || '' },
        body: JSON.stringify({ role }),
      }),
    me: () => request('/auth/me'),
    refresh: (refreshToken: string) =>
      request('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      }),
  },

  patients: {
    register: (data: any) =>
      request('/patients/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    lookup: (query: string, type: string = 'PHONE') =>
      request('/patients/lookup', {
        method: 'POST',
        body: JSON.stringify({ query, type }),
      }),
    get: (id: string) => request(`/patients/${id}`),
    me: () => request('/patients/me'),
  },

  visits: {
    get: (id: string) => request(`/visits/${id}`),
    list: (filters?: Record<string, string>) => {
      const params = new URLSearchParams(filters || {});
      return request(`/visits?${params}`);
    },
    updateStatus: (id: string, status: string, doctorId?: string) =>
      request(`/visits/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, doctorId }),
      }),
  },

  queue: {
    list: (filters?: Record<string, string>) => {
      const params = new URLSearchParams(filters || {});
      return request(`/queue?${params}`);
    },
    update: (id: string, data: any) =>
      request(`/queue/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },

  consent: {
    grant: (data: any) =>
      request('/consent', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getForPatient: (patientId: string) =>
      request(`/consent/${patientId}`),
  },

  conversation: {
    start: (visitId: string, language: string = 'EN', isAyush = false, treatmentSystem?: 'ALLOPATHY' | 'AYURVEDA' | 'HOMEOPATHY') =>
      request('/conversation/start', {
        method: 'POST',
        body: JSON.stringify({ visitId, language, isAyush, treatmentSystem }),
      }),
sendMessage: (sessionId: string, data: { content: string; inputMethod?: string; language?: string; rawTranscript?: string; isAyush?: boolean; treatmentSystem?: 'ALLOPATHY' | 'AYURVEDA' | 'HOMEOPATHY' }) =>
      request(`/conversation/${sessionId}/message`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    switchLanguage: (sessionId: string, targetLanguage: string, messages: any[] = []) =>
      request(`/conversation/${sessionId}/switch-language`, {
        method: 'POST',
        body: JSON.stringify({ targetLanguage, messages }),
      }),
    complete: (sessionId: string) =>
      request(`/conversation/${sessionId}/complete`, {
        method: 'POST',
      }),
  },


  documents: {
    upload: (formData: FormData) => {
      const token = getToken() || getKioskToken();
      return fetch(`${API_BASE}/documents/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
        return data;
      });
    },
    timeline: (patientId: string) => request(`/documents/timeline/${patientId}`),
    file: async (id: string) => {
      const token = getToken() || getKioskToken();
      const response = await fetch(`${API_BASE}/documents/file/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`Unable to load document (${response.status})`);
      return response.blob();
    },
  },

  vitals: {
    create: (data: any) => request('/vitals', { method: 'POST', body: JSON.stringify(data) }),
    get: (visitId: string) => request(`/vitals/${visitId}`),
  },

  ayush: {
    assessment: (data: any) => request('/ayush/assessment', { method: 'POST', body: JSON.stringify(data) }),
  },

  doctor: {
    consultation: (data: any) => request('/doctor/consultation', { method: 'POST', body: JSON.stringify(data) }),
  },

  triage: {
    alerts: () => request('/triage/alerts'),
    updateAlert: (id: string, status: string) => request(`/triage/alerts/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  },

  admin: {
    dashboard: () => request('/admin/dashboard'),
    auditLogs: (page: number = 1, limit: number = 50) =>
      request(`/admin/audit-logs?page=${page}&limit=${limit}`),
    users: () => request('/admin/users'),
    departments: () => request('/admin/departments'),
  },
};

export default api;

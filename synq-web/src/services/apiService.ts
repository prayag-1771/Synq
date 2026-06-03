import { useAuthStore } from '../stores/authStore';

const envUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
const BASE_URL = envUrl.endsWith('/api') ? envUrl : `${envUrl.replace(/\/$/, '')}/api`;

async function request(endpoint: string, options: RequestInit = {}) {
  const { token, refreshToken, setAuth, clearAuth } = useAuthStore.getState();

  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  let response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // Token expired check (Forbidden - 403)
  if (response.status === 403 && refreshToken) {
    try {
      const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        const user = useAuthStore.getState().user;
        if (user) {
          setAuth(user, data.accessToken, data.refreshToken);
        }
        
        // Retry with new token
        headers.set('Authorization', `Bearer ${data.accessToken}`);
        response = await fetch(`${BASE_URL}${endpoint}`, {
          ...options,
          headers,
        });
      } else {
        clearAuth();
      }
    } catch (err) {
      clearAuth();
    }
  }

  return response;
}

export const apiService = {
  get: (endpoint: string, options?: RequestInit) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint: string, body: any, options?: RequestInit) =>
    request(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),
};
export default apiService;

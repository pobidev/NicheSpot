const API_BASE = '';

async function api(path, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.reload();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }

  return res.json();
}

export const login = (data) => api('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
export const register = (data) => api('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
export const getMe = () => api('/api/auth/me');

export const searchAlbums = (q) => api(`/api/albums/search?q=${encodeURIComponent(q)}`);
export const getFeed = () => api('/api/albums/feed');
export const addAlbum = (data) => api('/api/albums', { method: 'POST', body: JSON.stringify(data) });

export const addUserAlbum = (data) => api('/api/albums/user-albums', { method: 'POST', body: JSON.stringify(data) });
export const updateUserAlbum = (id, data) => api(`/api/albums/user-albums/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteUserAlbum = (id) => api(`/api/albums/user-albums/${id}`, { method: 'DELETE' });
export const getUserAlbums = (status) => api(`/api/albums/user-albums${status ? `?status=${status}` : ''}`);
export const getFriendAlbums = (userId) => api(`/api/albums/user-albums/user/${userId}`);
export const recommendAlbum = (data) => api('/api/albums/recommend', { method: 'POST', body: JSON.stringify(data) });

export const getFriends = () => api('/api/friends');
export const getPending = () => api('/api/friends/pending');
export const getRecommendations = () => api('/api/friends/recommendations');
export const sendFriendRequest = (data) => api('/api/friends/request', { method: 'POST', body: JSON.stringify(data) });
export const acceptFriend = (id) => api(`/api/friends/${id}/accept`, { method: 'PUT' });
export const removeFriend = (id) => api(`/api/friends/${id}`, { method: 'DELETE' });
export const searchUsers = (q = '') => api('/api/friends/search' + (q ? `?q=${encodeURIComponent(q)}` : ''));

export const getProfile = () => api('/api/profile');
export const updateProfile = (data) => api('/api/profile', { method: 'PUT', body: JSON.stringify(data) });
export const syncLastfm = () => api('/api/profile/sync-lastfm', { method: 'POST' });

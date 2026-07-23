const BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  login: (pin) => request('/auth/login', { method: 'POST', body: JSON.stringify({ pin }) }),
  setupPin: (tempToken, pin) => request('/auth/setup-pin', { method: 'POST', body: JSON.stringify({ temp_token: tempToken, pin }) }),
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  lookupAccessCode: (code) => request(`/auth/events/access-code/${encodeURIComponent(code)}`),
  getRegistrationRequests: () => request('/auth/registration-requests'),
  approveRegistration: (id) => request(`/auth/registration-requests/${id}/approve`, { method: 'POST' }),
  rejectRegistration: (id) => request(`/auth/registration-requests/${id}/reject`, { method: 'POST' }),
  getEventAccessCode: (eventId) => request(`/events/${eventId}/access-code`),
  setEventAccessCode: (eventId, code) => request(`/events/${eventId}/access-code`, { method: 'PUT', body: JSON.stringify({ access_code: code }) }),
  deleteEventAccessCode: (eventId) => request(`/events/${eventId}/access-code`, { method: 'DELETE' }),
  createInvitation: (data) => request('/auth/invitations', { method: 'POST', body: JSON.stringify(data) }),
  getInvitations: () => request('/auth/invitations'),
  revokeInvitation: (id) => request(`/auth/invitations/${id}/revoke`, { method: 'POST' }),
  getInvitation: (token) => request(`/auth/invitation/${token}`),
  acceptInvitation: (token, pin) => request('/auth/invitations/accept', { method: 'POST', body: JSON.stringify({ token, pin }) }),
  getOnboardingSettings: (eventId) => request(`/auth/onboarding-settings/${eventId}`),
  setOnboardingSettings: (eventId, method) => request(`/auth/onboarding-settings/${eventId}`, { method: 'PUT', body: JSON.stringify({ onboarding_method: method }) }),
  getEvents: () => request('/events'),
  getEvent: (id) => request(`/events/${id}`),
  createEvent: (data) => request('/events', { method: 'POST', body: JSON.stringify(data) }),
  updateEvent: (id, data) => request(`/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEvent: (id) => request(`/events/${id}`, { method: 'DELETE' }),
  getGuests: (eventId, q) => request(`/guests?event_id=${eventId}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  getPendingGuests: (eventId) => request(`/guests?event_id=${eventId}&status=pending`),
  getPendingGuestCount: (eventId) => request(`/guests/pending/count?event_id=${eventId}`),
  getGuest: (id) => request(`/guests/${id}`),
  createGuest: (data) => request('/guests', { method: 'POST', body: JSON.stringify(data) }),
  updateGuest: (id, data) => request(`/guests/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGuest: (id) => request(`/guests/${id}`, { method: 'DELETE' }),
  approveGuest: (id) => request(`/guests/${id}/approve`, { method: 'PUT' }),
  rejectGuest: (id) => request(`/guests/${id}/reject`, { method: 'PUT' }),
  importGuests: (eventId, guests) => request('/guests/import', { method: 'POST', body: JSON.stringify({ event_id: eventId, guests }) }),
  getActivities: (eventId) => request(`/activities?event_id=${eventId}`),
  createActivity: (data) => request('/activities', { method: 'POST', body: JSON.stringify(data) }),
  updateActivity: (id, data) => request(`/activities/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  reorderActivities: (eventId, ordered_ids) => request(`/activities/reorder/${eventId}`, { method: 'PUT', body: JSON.stringify({ ordered_ids }) }),
  deleteActivity: (id) => request(`/activities/${id}`, { method: 'DELETE' }),
  checkIn: (guest_id, activity_id) => request('/checkins', { method: 'POST', body: JSON.stringify({ guest_id, activity_id }) }),
  undoCheckIn: (id) => request(`/checkins/${id}`, { method: 'DELETE' }),
  getGuestCheckins: (guestId) => request(`/checkins/guest/${guestId}`),
  getActivityCheckins: (activityId) => request(`/checkins/activity/${activityId}`),
  getDashboard: (eventId) => request(`/dashboard/${eventId}`),
  getUsers: () => request('/users'),
  getUser: (id) => request(`/users/${id}`),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  updateUserStatus: (id, status) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),
  resetUserPin: (id) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ pin: '1234' }) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  parseImportFile: (fileData) => request('/guests/import/parse', { method: 'POST', body: JSON.stringify({ file_data: fileData }) }),
  previewImport: (eventId, sessionId, mapping, duplicateRule) => request('/guests/import/preview', { method: 'POST', body: JSON.stringify({ event_id: eventId, session_id: sessionId, mapping, duplicate_rule: duplicateRule }) }),
  confirmImport: (eventId, sessionId, duplicateAction, fileName) => request('/guests/import/confirm', { method: 'POST', body: JSON.stringify({ event_id: eventId, session_id: sessionId, duplicate_action: duplicateAction, file_name: fileName }) }),
  getImportHistory: (eventId) => request(`/guests/import/history/${eventId}`),
  bulkGuests: (eventId, guestIds, action, value) => request('/guests/bulk', { method: 'POST', body: JSON.stringify({ event_id: eventId, guest_ids: guestIds, action, value }) }),
  getStaffDashboard: () => request('/staff/dashboard'),
  getLeaderboard: (eventId) => request(`/staff/leaderboard${eventId ? `?event_id=${eventId}` : ''}`),
  getActivityPerformance: (eventId) => request(`/staff/activity-performance?event_id=${eventId}`),
  getStaffTimeline: (userId) => request(`/staff/timeline${userId ? `?user_id=${userId}` : ''}`),
  getStaffStats: (id) => request(`/staff/stats/${id}`),
  getRegistrationStatus: (id) => request(`/auth/registration-request/${id}/status`),
};

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
    // A 401 means the credential itself was rejected, so retrying with the
    // same token is futile (polling pages would spam 401s forever). Drop the
    // dead token and return to login, unless already on a public route.
    if (token) localStorage.removeItem('token');
    const here = window.location.pathname || '';
    const isPublic =
      here === '/login' ||
      here === '/register' ||
      here.startsWith('/invitation/') ||
      here.startsWith('/pending-approval/');
    if (!isPublic) {
      window.location.href = '/login';
    }
    const errData = await res.json().catch(() => ({ error: 'Unauthorized' }));
    throw new Error(errData.error || 'Session expired. Please log in again.');
  }
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  // Phase 5: expose pagination headers without changing return shapes.
  api.lastHeaders = {
    total: res.headers.get('X-Total-Count'),
    truncated: res.headers.get('X-Truncated'),
  };
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
  getGuests: (eventId, q, limit) => request(`/guests?event_id=${eventId}${q ? `&q=${encodeURIComponent(q)}` : ''}${limit ? `&limit=${limit}` : ''}`),
  getPlatform: () => request('/platform'),
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
  checkIn: (guest_id, activity_id, key) => request('/checkins', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify({ guest_id, activity_id }) }),
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
  parseImportFile: (fileData, fileName, sheetName) => request('/guests/import/parse', { method: 'POST', body: JSON.stringify({ file_data: fileData, file_name: fileName, sheet_name: sheetName }) }),
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
  // Phase 1 — guest invitations, RSVP, readiness, report, lifecycle
  openGuestInvite: (token) => request(`/guest-invite/${encodeURIComponent(token)}`),
  submitRsvp: (token, response, note) => request(`/guest-invite/${encodeURIComponent(token)}/rsvp`, { method: 'POST', body: JSON.stringify({ response, note }) }),
  createGuestInvites: (eventId, guestIds) => request('/guest-invites', { method: 'POST', body: JSON.stringify({ event_id: eventId, guest_ids: guestIds }) }),
  getGuestInvites: (eventId) => request(`/guest-invites?event_id=${eventId}`),
  resendGuestInvite: (id) => request(`/guest-invites/${id}/resend`, { method: 'POST' }),
  revokeGuestInvite: (id) => request(`/guest-invites/${id}/revoke`, { method: 'POST' }),
  getRsvpSummary: (eventId) => request(`/rsvp-summary?event_id=${eventId}`),
  getReadiness: (eventId) => request(`/event/${eventId}/readiness`),
  getEventReport: (eventId) => request(`/event/${eventId}/report`),
  transitionLifecycle: (eventId, to) => request(`/events/${eventId}/lifecycle`, { method: 'POST', body: JSON.stringify({ to }) }),
  getTemplates: () => request('/templates'),
  // Phase 2 — QR access & dual check-in
  getVenueQr: (eventId) => request(`/events/${eventId}/checkin-qr`),
  rotateVenueQr: (eventId) => request(`/events/${eventId}/checkin-qr/rotate`, { method: 'POST' }),
  resolveSelfCheckin: (code) => request(`/self-checkin/${encodeURIComponent(code)}`),
  selfCheckin: (code, token) => request(`/self-checkin/${encodeURIComponent(code)}/checkin`, { method: 'POST', body: JSON.stringify({ token }) }),
  staffQrCheckin: (token, activity_id, key) => request('/checkins/qr', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify({ token, activity_id }) }),
  // Guest Journey & Event Companion (token-scoped, accountless)
  journeyContext: (token) => request(`/journey/${encodeURIComponent(token)}`),
  journeyCheckin: (token) => request(`/guest-invite/${encodeURIComponent(token)}/checkin`, { method: 'POST' }),
  journeySeatConfirm: (token) => request(`/journey/${encodeURIComponent(token)}/seat-confirm`, { method: 'POST' }),
  journeyMenu: (token) => request(`/journey/${encodeURIComponent(token)}/menu`),
  journeyRequests: (token) => request(`/journey/${encodeURIComponent(token)}/requests`),
  journeyCreateRequest: (token, data) => request(`/journey/${encodeURIComponent(token)}/requests`, { method: 'POST', body: JSON.stringify(data) }),
  seatLookup: (token) => request('/seat-lookup', { method: 'POST', body: JSON.stringify({ token }) }),
  staffSeatConfirm: (token) => request('/seat-confirm', { method: 'POST', body: JSON.stringify({ token }) }),
  getServiceMenu: (eventId) => request(`/service-menu?event_id=${eventId}`),
  createServiceMenuItem: (data) => request('/service-menu', { method: 'POST', body: JSON.stringify(data) }),
  updateServiceMenuItem: (id, data) => request(`/service-menu/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteServiceMenuItem: (id) => request(`/service-menu/${id}`, { method: 'DELETE' }),
  getSchedule: (eventId) => request(`/schedule?event_id=${eventId}`),
  createScheduleItem: (data, key) => request('/schedule', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify(data) }),
  updateScheduleItem: (id, data) => request(`/schedule/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setScheduleStatus: (id, to) => request(`/schedule/${id}/status`, { method: 'POST', body: JSON.stringify({ to }) }),
  deleteScheduleItem: (id) => request(`/schedule/${id}`, { method: 'DELETE' }),
  getTasks: (eventId, opts = {}) => request(`/tasks?event_id=${eventId}${opts.assignee ? `&assignee=${opts.assignee}` : ''}${opts.status ? `&status=${opts.status}` : ''}`),
  createTask: (data, key) => request('/tasks', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify(data) }),
  updateTask: (id, data) => request(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setTaskStatus: (id, to) => request(`/tasks/${id}/status`, { method: 'POST', body: JSON.stringify({ to }) }),
  completeTask: (id) => request(`/tasks/${id}/complete`, { method: 'POST' }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  getIncidents: (eventId, opts = {}) => request(`/incidents?event_id=${eventId}${opts.critical ? '&critical=1' : ''}${opts.status ? `&status=${opts.status}` : ''}`),
  createIncident: (data, key) => request('/incidents', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify(data) }),
  updateIncident: (id, data) => request(`/incidents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setIncidentStatus: (id, to, resolution) => request(`/incidents/${id}/status`, { method: 'POST', body: JSON.stringify({ to, resolution }) }),
  escalateIncident: (id, assignee_user_id) => request(`/incidents/${id}/escalate`, { method: 'POST', body: JSON.stringify({ assignee_user_id }) }),
  getRequests: (eventId, opts = {}) => request(`/requests?event_id=${eventId}${opts.status ? `&status=${opts.status}` : ''}`),
  createRequest: (data, key) => request('/requests', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify(data) }),
  updateRequest: (id, data) => request(`/requests/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setRequestStatus: (id, to, resolution) => request(`/requests/${id}/status`, { method: 'POST', body: JSON.stringify({ to, resolution }) }),
  getZones: (eventId) => request(`/seating/zones?event_id=${eventId}`),
  createZone: (data, key) => request('/seating/zones', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify(data) }),
  deleteZone: (id) => request(`/seating/zones/${id}`, { method: 'DELETE' }),
  getSeatAssignments: (eventId) => request(`/seating/assignments?event_id=${eventId}`),
  assignSeat: (data, move, key) => request('/seating/assign', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify({ ...data, move }) }),
  unassignSeat: (eventId, guestId) => request(`/seating/assign/${guestId}?event_id=${eventId}`, { method: 'DELETE' }),
  getVendors: (eventId) => request(`/vendors?event_id=${eventId}`),
  createVendor: (data, key) => request('/vendors', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify(data) }),
  updateVendor: (id, data) => request(`/vendors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setVendorStatus: (id, to) => request(`/vendors/${id}/status`, { method: 'POST', body: JSON.stringify({ to }) }),
  getTransport: (eventId) => request(`/transport?event_id=${eventId}`),
  createTransport: (data, key) => request('/transport', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify(data) }),
  setTransportStatus: (id, to) => request(`/transport/${id}/status`, { method: 'POST', body: JSON.stringify({ to }) }),
  addPassenger: (routeId, guest_id, key) => request(`/transport/${routeId}/passengers`, { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify({ guest_id }) }),
  getStays: (eventId) => request(`/stays?event_id=${eventId}`),
  createStay: (data, key) => request('/stays', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify(data) }),
  overrideCheckin: (id, reason) => request(`/checkins/${id}/override`, { method: 'POST', body: JSON.stringify({ reason }) }),
  // Phase 3 — command centers
  getCommand: (eventId, includeAcked) => request(`/command/${eventId}${includeAcked ? '?include_acked=1' : ''}`),
  getGlobalCommand: () => request('/command'),
  getTimeline: (eventId) => request(`/command/${eventId}/timeline`),
  ackAlert: (eventId, key) => request(`/command/${eventId}/ack`, { method: 'POST', body: JSON.stringify({ key }) }),
  unackAlert: (eventId, key) => request(`/command/${eventId}/unack`, { method: 'POST', body: JSON.stringify({ key }) }),
  // Phase 4 — managed service delivery
  getWorkspace: () => request('/operator/workspace'),
  getWorkload: () => request('/operator/workload'),
  getQuality: () => request('/operator/quality'),
  getNotes: (eventId) => request(`/notes?event_id=${eventId}`),
  createNote: (eventId, body, visibility) => request('/notes', { method: 'POST', body: JSON.stringify({ event_id: eventId, body, visibility }) }),
  grantBreakGlass: (event_id, user_id, reason, minutes) => request('/break-glass', { method: 'POST', body: JSON.stringify({ event_id, user_id, reason, minutes }) }),
  revokeBreakGlass: (id) => request(`/break-glass/${id}/revoke`, { method: 'POST' }),
  getIntakes: () => request('/intakes'),
  createIntake: (data) => request('/intakes', { method: 'POST', body: JSON.stringify(data) }),
  convertIntake: (id, template_key) => request(`/intakes/${id}/convert`, { method: 'POST', body: JSON.stringify({ template_key }) }),
  getDecisions: (eventId, status) => request(`/decisions?event_id=${eventId}${status ? `&status=${status}` : ''}`),
  createDecision: (data) => request('/decisions', { method: 'POST', body: JSON.stringify(data) }),
  decideDecision: (id, decision) => request(`/decisions/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision }) }),
  getRunbook: (eventId) => request(`/runbook?event_id=${eventId}`),
  materializeRunbook: (eventId) => request('/runbook/materialize', { method: 'POST', body: JSON.stringify({ event_id: eventId }) }),
  checkRunbookItem: (id, done) => request(`/runbook-items/${id}/check`, { method: 'POST', body: JSON.stringify({ done }) }),
  getDevices: (eventId) => request(`/devices?event_id=${eventId}`),
  createDevice: (data) => request('/devices', { method: 'POST', body: JSON.stringify(data) }),
  setDeviceStatus: (id, to) => request(`/devices/${id}/status`, { method: 'POST', body: JSON.stringify({ to }) }),
  getComms: (eventId) => request(`/comms?event_id=${eventId}`),
  createComm: (data) => request('/comms', { method: 'POST', body: JSON.stringify(data) }),
  setCommStatus: (id, to) => request(`/comms/${id}/status`, { method: 'POST', body: JSON.stringify({ to }) }),
  getReadinessFull: (eventId) => request(`/event/${eventId}/readiness-full`),
  getCustomerSummary: (eventId) => request(`/event/${eventId}/customer-summary`),
  getResults: (eventId) => request(`/event/${eventId}/results`),
  // Phase 6 — professional / enterprise
  getOrgs: () => request('/organizations'),
  getOrg: (id) => request(`/organizations/${id}`),
  createOrg: (data) => request('/organizations', { method: 'POST', body: JSON.stringify(data) }),
  updateOrg: (id, data) => request(`/organizations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteOrg: (id) => request(`/organizations/${id}`, { method: 'DELETE' }),
  addOrgMember: (orgId, user_id, org_role) => request(`/organizations/${orgId}/members`, { method: 'POST', body: JSON.stringify({ user_id, org_role }) }),
  removeOrgMember: (orgId, userId) => request(`/organizations/${orgId}/members/${userId}`, { method: 'DELETE' }),
  getOrgPortfolio: (orgId) => request(`/organizations/${orgId}/portfolio`),
  getOrgReport: (orgId) => request(`/organizations/${orgId}/report`),
  getOrgConflicts: (orgId) => request(`/organizations/${orgId}/conflicts`),
  getVenues: (orgId) => request(`/venues?org_id=${orgId}`),
  createVenue: (data) => request('/venues', { method: 'POST', body: JSON.stringify(data) }),
  updateVenue: (id, data) => request(`/venues/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteVenue: (id) => request(`/venues/${id}`, { method: 'DELETE' }),
  getContracts: (orgId) => request(`/contracts?org_id=${orgId}`),
  createContract: (data) => request('/contracts', { method: 'POST', body: JSON.stringify(data) }),
  updateContract: (id, data) => request(`/contracts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteContract: (id) => request(`/contracts/${id}`, { method: 'DELETE' }),
  createTemplate: (data) => request('/templates', { method: 'POST', body: JSON.stringify(data) }),
  templateFromEvent: (eventId, data) => request(`/templates/from-event/${eventId}`, { method: 'POST', body: JSON.stringify(data) }),
  cloneEvent: (eventId, data) => request(`/events/${eventId}/clone`, { method: 'POST', body: JSON.stringify(data) }),
  // Phase 7 — intelligence (deterministic, explainable)
  getIntelligence: (eventId) => request(`/intelligence/${eventId}`),
  getBaselines: (orgId, templateKey) => request(`/learning/baselines${orgId !== undefined ? `?org_id=${orgId}` : ''}${templateKey ? `${orgId !== undefined ? '&' : '?'}template_key=${templateKey}` : ''}`),
  rebuildLearning: () => request('/learning/rebuild', { method: 'POST' }),
  queueRsvpNudges: (eventId, key) => request('/followups/rsvp-nudges', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify({ event_id: eventId }) }),
};

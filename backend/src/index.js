import express from 'express';
import cors from 'cors';
import db, { initializeDatabase } from './database.js';
import websocketService from './websocket.js';

import authRoutes from './routes/auth.js';
import eventsRoutes from './routes/events.js';
import guestsRoutes from './routes/guests.js';
import activitiesRoutes from './routes/activities.js';
import checkinsRoutes from './routes/checkins.js';
import dashboardRoutes from './routes/dashboard.js';
import usersRoutes from './routes/users.js';
import staffRoutes from './routes/staff.js';
import shiftsRoutes from './routes/shifts.js';
import announcementsRoutes from './routes/announcements.js';
import feedbackRoutes from './routes/feedback.js';
import skillsRoutes from './routes/skills.js';
import imagesRoutes from './routes/images.js';
import menusRoutes from './routes/menus.js';
import importRoutes from './routes/import.js';
import organizationsRoutes from './routes/organizations.js';
import templatesRoutes from './routes/templates.js';
import accessTokensRoutes from './routes/accessTokens.js';
import auditRoutes from './routes/audit.js';
import guestInvitesRoutes from './routes/guestInvites.js';
import customInvitesRoutes from './routes/customInvites.js';
import qrCheckinRoutes from './routes/qrCheckin.js';
import journeyRoutes from './routes/journey.js';
import eventOpsRoutes from './routes/eventOps.js';
import scheduleRoutes from './routes/schedule.js';
import tasksRoutes from './routes/tasks.js';
import incidentsRoutes from './routes/incidents.js';
import requestsRoutes from './routes/requests.js';
import vendorsRoutes from './routes/vendors.js';
import transportRoutes from './routes/transport.js';
import staysRoutes from './routes/stays.js';
import commandRoutes from './routes/command.js';
import operatorRoutes from './routes/operator.js';
import deliveryRoutes from './routes/delivery.js';
import platformRoutes from './routes/platform.js';
import venuesRoutes from './routes/venues.js';
import contractsRoutes from './routes/contracts.js';
import intelligenceRoutes from './routes/intelligence.js';
import seatingRoutes from './routes/seating.js';
import wayfindingRoutes from './routes/wayfinding.js';
import { observe } from './middleware/observe.js';
import { publicAbuseLimit } from './middleware/abuseLimit.js';

initializeDatabase();

const app = express();
const PORT = process.env.PORT || 5175;

app.use(cors({
  origin: (origin, cb) => {
    // No Origin header (curl, mobile apps, same-origin worker proxy): allow.
    if (!origin) return cb(null, true);
    const frontend = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (frontend && origin === frontend) return cb(null, true);
    // Allow Cloudflare Workers deployment
    if (origin === 'https://eventcheck-frontend.sudokodes-477.workers.dev') {
      return cb(null, true);
    }
    // Allow specific ngrok tunnel for development
    if (process.env.NODE_ENV !== 'production' && origin === 'https://borrower-autopilot-amazingly.ngrok-free.dev') {
      return cb(null, true);
    }
    // Allow any ngrok-free.dev subdomain for development
    if (process.env.NODE_ENV !== 'production' && origin.includes('ngrok-free.dev')) {
      return cb(null, true);
    }
    // Local development conveniences; never active behind the worker proxy,
    // which issues same-origin requests with no Origin header.
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    return cb(new Error('CORS origin rejected'));
  },
}));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));
app.use(observe);

// Credential-guessing guard on public invitation/journey paths. Counts only
// 404/410 outcomes (unresolvable/revoked credentials) and converts further
// failures to 429 — successes, duplicates, lifecycle messages, and wrong-event
// guidance always pass, so a busy entrance behind one venue-WiFi IP cannot be
// throttled by legitimate traffic.
for (const prefix of ['/api/self-checkin', '/api/guest-invite', '/api/journey', '/api/custom-invite']) {
  app.use(prefix, publicAbuseLimit);
}

// Public endpoints first: routers mounted at bare `/api` run their middleware
// for every /api/* path, so these must be defined before any app.use mounts.
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'EventCheck API', version: '1.0.3-debug', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Readiness: process is up AND the database is queryable AND an admin exists.
// Returns 503 until all three hold. Reports counts only, never secrets.
app.get('/api/ready', (req, res) => {
  try {
    const one = db.prepare('SELECT 1 AS ok').get();
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get();
    if (one && one.ok === 1 && admins && admins.c >= 1) {
      return res.json({ status: 'ready' });
    }
    return res.status(503).json({ status: 'not-ready', reason: 'no-admin' });
  } catch (e) {
    return res.status(503).json({ status: 'not-ready', reason: 'db-error' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/guests', guestsRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/checkins', checkinsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/images', imagesRoutes);
app.use('/api/menus', menusRoutes);
app.use('/api/guests/import', importRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/venues', venuesRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/access-tokens', accessTokensRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api', guestInvitesRoutes);
app.use('/api', customInvitesRoutes);
app.use('/api', qrCheckinRoutes);
app.use('/api', eventOpsRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/incidents', incidentsRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/vendors', vendorsRoutes);
app.use('/api/transport', transportRoutes);
app.use('/api/stays', staysRoutes);
app.use('/api', commandRoutes);
app.use('/api', operatorRoutes);
app.use('/api', journeyRoutes);
app.use('/api', deliveryRoutes);
app.use('/api', platformRoutes);
app.use('/api', intelligenceRoutes);
app.use('/api/seating', seatingRoutes);
app.use('/api/wayfinding', wayfindingRoutes);

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.use((err, req, res, next) => {
  if (err && /CORS origin rejected/.test(err.message || '')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error('Express route error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server successfully running on 0.0.0.0:${PORT}`);
  // Initialize WebSocket server
  websocketService.initialize(server);
});

server.on('error', (err) => {
  console.error('Server listen error:', err.message);
});

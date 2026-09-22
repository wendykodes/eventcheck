import express from 'express';
import cors from 'cors';
import db, { initializeDatabase } from './database.js';

import authRoutes from './routes/auth.js';
import eventsRoutes from './routes/events.js';
import guestsRoutes from './routes/guests.js';
import activitiesRoutes from './routes/activities.js';
import checkinsRoutes from './routes/checkins.js';
import dashboardRoutes from './routes/dashboard.js';
import usersRoutes from './routes/users.js';
import staffRoutes from './routes/staff.js';
import importRoutes from './routes/import.js';
import organizationsRoutes from './routes/organizations.js';
import templatesRoutes from './routes/templates.js';
import accessTokensRoutes from './routes/accessTokens.js';
import auditRoutes from './routes/audit.js';
import guestInvitesRoutes from './routes/guestInvites.js';
import qrCheckinRoutes from './routes/qrCheckin.js';
import eventOpsRoutes from './routes/eventOps.js';
import scheduleRoutes from './routes/schedule.js';
import tasksRoutes from './routes/tasks.js';
import incidentsRoutes from './routes/incidents.js';
import requestsRoutes from './routes/requests.js';
import seatingRoutes from './routes/seating.js';
import vendorsRoutes from './routes/vendors.js';
import transportRoutes from './routes/transport.js';
import staysRoutes from './routes/stays.js';
import commandRoutes from './routes/command.js';
import operatorRoutes from './routes/operator.js';
import deliveryRoutes from './routes/delivery.js';
import platformRoutes from './routes/platform.js';
import { observe } from './middleware/observe.js';

initializeDatabase();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(observe);

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
app.use('/api/guests/import', importRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/access-tokens', accessTokensRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api', guestInvitesRoutes);
app.use('/api', qrCheckinRoutes);
app.use('/api', eventOpsRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/incidents', incidentsRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/seating', seatingRoutes);
app.use('/api/vendors', vendorsRoutes);
app.use('/api/transport', transportRoutes);
app.use('/api/stays', staysRoutes);
app.use('/api', commandRoutes);
app.use('/api', operatorRoutes);
app.use('/api', deliveryRoutes);
app.use('/api', platformRoutes);

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.use((err, req, res, next) => {
  console.error('Express route error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server successfully running on 0.0.0.0:${PORT}`);
});

server.on('error', (err) => {
  console.error('Server listen error:', err.message);
});

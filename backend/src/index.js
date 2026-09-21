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

initializeDatabase();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

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

import express from 'express';
import cors from 'cors';
import { initializeDatabase } from './database.js';

import authRoutes from './routes/auth.js';
import eventsRoutes from './routes/events.js';
import guestsRoutes from './routes/guests.js';
import activitiesRoutes from './routes/activities.js';
import checkinsRoutes from './routes/checkins.js';
import dashboardRoutes from './routes/dashboard.js';
import usersRoutes from './routes/users.js';
import staffRoutes from './routes/staff.js';
import importRoutes from './routes/import.js';

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

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'EventCheck API', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
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

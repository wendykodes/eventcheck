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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

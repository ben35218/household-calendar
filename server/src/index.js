require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const connectDB = require('./db');
const { startScheduler } = require('./jobs/scheduler');

// "Log and restart": an unhandled rejection or uncaught exception means a bug
// we didn't catch and process state may be corrupt, so we log the full stack,
// stop accepting new connections, and exit non-zero. The supervisor (run.js)
// then starts a fresh process. The logged stack is the thing to actually fix.
let httpServer = null;
let shuttingDown = false;
function fatal(label, err) {
  console.error(`[${label}]`, err?.stack || err);
  if (shuttingDown) return;       // a second fault while draining — let exit proceed
  shuttingDown = true;
  const done = () => process.exit(1);
  if (httpServer) {
    httpServer.close(done);
    setTimeout(done, 5000).unref();   // force-exit if connections don't drain
  } else {
    done();
  }
}
process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason));
process.on('uncaughtException', (err) => fatal('uncaughtException', err));

const authRoutes = require('./routes/auth');
const categoryRoutes = require('./routes/categories');
const itemRoutes = require('./routes/items');
const manualRoutes = require('./routes/manuals');
const taskRoutes = require('./routes/tasks');
const taskTemplateRoutes = require('./routes/taskTemplates');
const choreRoutes = require('./routes/chores');
const choreTemplateRoutes = require('./routes/choreTemplates');
const calendarRoutes = require('./routes/calendar');
const calendarChatRoutes = require('./routes/calendarChat');
const maintenanceChatRoutes = require('./routes/maintenanceChat');
const vacationChatRoutes = require('./routes/vacationChat');
const formAssistRoutes = require('./routes/formAssist');
const placesRoutes = require('./routes/places');
const historyRoutes = require('./routes/history');
const settingsRoutes = require('./routes/settings');
const odometerRoutes = require('./routes/odometer');
const weatherRoutes = require('./routes/weather');
const peopleRoutes = require('./routes/people');
const recipeRoutes = require('./routes/recipes');
const recipeScheduleRoutes = require('./routes/recipeSchedule');
const inventoryRoutes = require('./routes/inventory');
const tripRoutes = require('./routes/trips');
const householdRoutes = require('./routes/household');
const keyRoutes = require('./routes/keys');
const notificationRoutes = require('./routes/notifications');
const billingRoutes = require('./routes/billing');
const monetizationConfigRoutes = require('./routes/monetizationConfig');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS allowlist. Browser clients (web app + admin app) send an Origin and must
// be allowed explicitly; the native mobile app sends no Origin and is allowed
// through (the `!origin` case). Set CORS_ORIGINS (comma-separated) for
// production; CLIENT_URL is honored as a fallback. In non-production we always
// add the local dev ports for the consumer web client (5173) and admin app
// (5174) so both run out of the box even when CLIENT_URL pins a single origin.
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'];
const configuredOrigins = (process.env.CORS_ORIGINS || process.env.CLIENT_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOrigins =
  process.env.NODE_ENV === 'production'
    ? (configuredOrigins.length ? configuredOrigins : DEV_ORIGINS)
    : [...new Set([...configuredOrigins, ...DEV_ORIGINS])];
app.use(cors({
  origin(origin, cb) {
    // No Origin header → native app / curl / same-origin → allow.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || './uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/manuals', manualRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/task-templates', taskTemplateRoutes);
app.use('/api/chores', choreRoutes);
app.use('/api/chore-templates', choreTemplateRoutes);
app.use('/api/calendar/chat', calendarChatRoutes);
app.use('/api/maintenance/chat', maintenanceChatRoutes);
app.use('/api/vacation/chat', vacationChatRoutes);
app.use('/api/form-assist', formAssistRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/places', placesRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/vehicles/:itemId/odometer', odometerRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/people', peopleRoutes);
app.use('/api/recipes', recipeRoutes);
app.use('/api/recipe-schedule', recipeScheduleRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/household', householdRoutes);
app.use('/api/keys', keyRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/billing', billingRoutes);
// Admin-only monetization config (consumed by the separate admin web app).
// Gated by requireAuth + requireAdmin inside the router.
app.use('/api/monetization-config', monetizationConfigRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 3001;

connectDB().then(() => {
  httpServer = app.listen(PORT, () => {
    console.log(`Household Calendar server running on port ${PORT}`);
    startScheduler();
  });
});

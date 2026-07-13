// Express app construction, separated from the process concerns in index.js
// (dotenv, DB connect, listen, scheduler, crash supervisor) so the integration
// tests can mount the real app over an in-memory MongoDB without opening a port.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const authRoutes = require('./routes/auth');
const categoryRoutes = require('./routes/categories');
const itemRoutes = require('./routes/items');
const manualRoutes = require('./routes/manuals');
const taskRoutes = require('./routes/tasks');
const taskTemplateRoutes = require('./routes/taskTemplates');
const choreRoutes = require('./routes/chores');
const choreTemplateRoutes = require('./routes/choreTemplates');
const calendarRoutes = require('./routes/calendar');
const customCalendarRoutes = require('./routes/calendars');
const invitationRoutes = require('./routes/invitations');
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
const storageRoutes = require('./routes/storage');
const billingRoutes = require('./routes/billing');
const monetizationConfigRoutes = require('./routes/monetizationConfig');
const adminRoutes = require('./routes/admin');
const adminAnalyticsRoutes = require('./routes/adminAnalytics');
const adminEmailRoutes = require('./routes/adminEmail');

// Patch the Anthropic SDK once so one-shot AI calls auto-record token usage
// against the weekly budget (see services/aiUsage.js). Streaming chat records
// separately in chatStream.js.
require('./services/aiUsage').patchAnthropic();

const app = express();

// Behind Render's proxy the client address arrives in X-Forwarded-For; without
// this every request shares the LB's IP and per-IP rate limits punish everyone.
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS allowlist. The admin web app sends an Origin and must be allowed
// explicitly; the native mobile app sends no Origin and is allowed through
// (the `!origin` case). Set CORS_ORIGINS (comma-separated) for production;
// CLIENT_URL is honored as a fallback. In non-production we always add the
// local dev port for the admin app (5174) so it runs out of the box even when
// CLIENT_URL pins a single origin.
const DEV_ORIGINS = ['http://localhost:5174'];
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
  // Sliding session refresh: browser clients (admin app) can only read this
  // response header if it's exposed explicitly.
  exposedHeaders: ['X-Refreshed-Token'],
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
app.use('/api/calendars', customCalendarRoutes);
app.use('/api/invitations', invitationRoutes);
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
app.use('/api/storage', storageRoutes);
app.use('/api/billing', billingRoutes);
// Admin-only monetization config (consumed by the separate admin web app).
// Gated by requireAuth + requireAdmin inside the router.
app.use('/api/monetization-config', monetizationConfigRoutes);
// Admin analytics (content-blind product-usage insights). requireAdmin-gated.
// Mounted before the broader /api/admin so its paths match without falling
// through that router's auth stack first.
app.use('/api/admin/analytics', adminAnalyticsRoutes);
// Admin email surfaces (outbound send log + support@ inbox). requireAdmin-gated.
app.use('/api/admin/email', adminEmailRoutes);
// Admin-only ops surfaces (users, E2EE readiness, audit log). requireAdmin-gated.
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

module.exports = app;

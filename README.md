# Household Copilot

A MEVN-stack web application for managing household inventory, product manuals, and maintenance schedules. Built for rural/countryside homeowners who need to track many items and recurring tasks across appliances, vehicles, systems, and land.

## Stack

- **MongoDB** (via Mongoose) — data storage
- **Express.js** — REST API
- **Vue 3** (Composition API + `<script setup>`) — frontend SPA
- **Node.js** — runtime
- **Vuetify 3** — Material Design UI
- **Pinia** — state management
- **node-cron** + **Nodemailer** — scheduled email reminders

## Features

- **Inventory** — CRUD for household items with categories, custom fields, photos (grid & list views)
- **Manuals** — Upload PDFs or fetch from URL; copies stored locally so they survive dead links
- **Maintenance tasks** — Interval-based, calendar/seasonal, or one-time recurrence; auto-computes next due date on completion
- **Template library** — 50+ rural-home task templates (HVAC, septic, vehicles, exterior, electrical, appliances, etc.)
- **Calendar view** — Monthly view of upcoming tasks
- **Email reminders** — Daily digest via Gmail, with dedup so you never get the same reminder twice
- **History** — Full log of every task completion with cost and notes

---

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- A Gmail account with App Password enabled

### 1. Clone & install

```bash
git clone <repo-url>
cd household-copilot
npm install                    # root (concurrently)
npm --prefix server install    # server deps
npm --prefix client install    # client deps
```

### 2. Configure the server

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```env
PORT=3001
MONGODB_URI=mongodb://localhost:27017/household-copilot
JWT_SECRET=<long-random-string>
JWT_EXPIRES_IN=7d
UPLOAD_DIR=./uploads

# Gmail (App Password method — see below)
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx

APP_URL=http://localhost:5173
CLIENT_URL=http://localhost:5173
```

### 3. Run in development

```bash
npm run dev
```

This starts both the server (port 3001) and client (port 5173) concurrently.

- **App:** http://localhost:5173
- **API:** http://localhost:3001/api

Register an account — default categories are seeded automatically on first registration.

---

## Gmail Configuration

The app uses Nodemailer with Gmail App Passwords (SMTP). OAuth2 is architecturally supported by swapping the transport in `server/src/services/email.js`.

### App Password setup

1. Go to your Google Account → **Security** → **2-Step Verification** (must be enabled)
2. At the bottom, click **App passwords**
3. Create a new app password for "Mail" / "Other" → name it "Household Copilot"
4. Copy the 16-character password into `GMAIL_APP_PASSWORD` in `server/.env`

The scheduler sends a single daily digest at 07:00 local time for all tasks due within your reminder lead window (default: 7 days). Use **Settings → Trigger Email Check Now** to test without waiting.

---

## Project Structure

```
/household-copilot
  /client               # Vue 3 + Vuetify SPA
    /src
      /views            # Page components
      /stores           # Pinia stores (auth)
      /router           # Vue Router config
      /services         # Axios API wrappers
  /server               # Express REST API
    /src
      /models           # Mongoose schemas
      /routes           # Express route handlers
      /services         # Email, recurrence engine
      /jobs             # node-cron daily scheduler
      /middleware       # JWT auth middleware
      seed.js           # Default category seeder
  /shared
    /seed
      taskTemplates.json  # 50+ rural home task templates
  package.json          # Root: dev/build scripts
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Secret for signing JWTs |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | For notifications | Web Push keys (`npx web-push generate-vapid-keys`). Push is the only notification channel; blank disables all alerts |
| `VAPID_SUBJECT` | For notifications | Contact `mailto:`/URL sent with push requests |
| `APP_URL` | For notifications | Base URL used in push deep-links |
| `UPLOAD_DIR` | No | Where to store uploaded files (default: `./uploads`) |

> Notifications are delivered **only via Web Push**. Alerts are configured per item
> (calendar event / chore / maintenance task), default to alerting on the due date,
> and — in a multi-member household — can target everyone or just the creator.
> Birthdays always alert everyone on the day. (Gmail SMTP vars are no longer used.)

---

## API Reference

All routes are prefixed with `/api`. Auth routes are public; everything else requires `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Register new user (seeds default categories) |
| POST | `/auth/login` | Login, returns JWT |
| GET | `/auth/me` | Current user info |
| GET/POST | `/categories` | List / create categories |
| PUT/DELETE | `/categories/:id` | Update / delete category |
| GET/POST | `/items` | List (searchable) / create items |
| GET/PUT/DELETE | `/items/:id` | Get / update / delete item |
| POST | `/manuals/items/:id/upload` | Upload a manual PDF |
| POST | `/manuals/items/:id/from-url` | Fetch & save manual from URL |
| GET | `/manuals/:id/download` | Stream stored manual file |
| DELETE | `/manuals/:id` | Delete manual |
| GET/POST | `/tasks` | List (filterable by status/category/item) / create tasks |
| POST | `/tasks/:id/complete` | Log completion, recompute next due date |
| POST | `/tasks/:id/pause` | Pause task |
| POST | `/tasks/:id/resume` | Resume task |
| POST | `/tasks/from-template` | Add tasks from template library |
| GET | `/task-templates` | Browse the rural-home template catalog |
| GET | `/calendar` | Tasks with due dates in a date range |
| GET | `/history` | Task completion log |
| GET/PUT | `/settings` | User notification settings |
| POST | `/settings/test-email` | Trigger the daily email check now |

---

## Backups

**MongoDB:** use `mongodump` or Atlas's built-in backups.

```bash
mongodump --uri="$MONGODB_URI" --out=./backup/$(date +%F)
```

**Manuals:** back up the `server/uploads/` directory (or your configured `UPLOAD_DIR`). These are the only files not in the database.

---

## Production Deployment

1. Set strong `JWT_SECRET` and real MongoDB URI in environment variables
2. Build the client: `npm run build` → serve `client/dist/` as static files (nginx, Caddy, or Express static middleware)
3. Run the server with a process manager: `pm2 start server/src/index.js`
4. Ensure `UPLOAD_DIR` points to a persistent volume

# SIGHT

**SIGHT** is an offline-first dental clinic PWA for registering patients (children), recording visits, managing **schedule quotas and appointments**, viewing **reports and charts**, and **syncing** with a central server when connectivity allows.  
The npm packages are still named `toothaid-client` and `toothaid-server`; this repository is hosted on GitHub as **SIGHT**.

## Table of contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Using the app](#using-the-app)
- [Features (current UI)](#features-current-ui)
- [Tech stack](#tech-stack)
- [Project layout](#project-layout)
- [Environment variables](#environment-variables)
- [Production](#production)
- [Offline and sync](#offline-and-sync)
- [API (summary)](#api-summary)
- [Backend scripts](#backend-scripts)

## Overview

Built for clinics that may work **without reliable internet** (e.g. school-based screening). The **browser stores data in IndexedDB** (Dexie); changes are queued and pushed with **idempotent** sync. The **Node/Express/MongoDB** backend handles authentication and merge/sync.

## Prerequisites

- **Node.js** 18+
- **MongoDB** — local install, `docker-compose` in this repo, or [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)

## Quick start

```bash
git clone https://github.com/dustin-26/SIGHT.git
cd SIGHT
```

**1. MongoDB (optional local)**

```bash
docker compose up -d
```

**2. Backend**

```bash
cd server
npm install
cp .env.example .env
# Edit .env: MONGODB_URI, JWT_SECRET (see [Environment variables](#environment-variables))
npm run seed   # optional — demo user demo/demo
npm start      # default http://localhost:3001
```

**3. Frontend** (second terminal)

```bash
cd client
npm install
cp .env.example .env   # optional; leave VITE_API_URL empty to use Vite dev proxy to :3001
npm run dev            # http://localhost:3000
```

Open **http://localhost:3000**, sign in (after seed: **`demo` / `demo`**).

## Using the app

| Area | What it does |
|------|----------------|
| **Today** | Today’s **AM/PM waiting list** from scheduled appointments, reorder, contact shortcuts, **Sync** card (pending ops, last sync). |
| **Children** | Search by **name or patient ID** (and related fields), register new child, open **profile** (visits, consent, details). |
| **Schedule** | **Month calendar** with per-day AM/PM quota and remaining slots; open a day to edit **location/quota**, **add/edit appointments** (search child by name/ID), optional **batch weekly** quota/location update. |
| **Reports** | Charts and **Excel export** (treatment summary, monthly/yearly). |

**From a child profile:** add or edit **visits** (tooth chart, symptoms, medications), and book or adjust **appointments** (linked to clinic-day quota).

## Features (current UI)

- **Patient ID** surfaced consistently next to names across lists and headers where relevant.
- **Children:** registration with duplicate hints, filters (school / grade / class), search.
- **Visits:** screening/treatment entry, DMFT-related fields, flags, treatment types, offline save + sync.
- **Schedule:** clinic day records with **AM/PM capacity**, appointments with priority and status, today’s queue on **Home**.
- **Reports:** Recharts dashboards, xlsx export.
- **PWA:** installable; bottom navigation **Today · Children · Schedule · Reports**.
- **Auto-sync** when the app loads and when the device goes **online** (with guards); manual **Sync** on **Today**.

## Tech stack

| Layer | Stack |
|-------|--------|
| Client | React 18, Vite, React Router, PWA (vite-plugin-pwa), Dexie, Recharts, xlsx |
| Server | Node.js, Express, Mongoose, JWT, bcryptjs, cors, dotenv |
| DB | MongoDB |

## Project layout

```
SIGHT/
├── client/                 # Vite React PWA
│   ├── src/
│   │   ├── components/     # NavBar, PageHeader, PatientNameBlock, modals, ToastHost, …
│   │   ├── pages/          # Home, SearchChild, ChildProfile, AddVisit, Schedule, ScheduleDay, …
│   │   ├── db/indexedDB.js # Dexie schema, sync helpers, outbox
│   │   └── utils/
│   ├── public/
│   └── .env.example
├── server/
│   ├── models/
│   ├── routes/             # auth, sync
│   ├── middleware/
│   ├── scripts/            # seed, migrations, import-csv, view-data
│   └── .env.example
├── docker-compose.yml      # MongoDB only
└── README.md
```

> Some older page modules may still exist under `client/src/pages/` but are not all wired in the current `App.jsx` router; the table above reflects the **live** routes.

## Environment variables

**Server** (`server/.env` — copy from `server/.env.example`)

| Variable | Purpose |
|----------|---------|
| `PORT` | Listen port (default `3001` in example) |
| `MONGODB_URI` | Mongo connection string |
| `JWT_SECRET` | Strong secret for signing JWTs |
| `NODE_ENV` | e.g. `development` / `production` |
| `FRONTEND_ORIGIN` | Optional CORS allow-list (e.g. your deployed frontend URL) |

**Client** (`client/.env` — copy from `client/.env.example`)

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Backend base URL **without** trailing slash. Leave empty in dev to use Vite proxy to the API. **Set in production builds** to your real API host. |

Never commit real `.env` files (they are gitignored).

## Production

1. **Backend:** set env vars on the host, run `npm start` (or use a process manager).
2. **Frontend:** set `VITE_API_URL` **before** `npm run build`; deploy the contents of `client/dist/` over **HTTPS** (recommended for PWA).
3. Set **`FRONTEND_ORIGIN`** on the server to match your deployed frontend so browsers are not blocked by CORS.

## Offline and sync

- Reads/writes go to **IndexedDB** first; mutating operations are recorded in an **outbox**.
- **Sync** pushes the outbox then pulls server changes (see `client/src/db/indexedDB.js` and `server/routes/sync.js`).
- Server uses **idempotent** operation tracking to avoid duplicate applies.

**Try offline:** DevTools → Network → Offline, make a change, go online, use **Sync** on **Today**.

## API (summary)

- `POST /api/auth/login` — `{ "username", "password" }` → JWT  
- `POST /api/sync/push` — client push payload  
- `GET /api/sync/pull?since=...&scope=...` — incremental pull  

Full shapes are defined in the server routes and client sync code.

## Backend scripts

Run from `server/`:

```bash
npm run view-data
npm run migrate-visits
npm run migrate-children-notes
npm run import-csv -- <children.csv> <visits.csv>
```

See `server/data/CSV_IMPORT_FORMAT.md` for CSV expectations.

## License

ISC (see `server/package.json`). Add a root `LICENSE` file if you want GitHub to show a standard license.

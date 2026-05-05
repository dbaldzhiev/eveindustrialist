# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

EVE Industrialist is a profitability calculator for EVE Online manufacturing. It fetches blueprints and skills from the EVE ESI API, pulls market prices from Fuzzwork, and computes profit/margin/ISK-hour for manufacturing, invention, copying, and reaction activities.

## Development Commands

**Start both servers (from repo root):**
```bash
npm run dev
```
This runs the FastAPI backend on port 8000 and the Vite frontend on port 5173 concurrently.

**Backend only:**
```bash
cd backend && source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

**Frontend only:**
```bash
cd frontend && npm run dev
```

**Frontend type-check + build:**
```bash
cd frontend && npm run build
```

**One-time setup:**
```bash
# Backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then add EVE_CLIENT_ID, EVE_CLIENT_SECRET, SECRET_KEY
python setup_sde.py    # downloads ~300MB CCP SDE and imports into SQLite (~2–3 min)

# Frontend
cd frontend && npm install
```

There is no automated test suite. `test_undercut.py` in the root is a standalone market analysis utility, not a test runner.

## Architecture Overview

### Request flow
The frontend (React + Vite, port 5173) proxies all `/api/*` and `/auth/*` requests to the FastAPI backend (port 8000) via the Vite proxy in `vite.config.ts`. Authentication is EVE SSO OAuth2 PKCE; the backend issues a JWT session cookie (24h TTL).

### Backend (`backend/`)

| File | Role |
|------|------|
| `main.py` | FastAPI app + all 60+ API endpoints (~2000 lines) |
| `database.py` | SQLite schema + all CRUD operations (~1100 lines) |
| `profitability.py` | Core profit formula engine |
| `market.py` | Fuzzwork + ESI market price caching (30-min TTL) |
| `esi.py` | EVE ESI HTTP client + async caching |
| `auth.py` | OAuth2 PKCE flow + JWT session management |
| `setup_sde.py` | One-time SDE data importer (run once after install) |
| `eve_industry.db` | SQLite database (SDE, caches, user data) |

The database stores: SDE blueprint/material/type data, market price caches, ESI response caches (blueprints, skills, jobs, assets), user settings, character groups, production plans, and warehouse inventory.

### Frontend (`frontend/src/`)

| Path | Role |
|------|------|
| `App.tsx` | Router — 10 pages + auth redirect |
| `api/client.ts` | All 40+ axios API calls (single source of truth) |
| `types/index.ts` | All TypeScript interfaces |
| `context/RefreshContext.tsx` | Cache invalidation signals across components |
| `pages/` | One file per route (DashboardPage, SlotsPage, InventionPage, etc.) |
| `components/BlueprintTable.tsx` | Large reusable sortable/paginated table with inline detail rows |

### Profitability formula
```
material_qty  = max(1, ceil(base_qty × (1 - ME/100) × (1 - structure_ME_bonus)))
material_cost = Σ (sell_price × qty) × runs
EIV           = Σ (adjusted_price × qty) × runs   # job cost base
job_cost      = EIV × system_cost_index × (1 + facility_tax) × (1 - structure_cost_bonus)
net_revenue   = product_qty × sell_price × runs × (1 - broker_fee) × (1 - sales_tax)
profit        = net_revenue - material_cost - job_cost
margin        = profit / (material_cost + job_cost) × 100
```
Implemented in `profitability.py`; orchestrated from endpoints in `main.py`.

### Market prices
- **Fuzzwork** 5th percentile sell / 95th percentile buy — used for material cost and revenue
- **ESI `/markets/prices/`** adjusted prices — used only for job cost EIV base
- 30-min cache TTL for prices, 6-hour for history; `RefreshContext` on the frontend exposes a manual refresh trigger

### Character groups (multi-character)
One primary EVE character owns the account. Additional alts are linked via the `character_groups` table and share a single session. Blueprints, skills, and industry jobs are fetched for all characters in the group and merged.

## Key Configuration

Required `.env` variables in `backend/`:
```
EVE_CLIENT_ID=       # from developers.eveonline.com
EVE_CLIENT_SECRET=
SECRET_KEY=          # random string for JWT signing
CALLBACK_URL=http://localhost:8000/auth/callback
FRONTEND_URL=http://localhost:5173
```

# GEMINI.md

## Project Overview
**EVE Industrialist** is a blueprint profitability analyzer for EVE Online industrialists. It allows users to log in via EVE Online SSO, fetch their character blueprints, and calculate manufacturing profits based on real-time market data, system cost indices, and character skills.

### Tech Stack
- **Backend:** Python (FastAPI), SQLite (via `aiosqlite`), `httpx` for API calls.
- **Frontend:** React, TypeScript, Tailwind CSS, Vite.
- **Data Sources:** EVE ESI API, Fuzzwork Market Aggregates, CCP SDE (Static Data Export).
- **Architecture:** Monorepo with a dedicated `backend/` and `frontend/`.

---

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js & npm
- An EVE Online Developer Application (Client ID)

### Setup Instructions

#### 1. Backend Setup
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate | Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Set EVE_CLIENT_ID and SECRET_KEY in .env
python setup_sde.py  # Download and initialize SDE data (~300MB)
```

#### 2. Frontend Setup
```bash
cd frontend
npm install
```

#### 3. Running the Project
From the **root directory**:
```bash
npm run dev
```
This starts:
- **Backend:** [http://localhost:8000](http://localhost:8000)
- **Frontend:** [http://localhost:5173](http://localhost:5173)

---

## Development Conventions

### Backend Architecture (`backend/`)
- `main.py`: Entry point and API route definitions.
- `auth.py`: OAuth2 PKCE flow implementation for EVE SSO.
- `database.py`: SQLite schema and data access layers.
- `esi.py`: Wrapper for EVE ESI API calls with caching.
- `market.py`: Logic for fetching Fuzzwork market aggregates.
- `profitability.py`: Core business logic for blueprint math (ME/TE/Job costs).
- `setup_sde.py`: One-time script to populate the local database with CCP's SDE.

### Frontend Architecture (`frontend/src/`)
- `api/`: Axios client configuration.
- `components/`: Reusable UI components (Tables, Pickers, Panels).
- `pages/`: Main application views (Dashboard, Explorer, Plans, etc.).
- `types/`: TypeScript interfaces for API responses and application state.

### Key Workflows
- **Profit Calculation:** Uses the Fuzzwork percentile (5th sell / 95th buy) for pricing.
- **SDE Management:** The `eve_industry.db` contains both user data (sessions, plans) and static data (blueprints, materials). The SDE tables are populated once and used for batch lookups.
- **Multi-character Support:** Users can link multiple characters to a single "primary" account to aggregate blueprints and warehouse stock.

---

## Building and Deployment
- **Backend:** Deploy as a standard FastAPI app (e.g., using Uvicorn/Gunicorn). Ensure `eve_industry.db` is persisted.
- **Frontend:** Run `npm run build` in the `frontend/` directory to generate the static `dist/` folder.

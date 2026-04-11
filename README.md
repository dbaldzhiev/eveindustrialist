# EVE Industrialist

Blueprint profitability analyzer for EVE Online industrialists.

## Features
- Login with EVE Online SSO (OAuth2 PKCE – no password ever stored)
- Loads all your character's blueprints automatically
- Calculates profit per blueprint factoring in:
  - Material Efficiency (ME) – reduces input material cost
  - Market buy/sell prices via Fuzzwork aggregates
  - Industry job cost (EIV × system cost index)
  - Broker fees and sales tax
- Sortable table: profit, margin %, ISK/hour, costs
- Click any row for a full material breakdown
- All market data cached locally (30 min TTL)

## Tech stack
- **Backend**: Python + FastAPI, SQLite
- **Frontend**: React + TypeScript + Tailwind CSS + Vite
- **Data**: EVE ESI API + Fuzzwork market aggregates + CCP SDE

---

## Setup

### 1. Register an EVE application

Go to [https://developers.eveonline.com/](https://developers.eveonline.com/) and create a new application:

- **Connection type**: Authentication & API Access
- **Callback URL**: `http://localhost:8000/auth/callback`
- **Scopes**:
  - `esi-characters.read_blueprints.v1`
  - `esi-skills.read_skills.v1`
  - `esi-industry.read_character_jobs.v1`

Copy the **Client ID** – you'll need it below.

---

### 2. Backend setup

```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and set EVE_CLIENT_ID and SECRET_KEY

# Download SDE data (run once, ~2-3 min)
python setup_sde.py

# Start the backend
uvicorn main:app --reload --port 8000
```

---

### 3. Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## How profitability is calculated

```
Material qty  = max(1, ceil(base_qty × (1 - ME/100)))
Material cost = Σ (sell_price × qty) × runs
EIV           = Σ (adjusted_price × qty) × runs        [for job cost base]
Job cost      = EIV × system_cost_index × (1 + facility_tax)
Revenue       = product_qty × sell_price × runs
Net revenue   = revenue × (1 - broker_fee) × (1 - sales_tax)
Profit        = net_revenue - material_cost - job_cost
Margin        = profit / (material_cost + job_cost) × 100
```

- **Market prices**: Fuzzwork percentile (5th sell / 95th buy) by region
- **Adjusted prices**: from ESI `/markets/prices/` – used only for job cost
- **System cost index**: from ESI `/industry/systems/` – changes hourly
- **Broker fee default**: 3.68% (Broker Relations IV + 5% NPC station)
- **Sales tax default**: 3.6% (Accounting V)

---

## Notes

- BPOs (Blueprint Originals) show as "BPO"; BPCs (copies) show as "BPC"
- Market prices use the station's **region** for lookups
- ISK/hour is estimated based on SDE production time adjusted for TE
- The SDE download covers ~300 MB of data compressed to ~15-20 MB in SQLite

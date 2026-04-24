import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Cookie, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from database import (
    init_db, clear_market_cache,
    get_blueprints_data_batch, get_all_manufacturing_bp_ids, get_type_names_batch,
    get_type_volumes_batch,
    search_systems, get_regions, get_system_region,
    search_types, search_blueprints,
    get_structures, create_structure, delete_structure,
    get_user_settings, upsert_user_settings,
    get_group_character_ids, get_group_characters, remove_character_from_group,
    get_warehouse_items, set_warehouse_item, delete_warehouse_item, merge_warehouse_items,
    get_asset_locations, get_assets_at_location, get_cached_assets,
    get_plans, create_plan, rename_plan, delete_plan,
    get_plan_items, add_plan_item, update_plan_item, remove_plan_item,
    get_invention_variants, get_reaction_bp_ids,
    _chunk,
)
from auth import (
    router as auth_router,
    get_current_character, get_access_token, get_primary_id,
)
from esi import (
    get_character_blueprints, get_adjusted_prices, get_manufacturing_cost_index,
    get_character_skills, get_industry_skill_levels,
    get_character_jobs, get_character_assets,
    INDUSTRY_SKILL_IDS, MFG_ACTIVITIES, RESEARCH_ACTIVITIES, REACTION_ACTIVITIES,
    ACTIVITY_NAMES, resolve_location_names,
)
from market import get_market_prices
from profitability import calculate_blueprint_profit, ProfitSettings, calc_qty_with_me

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

MARKET_HUBS = [
    {"region_id": 10000002, "name": "The Forge (Jita)"},
    {"region_id": 10000043, "name": "Domain (Amarr)"},
    {"region_id": 10000032, "name": "Sinq Laison (Dodixie)"},
    {"region_id": 10000030, "name": "Heimatar (Rens)"},
    {"region_id": 10000042, "name": "Metropolis (Hek)"},
]

# T2 Invention Decryptors
DECRYPTORS = [
    {"name": "None",       "type_id": None,  "prob_mult": 1.0, "me_mod": 0,  "te_mod": 0,  "runs_mod": 0},
    {"name": "Symmetry",   "type_id": 34205, "prob_mult": 1.0, "me_mod": 1,  "te_mod": -1, "runs_mod": 0},
    {"name": "Parity",     "type_id": 34201, "prob_mult": 1.5, "me_mod": 1,  "te_mod": -1, "runs_mod": 0},
    {"name": "Augator",    "type_id": 34202, "prob_mult": 0.6, "me_mod": 4,  "te_mod": -1, "runs_mod": 0},
    {"name": "Incunabula", "type_id": 34203, "prob_mult": 1.2, "me_mod": -2, "te_mod": 1,  "runs_mod": 1},
    {"name": "Optimant",   "type_id": 34204, "prob_mult": 1.9, "me_mod": -2, "te_mod": 1,  "runs_mod": 1},
    {"name": "Esoteric",   "type_id": 34206, "prob_mult": 0.6, "me_mod": 2,  "te_mod": -1, "runs_mod": 4},
    {"name": "Occult",     "type_id": 34207, "prob_mult": 1.2, "me_mod": -1, "te_mod": 2,  "runs_mod": 3},
    {"name": "Kamikaze",   "type_id": 34208, "prob_mult": 1.1, "me_mod": -3, "te_mod": 5,  "runs_mod": 9},
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="EVE Industrialist API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _primary(session: str | None) -> int:
    return get_primary_id(session)


def _profit_settings(
    runs: int, broker_fee: float, sales_tax: float, facility_tax: float,
    structure_me_bonus: float, structure_te_bonus: float, structure_cost_bonus: float,
    material_order_type: str, product_order_type: str,
    industry_level: int = 0, adv_industry_level: int = 0,
) -> ProfitSettings:
    return ProfitSettings(
        broker_fee=broker_fee, sales_tax=sales_tax, facility_tax=facility_tax,
        runs=runs,
        structure_me_bonus=structure_me_bonus,
        structure_te_bonus=structure_te_bonus,
        structure_cost_bonus=structure_cost_bonus,
        material_order_type=material_order_type,
        product_order_type=product_order_type,
        industry_level=industry_level,
        adv_industry_level=adv_industry_level,
    )


def _calc_profits_for_bps(
    char_bps: list[dict],
    price_region_id: int,
    solar_system_id: int,
    settings: ProfitSettings,
    min_profit: float,
    force_refresh: bool = False,
    mode: str = "build",
    decryptor_strategy: str = "none",
    decryptor_type_id: int | None = None,
    primary_id: int | None = None,
    include_materials: bool = True,
) -> list[dict]:
    bp_type_ids = [bp["type_id"] for bp in char_bps]
    
    invention_bps = []
    if mode == "invent":
        unique_ids = list(set(bp_type_ids))
        variants = get_invention_variants(unique_ids)
        
        # Decide which decryptors to test
        test_decryptors = []
        if decryptor_strategy == "specific":
            test_decryptors = [d for d in DECRYPTORS if d["type_id"] == decryptor_type_id]
        elif decryptor_strategy == "optimized":
            test_decryptors = DECRYPTORS
        else:
            test_decryptors = [DECRYPTORS[0]] # "None"

        # Build "Potential" BPCs for calculation
        for var in variants:
            for d in test_decryptors:
                invention_bps.append({
                    "type_id":      var["result_bp_id"],
                    "type_name":    var["result_bp_name"] + " (Potential)",
                    "quantity":     1,
                    "me":           2 + d["me_mod"],
                    "te":           4 + d["te_mod"],
                    "is_bpo":       False,
                    "is_invention": True,
                    "decryptor":    d,
                })
        all_calc_bps = invention_bps
    elif mode == "copy":
        # Only owned BPOs that are NOT reactions (reactions can't be copied)
        reaction_ids = set(get_reaction_bp_ids())
        all_calc_bps = [
            bp for bp in char_bps 
            if (bp.get("quantity") == -1) and (bp["type_id"] not in reaction_ids)
        ]
    else:
        # mode == "build"
        all_calc_bps = char_bps
    
    calc_ids = [bp["type_id"] for bp in all_calc_bps]
    sde_data = get_blueprints_data_batch(calc_ids)

    # For "copy" mode, check matching BPCs in inventory
    bpc_inventory: dict[int, list[dict]] = {}
    if mode == "copy" and primary_id:
        char_ids = get_group_character_ids(primary_id)
        for cid in char_ids:
            try:
                for bp in get_character_blueprints(cid, get_access_token(cid)):
                    if bp.get("quantity") != -1:
                        tid = bp["type_id"]
                        if tid not in bpc_inventory: bpc_inventory[tid] = []
                        bpc_inventory[tid].append(bp)
            except Exception: pass

    all_type_ids: set[int] = set()
    for data in sde_data.values():
        if data["products"]:
            all_type_ids.update(m["type_id"] for m in data["materials"])
            all_type_ids.update(p["type_id"] for p in data["products"])

    if not all_type_ids:
        return []

    market_prices   = get_market_prices(list(all_type_ids), price_region_id, force_refresh=force_refresh)
    adjusted_prices = {k: v for k, v in get_adjusted_prices().items() if k in all_type_ids}
    cost_index      = get_manufacturing_cost_index(solar_system_id)

    if mode == "copy":
        results = []
        for bp in all_calc_bps:
            data = sde_data.get(bp["type_id"], {})
            product_id = data["products"][0]["type_id"] if data.get("products") else 0
            d = {
                "blueprint_type_id": bp["type_id"],
                "blueprint_name":    bp["type_name"],
                "product_type_id":   product_id,
                "me": bp["me"], "te": bp["te"],
                "is_bpo": True,
            }
            if bp.get("character_id"): d["character_id"] = bp["character_id"]
            matching_bpcs = bpc_inventory.get(bp["type_id"], [])
            d["bpc_count"] = len(matching_bpcs)
            d["bpc_total_runs"] = sum(b.get("runs", 0) for b in matching_bpcs)
            results.append(d)
        return results

    results = []
    for bp in all_calc_bps:
        data = sde_data.get(bp["type_id"], {})
        if not data.get("products"):
            continue

        result = calculate_blueprint_profit(
            blueprint_type_id=bp["type_id"],
            blueprint_name=bp["type_name"],
            me=bp["me"], te=bp["te"],
            is_bpo=bp.get("is_bpo", bp.get("quantity") == -1),
            sde_materials=data["materials"],
            sde_products=data["products"],
            base_time_seconds=data["time"],
            market_prices=market_prices,
            adjusted_prices=adjusted_prices,
            system_cost_index=cost_index,
            settings=settings,
        )
        if result and result.profit >= min_profit:
            d = result.to_api_dict(include_materials=include_materials)
            if bp.get("character_id"):
                d["character_id"] = bp["character_id"]
            if bp.get("is_invention"):
                d["is_invention"] = True
                d["decryptor_name"] = bp["decryptor"]["name"]
            
            if mode == "copy":
                matching_bpcs = bpc_inventory.get(bp["type_id"], [])
                d["bpc_count"] = len(matching_bpcs)
                d["bpc_total_runs"] = sum(b.get("runs", 0) for b in matching_bpcs)

            results.append(d)

    if mode == "invent" and decryptor_strategy == "optimized":
        # Keep only the best result per T2 blueprint
        best_per_id = {}
        for r in results:
            tid = r["blueprint_type_id"]
            if tid not in best_per_id or r["profit"] > best_per_id[tid]["profit"]:
                best_per_id[tid] = r
        results = list(best_per_id.values())

    results.sort(key=lambda x: x["profit"], reverse=True)
    return results


# ---------------------------------------------------------------------------
# Auth / identity
# ---------------------------------------------------------------------------

@app.get("/api/me")
def me(session: str | None = Cookie(None)):
    char = get_current_character(session)
    primary_id = int(char["uid"])
    members    = get_group_characters(primary_id)
    return {
        "character_id":          int(char["sub"]),
        "character_name":        char["name"],
        "primary_character_id":  primary_id,
        "linked_characters":     members,
    }


@app.get("/api/characters")
def list_characters(session: str | None = Cookie(None)):
    """Return all characters in the current user's group."""
    char       = get_current_character(session)
    primary_id = int(char["uid"])
    members    = get_group_characters(primary_id)
    return {
        "primary_character_id": primary_id,
        "characters": members,
    }


@app.delete("/api/characters/{character_id}", status_code=204)
def remove_character(character_id: int, session: str | None = Cookie(None)):
    primary_id = _primary(session)
    if not remove_character_from_group(primary_id, character_id):
        raise HTTPException(status_code=404, detail="Character not found in your account")


# ---------------------------------------------------------------------------
# User settings
# ---------------------------------------------------------------------------

class UserSettingsIn(BaseModel):
    default_structure_id:    int   | None = None
    default_system_id:       int   | None = None
    default_price_region:    int          = 10000002
    broker_fee:              float        = 0.0368
    sales_tax:               float        = 0.036
    facility_tax:            float        = 0.0
    structure_me_bonus:      float        = 0.0
    structure_te_bonus:      float        = 0.0
    structure_cost_bonus:    float        = 0.0
    industry_level:          int          = 0
    adv_industry_level:      int          = 0
    runs:                    int          = 1
    min_profit:              float        = 0.0
    material_order_type:     str          = "sell"
    product_order_type:      str          = "sell"
    warehouse_character_id:  int   | None = None
    warehouse_location_id:   int   | None = None
    warehouse_location_name: str   | None = None


@app.get("/api/settings")
def get_settings(session: str | None = Cookie(None)):
    return get_user_settings(_primary(session))


@app.put("/api/settings")
def put_settings(body: UserSettingsIn, session: str | None = Cookie(None)):
    return upsert_user_settings(
        _primary(session),
        default_structure_id=body.default_structure_id,
        default_system_id=body.default_system_id,
        default_price_region=body.default_price_region,
        broker_fee=body.broker_fee,
        sales_tax=body.sales_tax,
        facility_tax=body.facility_tax,
        structure_me_bonus=body.structure_me_bonus,
        structure_te_bonus=body.structure_te_bonus,
        structure_cost_bonus=body.structure_cost_bonus,
        industry_level=body.industry_level,
        adv_industry_level=body.adv_industry_level,
        runs=body.runs,
        min_profit=body.min_profit,
        material_order_type=body.material_order_type,
        product_order_type=body.product_order_type,
        warehouse_character_id=body.warehouse_character_id,
        warehouse_location_id=body.warehouse_location_id,
        warehouse_location_name=body.warehouse_location_name,
    )


# ---------------------------------------------------------------------------
# Geography / market
# ---------------------------------------------------------------------------

@app.get("/api/regions")
def regions():
    return get_regions()


@app.get("/api/systems/search")
def systems_search(q: str = Query(..., min_length=1)):
    return search_systems(q, limit=20)


@app.get("/api/market/hubs")
def market_hubs():
    return MARKET_HUBS


@app.post("/api/market/refresh")
def market_refresh():
    clear_market_cache()
    return {"ok": True}


@app.get("/api/market/decryptors")
def market_decryptors():
    return DECRYPTORS


@app.get("/api/types/search")
def types_search(q: str = Query(..., min_length=2)):
    return search_types(q, limit=20)


@app.get("/api/blueprints/search")
def blueprints_search(q: str = Query(..., min_length=2), session: str | None = Cookie(None)):
    get_current_character(session)
    return search_blueprints(q, limit=20)


# ---------------------------------------------------------------------------
# My Blueprints (aggregated from all characters in the group)
# ---------------------------------------------------------------------------

@app.get("/api/blueprints")
def blueprints(
    solar_system_id:      int   = Query(...),
    price_region_id:      int   = Query(10000002),
    runs:                 int   = Query(1,      ge=1, le=10000),
    broker_fee:           float = Query(0.0368, ge=0, le=0.20),
    sales_tax:            float = Query(0.0360, ge=0, le=0.20),
    facility_tax:         float = Query(0.0,    ge=0, le=0.25),
    structure_me_bonus:   float = Query(0.0,    ge=0, le=5),
    structure_te_bonus:   float = Query(0.0,    ge=0, le=30),
    structure_cost_bonus: float = Query(0.0,    ge=0, le=25),
    material_order_type:  str   = Query("sell"),
    product_order_type:   str   = Query("sell"),
    min_profit:           float = Query(0.0),
    force_refresh:        bool  = Query(False),
    mode:                 str   = Query("build"),
    decryptor_strategy:   str   = Query("none"),  # "none", "optimized", "specific"
    decryptor_type_id:    int | None = Query(None),
    session: str | None = Cookie(None),
):
    char       = get_current_character(session)
    primary_id = int(char["uid"])

    if get_system_region(solar_system_id) is None:
        raise HTTPException(status_code=400, detail="Unknown solar system")

    char_ids = get_group_character_ids(primary_id)
    all_bps: list[dict] = []
    for cid in char_ids:
        try:
            bps = get_character_blueprints(cid, get_access_token(cid))
            all_bps.extend(bps)
        except Exception:
            pass  # skip characters with expired tokens

    if not all_bps and mode != "invent":
        return []

    # Fetch skills for primary character to adjust time calculations
    skills = get_industry_skill_levels(int(char["sub"]), get_access_token(int(char["sub"])))
    settings = _profit_settings(
        runs, broker_fee, sales_tax, facility_tax,
        structure_me_bonus, structure_te_bonus, structure_cost_bonus,
        material_order_type, product_order_type,
        industry_level=skills["industry"],
        adv_industry_level=skills["adv_industry"],
    )
    return _calc_profits_for_bps(
        all_bps, price_region_id, solar_system_id, settings, min_profit, 
        force_refresh=force_refresh, 
        mode=mode,
        decryptor_strategy=decryptor_strategy,
        decryptor_type_id=decryptor_type_id,
        primary_id=primary_id
    )


# ---------------------------------------------------------------------------
# Explorer (all SDE blueprints)
# ---------------------------------------------------------------------------

@app.get("/api/blueprints/explore")
def blueprints_explore(
    solar_system_id:      int   = Query(...),
    price_region_id:      int   = Query(10000002),
    assumed_me:           int   = Query(10,    ge=0, le=10),
    assumed_te:           int   = Query(20,    ge=0, le=20),
    runs:                 int   = Query(1,     ge=1, le=10000),
    broker_fee:           float = Query(0.0368, ge=0, le=0.20),
    sales_tax:            float = Query(0.0360, ge=0, le=0.20),
    facility_tax:         float = Query(0.0,    ge=0, le=0.25),
    structure_me_bonus:   float = Query(0.0,    ge=0, le=5),
    structure_te_bonus:   float = Query(0.0,    ge=0, le=30),
    structure_cost_bonus: float = Query(0.0,    ge=0, le=25),
    material_order_type:  str   = Query("sell"),
    product_order_type:   str   = Query("sell"),
    min_profit:           float = Query(0.0),
    force_refresh:        bool  = Query(False),
    limit:                int   = Query(200,   ge=1, le=1000),
    session: str | None = Cookie(None),
):
    char       = get_current_character(session)
    primary_id = int(char["uid"])

    if get_system_region(solar_system_id) is None:
        raise HTTPException(status_code=400, detail="Unknown solar system")

    skills = get_industry_skill_levels(int(char["sub"]), get_access_token(int(char["sub"])))
    settings = _profit_settings(
        runs, broker_fee, sales_tax, facility_tax,
        structure_me_bonus, structure_te_bonus, structure_cost_bonus,
        material_order_type, product_order_type,
        industry_level=skills["industry"],
        adv_industry_level=skills["adv_industry"],
    )

    all_bp_ids = get_all_manufacturing_bp_ids()
    if not all_bp_ids:
        return []

    sde_data = get_blueprints_data_batch(all_bp_ids)

    all_type_ids: set[int] = set()
    for data in sde_data.values():
        if data["products"]:
            all_type_ids.update(m["type_id"] for m in data["materials"])
            all_type_ids.update(p["type_id"] for p in data["products"])

    if not all_type_ids:
        return []

    market_prices   = get_market_prices(list(all_type_ids), price_region_id, force_refresh=force_refresh)
    adjusted_prices = {k: v for k, v in get_adjusted_prices().items() if k in all_type_ids}
    cost_index      = get_manufacturing_cost_index(solar_system_id)
    name_map        = get_type_names_batch(all_bp_ids)

    results = []
    for bp_id in all_bp_ids:
        data = sde_data.get(bp_id, {})
        if not data.get("products"):
            continue
        result = calculate_blueprint_profit(
            blueprint_type_id=bp_id,
            blueprint_name=name_map.get(bp_id, f"Unknown [{bp_id}]"),
            me=assumed_me, te=assumed_te, is_bpo=True,
            sde_materials=data["materials"],
            sde_products=data["products"],
            base_time_seconds=data["time"],
            market_prices=market_prices,
            adjusted_prices=adjusted_prices,
            system_cost_index=cost_index,
            settings=settings,
        )
        if result and result.profit >= min_profit:
            results.append(result.to_api_dict())

    results.sort(key=lambda x: x["profit"], reverse=True)
    return results[:limit]


# ---------------------------------------------------------------------------
# Slot dashboard
# ---------------------------------------------------------------------------

@app.get("/api/slots")
def slots_dashboard(session: str | None = Cookie(None)):
    """
    Per-character slot summary + active jobs for all characters in the group.
    Slot counts are computed from ESI skills.
    """
    char       = get_current_character(session)
    primary_id = int(char["uid"])
    char_ids   = get_group_character_ids(primary_id)

    result = []
    for cid in char_ids:
        try:
            token  = get_access_token(cid)
            skills = get_character_skills(cid, token)
            jobs   = get_character_jobs(cid, token)
        except Exception:
            continue

        mfg_total      = 1 + skills.get(INDUSTRY_SKILL_IDS["mass_production"], 0) + \
                             skills.get(INDUSTRY_SKILL_IDS["adv_mass_production"], 0)
        research_total = 1 + skills.get(INDUSTRY_SKILL_IDS["lab_operation"], 0) + \
                             skills.get(INDUSTRY_SKILL_IDS["adv_lab_operation"], 0)
        reaction_total = 1 + skills.get(INDUSTRY_SKILL_IDS["mass_reactions"], 0)

        mfg_used      = sum(1 for j in jobs if j["activity_id"] in MFG_ACTIVITIES)
        research_used = sum(1 for j in jobs if j["activity_id"] in RESEARCH_ACTIVITIES)
        reaction_used = sum(1 for j in jobs if j["activity_id"] in REACTION_ACTIVITIES)

        # Fetch character name from the jobs list or from group data
        char_name = next(
            (c["character_name"] for c in get_group_characters(primary_id)
             if c["character_id"] == cid),
            f"Character {cid}",
        )

        result.append({
            "character_id":   cid,
            "character_name": char_name,
            "manufacturing":  {
                "total":     mfg_total,
                "used":      mfg_used,
                "available": max(0, mfg_total - mfg_used),
            },
            "research": {
                "total":     research_total,
                "used":      research_used,
                "available": max(0, research_total - research_used),
            },
            "reactions": {
                "total":     reaction_total,
                "used":      reaction_used,
                "available": max(0, reaction_total - reaction_used),
            },
            "active_jobs": [
                {
                    "job_id":          j["job_id"],
                    "activity_name":   j.get("activity_name") or ACTIVITY_NAMES.get(j.get("activity_id"), "Unknown"),
                    "product_name":    j.get("product_name") or j.get("blueprint_name", ""),
                    "product_type_id": j.get("product_type_id") or j.get("blueprint_type_id"),
                    "runs":            j.get("runs", 1),
                    "end_date":        j.get("end_date", ""),
                }
                for j in jobs
            ],
        })

    return result


@app.get("/api/characters/slots")
def characters_slots(session: str | None = Cookie(None)):
    """Flat per-character slot summary (for frontend dashboard)."""
    raw = slots_dashboard(session)
    result = []
    for r in raw:
        result.append({
            "character_id":   r["character_id"],
            "character_name": r["character_name"],
            "mfg_used":       r["manufacturing"]["used"],
            "mfg_max":        r["manufacturing"]["total"],
            "research_used":  r["research"]["used"],
            "research_max":   r["research"]["total"],
            "reaction_used":  r["reactions"]["used"],
            "reaction_max":   r["reactions"]["total"],
            "active_jobs":    r["active_jobs"],
            "suggestions":    [],  # populated separately via /api/slots/suggestions
        })
    return result


@app.get("/api/slots/suggestions")
def slot_suggestions(
    solar_system_id:      int   = Query(...),
    price_region_id:      int   = Query(10000002),
    runs:                 int   = Query(1,     ge=1, le=10000),
    broker_fee:           float = Query(0.0368, ge=0, le=0.20),
    sales_tax:            float = Query(0.0360, ge=0, le=0.20),
    facility_tax:         float = Query(0.0,    ge=0, le=0.25),
    structure_me_bonus:   float = Query(0.0,    ge=0, le=5),
    structure_te_bonus:   float = Query(0.0,    ge=0, le=30),
    structure_cost_bonus: float = Query(0.0,    ge=0, le=25),
    material_order_type:  str   = Query("sell"),
    product_order_type:   str   = Query("sell"),
    limit:                int   = Query(10,    ge=1, le=50),
    session: str | None = Cookie(None),
):
    """Top blueprints by ISK/hour to fill free manufacturing slots."""
    char       = get_current_character(session)
    primary_id = int(char["uid"])

    if get_system_region(solar_system_id) is None:
        raise HTTPException(status_code=400, detail="Unknown solar system")

    char_ids = get_group_character_ids(primary_id)
    all_bps: list[dict] = []
    for cid in char_ids:
        try:
            all_bps.extend(get_character_blueprints(cid, get_access_token(cid)))
        except Exception:
            pass

    if not all_bps:
        return []

    skills = get_industry_skill_levels(int(char["sub"]), get_access_token(int(char["sub"])))
    settings = _profit_settings(
        runs, broker_fee, sales_tax, facility_tax,
        structure_me_bonus, structure_te_bonus, structure_cost_bonus,
        material_order_type, product_order_type,
        industry_level=skills["industry"],
        adv_industry_level=skills["adv_industry"],
    )
    results = _calc_profits_for_bps(all_bps, price_region_id, solar_system_id, settings, 0)
    # Sort by ISK/hour and return top N
    results.sort(key=lambda x: x["isk_per_hour"], reverse=True)
    return results[:limit]


# ---------------------------------------------------------------------------
# Structures CRUD
# ---------------------------------------------------------------------------

class StructureIn(BaseModel):
    name:            str
    solar_system_id: int | None = None
    me_bonus:        float = 0.0
    te_bonus:        float = 0.0
    cost_bonus:      float = 0.0


@app.get("/api/structures")
def list_structures(session: str | None = Cookie(None)):
    return get_structures(_primary(session))


@app.post("/api/structures", status_code=201)
def add_structure(body: StructureIn, session: str | None = Cookie(None)):
    return create_structure(
        _primary(session), body.name, body.solar_system_id,
        body.me_bonus, body.te_bonus, body.cost_bonus,
    )


@app.delete("/api/structures/{structure_id}", status_code=204)
def remove_structure(structure_id: int, session: str | None = Cookie(None)):
    if not delete_structure(_primary(session), structure_id):
        raise HTTPException(status_code=404, detail="Structure not found")


# ---------------------------------------------------------------------------
# Warehouse CRUD
# ---------------------------------------------------------------------------

class WarehouseItemIn(BaseModel):
    type_id:   int
    type_name: str
    quantity:  int


class AssetImportIn(BaseModel):
    character_id: int
    location_id:  int
    replace:      bool = False  # if True, clear existing warehouse before import


@app.get("/api/warehouse")
def warehouse_list(session: str | None = Cookie(None)):
    """
    Return warehouse contents.
    If a warehouse source (character + location) is configured in settings,
    return only items from that location. Otherwise aggregate all hangar assets.
    """
    char       = get_current_character(session)
    primary_id = int(char["uid"])
    settings   = get_user_settings(primary_id)

    wh_char = settings.get("warehouse_character_id")
    wh_loc  = settings.get("warehouse_location_id")

    if wh_char and wh_loc:
        # Specific source configured — return its items directly
        items = get_assets_at_location(wh_char, wh_loc)
        return sorted(items, key=lambda x: x["type_name"])

    # No source set — aggregate all hangar assets across all characters
    char_ids = get_group_character_ids(primary_id)
    grouped: dict[int, dict] = {}
    for cid in char_ids:
        assets = get_cached_assets(cid)
        if not assets:
            continue
        for item in assets:
            # Skip container items themselves (is_container rows have quantity=1 but are not materials)
            if item.get("is_container"):
                continue
            tid = item["type_id"]
            if tid not in grouped:
                grouped[tid] = {"type_id": tid, "type_name": item["type_name"], "quantity": 0}
            grouped[tid]["quantity"] += item.get("quantity", 1)
    return sorted(grouped.values(), key=lambda x: x["type_name"])


@app.put("/api/warehouse/items")
def warehouse_set_item(body: WarehouseItemIn, session: str | None = Cookie(None)):
    set_warehouse_item(_primary(session), body.type_id, body.type_name, body.quantity)
    return {"ok": True}


@app.delete("/api/warehouse/items/{type_id}", status_code=204)
def warehouse_delete_item(type_id: int, session: str | None = Cookie(None)):
    delete_warehouse_item(_primary(session), type_id)


@app.post("/api/warehouse/sync")
def warehouse_sync(session: str | None = Cookie(None)):
    """
    Pull ESI assets from all group characters and merge into warehouse.
    Returns aggregated items from all characters' hangars.
    """
    char       = get_current_character(session)
    primary_id = int(char["uid"])
    char_ids   = get_group_character_ids(primary_id)

    all_items: list[dict] = []
    for cid in char_ids:
        try:
            token  = get_access_token(cid)
            assets = get_character_assets(cid, token, force_refresh=True)
            all_items.extend(assets)
        except Exception:
            pass

    # Group by type_id, summing quantity
    grouped: dict[int, dict] = {}
    for item in all_items:
        tid = item["type_id"]
        if tid not in grouped:
            grouped[tid] = {"type_id": tid, "type_name": item["type_name"], "quantity": 0}
        grouped[tid]["quantity"] += item.get("quantity", 1)

    result = list(grouped.values())
    return {"synced": len(result), "items": result}


# ---------------------------------------------------------------------------
# Assets (ESI) → warehouse import
# ---------------------------------------------------------------------------

@app.get("/api/assets/locations")
def asset_locations(session: str | None = Cookie(None)):
    """
    Return all distinct asset locations (stations + containers) across all
    group characters, with resolved display names.
    Triggers ESI fetch for any character whose cache is stale.
    """
    char       = get_current_character(session)
    primary_id = int(char["uid"])
    char_ids   = get_group_character_ids(primary_id)
    char_names = {c["character_id"]: c["character_name"]
                  for c in get_group_characters(primary_id)}

    all_locations = []
    all_station_ids: list[int] = []
    char_tokens: dict[int, str] = {}

    for cid in char_ids:
        try:
            token = get_access_token(cid)
            char_tokens[cid] = token
            get_character_assets(cid, token, force_refresh=True)   # always fetch fresh
        except Exception:
            pass
        for loc in get_asset_locations(cid):
            loc["character_id"]   = cid
            loc["character_name"] = char_names.get(cid, f"Character {cid}")
            loc["location_name"]  = ""          # filled in below
            all_locations.append(loc)
            if not loc.get("is_container"):
                all_station_ids.append(loc["loc_id"])

    # Resolve station/system names; pass tokens for player structure lookups
    name_map = resolve_location_names(
        list(set(all_station_ids)),
        char_tokens=list(char_tokens.values()),
    )
    for loc in all_locations:
        if loc.get("is_container"):
            loc["location_name"] = loc.get("container_name") or f"Container #{loc['loc_id']}"
        else:
            loc["location_name"] = name_map.get(loc["loc_id"], f"Location #{loc['loc_id']}")

    return all_locations


@app.post("/api/assets/import")
def asset_import(body: AssetImportIn, session: str | None = Cookie(None)):
    """Import assets from a specific location into the warehouse."""
    primary_id = _primary(session)
    char_ids   = get_group_character_ids(primary_id)

    if body.character_id not in char_ids:
        raise HTTPException(status_code=403, detail="Character not in your account")

    items = get_assets_at_location(body.character_id, body.location_id)
    if not items:
        return {"imported": 0}

    if body.replace:
        from database import get_db as _get_db
        conn = _get_db()
        conn.execute("DELETE FROM warehouse_items WHERE character_id = ?", (primary_id,))
        conn.commit()
        conn.close()

    warehouse_items = [
        {"type_id": i["type_id"], "type_name": i["type_name"], "quantity": i["quantity"]}
        for i in items
        if i["quantity"] > 0
    ]
    merge_warehouse_items(primary_id, warehouse_items)
    return {"imported": len(warehouse_items)}


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------

class PlanIn(BaseModel):
    name: str


class PlanRenameIn(BaseModel):
    name: str


class PlanItemIn(BaseModel):
    blueprint_type_id: int
    blueprint_name:    str
    product_type_id:   int  = 0
    product_name:      str  = ""
    runs:              int  = 1
    me:                int  = 0
    te:                int  = 0


class PlanItemUpdateIn(BaseModel):
    runs: int = 1
    me:   int = 0
    te:   int = 0


@app.get("/api/plans")
def list_plans(session: str | None = Cookie(None)):
    return get_plans(_primary(session))


@app.post("/api/plans", status_code=201)
def new_plan(body: PlanIn, session: str | None = Cookie(None)):
    return create_plan(_primary(session), body.name)


@app.patch("/api/plans/{plan_id}")
def update_plan(plan_id: int, body: PlanRenameIn, session: str | None = Cookie(None)):
    if not rename_plan(_primary(session), plan_id, body.name):
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"ok": True}


@app.delete("/api/plans/{plan_id}", status_code=204)
def del_plan(plan_id: int, session: str | None = Cookie(None)):
    if not delete_plan(_primary(session), plan_id):
        raise HTTPException(status_code=404, detail="Plan not found")


@app.get("/api/plans/{plan_id}/items")
def list_plan_items(plan_id: int, session: str | None = Cookie(None)):
    _primary(session)  # auth check
    return get_plan_items(plan_id)


@app.post("/api/plans/{plan_id}/items", status_code=201)
def add_to_plan(plan_id: int, body: PlanItemIn, session: str | None = Cookie(None)):
    _primary(session)
    return add_plan_item(
        plan_id,
        body.blueprint_type_id, body.blueprint_name,
        body.product_type_id, body.product_name,
        body.runs, body.me, body.te,
    )


@app.patch("/api/plans/{plan_id}/items/{item_id}")
def update_plan_item_endpoint(
    plan_id: int, item_id: int, body: PlanItemUpdateIn,
    session: str | None = Cookie(None),
):
    _primary(session)
    if not update_plan_item(plan_id, item_id, body.runs, body.me, body.te):
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


@app.delete("/api/plans/{plan_id}/items/{item_id}", status_code=204)
def remove_from_plan(plan_id: int, item_id: int, session: str | None = Cookie(None)):
    _primary(session)
    if not remove_plan_item(plan_id, item_id):
        raise HTTPException(status_code=404, detail="Item not found")


@app.get("/api/plans/suggest")
def suggest_plan(strategy: str = "profit", session: str | None = Cookie(None)):
    """
    Suggest manufacturing runs to fill open slots.
    strategy: "profit" (max ISK/h) or "materials" (max already owned in warehouse)
    """
    primary_id = _primary(session)
    char_ids   = get_group_character_ids(primary_id)
    
    # 1. Find total open manufacturing slots
    raw_slots = slots_dashboard(session)
    total_open = sum(max(0, s["manufacturing"]["total"] - s["manufacturing"]["used"]) for s in raw_slots)
    
    if total_open <= 0:
        return {"suggested_items": [], "reason": "No open manufacturing slots available"}

    # 2. Get user settings for calculations
    settings_raw = get_user_settings(primary_id)
    if not settings_raw.get("default_system_id"):
         raise HTTPException(status_code=400, detail="Default manufacturing system not configured")

    skills = get_industry_skill_levels(primary_id, get_access_token(primary_id))
    p_settings = _profit_settings(
        settings_raw["runs"], settings_raw["broker_fee"], settings_raw["sales_tax"], settings_raw["facility_tax"],
        settings_raw["structure_me_bonus"], settings_raw["structure_te_bonus"], settings_raw["structure_cost_bonus"],
        settings_raw["material_order_type"], settings_raw["product_order_type"],
        industry_level=skills["industry"], adv_industry_level=skills["adv_industry"],
    )

    # 3. Fetch all character blueprints
    all_bps: list[dict] = []
    for cid in char_ids:
        try:
            all_bps.extend(get_character_blueprints(cid, get_access_token(cid)))
        except Exception: pass

    if not all_bps:
        return {"suggested_items": [], "reason": "No blueprints found in assets"}

    # Calculate full profit/material data
    results = _calc_profits_for_bps(
        all_bps, settings_raw["default_price_region"], settings_raw["default_system_id"], 
        p_settings, min_profit=-1e15, include_materials=True
    )

    # 4. Rank items based on strategy
    if strategy == "profit":
        results.sort(key=lambda x: x["isk_per_hour"], reverse=True)
    elif strategy == "materials":
        # Percentage of total material quantity already owned in group assets
        warehouse: dict[int, int] = {}
        for cid in char_ids:
            assets = get_cached_assets(cid)
            if assets:
                for a in assets:
                    tid = a["type_id"]
                    warehouse[tid] = warehouse.get(tid, 0) + a.get("quantity", 1)
        
        def material_score(bp):
            mats = bp.get("materials", [])
            if not mats: return 0
            total_needed = sum(m["quantity"] for m in mats)
            if total_needed == 0: return 1.0
            owned = sum(min(m["quantity"], warehouse.get(m["type_id"], 0)) for m in mats)
            return owned / total_needed

        results.sort(key=material_score, reverse=True)

    # 5. Suggest top N to fill slots
    suggested = results[:total_open]
    return {
        "strategy": strategy,
        "open_slots": total_open,
        "suggested_items": suggested
    }


@app.get("/api/plans/{plan_id}/summary")
def plan_summary(
    plan_id:              int,
    solar_system_id:      int   = Query(None),
    price_region_id:      int   = Query(10000002),
    broker_fee:           float = Query(0.0368),
    sales_tax:            float = Query(0.0360),
    facility_tax:         float = Query(0.0),
    structure_me_bonus:   float = Query(0.0),
    structure_te_bonus:   float = Query(0.0),
    structure_cost_bonus: float = Query(0.0),
    material_order_type:  str   = Query("sell"),
    product_order_type:   str   = Query("sell"),
    use_warehouse:        bool  = Query(True),
    session: str | None = Cookie(None),
):
    """
    Compute full plan statistics:
    - material_cost, revenue, profit
    - material_volume_m3, output_volume_m3
    - materials list with warehouse check
    - multibuy text (with/without warehouse offset)
    """
    char       = get_current_character(session)
    primary_id = int(char["uid"])

    items = get_plan_items(plan_id)
    if not items:
        return {
            "material_cost": 0, "revenue": 0, "profit": 0,
            "material_volume_m3": 0, "output_volume_m3": 0,
            "materials": [], "multibuy": "",
        }

    bp_ids   = list({item["blueprint_type_id"] for item in items})
    sde_data = get_blueprints_data_batch(bp_ids)

    # Aggregate required materials (across all plan items)
    needed: dict[int, dict] = {}
    for item in items:
        data = sde_data.get(item["blueprint_type_id"], {})
        for mat in data.get("materials", []):
            qty = calc_qty_with_me(mat["quantity"], item["me"], structure_me_bonus) * item["runs"]
            if mat["type_id"] not in needed:
                needed[mat["type_id"]] = {"name": mat["name"], "qty": 0}
            needed[mat["type_id"]]["qty"] += qty

    # Collect product type IDs
    product_type_ids = set()
    product_qtys: dict[int, int] = {}
    for item in items:
        data = sde_data.get(item["blueprint_type_id"], {})
        for prod in data.get("products", []):
            pid  = prod["type_id"]
            pqty = prod["quantity"] * item["runs"]
            product_type_ids.add(pid)
            product_qtys[pid] = product_qtys.get(pid, 0) + pqty

    all_type_ids = set(needed.keys()) | product_type_ids
    volumes      = get_type_volumes_batch(list(all_type_ids))

    # Market prices for cost and revenue
    market_prices = {}
    if solar_system_id:
        market_prices = get_market_prices(list(all_type_ids), price_region_id)

    warehouse = {w["type_id"]: w["quantity"] for w in get_warehouse_items(primary_id)}

    # Material breakdown
    material_rows = []
    total_mat_cost = 0.0
    total_mat_vol  = 0.0
    for type_id, info in sorted(needed.items(), key=lambda x: x[1]["name"]):
        in_stock  = warehouse.get(type_id, 0) if use_warehouse else 0
        to_buy    = max(0, info["qty"] - in_stock)
        unit_p    = market_prices.get(type_id, {}).get(material_order_type, 0.0)
        cost      = to_buy * unit_p
        total_mat_cost += info["qty"] * unit_p
        total_mat_vol  += info["qty"] * volumes.get(type_id, 0.0)
        material_rows.append({
            "type_id":  type_id,
            "name":     info["name"],
            "needed":   info["qty"],
            "in_stock": in_stock,
            "to_buy":   to_buy,
            "unit_price": round(unit_p, 2),
            "cost":     round(cost, 2),
        })

    # Output volume
    total_out_vol = sum(
        pqty * volumes.get(pid, 0.0)
        for pid, pqty in product_qtys.items()
    )

    # Revenue
    total_revenue = 0.0
    for pid, pqty in product_qtys.items():
        p = market_prices.get(pid, {}).get(product_order_type, 0.0)
        total_revenue += pqty * p * (1.0 - broker_fee) * (1.0 - sales_tax)

    profit = total_revenue - total_mat_cost

    # Multibuy
    multibuy_lines = [
        f"{row['name']} {row['to_buy']}"
        for row in material_rows
        if row["to_buy"] > 0
    ]

    return {
        "material_cost":      round(total_mat_cost, 2),
        "revenue":            round(total_revenue, 2),
        "profit":             round(profit, 2),
        "material_volume_m3": round(total_mat_vol, 2),
        "output_volume_m3":   round(total_out_vol, 2),
        "materials":          material_rows,
        "multibuy":           "\n".join(multibuy_lines),
    }


@app.get("/api/plans/{plan_id}/stats")
def plan_stats(
    plan_id:              int,
    solar_system_id:      int   = Query(None),
    price_region_id:      int   = Query(10000002),
    runs:                 int   = Query(1),
    broker_fee:           float = Query(0.0368),
    sales_tax:            float = Query(0.0360),
    facility_tax:         float = Query(0.0),
    structure_me_bonus:   float = Query(0.0),
    structure_te_bonus:   float = Query(0.0),
    structure_cost_bonus: float = Query(0.0),
    material_order_type:  str   = Query("sell"),
    product_order_type:   str   = Query("sell"),
    industry_level:       int   = Query(0),
    adv_industry_level:   int   = Query(0),
    min_profit:           float = Query(0.0),
    session: str | None = Cookie(None),
):
    """Per-item profit statistics for a plan."""
    char       = get_current_character(session)
    primary_id = int(char["uid"])
    items      = get_plan_items(plan_id)

    if not items:
        return {
            "total_material_cost": 0, "total_job_cost": 0, "total_cost": 0,
            "total_revenue": 0, "total_profit": 0, "total_margin_pct": 0, "items": [],
        }

    bp_type_ids = list({item["blueprint_type_id"] for item in items})
    sde_data    = get_blueprints_data_batch(bp_type_ids)

    all_type_ids: set[int] = set()
    for data in sde_data.values():
        all_type_ids.update(m["type_id"] for m in data.get("materials", []))
        all_type_ids.update(p["type_id"] for p in data.get("products", []))

    market_prices   = get_market_prices(list(all_type_ids), price_region_id) if solar_system_id else {}
    adjusted_prices = {k: v for k, v in get_adjusted_prices().items() if k in all_type_ids}
    cost_index      = get_manufacturing_cost_index(solar_system_id) if solar_system_id else 0.0

    settings = _profit_settings(
        runs, broker_fee, sales_tax, facility_tax,
        structure_me_bonus, structure_te_bonus, structure_cost_bonus,
        material_order_type, product_order_type, industry_level, adv_industry_level,
    )

    stat_items     = []
    total_mat_cost = 0.0
    total_job_cost = 0.0
    total_revenue  = 0.0

    for item in items:
        data  = sde_data.get(item["blueprint_type_id"], {})
        if not data.get("products"):
            continue
        item_settings = ProfitSettings(
            broker_fee=settings.broker_fee, sales_tax=settings.sales_tax,
            facility_tax=settings.facility_tax, runs=item["runs"],
            structure_me_bonus=settings.structure_me_bonus,
            structure_te_bonus=settings.structure_te_bonus,
            structure_cost_bonus=settings.structure_cost_bonus,
            material_order_type=settings.material_order_type,
            product_order_type=settings.product_order_type,
            industry_level=settings.industry_level,
            adv_industry_level=settings.adv_industry_level,
        )
        result = calculate_blueprint_profit(
            blueprint_type_id=item["blueprint_type_id"],
            blueprint_name=item["blueprint_name"],
            me=item["me"], te=item["te"],
            is_bpo=False,
            sde_materials=data["materials"],
            sde_products=data["products"],
            base_time_seconds=data["time"],
            market_prices=market_prices,
            adjusted_prices=adjusted_prices,
            system_cost_index=cost_index,
            settings=item_settings,
        )
        if result:
            total_mat_cost += result.material_cost
            total_job_cost += result.job_cost
            total_revenue  += result.revenue
            stat_items.append({
                "blueprint_name": result.blueprint_name,
                "product_name":   result.product_name,
                "runs":           item["runs"],
                "profit":         round(result.profit, 2),
                "isk_per_hour":   round(result.isk_per_hour, 2),
            })

    total_cost   = total_mat_cost + total_job_cost
    total_profit = total_revenue - total_cost
    margin_pct   = (total_profit / total_cost * 100.0) if total_cost > 0 else 0.0

    return {
        "total_material_cost": round(total_mat_cost, 2),
        "total_job_cost":      round(total_job_cost, 2),
        "total_cost":          round(total_cost, 2),
        "total_revenue":       round(total_revenue, 2),
        "total_profit":        round(total_profit, 2),
        "total_margin_pct":    round(margin_pct, 2),
        "items":               stat_items,
    }


@app.get("/api/plans/{plan_id}/shopping-list")
def plan_shopping_list(
    plan_id:              int,
    solar_system_id:      int   = Query(None),
    price_region_id:      int   = Query(10000002),
    structure_me_bonus:   float = Query(0.0),
    material_order_type:  str   = Query("sell"),
    use_warehouse:        bool  = Query(False),
    industry_level:       int   = Query(0),
    adv_industry_level:   int   = Query(0),
    runs:                 int   = Query(1),
    broker_fee:           float = Query(0.0368),
    sales_tax:            float = Query(0.0360),
    facility_tax:         float = Query(0.0),
    structure_te_bonus:   float = Query(0.0),
    structure_cost_bonus: float = Query(0.0),
    product_order_type:   str   = Query("sell"),
    min_profit:           float = Query(0.0),
    session: str | None = Cookie(None),
):
    """Shopping list (materials to buy) for a plan."""
    char       = get_current_character(session)
    primary_id = int(char["uid"])
    items      = get_plan_items(plan_id)

    if not items:
        return {"materials": [], "multibuy": ""}

    bp_type_ids = list({item["blueprint_type_id"] for item in items})
    sde_data    = get_blueprints_data_batch(bp_type_ids)

    # Aggregate all materials across plan items
    needed: dict[int, dict] = {}
    for item in items:
        data = sde_data.get(item["blueprint_type_id"], {})
        for mat in data.get("materials", []):
            qty = calc_qty_with_me(mat["quantity"], item["me"], structure_me_bonus) * item["runs"]
            if mat["type_id"] not in needed:
                needed[mat["type_id"]] = {"name": mat["name"], "qty": 0}
            needed[mat["type_id"]]["qty"] += qty

    all_type_ids = list(needed.keys())
    market_prices = get_market_prices(all_type_ids, price_region_id) if solar_system_id else {}

    # Warehouse stock from ESI asset cache (all group characters)
    warehouse: dict[int, int] = {}
    if use_warehouse:
        char_ids = get_group_character_ids(primary_id)
        for cid in char_ids:
            assets = get_cached_assets(cid)
            if assets:
                for asset in assets:
                    tid = asset["type_id"]
                    warehouse[tid] = warehouse.get(tid, 0) + asset.get("quantity", 1)

    material_rows = []
    for type_id, info in sorted(needed.items(), key=lambda x: x[1]["name"]):
        in_stock = warehouse.get(type_id, 0)
        to_buy   = max(0, info["qty"] - in_stock)
        material_rows.append({
            "type_id":  type_id,
            "name":     info["name"],
            "needed":   info["qty"],
            "in_stock": in_stock,
            "to_buy":   to_buy,
        })

    multibuy = "\n".join(
        f"{row['name']} {row['to_buy']}"
        for row in material_rows
        if row["to_buy"] > 0
    )

    return {"materials": material_rows, "multibuy": multibuy}

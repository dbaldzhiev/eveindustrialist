import os
import math
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Cookie, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from database import (
    init_db, clear_market_cache,
    get_blueprints_data_batch, get_all_manufacturing_bp_ids, get_type_names_batch,
    get_type_volumes_batch, get_type_categories_batch,
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
    get_blueprint_required_skills_batch, get_cached_all_skills_for_characters,
    get_active_job_blueprint_ids, get_type_id_by_name,
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
    get_realtime_market_prices,
    INDUSTRY_SKILL_IDS, MFG_ACTIVITIES, RESEARCH_ACTIVITIES, REACTION_ACTIVITIES,
    ACTIVITY_NAMES, resolve_location_names,
)
from market import get_market_prices, get_market_history_stats
from profitability import calculate_blueprint_profit, ProfitSettings, calc_qty_with_me_runs

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

MARKET_HUBS = [
    {"region_id": 10000002, "name": "The Forge (Jita)"},
    {"region_id": 10000043, "name": "Domain (Amarr)"},
    {"region_id": 10000032, "name": "Sinq Laison (Dodixie)"},
    {"region_id": 10000030, "name": "Heimatar (Rens)"},
    {"region_id": 10000042, "name": "Metropolis (Hek)"},
]

# T2 Invention Decryptors (Standard)
DECRYPTORS = [
    {"name": "None",                   "type_id": None,  "prob_mult": 1.0,  "me_mod": 0,  "te_mod": 0,  "runs_mod": 0},
    {"name": "Accelerated Control",    "type_id": 34201, "prob_mult": 1.2,  "me_mod": -2, "te_mod": 2,  "runs_mod": 2},
    {"name": "Augmentation",           "type_id": 34202, "prob_mult": 0.59, "me_mod": 2,  "te_mod": 2,  "runs_mod": 9},
    {"name": "Optimized Attainment",   "type_id": 34203, "prob_mult": 1.9,  "me_mod": 1,  "te_mod": -2, "runs_mod": 4},
    {"name": "Optimized Augmentation", "type_id": 34204, "prob_mult": 0.9,  "me_mod": 3,  "te_mod": 2,  "runs_mod": 7},
    {"name": "Parity",                 "type_id": 34205, "prob_mult": 1.5,  "me_mod": 1,  "te_mod": 2,  "runs_mod": 3},
    {"name": "Process",                "type_id": 34206, "prob_mult": 1.1,  "me_mod": 1,  "te_mod": 6,  "runs_mod": 0},
    {"name": "Symmetry",               "type_id": 34207, "prob_mult": 1.0,  "me_mod": 1,  "te_mod": 2,  "runs_mod": 2},
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
    reaction_level: int = 0,
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
        reaction_level=reaction_level,
    )


def _calc_profits_for_bps(
    char_bps: list[dict],
    price_region_id: int,
    solar_system_id: int | None,
    settings: ProfitSettings,
    min_profit: float,
    force_refresh: bool = False,
    mode: str = "build",
    decryptor_strategy: str = "none",
    decryptor_type_id: int | None = None,
    primary_id: int | None = None,
    include_materials: bool = True,
    individual: bool = False,
) -> list[dict]:
    # Remove BPCs that are physically installed in an active industry job —
    # they're consumed and can't be queued until the job delivers.
    if primary_id:
        in_use = get_active_job_blueprint_ids(get_group_character_ids(primary_id))
        if in_use:
            char_bps = [bp for bp in char_bps if bp.get("item_id") not in in_use]

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

        # Get base BPC counts for invention
        base_bpc_counts = {}
        if primary_id:
            for cid in get_group_character_ids(primary_id):
                try:
                    for bp in get_character_blueprints(cid, get_access_token(cid)):
                        if bp.get("quantity") != -1: # BPC
                            tid = bp["type_id"]
                            if tid not in base_bpc_counts: base_bpc_counts[tid] = {"count": 0, "runs": 0}
                            base_bpc_counts[tid]["count"] += 1
                            base_bpc_counts[tid]["runs"] += bp.get("runs", 0)
                except Exception: pass

        # Get invention materials for all source blueprints
        source_ids = list({v["base_bp_id"] for v in variants})
        invent_data = get_blueprints_data_batch(source_ids, activity_id=8)

        # Build "Potential" BPCs for calculation
        for var in variants:
            for d in test_decryptors:
                invention_bps.append({
                    "type_id":        var["result_bp_id"],
                    "source_type_id": var["base_bp_id"],
                    "type_name":      var["result_bp_name"] + " (Potential)",
                    "quantity":       1,
                    "me":             2 + d["me_mod"],
                    "te":             4 + d["te_mod"],
                    "is_bpo":         False,
                    "is_invention":   True,
                    "decryptor":      d,
                    "base_probability": var.get("probability", 0),
                    "invent_materials": invent_data.get(var["base_bp_id"], {}).get("materials", []),
                    "base_bpc_info":    base_bpc_counts.get(var["base_bp_id"], {"count": 0, "runs": 0}),
                })
        all_calc_bps = invention_bps
    elif mode == "copy":
        # Only owned BPOs that are NOT reactions (reactions can't be copied)
        reaction_ids = set(get_reaction_bp_ids())
        all_calc_bps = [
            bp for bp in char_bps 
            if (bp.get("quantity") == -1) and (bp["type_id"] not in reaction_ids)
        ]
    elif mode == "react":
        # Only owned reaction formulas (activity 11)
        reaction_ids = set(get_reaction_bp_ids())
        all_calc_bps = [bp for bp in char_bps if bp["type_id"] in reaction_ids]
    else:
        # mode == "build"
        all_calc_bps = char_bps
    
    calc_ids = [bp["type_id"] for bp in all_calc_bps]
    # Use activity 11 for SDE data if in react mode
    sde_activity = 11 if mode == "react" else 1
    sde_data = get_blueprints_data_batch(calc_ids, activity_id=sde_activity)

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

    if mode == "invent":
        for bp in all_calc_bps:
            for m in bp.get("invent_materials", []):
                all_type_ids.add(m["type_id"])

    if not all_type_ids:
        return []

    market_prices   = get_market_prices(list(all_type_ids), price_region_id, force_refresh=force_refresh) if solar_system_id else {}
    adjusted_prices = ({k: v for k, v in get_adjusted_prices().items() if k in all_type_ids} if solar_system_id else {})
    cost_index      = get_manufacturing_cost_index(solar_system_id) if solar_system_id else 0.0
    category_map    = get_type_categories_batch(list(all_type_ids))

    if mode == "copy":
        # Aggregate BPOs by type_id to show all owners
        bpo_agg: dict[int, dict] = {}
        reaction_ids = set(get_reaction_bp_ids())
        for bp in char_bps:
            if bp.get("quantity") == -1 and bp["type_id"] not in reaction_ids:
                tid = bp["type_id"]
                if tid not in bpo_agg:
                    bpo_agg[tid] = {
                        "type_id": tid,
                        "type_name": bp["type_name"],
                        "me": bp["me"], "te": bp["te"],
                        "character_ids": set()
                    }
                if bp.get("character_id"):
                    bpo_agg[tid]["character_ids"].add(bp["character_id"])

        # Check matching BPCs in inventory
        bpc_inventory: dict[int, list[dict]] = {}
        if primary_id:
            char_ids = get_group_character_ids(primary_id)
            for cid in char_ids:
                try:
                    for bp in get_character_blueprints(cid, get_access_token(cid)):
                        if bp.get("quantity") != -1: # It's a BPC
                            tid = bp["type_id"]
                            if tid not in bpc_inventory: bpc_inventory[tid] = []
                            bpc_inventory[tid].append(bp)
                except Exception: pass

        results = []
        for tid, agg in bpo_agg.items():
            data = sde_data.get(tid, {})
            product_id = data["products"][0]["type_id"] if data.get("products") else 0
            
            matching_bpcs = bpc_inventory.get(tid, [])
            # Collect unique character IDs who own BPCs for this blueprint
            bpc_char_ids = list({b["character_id"] for b in matching_bpcs if b.get("character_id")})

            d = {
                "blueprint_type_id": tid,
                "blueprint_name":    agg["type_name"],
                "product_type_id":   product_id,
                "product_name":      data["products"][0]["name"] if data.get("products") else "Unknown",
                "me": agg["me"], "te": agg["te"],
                "runs": 1,
                "is_bpo": True,
                "category_name": category_map.get(product_id, "Unknown"),
                "material_cost": 0, "job_cost": 0, "total_cost": 0,
                "revenue": 0, "profit": 0, "margin_pct": 0,
                "isk_per_hour": 0, "sell_price": 0, "product_quantity": 0,
                "materials": [],
                "character_ids": list(agg["character_ids"]),
                "bpc_character_ids": bpc_char_ids,
                "bpc_count": len(matching_bpcs),
                "bpc_total_runs": sum(b.get("runs", 0) for b in matching_bpcs)
            }
            results.append(d)
        return results

    if individual:
        results = []
        for bp in all_calc_bps:
            data = sde_data.get(bp["type_id"], {})
            if not data.get("products"):
                continue
            qty_indicator = bp.get("quantity", 1)
            is_bpo = (qty_indicator == -1)
            bp_runs = settings.runs if is_bpo else max(1, bp.get("runs", 1))
            bp_settings = ProfitSettings(
                broker_fee=settings.broker_fee,
                sales_tax=settings.sales_tax,
                facility_tax=settings.facility_tax,
                runs=bp_runs,
                structure_me_bonus=settings.structure_me_bonus,
                structure_te_bonus=settings.structure_te_bonus,
                structure_cost_bonus=settings.structure_cost_bonus,
                material_order_type=settings.material_order_type,
                product_order_type=settings.product_order_type,
                industry_level=settings.industry_level,
                adv_industry_level=settings.adv_industry_level,
            )
            result = calculate_blueprint_profit(
                blueprint_type_id=bp["type_id"],
                blueprint_name=bp["type_name"],
                me=bp["me"], te=bp["te"],
                is_bpo=is_bpo,
                sde_materials=data["materials"],
                sde_products=data["products"],
                base_time_seconds=data["time"],
                market_prices=market_prices,
                adjusted_prices=adjusted_prices,
                system_cost_index=cost_index,
                settings=bp_settings,
            )
            if result:
                d = result.to_api_dict(include_materials=True)
                d["category_name"] = category_map.get(d["product_type_id"], "Unknown")
                if bp.get("item_id"):
                    d["item_id"] = bp["item_id"]
                if bp.get("character_id"):
                    d["character_ids"] = [bp["character_id"]]
                results.append(d)
        # Attach per-blueprint skill requirements for individual mode (always build, activityID=1)
        bp_type_ids = list({r["blueprint_type_id"] for r in results})
        skills_map  = get_blueprint_required_skills_batch(bp_type_ids, 1)
        for r in results:
            r["required_skills"] = skills_map.get(r["blueprint_type_id"], [])
        # Attach market history stats
        product_ids  = list({r["product_type_id"] for r in results})
        history_map  = get_market_history_stats(product_ids, price_region_id)
        _empty_stats = {"vol_1d": 0, "vol_7d": 0, "avg_daily": 0.0, "avg_price": 0.0, "trend": "flat"}
        for r in results:
            r["market_stats"] = history_map.get(r["product_type_id"], _empty_stats)
        return results

    # Aggregate identical blueprints (same type, ME, TE, etc.)
    aggregated_bps: dict[tuple, dict] = {}
    for bp in all_calc_bps:
        # EVE ESI: quantity is -1 for BPO, -2 for BPC. actual runs are in 'runs' field for BPCs.
        qty_indicator = bp.get("quantity", 1)
        is_bpo = (qty_indicator == -1)
        
        # For invention, decryptor name is part of the identity
        d_name = bp.get("decryptor", {}).get("name") if bp.get("decryptor") else None
        
        key = (bp["type_id"], bp["me"], bp["te"], is_bpo, d_name)
        if key not in aggregated_bps:
            aggregated_bps[key] = dict(bp)
            aggregated_bps[key]["character_ids"] = []
            # Initialize aggregate runs: BPOs use indicators, BPCs will sum actual runs
            if not is_bpo:
                aggregated_bps[key]["runs"] = 0
            
            # Preserve invention metadata if present
            if bp.get("is_invention"):
                aggregated_bps[key]["is_invention"] = True
                aggregated_bps[key]["decryptor"] = bp.get("decryptor")
                aggregated_bps[key]["base_probability"] = bp.get("base_probability")
                aggregated_bps[key]["invent_materials"] = bp.get("invent_materials")
                aggregated_bps[key]["base_bpc_info"] = bp.get("base_bpc_info")
                aggregated_bps[key]["source_type_id"] = bp.get("source_type_id")

        if bp.get("character_id"):
            cid = bp["character_id"]
            if cid not in aggregated_bps[key]["character_ids"]:
                aggregated_bps[key]["character_ids"].append(cid)

        if not is_bpo:
            # Sum the actual runs field from ESI for BPCs
            aggregated_bps[key]["runs"] += bp.get("runs", 1)

    results = []
    for bp in aggregated_bps.values():
        data = sde_data.get(bp["type_id"], {})
        if not data.get("products"):
            continue

        # Use actual blueprint runs if available (BPC), else use global setting (BPO)
        qty_indicator = bp.get("quantity", 1)
        if qty_indicator == -1:
            # BPO: use dashboard setting
            bp_runs = settings.runs
        else:
            # BPC: use the summed runs we calculated during aggregation
            bp_runs = bp.get("runs", 1)
        
        # Create a per-blueprint settings object with correct runs
        
        # Create a per-blueprint settings object with correct runs
        bp_settings = ProfitSettings(
            broker_fee=settings.broker_fee,
            sales_tax=settings.sales_tax,
            facility_tax=settings.facility_tax,
            runs=bp_runs,
            structure_me_bonus=settings.structure_me_bonus,
            structure_te_bonus=settings.structure_te_bonus,
            structure_cost_bonus=settings.structure_cost_bonus,
            material_order_type=settings.material_order_type,
            product_order_type=settings.product_order_type,
            industry_level=settings.industry_level,
            adv_industry_level=settings.adv_industry_level,
        )

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
            settings=bp_settings,
        )
        if result and result.profit >= min_profit:
            d = result.to_api_dict(include_materials=include_materials)
            d["category_name"] = category_map.get(d["product_type_id"], "Unknown")
            if bp.get("character_ids"):
                d["character_ids"] = bp["character_ids"]
            if bp.get("is_invention") and bp.get("decryptor"):
                d["is_invention"] = True
                d["decryptor_name"] = bp["decryptor"]["name"]
                
                # Attach priced invention materials and metadata
                inv_mats = []
                inv_cost = 0.0
                if bp.get("invent_materials"):
                    for m in bp["invent_materials"]:
                        price = market_prices.get(m["type_id"], {}).get(settings.material_order_type, 0.0)
                        line_cost = m["quantity"] * price
                        inv_cost += line_cost
                        inv_mats.append({
                            "type_id": m["type_id"], "name": m["name"],
                            "quantity": m["quantity"], "unit_price": price, "total_cost": line_cost
                        })
                d["invent_materials"] = inv_mats
                d["invent_cost"]      = inv_cost
                d["base_probability"] = bp.get("base_probability", 0)
                d["base_bpc_info"]    = bp.get("base_bpc_info", {})

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

    # Attach per-blueprint skill requirements
    if mode == "invent":
        # Skills are on the T1 source blueprint (activityID=8)
        source_id_map = {bp["type_id"]: bp.get("source_type_id", bp["type_id"]) for bp in all_calc_bps}
        source_ids = list({v for v in source_id_map.values()})
        skills_map = get_blueprint_required_skills_batch(source_ids, 8)
        for r in results:
            src = source_id_map.get(r["blueprint_type_id"])
            r["required_skills"] = skills_map.get(src, []) if src else []
    elif mode != "copy":
        activity_id = 11 if mode == "react" else 1
        type_ids = list({r["blueprint_type_id"] for r in results})
        skills_map = get_blueprint_required_skills_batch(type_ids, activity_id)
        for r in results:
            r["required_skills"] = skills_map.get(r["blueprint_type_id"], [])

    # Attach market history stats (volume + price trend) per product
    product_ids  = list({r["product_type_id"] for r in results})
    history_map  = get_market_history_stats(product_ids, price_region_id)
    _empty_stats = {"vol_1d": 0, "vol_7d": 0, "avg_daily": 0.0, "avg_price": 0.0, "trend": "flat"}
    for r in results:
        r["market_stats"] = history_map.get(r["product_type_id"], _empty_stats)

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
    runs:                    int          = 1
    min_profit:              float        = 0.0
    material_order_type:     str          = "sell"
    product_order_type:      str          = "sell"
    warehouse_character_id:  int   | None = None
    warehouse_location_id:   int   | None = None
    warehouse_location_name: str   | None = None
    reaction_facility_tax:   float        = 0.0
    reaction_me_bonus:       float        = 0.0
    reaction_te_bonus:       float        = 0.0
    reaction_cost_bonus:     float        = 0.0


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
        runs=body.runs,
        min_profit=body.min_profit,
        material_order_type=body.material_order_type,
        product_order_type=body.product_order_type,
        warehouse_character_id=body.warehouse_character_id,
        warehouse_location_id=body.warehouse_location_id,
        warehouse_location_name=body.warehouse_location_name,
        reaction_facility_tax=body.reaction_facility_tax,
        reaction_me_bonus=body.reaction_me_bonus,
        reaction_te_bonus=body.reaction_te_bonus,
        reaction_cost_bonus=body.reaction_cost_bonus,
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


@app.get("/api/cache/status")
def cache_status(session: str | None = Cookie(None)):
    primary_id = _primary(session)
    char_ids   = get_group_character_ids(primary_id)

    from database import _query_one as _qo
    market_row = _qo("SELECT MAX(updated_at) AS ts FROM market_price_cache")
    market_at  = market_row["ts"] if market_row else None

    esi_at = None
    if char_ids:
        ph = ",".join("?" * len(char_ids))
        jobs_row   = _qo(f"SELECT MAX(updated_at) AS ts FROM jobs_cache   WHERE character_id IN ({ph})", tuple(char_ids))
        assets_row = _qo(f"SELECT MAX(updated_at) AS ts FROM asset_cache  WHERE character_id IN ({ph})", tuple(char_ids))
        ts_list = [r["ts"] for r in [jobs_row, assets_row] if r and r["ts"]]
        esi_at  = max(ts_list) if ts_list else None

    return {"market_updated_at": market_at, "esi_updated_at": esi_at}


@app.post("/api/esi/refresh")
def esi_refresh(session: str | None = Cookie(None)):
    primary_id = _primary(session)
    char_ids   = get_group_character_ids(primary_id)

    errors: list[str] = []
    for cid in char_ids:
        try:
            token = get_access_token(cid)
            get_character_assets(cid, token, force_refresh=True)
        except Exception as e:
            errors.append(f"assets:{cid}:{e}")
        try:
            token = get_access_token(cid)
            get_character_jobs(cid, token, force_refresh=True)
        except Exception as e:
            errors.append(f"jobs:{cid}:{e}")
        try:
            token = get_access_token(cid)
            get_character_skills(cid, token, force_refresh=True)
        except Exception as e:
            errors.append(f"skills:{cid}:{e}")

    return {"ok": True, "errors": errors}


@app.post("/api/sde/refresh")
def sde_refresh(session: str | None = Cookie(None)):
    get_current_character(session)
    import setup_sde as _sde
    _sde.main()
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


@app.get("/api/blueprints/detail")
def blueprint_detail(
    blueprint_type_id:    int   = Query(...),
    me:                   int   = Query(0, ge=0, le=10),
    te:                   int   = Query(0, ge=0, le=20),
    runs:                 int   = Query(1, ge=1),
    solar_system_id:      int   | None = Query(None),
    price_region_id:      int   = Query(10000002),
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
    session: str | None = Cookie(None),
):
    """Full profit + material breakdown for a single blueprint. solar_system_id is optional."""
    get_current_character(session)

    sde_map = get_blueprints_data_batch([blueprint_type_id])
    data    = sde_map.get(blueprint_type_id, {})
    if not data or not data.get("products"):
        raise HTTPException(status_code=404, detail="Blueprint not found or has no products")

    all_type_ids: set[int] = (
        {m["type_id"] for m in data["materials"]}
        | {p["type_id"] for p in data["products"]}
    )

    market_prices   = get_market_prices(list(all_type_ids), price_region_id) if solar_system_id else {}
    adjusted_prices = {k: v for k, v in get_adjusted_prices().items() if k in all_type_ids}
    cost_index      = get_manufacturing_cost_index(solar_system_id) if solar_system_id else 0.0

    settings = _profit_settings(
        runs, broker_fee, sales_tax, facility_tax,
        structure_me_bonus, structure_te_bonus, structure_cost_bonus,
        material_order_type, product_order_type, industry_level, adv_industry_level,
        reaction_level,
    )

    name_map = get_type_names_batch([blueprint_type_id])
    bp_name  = name_map.get(blueprint_type_id, f"Blueprint [{blueprint_type_id}]")

    result = calculate_blueprint_profit(
        blueprint_type_id=blueprint_type_id,
        blueprint_name=bp_name,
        me=me, te=te, is_bpo=True,
        sde_materials=data["materials"],
        sde_products=data["products"],
        base_time_seconds=data["time"],
        market_prices=market_prices,
        adjusted_prices=adjusted_prices,
        system_cost_index=cost_index,
        settings=settings,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Calculation failed")

    d = result.to_api_dict()
    d["category_name"] = get_type_categories_batch(list(all_type_ids)).get(d["product_type_id"], "Unknown")
    return d


class SellerInput(BaseModel):
    raw_text: str
    region_id: int | None = 10000002

@app.post("/api/market/seller")
def market_seller(body: SellerInput, session: str | None = Cookie(None)):
    """
    Parse a list of items (TypeIDs or Name + Price), fetch real-time sell prices
    for the specified region, and return undercut prices.
    """
    get_current_character(session) # Auth check

    region_id = body.region_id or 10000002

    lines = body.raw_text.strip().split("\n")
    type_ids = []
    
    # We'll store either tid or name to resolve later
    to_resolve = []

    for line in lines:
        line = line.strip()
        if not line: continue
        
        # 1. Try TypeID at the start
        match_tid = re.match(r"^(\d{2,10})\b", line)
        if match_tid:
            tid = int(match_tid.group(1))
            type_ids.append(tid)
            to_resolve.append({"type_id": tid})
            continue

        # 2. Try [Name] [Price] format
        # Regex: captures everything up to the last segment that looks like a price.
        # We look for a space followed by a price-like string at the end of the line.
        # Price-like: can contain digits, commas, and a decimal point.
        match_name_price = re.match(r"^(.*?)\s+([\d,]*\.?\d+)$", line)
        if match_name_price:
            name = match_name_price.group(1).strip()
            to_resolve.append({"name": name})
            continue
        
        # 3. Fallback: treat the whole line as a name
        to_resolve.append({"name": line})

    # Resolve names to typeIDs
    final_type_ids = []
    for item in to_resolve:
        if "type_id" in item:
            final_type_ids.append(item["type_id"])
        elif "name" in item:
            tid = get_type_id_by_name(item["name"])
            if tid:
                item["type_id"] = tid
                final_type_ids.append(tid)

    if not final_type_ids:
        return {"items": []}

    # Fetch real-time ESI DATA for the specified region
    prices = get_realtime_market_prices(final_type_ids, region_id)
    names = get_type_names_batch(final_type_ids)

    results = []
    for item in to_resolve:
        tid = item.get("type_id")
        if not tid: continue

        p = prices.get(tid, {}).get("sell", 0)
        
        undercut = 0
        if p > 0:
            magnitude = math.floor(math.log10(p))
            undercut_unit = 10**(magnitude - 3)
            undercut_unit = max(0.01, undercut_unit)
            undercut = round(max(0.01, p - undercut_unit), 2)
        
        results.append({
            "type_id": tid,
            "name": names.get(tid, "Unknown"),
            "original_price": p,
            "undercut_price": undercut,
        })

    return {"items": results}

# ---------------------------------------------------------------------------
# My Blueprints (aggregated from all characters in the group)
# ---------------------------------------------------------------------------

@app.get("/api/blueprints")
def blueprints(
    solar_system_id:      int   | None = Query(None),
    price_region_id:      int   = Query(10000002),
    runs:                 int   = Query(1,      ge=1, le=10000),
    broker_fee:           float = Query(0.0368, ge=0, le=0.20),
    sales_tax:            float = Query(0.0360, ge=0, le=0.20),
    facility_tax:         float = Query(0.0,    ge=0, le=0.25),
    structure_me_bonus:   float = Query(0.0,    ge=0, le=0.05),
    structure_te_bonus:   float = Query(0.0,    ge=0, le=0.30),
    structure_cost_bonus: float = Query(0.0,    ge=0, le=0.25),
    material_order_type:  str   = Query("sell"),
    product_order_type:   str   = Query("sell"),
    min_profit:           float = Query(0.0),
    force_refresh:        bool  = Query(False),
    mode:                 str   = Query("build"),
    decryptor_strategy:   str   = Query("none"),  # "none", "optimized", "specific"
    decryptor_type_id:    int | None = Query(None),
    individual:           bool  = Query(False),
    session: str | None = Cookie(None),
):
    char       = get_current_character(session)
    primary_id = int(char["uid"])

    if solar_system_id is not None and get_system_region(solar_system_id) is None:
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
        reaction_level=skills["reactions"],
    )
    return _calc_profits_for_bps(
        all_bps, price_region_id, solar_system_id, settings, min_profit, 
        force_refresh=force_refresh, 
        mode=mode,
        decryptor_strategy=decryptor_strategy,
        decryptor_type_id=decryptor_type_id,
        primary_id=primary_id,
        individual=individual,
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
    structure_me_bonus:   float = Query(0.0,    ge=0, le=0.05),
    structure_te_bonus:   float = Query(0.0,    ge=0, le=0.30),
    structure_cost_bonus: float = Query(0.0,    ge=0, le=0.25),
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
        reaction_level=skills["reactions"],
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
    category_map    = get_type_categories_batch(list(all_type_ids))

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
            d = result.to_api_dict()
            d["category_name"] = category_map.get(d["product_type_id"], "Unknown")
            results.append(d)

    results.sort(key=lambda x: x["profit"], reverse=True)
    return results[:limit]


@app.get("/api/blueprints/reactions/explore")
def reactions_explore(
    solar_system_id:      int   = Query(...),
    price_region_id:      int   = Query(10000002),
    runs:                 int   = Query(1,     ge=1, le=10000),
    broker_fee:           float = Query(0.0368, ge=0, le=0.20),
    sales_tax:            float = Query(0.0360, ge=0, le=0.20),
    facility_tax:         float = Query(0.0,    ge=0, le=0.25),
    structure_me_bonus:   float = Query(0.0,    ge=0, le=0.05),
    structure_te_bonus:   float = Query(0.0,    ge=0, le=0.30),
    structure_cost_bonus: float = Query(0.0,    ge=0, le=0.25),
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
        reaction_level=skills["reactions"],
    )

    all_bp_ids = get_all_reaction_bp_ids()
    if not all_bp_ids:
        return []

    # Activity 11 is Reactions
    sde_data = get_blueprints_data_batch(all_bp_ids, activity_id=11)

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
    category_map    = get_type_categories_batch(list(all_type_ids))

    results = []
    for bp_id in all_bp_ids:
        data = sde_data.get(bp_id, {})
        if not data.get("products"):
            continue
        # Reactions don't have ME/TE levels (they are always 0)
        result = calculate_blueprint_profit(
            blueprint_type_id=bp_id,
            blueprint_name=name_map.get(bp_id, f"Unknown [{bp_id}]"),
            me=0, te=0, is_bpo=True,
            sde_materials=data["materials"],
            sde_products=data["products"],
            base_time_seconds=data["time"],
            market_prices=market_prices,
            adjusted_prices=adjusted_prices,
            system_cost_index=cost_index,
            settings=settings,
        )
        if result and result.profit >= min_profit:
            d = result.to_api_dict()
            d["category_name"] = category_map.get(d["product_type_id"], "Unknown")
            results.append(d)

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
        
        mr_lvl = skills.get(INDUSTRY_SKILL_IDS["mass_reactions"], 0)
        amr_lvl = skills.get(INDUSTRY_SKILL_IDS["adv_mass_reactions"], 0)
        reaction_total = 1 + mr_lvl + amr_lvl

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


@app.get("/api/characters/skills")
def characters_skills(session: str | None = Cookie(None)):
    """Return industry-relevant skill levels for all group characters."""
    primary_id = _primary(session)
    char_ids   = get_group_character_ids(primary_id)
    chars      = get_group_characters(primary_id)
    name_map   = {c["character_id"]: c["character_name"] for c in chars}

    # Read all cached skills in one query
    cached = get_cached_all_skills_for_characters(char_ids)

    result = []
    for cid in char_ids:
        try:
            token  = get_access_token(cid)
            skills = get_character_skills(cid, token)   # refreshes cache if stale
        except Exception:
            skills = {}
        all_skills = cached.get(cid, skills)  # prefer freshly-fetched, fall back to pre-cache
        named = {name: all_skills.get(sid, 0) for name, sid in INDUSTRY_SKILL_IDS.items()}
        result.append({
            "character_id":   cid,
            "character_name": name_map.get(cid, f"Character {cid}"),
            "skills":         named,
            "all_skills":     {str(k): v for k, v in all_skills.items()},
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
    structure_me_bonus:   float = Query(0.0,    ge=0, le=0.05),
    structure_te_bonus:   float = Query(0.0,    ge=0, le=0.30),
    structure_cost_bonus: float = Query(0.0,    ge=0, le=0.25),
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
        reaction_level=skills["reactions"],
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
    Return warehouse contents with category and estimated prices.
    """
    char       = get_current_character(session)
    primary_id = int(char["uid"])
    settings   = get_user_settings(primary_id)

    wh_char = settings.get("warehouse_character_id")
    wh_loc  = settings.get("warehouse_location_id")

    items = []
    if wh_char and wh_loc:
        items = get_assets_at_location(wh_char, wh_loc)
    else:
        char_ids = get_group_character_ids(primary_id)
        grouped: dict[int, dict] = {}
        for cid in char_ids:
            assets = get_cached_assets(cid)
            if assets:
                for item in assets:
                    if item.get("is_container"): continue
                    tid = item["type_id"]
                    if tid not in grouped:
                        grouped[tid] = {"type_id": tid, "type_name": item["type_name"], "quantity": 0}
                    grouped[tid]["quantity"] += item.get("quantity", 1)
        items = list(grouped.values())

    if not items:
        return []

    type_ids     = [i["type_id"] for i in items]
    category_map = get_type_categories_batch(type_ids)
    prices       = get_market_prices(type_ids, settings["default_price_region"])

    for item in items:
        tid = item["type_id"]
        item["category_name"] = category_map.get(tid, "Unknown")
        # Use sell price as estimated value
        item["estimated_price"] = prices.get(tid, {}).get("sell", 0.0)

    return sorted(items, key=lambda x: x["type_name"])


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

    # Group by type_id, summing quantity (filtering for hangars)
    # Most items in 'hangar' location_type are what users consider warehouse
    grouped: dict[int, dict] = {}
    for item in all_items:
        # If item has is_container=True, it's a box, we want the contents
        if item.get("is_container"): continue
        
        tid = item["type_id"]
        if tid not in grouped:
            grouped[tid] = {"type_id": tid, "type_name": item["type_name"], "quantity": 0}
        grouped[tid]["quantity"] += item.get("quantity", 1)

    result = list(grouped.values())
    
    # PERSIST to the database so shopping lists can see it!
    # We clear the existing entries for this primary_id first to avoid stale data
    from database import get_db as _get_db
    conn = _get_db()
    try:
        conn.execute("DELETE FROM warehouse_items WHERE character_id = ?", (primary_id,))
        conn.commit()
    finally:
        conn.close()
        
    if result:
        merge_warehouse_items(primary_id, result)
        
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
    character_id:      int | None = None


class PlanItemUpdateIn(BaseModel):
    runs:   int          = 1
    me:     int          = 0
    te:     int          = 0
    status: str | None = None


@app.put("/api/plans/{plan_id}")
def rename_plan_endpoint(plan_id: int, body: PlanIn, session: str | None = Cookie(None)):
    if not rename_plan(_primary(session), plan_id, body.name):
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"ok": True}


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
        character_id=body.character_id
    )


@app.patch("/api/plans/{plan_id}/items/{item_id}")
def update_plan_item_endpoint(
    plan_id: int, item_id: int, body: PlanItemUpdateIn,
    session: str | None = Cookie(None),
):
    _primary(session)
    if not update_plan_item(plan_id, item_id, body.runs, body.me, body.te, body.status):
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


@app.delete("/api/plans/{plan_id}/items/{item_id}", status_code=204)
def remove_from_plan(plan_id: int, item_id: int, session: str | None = Cookie(None)):
    _primary(session)
    if not remove_plan_item(plan_id, item_id):
        raise HTTPException(status_code=404, detail="Item not found")


@app.get("/api/plans/suggest")
def suggest_plan(
    strategy: str = "profit",
    max_isk: float = Query(1e12),
    max_items: int = Query(None),
    session: str | None = Cookie(None)
):
    """
    Suggest manufacturing runs to fill open slots.
    strategy: "profit" (max ISK/h) or "materials" (max already owned in warehouse)
    """
    primary_id = _primary(session)
    char_ids   = get_group_character_ids(primary_id)

    # 1. Find total open manufacturing slots
    raw_slots = slots_dashboard(session)
    total_open = sum(max(0, s["manufacturing"]["total"] - s["manufacturing"]["used"]) for s in raw_slots)

    if max_items is not None:
        total_open = min(total_open, max_items)

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
        industry_level=skills["industry"],
        adv_industry_level=skills["adv_industry"],
        reaction_level=skills["reactions"],
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
        p_settings, min_profit=-1e15, include_materials=True,
        individual=True, primary_id=primary_id
    )

    # 4. Filter and rank items based on strategy
    # Load warehouse for material-aware strategies
    warehouse: dict[int, int] = {}
    for cid in char_ids:
        assets = get_cached_assets(cid)
        if assets:
            for a in assets:
                tid = a["type_id"]
                warehouse[tid] = warehouse.get(tid, 0) + a.get("quantity", 1)

    if strategy == "profit":
        results.sort(key=lambda x: x["isk_per_hour"], reverse=True)
        suggested = results[:total_open]
    elif strategy == "materials":
        # Greedy optimization to maximize profit given max_isk budget and warehouse stock
        selected = []
        current_spent = 0.0
        current_warehouse = warehouse.copy()

        # Only consider profitable items
        candidates = [r for r in results if r["profit"] > 0]

        # We'll use a greedy approach: in each step, pick the item that gives the best 
        # profit / (cost to buy missing materials).
        # We need to re-evaluate scores because picking one item consumes warehouse mats.
        while len(selected) < total_open and candidates:
            best_idx = -1
            best_score = -1.0
            best_buy_cost = 0.0

            for i, cand in enumerate(candidates):
                buy_cost = 0.0
                for mat in cand.get("materials", []):
                    needed = mat["quantity"]
                    owned = current_warehouse.get(mat["type_id"], 0)
                    to_buy = max(0, needed - owned)
                    buy_cost += to_buy * mat["unit_price"]

                if current_spent + buy_cost > max_isk:
                    continue

                # Score = profit per ISK spent. If buy_cost is 0, it's very high priority.
                score = cand["profit"] / max(1.0, buy_cost)
                if buy_cost == 0:
                    score += 1e12 # Boost items that are "free" to start

                if score > best_score:
                    best_score = score
                    best_idx = i
                    best_buy_cost = buy_cost

            if best_idx == -1:
                break # No more candidates fit the budget

            winner = candidates.pop(best_idx)
            selected.append(winner)
            current_spent += best_buy_cost

            # Update warehouse stock
            for mat in winner.get("materials", []):
                tid = mat["type_id"]
                current_warehouse[tid] = max(0, current_warehouse.get(tid, 0) - mat["quantity"])

        suggested = selected
    else:
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
    use_warehouse:        bool  = Query(False),
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

    all_items = get_plan_items(plan_id)
    # Exclude items marked as done
    items = [i for i in all_items if i.get("status") != "done"]
    
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
            qty = calc_qty_with_me_runs(mat["quantity"], item["me"], item["runs"], structure_me_bonus)
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
    reaction_level:       int   = Query(0),
    min_profit:           float = Query(0.0),
    session: str | None = Cookie(None),
):
    """Per-item profit statistics for a plan."""
    char       = get_current_character(session)
    primary_id = int(char["uid"])
    all_items  = get_plan_items(plan_id)
    # Exclude items marked as done
    items      = [i for i in all_items if i.get("status") != "done"]

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
        reaction_level,
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
            reaction_level=settings.reaction_level,
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
                "character_id":   item.get("character_id"),
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


@app.get("/api/plans/{plan_id}/shopping")
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
    all_items  = get_plan_items(plan_id)
    # Exclude items marked as done
    items      = [i for i in all_items if i.get("status") != "done"]

    if not items:
        return {"materials": [], "multibuy": ""}

    bp_type_ids = list({item["blueprint_type_id"] for item in items})
    sde_data    = get_blueprints_data_batch(bp_type_ids)

    # Aggregate all materials across plan items
    needed: dict[int, dict] = {}
    for item in items:
        data = sde_data.get(item["blueprint_type_id"], {})
        for mat in data.get("materials", []):
            qty = calc_qty_with_me_runs(mat["quantity"], item["me"], item["runs"], structure_me_bonus)
            if mat["type_id"] not in needed:
                needed[mat["type_id"]] = {"name": mat["name"], "qty": 0}
            needed[mat["type_id"]]["qty"] += qty

    all_type_ids = list(needed.keys())
    market_prices = get_market_prices(all_type_ids, price_region_id) if solar_system_id else {}

    # Warehouse stock from curated warehouse_items table
    warehouse: dict[int, int] = {}
    if use_warehouse:
        warehouse = {w["type_id"]: w["quantity"] for w in get_warehouse_items(primary_id)}

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

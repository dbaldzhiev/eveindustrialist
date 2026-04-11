import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Cookie, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from database      import init_db, get_blueprints_data_batch, get_all_manufacturing_bp_ids, \
                          get_type_names_batch, \
                          search_systems, get_regions, get_system_region, search_types, search_blueprints, \
                          get_structures, create_structure, delete_structure, \
                          get_warehouse_items, set_warehouse_item, delete_warehouse_item, \
                          get_shopping_list, add_shopping_list_item, update_shopping_list_item_runs, \
                          remove_shopping_list_item, clear_shopping_list
from auth          import router as auth_router, get_current_character, get_access_token
from esi           import get_character_blueprints, get_adjusted_prices, \
                          get_manufacturing_cost_index
from market        import get_market_prices
from profitability import calculate_blueprint_profit, ProfitSettings, calc_qty_with_me

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

MARKET_HUBS = [
    {"region_id": 10000002, "name": "The Forge (Jita)"},
    {"region_id": 10000043, "name": "Domain (Amarr)"},
    {"region_id": 10000032, "name": "Sinq Laison (Dodixie)"},
    {"region_id": 10000030, "name": "Heimatar (Rens)"},
    {"region_id": 10000042, "name": "Metropolis (Hek)"},
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
# Auth / identity
# ---------------------------------------------------------------------------

@app.get("/api/me")
def me(session: str | None = Cookie(None)):
    char = get_current_character(session)
    return {"character_id": int(char["sub"]), "character_name": char["name"]}


# ---------------------------------------------------------------------------
# Geography / market hubs
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


@app.get("/api/types/search")
def types_search(q: str = Query(..., min_length=2)):
    return search_types(q, limit=20)


@app.get("/api/blueprints/search")
def blueprints_search(q: str = Query(..., min_length=2), session: str | None = Cookie(None)):
    get_current_character(session)
    return search_blueprints(q, limit=20)


# ---------------------------------------------------------------------------
# Shared helper: build ProfitSettings from query params
# ---------------------------------------------------------------------------

def _profit_settings(
    runs:                 int,
    broker_fee:           float,
    sales_tax:            float,
    facility_tax:         float,
    structure_me_bonus:   float,
    structure_te_bonus:   float,
    structure_cost_bonus: float,
    material_order_type:  str,
    product_order_type:   str,
) -> ProfitSettings:
    return ProfitSettings(
        broker_fee=broker_fee,
        sales_tax=sales_tax,
        facility_tax=facility_tax,
        runs=runs,
        structure_me_bonus=structure_me_bonus,
        structure_te_bonus=structure_te_bonus,
        structure_cost_bonus=structure_cost_bonus,
        material_order_type=material_order_type,
        product_order_type=product_order_type,
    )


# ---------------------------------------------------------------------------
# My Blueprints
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
    session: str | None = Cookie(None),
):
    char         = get_current_character(session)
    character_id = int(char["sub"])

    if get_system_region(solar_system_id) is None:
        raise HTTPException(status_code=400, detail="Unknown solar system")

    char_bps = get_character_blueprints(character_id, get_access_token(character_id))
    if not char_bps:
        return []

    bp_type_ids = [bp["type_id"] for bp in char_bps]
    sde_data    = get_blueprints_data_batch(bp_type_ids)

    all_type_ids: set[int] = set()
    for tid, data in sde_data.items():
        if data["products"]:
            all_type_ids.update(m["type_id"] for m in data["materials"])
            all_type_ids.update(p["type_id"] for p in data["products"])

    if not all_type_ids:
        return []

    market_prices   = get_market_prices(list(all_type_ids), price_region_id)
    adjusted_prices = {k: v for k, v in get_adjusted_prices().items() if k in all_type_ids}
    cost_index      = get_manufacturing_cost_index(solar_system_id)

    settings = _profit_settings(
        runs, broker_fee, sales_tax, facility_tax,
        structure_me_bonus, structure_te_bonus, structure_cost_bonus,
        material_order_type, product_order_type,
    )

    results = []
    for bp in char_bps:
        data = sde_data.get(bp["type_id"], {})
        if not data.get("products"):
            continue

        result = calculate_blueprint_profit(
            blueprint_type_id=bp["type_id"],
            blueprint_name=bp["type_name"],
            me=bp["me"],
            te=bp["te"],
            is_bpo=(bp["quantity"] == -1),
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
    return results


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
    limit:                int   = Query(200,   ge=1, le=1000),
    session: str | None = Cookie(None),
):
    get_current_character(session)  # require auth

    if get_system_region(solar_system_id) is None:
        raise HTTPException(status_code=400, detail="Unknown solar system")

    all_bp_ids = get_all_manufacturing_bp_ids()
    if not all_bp_ids:
        return []

    sde_data = get_blueprints_data_batch(all_bp_ids)

    all_type_ids: set[int] = set()
    for tid, data in sde_data.items():
        if data["products"]:
            all_type_ids.update(m["type_id"] for m in data["materials"])
            all_type_ids.update(p["type_id"] for p in data["products"])

    if not all_type_ids:
        return []

    market_prices   = get_market_prices(list(all_type_ids), price_region_id)
    adjusted_prices = {k: v for k, v in get_adjusted_prices().items() if k in all_type_ids}
    cost_index      = get_manufacturing_cost_index(solar_system_id)

    settings = _profit_settings(
        runs, broker_fee, sales_tax, facility_tax,
        structure_me_bonus, structure_te_bonus, structure_cost_bonus,
        material_order_type, product_order_type,
    )

    name_map = get_type_names_batch(all_bp_ids)

    results = []
    for bp_id in all_bp_ids:
        data = sde_data.get(bp_id, {})
        if not data.get("products"):
            continue

        result = calculate_blueprint_profit(
            blueprint_type_id=bp_id,
            blueprint_name=name_map.get(bp_id, f"Unknown [{bp_id}]"),
            me=assumed_me,
            te=assumed_te,
            is_bpo=True,  # assume BPO for explorer
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
    char = get_current_character(session)
    return get_structures(int(char["sub"]))


@app.post("/api/structures", status_code=201)
def add_structure(body: StructureIn, session: str | None = Cookie(None)):
    char = get_current_character(session)
    return create_structure(
        int(char["sub"]), body.name, body.solar_system_id,
        body.me_bonus, body.te_bonus, body.cost_bonus,
    )


@app.delete("/api/structures/{structure_id}", status_code=204)
def remove_structure(structure_id: int, session: str | None = Cookie(None)):
    char = get_current_character(session)
    if not delete_structure(int(char["sub"]), structure_id):
        raise HTTPException(status_code=404, detail="Structure not found")


# ---------------------------------------------------------------------------
# Warehouse CRUD
# ---------------------------------------------------------------------------

class WarehouseItemIn(BaseModel):
    type_id:   int
    type_name: str
    quantity:  int


@app.get("/api/warehouse")
def warehouse_list(session: str | None = Cookie(None)):
    char = get_current_character(session)
    return get_warehouse_items(int(char["sub"]))


@app.put("/api/warehouse/items")
def warehouse_set_item(body: WarehouseItemIn, session: str | None = Cookie(None)):
    char = get_current_character(session)
    set_warehouse_item(int(char["sub"]), body.type_id, body.type_name, body.quantity)
    return {"ok": True}


@app.delete("/api/warehouse/items/{type_id}", status_code=204)
def warehouse_delete_item(type_id: int, session: str | None = Cookie(None)):
    char = get_current_character(session)
    delete_warehouse_item(int(char["sub"]), type_id)


# ---------------------------------------------------------------------------
# Shopping list
# ---------------------------------------------------------------------------

class ShoppingItemIn(BaseModel):
    blueprint_type_id: int
    blueprint_name:    str
    product_type_id:   int
    product_name:      str
    runs:              int = 1
    me:                int = 0
    te:                int = 0


class ShoppingItemRunsIn(BaseModel):
    runs: int


@app.get("/api/shopping-list")
def shopping_list_get(session: str | None = Cookie(None)):
    char = get_current_character(session)
    return get_shopping_list(int(char["sub"]))


@app.post("/api/shopping-list/items", status_code=201)
def shopping_list_add(body: ShoppingItemIn, session: str | None = Cookie(None)):
    char = get_current_character(session)
    return add_shopping_list_item(
        int(char["sub"]),
        body.blueprint_type_id, body.blueprint_name,
        body.product_type_id, body.product_name,
        body.runs, body.me, body.te,
    )


@app.patch("/api/shopping-list/items/{item_id}")
def shopping_list_update_runs(
    item_id: int, body: ShoppingItemRunsIn, session: str | None = Cookie(None)
):
    char = get_current_character(session)
    if not update_shopping_list_item_runs(int(char["sub"]), item_id, body.runs):
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


@app.delete("/api/shopping-list/items/{item_id}", status_code=204)
def shopping_list_remove(item_id: int, session: str | None = Cookie(None)):
    char = get_current_character(session)
    if not remove_shopping_list_item(int(char["sub"]), item_id):
        raise HTTPException(status_code=404, detail="Item not found")


@app.delete("/api/shopping-list", status_code=204)
def shopping_list_clear(session: str | None = Cookie(None)):
    char = get_current_character(session)
    clear_shopping_list(int(char["sub"]))


@app.get("/api/shopping-list/materials")
def shopping_list_materials(
    structure_me_bonus: float = Query(0.0, ge=0, le=5),
    session: str | None = Cookie(None),
):
    """
    Compute the total materials needed for the shopping list,
    accounting for warehouse stock.  Returns:
      - materials: [{type_id, name, needed, in_stock, to_buy}]
      - multibuy: plain-text block for EVE's multibuy
    """
    char         = get_current_character(session)
    character_id = int(char["sub"])

    items = get_shopping_list(character_id)
    if not items:
        return {"materials": [], "multibuy": ""}

    bp_ids   = list({item["blueprint_type_id"] for item in items})
    sde_data = get_blueprints_data_batch(bp_ids)

    warehouse = {w["type_id"]: w["quantity"] for w in get_warehouse_items(character_id)}

    # Aggregate required quantities across all list items
    needed: dict[int, dict] = {}  # type_id → {name, qty}
    for item in items:
        data = sde_data.get(item["blueprint_type_id"], {})
        for mat in data.get("materials", []):
            qty = calc_qty_with_me(mat["quantity"], item["me"], structure_me_bonus)
            qty *= item["runs"]
            if mat["type_id"] not in needed:
                needed[mat["type_id"]] = {"name": mat["name"], "qty": 0}
            needed[mat["type_id"]]["qty"] += qty

    materials = []
    multibuy_lines = []
    for type_id, info in sorted(needed.items(), key=lambda x: x[1]["name"]):
        in_stock = warehouse.get(type_id, 0)
        to_buy   = max(0, info["qty"] - in_stock)
        materials.append({
            "type_id":  type_id,
            "name":     info["name"],
            "needed":   info["qty"],
            "in_stock": in_stock,
            "to_buy":   to_buy,
        })
        if to_buy > 0:
            multibuy_lines.append(f"{info['name']} {to_buy}")

    return {
        "materials": materials,
        "multibuy":  "\n".join(multibuy_lines),
    }

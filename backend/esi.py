"""
ESI API client with caching.

Public:  /markets/prices/  /industry/systems/
Auth:    /characters/{id}/blueprints/
"""
import time
import httpx
from database import get_db, _chunk

BASE_URL   = "https://esi.evetech.net/latest"
DATASOURCE = "tranquility"

PRICE_TTL      = 86400  # 24 h
COST_INDEX_TTL = 3600   # 1 h


def _esi_get(path: str, token: str | None = None, params: dict | None = None) -> list | dict:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{BASE_URL}{path}",
            headers=headers,
            params={"datasource": DATASOURCE, **(params or {})},
        )
    resp.raise_for_status()
    return resp.json()


def _esi_get_paged(path: str, token: str | None = None) -> list:
    """Fetch all pages of a paginated ESI endpoint, reusing one HTTP connection."""
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    results = []
    page = 1
    with httpx.Client(timeout=30) as client:
        while True:
            resp = client.get(
                f"{BASE_URL}{path}",
                headers=headers,
                params={"datasource": DATASOURCE, "page": page},
            )
            resp.raise_for_status()
            data = resp.json()
            if not data:
                break
            results.extend(data)
            if page >= int(resp.headers.get("X-Pages", "1")):
                break
            page += 1
    return results


# ---------------------------------------------------------------------------
# Adjusted prices  (EIV base for job cost)
# ---------------------------------------------------------------------------

def get_adjusted_prices() -> dict[int, dict]:
    """Return {type_id: {adjusted_price, average_price}}, cached 24 h."""
    db = get_db()
    row = db.execute("SELECT updated_at FROM adjusted_price_cache LIMIT 1").fetchone()

    if row and (time.time() - row["updated_at"]) < PRICE_TTL:
        rows = db.execute(
            "SELECT type_id, adjusted_price, average_price FROM adjusted_price_cache"
        ).fetchall()
        db.close()
        return {r["type_id"]: {"adjusted_price": r["adjusted_price"],
                               "average_price":  r["average_price"]} for r in rows}

    data = _esi_get("/markets/prices/")
    now  = time.time()
    db.execute("DELETE FROM adjusted_price_cache")
    db.executemany(
        "INSERT INTO adjusted_price_cache (type_id, adjusted_price, average_price, updated_at)"
        " VALUES (?,?,?,?)",
        [(item["type_id"], item.get("adjusted_price", 0.0), item.get("average_price", 0.0), now)
         for item in data],
    )
    db.commit()
    db.close()
    return {item["type_id"]: {"adjusted_price": item.get("adjusted_price", 0.0),
                              "average_price":  item.get("average_price",  0.0)}
            for item in data}


# ---------------------------------------------------------------------------
# Industry cost indices
# ---------------------------------------------------------------------------

def get_manufacturing_cost_index(solar_system_id: int) -> float:
    """Return manufacturing cost index for a system, cached 1 h."""
    db = get_db()
    row = db.execute(
        "SELECT manufacturing_index, updated_at FROM cost_index_cache WHERE solar_system_id = ?",
        (solar_system_id,),
    ).fetchone()

    if row and (time.time() - row["updated_at"]) < COST_INDEX_TTL:
        db.close()
        return row["manufacturing_index"]

    data = _esi_get("/industry/systems/")
    now  = time.time()
    index_map = {}
    for system in data:
        for activity in system.get("cost_indices", []):
            if activity["activity"] == "manufacturing":
                index_map[system["solar_system_id"]] = activity["cost_index"]
                break

    db.executemany(
        "INSERT OR REPLACE INTO cost_index_cache (solar_system_id, manufacturing_index, updated_at)"
        " VALUES (?,?,?)",
        [(sid, idx, now) for sid, idx in index_map.items()],
    )
    db.commit()
    db.close()
    return index_map.get(solar_system_id, 0.0)


# ---------------------------------------------------------------------------
# Character blueprints
# ---------------------------------------------------------------------------

def get_character_blueprints(character_id: int, access_token: str) -> list[dict]:
    """
    Fetch character blueprints from ESI.
    quantity = -1 → BPO (unlimited runs).  me/te are 0-10/0-20.
    """
    raw = _esi_get_paged(f"/characters/{character_id}/blueprints/", token=access_token)
    if not raw:
        return []

    # Batch-resolve all type names in one query
    all_ids = list({bp["type_id"] for bp in raw})
    name_map: dict[int, str] = {}
    db = get_db()
    try:
        for chunk in _chunk(all_ids):
            ph = ",".join("?" * len(chunk))
            for row in db.execute(
                f"SELECT typeID, typeName FROM invTypes WHERE typeID IN ({ph})", chunk
            ).fetchall():
                name_map[row["typeID"]] = row["typeName"]
    finally:
        db.close()

    return [
        {
            "item_id":     bp["item_id"],
            "type_id":     bp["type_id"],
            "type_name":   name_map.get(bp["type_id"], f"Unknown [{bp['type_id']}]"),
            "quantity":    bp["quantity"],
            "me":          bp["material_efficiency"],
            "te":          bp["time_efficiency"],
            "runs":        bp["runs"],
            "location_id": bp["location_id"],
        }
        for bp in raw
    ]

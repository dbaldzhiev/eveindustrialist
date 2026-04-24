"""
ESI API client with caching.

Public:   /markets/prices/  /industry/systems/
Auth:     /characters/{id}/blueprints/
          /characters/{id}/skills/
          /characters/{id}/industry/jobs/
          /characters/{id}/assets/
"""
import time
import httpx
from database import (
    get_db, _chunk,
    get_cached_skills, store_skills,
    get_cached_jobs, store_jobs,
    get_cached_assets, store_assets,
    get_type_names_batch,
)

BASE_URL   = "https://esi.evetech.net/latest"
DATASOURCE = "tranquility"

PRICE_TTL      = 86400  # 24 h
COST_INDEX_TTL = 3600   # 1 h

# Industry skills that affect time / slot counts
# NOTE: skill IDs verified against EVE SDE – update here if they ever change
INDUSTRY_SKILL_IDS = {
    "industry":            3380,   # -4% mfg time per level
    "adv_industry":        3388,   # -3% mfg time per level
    "mass_production":     3387,   # +1 mfg slot per level
    "adv_mass_production": 24625,  # +1 mfg slot per level
    "lab_operation":       3406,   # +1 research slot per level
    "adv_lab_operation":   24624,  # +1 research slot per level
    "mass_reactions":      45748,  # +1 reaction slot per level
    "science":             3402,   # required for copy/invent
}


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
    """Fetch all pages of a paginated ESI endpoint."""
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
    db  = get_db()
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
        "INSERT INTO adjusted_price_cache (type_id, adjusted_price, average_price, updated_at) "
        "VALUES (?,?,?,?)",
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
    db  = get_db()
    row = db.execute(
        "SELECT manufacturing_index, updated_at FROM cost_index_cache WHERE solar_system_id = ?",
        (solar_system_id,),
    ).fetchone()
    if row and (time.time() - row["updated_at"]) < COST_INDEX_TTL:
        db.close()
        return row["manufacturing_index"]

    data      = _esi_get("/industry/systems/")
    now       = time.time()
    index_map = {}
    for system in data:
        for activity in system.get("cost_indices", []):
            if activity["activity"] == "manufacturing":
                index_map[system["solar_system_id"]] = activity["cost_index"]
                break
    db.executemany(
        "INSERT OR REPLACE INTO cost_index_cache (solar_system_id, manufacturing_index, updated_at) "
        "VALUES (?,?,?)",
        [(sid, idx, now) for sid, idx in index_map.items()],
    )
    db.commit()
    db.close()
    return index_map.get(solar_system_id, 0.0)


# ---------------------------------------------------------------------------
# Character blueprints
# ---------------------------------------------------------------------------

def get_character_blueprints(character_id: int, access_token: str) -> list[dict]:
    raw = _esi_get_paged(f"/characters/{character_id}/blueprints/", token=access_token)
    if not raw:
        return []
    all_ids  = list({bp["type_id"] for bp in raw})
    name_map = get_type_names_batch(all_ids)
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
            "character_id": character_id,
        }
        for bp in raw
    ]


# ---------------------------------------------------------------------------
# Character skills
# ---------------------------------------------------------------------------

def get_character_skills(character_id: int, access_token: str) -> dict[int, int]:
    """
    Return {skill_id: trained_level} for industry-relevant skills.
    Results are cached for 1 hour.
    """
    skill_ids = list(INDUSTRY_SKILL_IDS.values())
    cached    = get_cached_skills(character_id, skill_ids)
    if len(cached) == len(skill_ids):
        return cached  # all needed skills are in cache

    # Fetch full skill sheet from ESI
    data   = _esi_get(f"/characters/{character_id}/skills/", token=access_token)
    skills = {s["skill_id"]: s["trained_skill_level"] for s in data.get("skills", [])}
    # Cache all skills returned
    store_skills(character_id, skills)
    # Return only the subset we need
    return {sid: skills.get(sid, 0) for sid in skill_ids}


def get_industry_skill_levels(character_id: int, access_token: str) -> dict[str, int]:
    """Return a named dict of industry skill levels for profitability calculations."""
    raw = get_character_skills(character_id, access_token)
    return {
        name: raw.get(sid, 0)
        for name, sid in INDUSTRY_SKILL_IDS.items()
    }


# ---------------------------------------------------------------------------
# Character industry jobs
# ---------------------------------------------------------------------------

# Activity ID → human-readable name
ACTIVITY_NAMES = {
    1:  "Manufacturing",
    3:  "TE Research",
    4:  "ME Research",
    5:  "Copying",
    8:  "Invention",
    9:  "Reactions",
    11: "Reactions",
}

# Slot categories
MFG_ACTIVITIES      = {1}
RESEARCH_ACTIVITIES = {3, 4, 5, 8}
REACTION_ACTIVITIES = {9, 11}


def get_character_jobs(character_id: int, access_token: str,
                        force_refresh: bool = False) -> list[dict]:
    """
    Return active industry jobs for a character. Cached for 5 minutes.
    """
    if not force_refresh:
        cached = get_cached_jobs(character_id)
        if cached is not None:
            return [j for j in cached if j["status"] == "active"]

    raw = _esi_get(
        f"/characters/{character_id}/industry/jobs/",
        token=access_token,
        params={"include_completed": "false"},
    )
    if not isinstance(raw, list):
        raw = []

    # Resolve type names
    all_type_ids = set()
    for job in raw:
        if job.get("blueprint_type_id"):
            all_type_ids.add(job["blueprint_type_id"])
        if job.get("product_type_id"):
            all_type_ids.add(job["product_type_id"])
    name_map = get_type_names_batch(list(all_type_ids))

    jobs = [
        {
            "job_id":             job["job_id"],
            "activity_id":        job["activity_id"],
            "activity_name":      ACTIVITY_NAMES.get(job["activity_id"], "Unknown"),
            "blueprint_type_id":  job.get("blueprint_type_id"),
            "product_type_id":    job.get("product_type_id"),
            "blueprint_name":     name_map.get(job.get("blueprint_type_id"), ""),
            "product_name":       name_map.get(job.get("product_type_id"), ""),
            "status":             job.get("status", "active"),
            "runs":               job.get("runs", 1),
            "start_date":         job.get("start_date", ""),
            "end_date":           job.get("end_date", ""),
            "duration":           job.get("duration", 0),
        }
        for job in raw
    ]
    store_jobs(character_id, jobs)
    return [j for j in jobs if j["status"] == "active"]


# ---------------------------------------------------------------------------
# Character assets
# ---------------------------------------------------------------------------

def resolve_location_names(
    location_ids: list[int],
    char_tokens: list[str] | None = None,
) -> dict[int, str]:
    """
    Resolve location IDs to display names.

    - NPC station / solar system IDs (< 1 000 000 000 000): public /universe/names/ bulk call.
    - Player structure IDs (>= 1 000 000 000 000): authenticated /universe/structures/{id}/ call.
      Tries each token in char_tokens until one succeeds.
    """
    if not location_ids:
        return {}

    names: dict[int, str] = {}
    npc_ids       = [i for i in location_ids if i < 1_000_000_000_000]
    structure_ids = [i for i in location_ids if i >= 1_000_000_000_000]

    # --- NPC stations / solar systems (public) ---
    if npc_ids:
        try:
            with httpx.Client(timeout=15) as client:
                resp = client.post(
                    f"{BASE_URL}/universe/names/",
                    json=npc_ids,
                    params={"datasource": DATASOURCE},
                    headers={"Accept": "application/json"},
                )
            if resp.is_success:
                for item in resp.json():
                    names[item["id"]] = item["name"]
        except Exception:
            pass

    # --- Player-owned structures (authenticated) ---
    if structure_ids:
        tokens = char_tokens or []
        with httpx.Client(timeout=15) as client:
            for sid in structure_ids:
                resolved = False
                for token in tokens:
                    try:
                        resp = client.get(
                            f"{BASE_URL}/universe/structures/{sid}/",
                            headers={
                                "Accept": "application/json",
                                "Authorization": f"Bearer {token}",
                            },
                            params={"datasource": DATASOURCE},
                        )
                        if resp.is_success:
                            names[sid] = resp.json().get("name", f"Structure #{sid}")
                            resolved = True
                            break
                    except Exception:
                        continue
                if not resolved:
                    names[sid] = f"Player Structure #{sid}"

    return names


def get_character_assets(character_id: int, access_token: str,
                          force_refresh: bool = False) -> list[dict]:
    """
    Return all assets reachable from hangars (stations, player structures, containers).
    Cached 1 hour unless force_refresh=True.

    Strategy: use the parent-child structure of the ESI asset tree rather than
    relying on location_flag or location_type strings, which are unreliable for
    player-owned structures and can vary by context.

    - Top-level items: their location_id is NOT the item_id of any other asset
      (i.e. they sit directly in a station/structure, not inside a ship/container)
    - Containers: top-level items that themselves have children in the data
    - We keep: all top-level items + their direct children (one level deep)
    """
    if not force_refresh:
        cached = get_cached_assets(character_id)
        if cached is not None:
            return cached

    raw = _esi_get_paged(f"/characters/{character_id}/assets/", token=access_token)
    if not raw:
        store_assets(character_id, [])
        return []

    all_item_ids = {item["item_id"] for item in raw}

    # Items whose parent is NOT another asset → directly in a station/structure
    top_level_ids = {
        item["item_id"] for item in raw
        if item["location_id"] not in all_item_ids
    }

    # Top-level items that have at least one child → treat as containers
    parents_of_children = {
        item["location_id"] for item in raw
        if item["location_id"] in top_level_ids
    }
    container_item_ids = top_level_ids & parents_of_children

    # Keep all top-level items + items one level deep inside them
    keep = [
        item for item in raw
        if item["item_id"] in top_level_ids
        or item["location_id"] in top_level_ids
    ]

    all_type_ids = list({item["type_id"] for item in keep})
    name_map     = get_type_names_batch(all_type_ids)

    assets = [
        {
            "item_id":       item["item_id"],
            "type_id":       item["type_id"],
            "type_name":     name_map.get(item["type_id"]) or f"Unknown [{item['type_id']}]",
            "location_id":   item["location_id"],
            "location_type": item.get("location_type", ""),
            "is_container":  item["item_id"] in container_item_ids,
            "quantity":      item.get("quantity", 1),
        }
        for item in keep
    ]

    store_assets(character_id, assets)
    return get_cached_assets(character_id) or []

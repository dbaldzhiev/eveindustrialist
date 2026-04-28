"""
SQLite database setup: app sessions + cached SDE/market data.
SDE tables are populated by setup_sde.py before first run.
"""
import sqlite3
import os
import time as _time

DB_PATH = os.path.join(os.path.dirname(__file__), "eve_industry.db")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        -- Core auth tables
        CREATE TABLE IF NOT EXISTS sessions (
            session_id           TEXT PRIMARY KEY,
            character_id         INTEGER NOT NULL,
            character_name       TEXT    NOT NULL,
            primary_character_id INTEGER,
            access_token         TEXT    NOT NULL,
            refresh_token        TEXT    NOT NULL,
            expires_at           REAL    NOT NULL,
            created_at           REAL    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pkce_state (
            state               TEXT PRIMARY KEY,
            code_verifier       TEXT NOT NULL,
            expires_at          REAL NOT NULL,
            link_to_primary_id  INTEGER
        );

        -- Multi-character grouping
        CREATE TABLE IF NOT EXISTS character_groups (
            primary_character_id  INTEGER NOT NULL,
            member_character_id   INTEGER NOT NULL UNIQUE,
            joined_at             REAL    NOT NULL,
            PRIMARY KEY (primary_character_id, member_character_id)
        );

        -- Market caches
        CREATE TABLE IF NOT EXISTS market_history_cache (
            type_id    INTEGER NOT NULL,
            region_id  INTEGER NOT NULL,
            vol_1d     INTEGER NOT NULL DEFAULT 0,
            vol_7d     INTEGER NOT NULL DEFAULT 0,
            avg_daily  REAL    NOT NULL DEFAULT 0,
            avg_price  REAL    NOT NULL DEFAULT 0,
            trend      TEXT    NOT NULL DEFAULT 'flat',
            fetched_at REAL    NOT NULL,
            PRIMARY KEY (type_id, region_id)
        );
        CREATE TABLE IF NOT EXISTS market_price_cache (
            type_id     INTEGER NOT NULL,
            region_id   INTEGER NOT NULL,
            buy_price   REAL,
            sell_price  REAL,
            updated_at  REAL NOT NULL,
            PRIMARY KEY (type_id, region_id)
        );
        CREATE TABLE IF NOT EXISTS adjusted_price_cache (
            type_id         INTEGER PRIMARY KEY,
            adjusted_price  REAL,
            average_price   REAL,
            updated_at      REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cost_index_cache (
            solar_system_id     INTEGER PRIMARY KEY,
            manufacturing_index REAL,
            updated_at          REAL NOT NULL
        );

        -- User-saved structures
        CREATE TABLE IF NOT EXISTS structures (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            character_id    INTEGER NOT NULL,
            name            TEXT    NOT NULL,
            solar_system_id INTEGER,
            me_bonus        REAL    NOT NULL DEFAULT 0.0,
            te_bonus        REAL    NOT NULL DEFAULT 0.0,
            cost_bonus      REAL    NOT NULL DEFAULT 0.0
        );

        -- Per-user persistent settings (facility + defaults)
        CREATE TABLE IF NOT EXISTS user_settings (
            primary_character_id  INTEGER PRIMARY KEY,
            default_structure_id  INTEGER,
            default_system_id     INTEGER,
            default_price_region  INTEGER NOT NULL DEFAULT 10000002,
            broker_fee            REAL    NOT NULL DEFAULT 0.0368,
            sales_tax             REAL    NOT NULL DEFAULT 0.036,
            facility_tax          REAL    NOT NULL DEFAULT 0.0,
            structure_me_bonus    REAL    NOT NULL DEFAULT 0.0,
            structure_te_bonus    REAL    NOT NULL DEFAULT 0.0,
            structure_cost_bonus  REAL    NOT NULL DEFAULT 0.0,
            industry_level        INTEGER NOT NULL DEFAULT 0,
            adv_industry_level    INTEGER NOT NULL DEFAULT 0,
            runs                  INTEGER NOT NULL DEFAULT 1,
            min_profit            REAL    NOT NULL DEFAULT 0.0,
            material_order_type   TEXT    NOT NULL DEFAULT 'sell',
            product_order_type    TEXT    NOT NULL DEFAULT 'sell',
            warehouse_character_id INTEGER,
            warehouse_location_id  INTEGER,
            warehouse_location_name TEXT,
            reaction_facility_tax REAL    NOT NULL DEFAULT 0.0,
            reaction_me_bonus     REAL    NOT NULL DEFAULT 0.0,
            reaction_te_bonus     REAL    NOT NULL DEFAULT 0.0,
            reaction_cost_bonus   REAL    NOT NULL DEFAULT 0.0
        );

        -- Warehouse (shared per user group)
        CREATE TABLE IF NOT EXISTS warehouse_items (
            character_id    INTEGER NOT NULL,
            type_id         INTEGER NOT NULL,
            type_name       TEXT    NOT NULL,
            quantity        INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (character_id, type_id)
        );

        -- ESI skill cache (per character, TTL 1h)
        CREATE TABLE IF NOT EXISTS skills_cache (
            character_id  INTEGER NOT NULL,
            skill_id      INTEGER NOT NULL,
            trained_level INTEGER NOT NULL DEFAULT 0,
            updated_at    REAL    NOT NULL,
            PRIMARY KEY (character_id, skill_id)
        );

        -- ESI industry jobs cache (per character, TTL 5min)
        CREATE TABLE IF NOT EXISTS jobs_cache (
            character_id      INTEGER NOT NULL,
            job_id            INTEGER NOT NULL,
            blueprint_id      INTEGER,
            activity_id       INTEGER NOT NULL,
            blueprint_type_id INTEGER,
            product_type_id   INTEGER,
            blueprint_name    TEXT,
            product_name      TEXT,
            status            TEXT    NOT NULL,
            runs              INTEGER NOT NULL DEFAULT 1,
            start_date        TEXT,
            end_date          TEXT,
            duration_seconds  INTEGER,
            updated_at        REAL    NOT NULL,
            PRIMARY KEY (character_id, job_id)
        );

        -- ESI asset cache (per character, TTL 1h)
        CREATE TABLE IF NOT EXISTS asset_cache (
            character_id  INTEGER NOT NULL,
            item_id       INTEGER NOT NULL,
            type_id       INTEGER NOT NULL,
            type_name     TEXT    NOT NULL DEFAULT '',
            location_id   INTEGER NOT NULL,
            quantity      INTEGER NOT NULL DEFAULT 1,
            updated_at    REAL    NOT NULL,
            PRIMARY KEY (character_id, item_id)
        );

        -- Plans (named sets of industry jobs)
        CREATE TABLE IF NOT EXISTS plans (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            primary_character_id INTEGER NOT NULL,
            name                 TEXT    NOT NULL,
            created_at           REAL    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS plan_items (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id           INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
            blueprint_type_id INTEGER NOT NULL,
            blueprint_name    TEXT    NOT NULL,
            product_type_id   INTEGER NOT NULL DEFAULT 0,
            product_name      TEXT    NOT NULL DEFAULT '',
            runs              INTEGER NOT NULL DEFAULT 1,
            me                INTEGER NOT NULL DEFAULT 0,
            te                INTEGER NOT NULL DEFAULT 0,
            status            TEXT    NOT NULL DEFAULT 'active',
            character_id      INTEGER
        );
    """)
    conn.commit()
    _migrate(conn)
    conn.close()


def _migrate(conn: sqlite3.Connection):
    """Apply incremental schema migrations (safe to run on every startup)."""
    # Add missing columns to existing tables (ALTER TABLE is idempotent via try/except)
    _add_column_if_missing(conn, "sessions",   "primary_character_id", "INTEGER")
    _add_column_if_missing(conn, "pkce_state", "link_to_primary_id",   "INTEGER")
    # user_settings additions
    _add_column_if_missing(conn, "user_settings", "industry_level",       "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "user_settings", "adv_industry_level",   "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "user_settings", "runs",                 "INTEGER NOT NULL DEFAULT 1")
    _add_column_if_missing(conn, "user_settings", "min_profit",           "REAL    NOT NULL DEFAULT 0.0")
    _add_column_if_missing(conn, "user_settings", "material_order_type",  "TEXT    NOT NULL DEFAULT 'sell'")
    _add_column_if_missing(conn, "user_settings", "product_order_type",   "TEXT    NOT NULL DEFAULT 'sell'")
    _add_column_if_missing(conn, "user_settings", "warehouse_character_id", "INTEGER")
    _add_column_if_missing(conn, "user_settings", "warehouse_location_id",  "INTEGER")
    _add_column_if_missing(conn, "user_settings", "warehouse_location_name", "TEXT")
    _add_column_if_missing(conn, "user_settings", "reaction_facility_tax", "REAL NOT NULL DEFAULT 0.0")
    _add_column_if_missing(conn, "user_settings", "reaction_me_bonus",     "REAL NOT NULL DEFAULT 0.0")
    _add_column_if_missing(conn, "user_settings", "reaction_te_bonus",     "REAL NOT NULL DEFAULT 0.0")
    _add_column_if_missing(conn, "user_settings", "reaction_cost_bonus",   "REAL NOT NULL DEFAULT 0.0")
    _add_column_if_missing(conn, "jobs_cache",    "blueprint_id",          "INTEGER")

    # asset_cache: container + location metadata
    _add_column_if_missing(conn, "asset_cache", "is_container",  "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "asset_cache", "location_type", "TEXT    NOT NULL DEFAULT ''")

    # plan_items: manufacturing status and owner
    _add_column_if_missing(conn, "plan_items", "status", "TEXT NOT NULL DEFAULT 'active'")
    _add_column_if_missing(conn, "plan_items", "character_id", "INTEGER")


    migrations = [
        "UPDATE sessions SET primary_character_id = character_id WHERE primary_character_id IS NULL",
        "UPDATE plan_items SET character_id = (SELECT primary_character_id FROM plans WHERE plans.id = plan_items.plan_id) WHERE character_id IS NULL",
    ]
    for sql in migrations:
        try:
            conn.execute(sql)
        except Exception:
            pass
    conn.commit()


def _add_column_if_missing(conn, table: str, column: str, col_type: str):
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
    except Exception:
        pass  # column already exists


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _chunk(lst: list, size: int = 900) -> list[list]:
    return [lst[i : i + size] for i in range(0, len(lst), size)]


def _query(sql: str, params: tuple = ()) -> list[dict]:
    conn = get_db()
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def _query_one(sql: str, params: tuple = ()) -> dict | None:
    conn = get_db()
    try:
        row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Character group helpers
# ---------------------------------------------------------------------------

def get_group_character_ids(primary_character_id: int) -> list[int]:
    rows = _query(
        "SELECT member_character_id FROM character_groups WHERE primary_character_id = ?",
        (primary_character_id,),
    )
    return [r["member_character_id"] for r in rows]


def get_group_characters(primary_character_id: int) -> list[dict]:
    """Return [{character_id, character_name}] for all members in the group."""
    rows = _query(
        """
        SELECT DISTINCT s.character_id, s.character_name
        FROM   sessions s
        JOIN   character_groups g ON g.member_character_id = s.character_id
        WHERE  g.primary_character_id = ?
        ORDER  BY s.character_name
        """,
        (primary_character_id,),
    )
    return rows


def remove_character_from_group(primary_character_id: int, character_id: int) -> bool:
    """Remove a non-primary character from the group."""
    if character_id == primary_character_id:
        return False  # cannot remove primary
    conn = get_db()
    try:
        cur = conn.execute(
            "DELETE FROM character_groups WHERE primary_character_id=? AND member_character_id=?",
            (primary_character_id, character_id),
        )
        conn.execute("DELETE FROM sessions WHERE character_id = ?", (character_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# User settings helpers
# ---------------------------------------------------------------------------

_SETTINGS_DEFAULTS = {
    "default_structure_id":   None,
    "default_system_id":      None,
    "default_price_region":   10000002,
    "broker_fee":             0.0368,
    "sales_tax":              0.036,
    "facility_tax":           0.0,
    "structure_me_bonus":     0.0,
    "structure_te_bonus":     0.0,
    "structure_cost_bonus":   0.0,
    "runs":                   1,
    "min_profit":             0.0,
    "material_order_type":    "sell",
    "product_order_type":     "sell",
    "warehouse_character_id": None,
    "warehouse_location_id":  None,
    "warehouse_location_name": None,
    "reaction_facility_tax":  0.0,
    "reaction_me_bonus":      0.0,
    "reaction_te_bonus":      0.0,
    "reaction_cost_bonus":    0.0,
}


def get_user_settings(primary_character_id: int) -> dict:
    row = _query_one(
        "SELECT * FROM user_settings WHERE primary_character_id = ?",
        (primary_character_id,),
    )
    if not row:
        return {"primary_character_id": primary_character_id, **_SETTINGS_DEFAULTS}
    # Fill in any missing keys (from migrations) with defaults
    result = dict(_SETTINGS_DEFAULTS)
    result.update(row)
    return result


def upsert_user_settings(primary_character_id: int, **kwargs) -> dict:
    current = get_user_settings(primary_character_id)
    current.update({k: v for k, v in kwargs.items() if k in _SETTINGS_DEFAULTS})
    conn = get_db()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO user_settings
                (primary_character_id, default_structure_id, default_system_id,
                 default_price_region, broker_fee, sales_tax, facility_tax,
                 structure_me_bonus, structure_te_bonus, structure_cost_bonus,
                 runs, min_profit, material_order_type, product_order_type,
                 warehouse_character_id, warehouse_location_id, warehouse_location_name,
                 reaction_facility_tax, reaction_me_bonus, reaction_te_bonus, reaction_cost_bonus)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                primary_character_id,
                current["default_structure_id"],
                current["default_system_id"],
                current["default_price_region"],
                current["broker_fee"],
                current["sales_tax"],
                current["facility_tax"],
                current["structure_me_bonus"],
                current["structure_te_bonus"],
                current["structure_cost_bonus"],
                current["runs"],
                current["min_profit"],
                current["material_order_type"],
                current["product_order_type"],
                current["warehouse_character_id"],
                current["warehouse_location_id"],
                current["warehouse_location_name"],
                current["reaction_facility_tax"],
                current["reaction_me_bonus"],
                current["reaction_te_bonus"],
                current["reaction_cost_bonus"],
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return get_user_settings(primary_character_id)


def clear_market_cache():
    conn = get_db()
    try:
        conn.execute("DELETE FROM market_price_cache")
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# SDE query helpers
# ---------------------------------------------------------------------------

def get_blueprints_data_batch(bp_type_ids: list[int], activity_id: int = 1) -> dict[int, dict]:
    if not bp_type_ids:
        return {}
    result: dict[int, dict] = {
        tid: {"materials": [], "products": [], "time": 3600, "tech_level": 1}
        for tid in bp_type_ids
    }
    conn = get_db()
    try:
        for chunk in _chunk(bp_type_ids):
            ph = ",".join("?" * len(chunk))
            
            # Determine BP tech level: if it's a product of activity 8 (Invention), it's Tech 2
            for row in conn.execute(
                f"SELECT DISTINCT productTypeID FROM industryActivityProducts WHERE productTypeID IN ({ph}) AND activityID = 8",
                chunk
            ).fetchall():
                result[row["productTypeID"]]["tech_level"] = 2

            for row in conn.execute(
                f"""
                SELECT m.typeID AS bp_id, m.materialTypeID AS type_id,
                       t.typeName AS name, m.quantity
                FROM   industryActivityMaterials m
                JOIN   invTypes t ON t.typeID = m.materialTypeID
                WHERE  m.typeID IN ({ph}) AND m.activityID = ?
                """, (*chunk, activity_id),
            ).fetchall():
                result[row["bp_id"]]["materials"].append(
                    {"type_id": row["type_id"], "name": row["name"], "quantity": row["quantity"]}
                )
            
            # For products, we also want to know their tech level
            for row in conn.execute(
                f"""
                SELECT p.typeID AS bp_id, p.productTypeID AS type_id,
                       t.typeName AS name, p.quantity
                FROM   industryActivityProducts p
                JOIN   invTypes t ON t.typeID = p.productTypeID
                WHERE  p.typeID IN ({ph}) AND p.activityID = ?
                """, (*chunk, activity_id),
            ).fetchall():
                # Default tech 1
                prod = {"type_id": row["type_id"], "name": row["name"], "quantity": row["quantity"], "tech_level": 1}
                
                # Check if this product is produced by a BP that is itself an invention product
                # OR if the product name ends with II/III (fallback)
                name = row["name"].lower()
                if " ii " in name or name.endswith(" ii"):
                    prod["tech_level"] = 2
                elif " iii " in name or name.endswith(" iii"):
                    prod["tech_level"] = 3
                
                result[row["bp_id"]]["products"].append(prod)

            for row in conn.execute(
                f"""
                SELECT typeID AS bp_id, time
                FROM   industryActivity
                WHERE  typeID IN ({ph}) AND activityID = ?
                """, (*chunk, activity_id),
            ).fetchall():
                result[row["bp_id"]]["time"] = row["time"]
        
        # Final pass for product tech levels based on their producing blueprints
        all_product_ids = []
        for bp_data in result.values():
            for p in bp_data["products"]:
                all_product_ids.append(p["type_id"])
        
        if all_product_ids:
            invented_products = set()
            for chunk in _chunk(list(set(all_product_ids))):
                ph = ",".join("?" * len(chunk))
                # If the product's blueprint is an invention product, then the product is Tech 2
                # We need to find the BP that produces this product, and check if THAT BP is an invention product
                for row in conn.execute(
                    f"""
                    SELECT DISTINCT p.productTypeID 
                    FROM industryActivityProducts p
                    JOIN industryActivityProducts p_inv ON p_inv.productTypeID = p.typeID
                    WHERE p.productTypeID IN ({ph}) AND p.activityID = 1 AND p_inv.activityID = 8
                    """, chunk
                ).fetchall():
                    invented_products.add(row["productTypeID"])
            
            for bp_data in result.values():
                for p in bp_data["products"]:
                    if p["type_id"] in invented_products:
                        p["tech_level"] = 2
    finally:
        conn.close()
    return result


def get_invention_variants(bp_type_ids: list[int]) -> list[dict]:
    """
    Find T2 blueprint variants that can be invented from the given base BP IDs.
    Returns list of {base_bp_id, result_bp_id, result_bp_name}
    """
    if not bp_type_ids:
        return []
    
    conn = get_db()
    results = []
    try:
        for chunk in _chunk(bp_type_ids):
            ph = ",".join("?" * len(chunk))
            for row in conn.execute(
                f"""
                SELECT p.typeID AS base_bp_id, p.productTypeID AS result_bp_id,
                       t.typeName AS result_bp_name, p.probability
                FROM   industryActivityProducts p
                JOIN   invTypes t ON t.typeID = p.productTypeID
                WHERE  p.typeID IN ({ph}) AND p.activityID = 8
                """, chunk,
            ).fetchall():
                results.append(dict(row))
    finally:
        conn.close()
    return results


def get_blueprint_required_skills_batch(
    type_ids: list[int], activity_id: int
) -> dict[int, list[dict]]:
    """Return {blueprint_type_id: [{skill_id, skill_name, level}]} for the given activity."""
    if not type_ids:
        return {}
    conn = get_db()
    result: dict[int, list[dict]] = {}
    try:
        for chunk in _chunk(type_ids):
            ph = ",".join("?" * len(chunk))
            rows = conn.execute(
                f"""
                SELECT ias.typeID, ias.skillID, t.typeName AS skill_name, ias.level
                FROM   industryActivitySkills ias
                JOIN   invTypes t ON t.typeID = ias.skillID
                WHERE  ias.typeID IN ({ph}) AND ias.activityID = ?
                """,
                (*chunk, activity_id),
            ).fetchall()
            for row in rows:
                tid = row["typeID"]
                if tid not in result:
                    result[tid] = []
                result[tid].append({
                    "skill_id":   row["skillID"],
                    "skill_name": row["skill_name"],
                    "level":      row["level"],
                })
    finally:
        conn.close()
    return result


def get_cached_all_skills_for_characters(character_ids: list[int]) -> dict[int, dict[int, int]]:
    """Return {character_id: {skill_type_id: trained_level}} from local cache."""
    if not character_ids:
        return {}
    conn = get_db()
    result: dict[int, dict[int, int]] = {cid: {} for cid in character_ids}
    try:
        ph = ",".join("?" * len(character_ids))
        for row in conn.execute(
            f"SELECT character_id, skill_id, trained_level FROM skills_cache WHERE character_id IN ({ph})",
            character_ids,
        ).fetchall():
            result[row["character_id"]][row["skill_id"]] = row["trained_level"]
    finally:
        conn.close()
    return result


def get_all_manufacturing_bp_ids() -> list[int]:
    rows = _query(
        """
        SELECT DISTINCT a.typeID
        FROM   industryActivity a
        JOIN   invTypes t ON t.typeID = a.typeID
        WHERE  a.activityID = 1 AND t.published = 1
        """
    )
    return [r["typeID"] for r in rows]


def get_all_reaction_bp_ids() -> list[int]:
    rows = _query(
        """
        SELECT DISTINCT a.typeID
        FROM   industryActivity a
        JOIN   invTypes t ON t.typeID = a.typeID
        WHERE  a.activityID = 11 AND t.published = 1
        """
    )
    return [r["typeID"] for r in rows]


def get_reaction_bp_ids() -> list[int]:
    """Return typeIDs of blueprints that are used for Reactions (activity 11)."""
    rows = _query(
        """
        SELECT DISTINCT typeID FROM industryActivity WHERE activityID = 11
        """
    )
    return [r["typeID"] for r in rows]


def get_type_id_by_name(name: str) -> int | None:
    row = _query_one("SELECT typeID FROM invTypes WHERE typeName = ? AND published = 1", (name,))
    return row["typeID"] if row else None


def get_type_name(type_id: int) -> str | None:
    row = _query_one("SELECT typeName FROM invTypes WHERE typeID = ?", (type_id,))
    return row["typeName"] if row else None


def get_type_names_batch(type_ids: list[int]) -> dict[int, str]:
    if not type_ids:
        return {}
    result: dict[int, str] = {}
    conn = get_db()
    try:
        for chunk in _chunk(type_ids):
            ph = ",".join("?" * len(chunk))
            for row in conn.execute(
                f"SELECT typeID, typeName FROM invTypes WHERE typeID IN ({ph})", chunk
            ).fetchall():
                result[row["typeID"]] = row["typeName"]
    finally:
        conn.close()
    return result


def get_type_volume(type_id: int) -> float:
    """Return packaged volume (m³) for a type, falling back to volume."""
    row = _query_one(
        "SELECT volume, packagedVolume FROM invTypes WHERE typeID = ?", (type_id,)
    )
    if not row:
        return 0.0
    return float(row["packagedVolume"] or row["volume"] or 0.0)


def get_type_volumes_batch(type_ids: list[int]) -> dict[int, float]:
    if not type_ids:
        return {}
    result: dict[int, float] = {}
    conn = get_db()
    try:
        for chunk in _chunk(type_ids):
            ph = ",".join("?" * len(chunk))
            for row in conn.execute(
                f"SELECT typeID, volume, packagedVolume FROM invTypes WHERE typeID IN ({ph})",
                chunk,
            ).fetchall():
                result[row["typeID"]] = float(row["packagedVolume"] or row["volume"] or 0.0)
    finally:
        conn.close()
    return result


def get_type_categories_batch(type_ids: list[int]) -> dict[int, str]:
    if not type_ids:
        return {}
    result: dict[int, str] = {}
    conn = get_db()
    try:
        for chunk in _chunk(type_ids):
            ph = ",".join("?" * len(chunk))
            sql = f"""
                SELECT t.typeID, c.categoryName
                FROM   invTypes t
                JOIN   invGroups g ON g.groupID = t.groupID
                JOIN   invCategories c ON c.categoryID = g.categoryID
                WHERE  t.typeID IN ({ph})
            """
            for row in conn.execute(sql, chunk).fetchall():
                result[row["typeID"]] = row["categoryName"]
    finally:
        conn.close()
    return result


def search_types(query: str, limit: int = 20) -> list[dict]:
    return _query(
        """
        SELECT typeID AS type_id, typeName AS type_name
        FROM   invTypes
        WHERE  typeName LIKE ? AND published = 1
        ORDER  BY typeName
        LIMIT  ?
        """,
        (f"{query}%", limit),
    )


def search_blueprints(query: str, limit: int = 20) -> list[dict]:
    return _query(
        """
        SELECT b.typeID AS blueprint_type_id,
               b.typeName AS blueprint_name,
               p.productTypeID AS product_type_id,
               pt.typeName AS product_name
        FROM   invTypes b
        JOIN   industryActivityProducts p ON p.typeID = b.typeID AND p.activityID = 1
        JOIN   invTypes pt ON pt.typeID = p.productTypeID
        WHERE  pt.typeName LIKE ? AND b.published = 1
        ORDER  BY pt.typeName
        LIMIT  ?
        """,
        (f"%{query}%", limit),
    )


def search_systems(query: str, limit: int = 20) -> list[dict]:
    return _query(
        """
        SELECT s.solarSystemID   AS solar_system_id,
               s.solarSystemName AS name,
               r.regionName      AS region_name,
               s.security        AS security
        FROM   mapSolarSystems s
        JOIN   mapRegions r ON r.regionID = s.regionID
        WHERE  s.solarSystemName LIKE ?
          AND  r.regionID < 11000000
        ORDER  BY s.solarSystemName
        LIMIT  ?
        """,
        (f"{query}%", limit),
    )


def get_regions() -> list[dict]:
    return _query(
        """
        SELECT regionID AS region_id, regionName AS name
        FROM   mapRegions
        WHERE  regionID < 11000000
        ORDER  BY regionName
        """
    )


def get_system_region(solar_system_id: int) -> int | None:
    row = _query_one(
        "SELECT regionID FROM mapSolarSystems WHERE solarSystemID = ?",
        (solar_system_id,),
    )
    return row["regionID"] if row else None


# ---------------------------------------------------------------------------
# Structure helpers
# ---------------------------------------------------------------------------

def get_structures(character_id: int) -> list[dict]:
    return _query(
        "SELECT * FROM structures WHERE character_id = ? ORDER BY id",
        (character_id,),
    )


def create_structure(character_id: int, name: str, solar_system_id: int | None,
                     me_bonus: float, te_bonus: float, cost_bonus: float) -> dict:
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO structures (character_id, name, solar_system_id, me_bonus, te_bonus, cost_bonus) "
            "VALUES (?,?,?,?,?,?)",
            (character_id, name, solar_system_id, me_bonus, te_bonus, cost_bonus),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM structures WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def delete_structure(character_id: int, structure_id: int) -> bool:
    conn = get_db()
    try:
        cur = conn.execute(
            "DELETE FROM structures WHERE id = ? AND character_id = ?",
            (structure_id, character_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Warehouse helpers
# ---------------------------------------------------------------------------

def get_warehouse_items(character_id: int) -> list[dict]:
    return _query(
        "SELECT type_id, type_name, quantity FROM warehouse_items "
        "WHERE character_id = ? ORDER BY type_name",
        (character_id,),
    )


def set_warehouse_item(character_id: int, type_id: int, type_name: str, quantity: int) -> None:
    conn = get_db()
    try:
        if quantity <= 0:
            conn.execute(
                "DELETE FROM warehouse_items WHERE character_id = ? AND type_id = ?",
                (character_id, type_id),
            )
        else:
            conn.execute(
                "INSERT OR REPLACE INTO warehouse_items (character_id, type_id, type_name, quantity) "
                "VALUES (?,?,?,?)",
                (character_id, type_id, type_name, quantity),
            )
        conn.commit()
    finally:
        conn.close()


def merge_warehouse_items(character_id: int, items: list[dict]) -> None:
    """Add quantities to existing warehouse items (for ESI asset import)."""
    conn = get_db()
    try:
        for item in items:
            conn.execute(
                """
                INSERT INTO warehouse_items (character_id, type_id, type_name, quantity)
                VALUES (?,?,?,?)
                ON CONFLICT(character_id, type_id) DO UPDATE SET
                    quantity = quantity + excluded.quantity,
                    type_name = excluded.type_name
                """,
                (character_id, item["type_id"], item["type_name"], item["quantity"]),
            )
        conn.commit()
    finally:
        conn.close()


def delete_warehouse_item(character_id: int, type_id: int) -> None:
    conn = get_db()
    try:
        conn.execute(
            "DELETE FROM warehouse_items WHERE character_id = ? AND type_id = ?",
            (character_id, type_id),
        )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Skills cache helpers
# ---------------------------------------------------------------------------

SKILLS_TTL = 3600  # 1 hour

def get_cached_skills(character_id: int, skill_ids: list[int]) -> dict[int, int]:
    """Return {skill_id: trained_level} from cache. Empty if stale/missing."""
    cutoff = _time.time() - SKILLS_TTL
    rows = _query(
        f"""
        SELECT skill_id, trained_level FROM skills_cache
        WHERE  character_id = ? AND skill_id IN ({','.join('?' * len(skill_ids))})
          AND  updated_at > ?
        """,
        (character_id, *skill_ids, cutoff),
    )
    return {r["skill_id"]: r["trained_level"] for r in rows}


def store_skills(character_id: int, skills: dict[int, int]) -> None:
    """Persist {skill_id: trained_level} to cache."""
    now  = _time.time()
    conn = get_db()
    try:
        conn.executemany(
            "INSERT OR REPLACE INTO skills_cache (character_id, skill_id, trained_level, updated_at) "
            "VALUES (?,?,?,?)",
            [(character_id, sid, lvl, now) for sid, lvl in skills.items()],
        )
        conn.commit()
    finally:
        conn.close()


def clear_skills_cache(character_id: int) -> None:
    conn = get_db()
    try:
        conn.execute("DELETE FROM skills_cache WHERE character_id = ?", (character_id,))
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Jobs cache helpers
# ---------------------------------------------------------------------------

JOBS_TTL = 300  # 5 minutes

def get_cached_jobs(character_id: int) -> list[dict] | None:
    """Return cached jobs list or None if stale."""
    cutoff = _time.time() - JOBS_TTL
    row = _query_one(
        "SELECT updated_at FROM jobs_cache WHERE character_id = ? LIMIT 1",
        (character_id,),
    )
    if not row or row["updated_at"] < cutoff:
        return None
    return _query(
        "SELECT * FROM jobs_cache WHERE character_id = ? ORDER BY end_date",
        (character_id,),
    )


def store_jobs(character_id: int, jobs: list[dict]) -> None:
    now  = _time.time()
    conn = get_db()
    try:
        conn.execute("DELETE FROM jobs_cache WHERE character_id = ?", (character_id,))
        conn.executemany(
            """
            INSERT INTO jobs_cache
                (character_id, job_id, blueprint_id, activity_id, blueprint_type_id,
                 product_type_id, blueprint_name, product_name, status, runs,
                 start_date, end_date, duration_seconds, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            [
                (character_id, j["job_id"], j.get("blueprint_id"),
                 j["activity_id"], j.get("blueprint_type_id"), j.get("product_type_id"),
                 j.get("blueprint_name", ""), j.get("product_name", ""),
                 j["status"], j["runs"], j.get("start_date", ""),
                 j.get("end_date", ""), j.get("duration"), now)
                for j in jobs
            ],
        )
        conn.commit()
    finally:
        conn.close()


def get_active_job_blueprint_ids(char_ids: list[int]) -> set[int]:
    """
    Return the set of blueprint item_ids currently installed in active industry jobs.
    These BPCs are physically in a job slot and cannot be queued again.
    """
    if not char_ids:
        return set()
    conn = get_db()
    try:
        ph   = ",".join("?" * len(char_ids))
        rows = conn.execute(
            f"""
            SELECT blueprint_id FROM jobs_cache
            WHERE  character_id IN ({ph})
              AND  status IN ('active', 'ready', 'paused')
              AND  blueprint_id IS NOT NULL
            """,
            char_ids,
        ).fetchall()
        return {row["blueprint_id"] for row in rows}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Asset cache helpers
# ---------------------------------------------------------------------------

ASSETS_TTL = 3600  # 1 hour

def get_cached_assets(character_id: int) -> list[dict] | None:
    """Return cached assets or None if stale."""
    cutoff = _time.time() - ASSETS_TTL
    row = _query_one(
        "SELECT updated_at FROM asset_cache WHERE character_id = ? LIMIT 1",
        (character_id,),
    )
    if not row or row["updated_at"] < cutoff:
        return None
    return _query(
        "SELECT type_id, type_name, location_id, SUM(quantity) AS quantity "
        "FROM asset_cache WHERE character_id = ? GROUP BY type_id, location_id "
        "ORDER BY type_name",
        (character_id,),
    )


def store_assets(character_id: int, assets: list[dict]) -> None:
    now  = _time.time()
    conn = get_db()
    try:
        conn.execute("DELETE FROM asset_cache WHERE character_id = ?", (character_id,))
        conn.executemany(
            "INSERT INTO asset_cache "
            "(character_id, item_id, type_id, type_name, location_id, quantity, updated_at, is_container, location_type) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            [(character_id, a["item_id"], a["type_id"], a.get("type_name", ""),
              a["location_id"], a["quantity"], now,
              1 if a.get("is_container") else 0,
              a.get("location_type", "")) for a in assets],
        )
        conn.commit()
    finally:
        conn.close()


def get_asset_locations(character_id: int) -> list[dict]:
    """
    Return distinct locations (stations/structures + containers) with item counts.

    Top-level locations are identified by finding location_ids that do NOT
    appear as item_ids in the cache (i.e. they're external IDs like station/structure IDs).
    Containers are top-level items (item_id IS in the cache) that have children.
    """
    # Top-level station/structure locations:
    # location_id values that are NOT item_ids in this character's asset cache
    stations = _query(
        """
        SELECT a.location_id AS loc_id,
               '' AS container_name,
               COUNT(DISTINCT a.type_id) AS type_count,
               SUM(a.quantity)           AS total_quantity,
               0 AS is_container
        FROM   asset_cache a
        WHERE  a.character_id = ?
          AND  a.location_id NOT IN (
                  SELECT item_id FROM asset_cache WHERE character_id = ?
               )
        GROUP  BY a.location_id
        ORDER  BY total_quantity DESC
        """,
        (character_id, character_id),
    )
    # Containers: items whose item_id is itself a parent of other items
    containers = _query(
        """
        SELECT c.item_id      AS loc_id,
               c.type_name    AS container_name,
               COUNT(DISTINCT i.type_id) AS type_count,
               SUM(i.quantity)           AS total_quantity,
               1 AS is_container
        FROM   asset_cache c
        JOIN   asset_cache i ON i.character_id = c.character_id
                             AND i.location_id  = c.item_id
        WHERE  c.character_id = ?
          AND  c.is_container  = 1
        GROUP  BY c.item_id
        ORDER  BY total_quantity DESC
        """,
        (character_id,),
    )
    return stations + containers


def get_assets_at_location(character_id: int, location_id: int) -> list[dict]:
    return _query(
        "SELECT type_id, type_name, SUM(quantity) AS quantity "
        "FROM asset_cache WHERE character_id = ? AND location_id = ? "
        "GROUP BY type_id ORDER BY type_name",
        (character_id, location_id),
    )


# ---------------------------------------------------------------------------
# Plans helpers
# ---------------------------------------------------------------------------

def get_plans(primary_character_id: int) -> list[dict]:
    plans = _query(
        "SELECT p.*, COUNT(i.id) AS item_count FROM plans p "
        "LEFT JOIN plan_items i ON i.plan_id = p.id "
        "WHERE p.primary_character_id = ? GROUP BY p.id ORDER BY p.created_at DESC",
        (primary_character_id,),
    )
    return plans


def create_plan(primary_character_id: int, name: str) -> dict:
    now  = _time.time()
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO plans (primary_character_id, name, created_at) VALUES (?,?,?)",
            (primary_character_id, name, now),
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM plans WHERE id = ?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()


def rename_plan(primary_character_id: int, plan_id: int, name: str) -> bool:
    conn = get_db()
    try:
        cur = conn.execute(
            "UPDATE plans SET name = ? WHERE id = ? AND primary_character_id = ?",
            (name, plan_id, primary_character_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_plan(primary_character_id: int, plan_id: int) -> bool:
    conn = get_db()
    try:
        cur = conn.execute(
            "DELETE FROM plans WHERE id = ? AND primary_character_id = ?",
            (plan_id, primary_character_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def get_plan_items(plan_id: int) -> list[dict]:
    return _query("SELECT * FROM plan_items WHERE plan_id = ? ORDER BY id", (plan_id,))

def add_plan_item(plan_id: int, blueprint_type_id: int, blueprint_name: str,
                   product_type_id: int, product_name: str,
                   runs: int, me: int, te: int, status: str = "active",
                   character_id: int | None = None) -> dict:
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO plan_items (plan_id, blueprint_type_id, blueprint_name, "
            "product_type_id, product_name, runs, me, te, status, character_id) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (plan_id, blueprint_type_id, blueprint_name, product_type_id, product_name, runs, me, te, status, character_id),
        )

        conn.commit()
        return dict(conn.execute("SELECT * FROM plan_items WHERE id = ?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()


def update_plan_item(plan_id: int, item_id: int, runs: int, me: int, te: int, status: str | None = None) -> bool:
    conn = get_db()
    try:
        if status is not None:
            cur = conn.execute(
                "UPDATE plan_items SET runs=?, me=?, te=?, status=? WHERE id=? AND plan_id=?",
                (runs, me, te, status, item_id, plan_id),
            )
        else:
            cur = conn.execute(
                "UPDATE plan_items SET runs=?, me=?, te=? WHERE id=? AND plan_id=?",
                (runs, me, te, item_id, plan_id),
            )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()

def remove_plan_item(plan_id: int, item_id: int) -> bool:
    conn = get_db()
    try:
        cur = conn.execute("DELETE FROM plan_items WHERE id=? AND plan_id=?", (item_id, plan_id))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()

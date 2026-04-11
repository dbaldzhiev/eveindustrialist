"""
SQLite database setup: app sessions + cached SDE/market data.
SDE tables are populated by setup_sde.py before first run.
"""
import sqlite3
import os

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
        CREATE TABLE IF NOT EXISTS sessions (
            session_id      TEXT PRIMARY KEY,
            character_id    INTEGER NOT NULL,
            character_name  TEXT    NOT NULL,
            access_token    TEXT    NOT NULL,
            refresh_token   TEXT    NOT NULL,
            expires_at      REAL    NOT NULL,
            created_at      REAL    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pkce_state (
            state           TEXT PRIMARY KEY,
            code_verifier   TEXT NOT NULL,
            expires_at      REAL NOT NULL
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
        CREATE TABLE IF NOT EXISTS structures (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            character_id    INTEGER NOT NULL,
            name            TEXT    NOT NULL,
            solar_system_id INTEGER,
            me_bonus        REAL    NOT NULL DEFAULT 0.0,
            te_bonus        REAL    NOT NULL DEFAULT 0.0,
            cost_bonus      REAL    NOT NULL DEFAULT 0.0
        );
        CREATE TABLE IF NOT EXISTS warehouse_items (
            character_id    INTEGER NOT NULL,
            type_id         INTEGER NOT NULL,
            type_name       TEXT    NOT NULL,
            quantity        INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (character_id, type_id)
        );
        CREATE TABLE IF NOT EXISTS shopping_list_items (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            character_id        INTEGER NOT NULL,
            blueprint_type_id   INTEGER NOT NULL,
            blueprint_name      TEXT    NOT NULL,
            product_type_id     INTEGER NOT NULL,
            product_name        TEXT    NOT NULL,
            runs                INTEGER NOT NULL DEFAULT 1,
            me                  INTEGER NOT NULL DEFAULT 0,
            te                  INTEGER NOT NULL DEFAULT 0
        );
    """)
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _chunk(lst: list, size: int = 900) -> list[list]:
    """Split list into chunks to stay under SQLite's 999-variable limit."""
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
# SDE query helpers
# ---------------------------------------------------------------------------

def get_blueprints_data_batch(bp_type_ids: list[int]) -> dict[int, dict]:
    """
    Fetch materials, products, and production time for a list of blueprint type IDs
    in three bulk queries instead of N×3 individual queries.
    Returns {bp_type_id: {materials: [...], products: [...], time: int}}.
    """
    if not bp_type_ids:
        return {}

    result: dict[int, dict] = {
        tid: {"materials": [], "products": [], "time": 3600}
        for tid in bp_type_ids
    }

    conn = get_db()
    try:
        for chunk in _chunk(bp_type_ids):
            ph = ",".join("?" * len(chunk))

            for row in conn.execute(
                f"""
                SELECT m.typeID AS bp_id, m.materialTypeID AS type_id,
                       t.typeName AS name, m.quantity
                FROM   industryActivityMaterials m
                JOIN   invTypes t ON t.typeID = m.materialTypeID
                WHERE  m.typeID IN ({ph}) AND m.activityID = 1
                """,
                chunk,
            ).fetchall():
                result[row["bp_id"]]["materials"].append(
                    {"type_id": row["type_id"], "name": row["name"], "quantity": row["quantity"]}
                )

            for row in conn.execute(
                f"""
                SELECT p.typeID AS bp_id, p.productTypeID AS type_id,
                       t.typeName AS name, p.quantity
                FROM   industryActivityProducts p
                JOIN   invTypes t ON t.typeID = p.productTypeID
                WHERE  p.typeID IN ({ph}) AND p.activityID = 1
                """,
                chunk,
            ).fetchall():
                result[row["bp_id"]]["products"].append(
                    {"type_id": row["type_id"], "name": row["name"], "quantity": row["quantity"]}
                )

            for row in conn.execute(
                f"""
                SELECT typeID AS bp_id, time
                FROM   industryActivity
                WHERE  typeID IN ({ph}) AND activityID = 1
                """,
                chunk,
            ).fetchall():
                result[row["bp_id"]]["time"] = row["time"]
    finally:
        conn.close()

    return result


def get_all_manufacturing_bp_ids() -> list[int]:
    """Return all blueprint typeIDs that have a manufacturing activity in the SDE."""
    rows = _query(
        """
        SELECT DISTINCT a.typeID
        FROM   industryActivity a
        JOIN   invTypes t ON t.typeID = a.typeID
        WHERE  a.activityID = 1 AND t.published = 1
        """
    )
    return [r["typeID"] for r in rows]


def get_type_name(type_id: int) -> str | None:
    row = _query_one("SELECT typeName FROM invTypes WHERE typeID = ?", (type_id,))
    return row["typeName"] if row else None


def get_type_names_batch(type_ids: list[int]) -> dict[int, str]:
    """Return {type_id: typeName} for all given IDs."""
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


def search_types(query: str, limit: int = 20) -> list[dict]:
    """Search published types by name prefix (for warehouse item picker)."""
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
    """Search blueprint types by product name substring (for shopping list)."""
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


def create_structure(
    character_id: int,
    name: str,
    solar_system_id: int | None,
    me_bonus: float,
    te_bonus: float,
    cost_bonus: float,
) -> dict:
    conn = get_db()
    try:
        cur = conn.execute(
            """
            INSERT INTO structures (character_id, name, solar_system_id, me_bonus, te_bonus, cost_bonus)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
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
        "SELECT type_id, type_name, quantity FROM warehouse_items WHERE character_id = ? ORDER BY type_name",
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
                """
                INSERT OR REPLACE INTO warehouse_items (character_id, type_id, type_name, quantity)
                VALUES (?, ?, ?, ?)
                """,
                (character_id, type_id, type_name, quantity),
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
# Shopping list helpers
# ---------------------------------------------------------------------------

def get_shopping_list(character_id: int) -> list[dict]:
    return _query(
        "SELECT * FROM shopping_list_items WHERE character_id = ? ORDER BY id",
        (character_id,),
    )


def add_shopping_list_item(
    character_id: int,
    blueprint_type_id: int,
    blueprint_name: str,
    product_type_id: int,
    product_name: str,
    runs: int,
    me: int,
    te: int,
) -> dict:
    conn = get_db()
    try:
        cur = conn.execute(
            """
            INSERT INTO shopping_list_items
                (character_id, blueprint_type_id, blueprint_name,
                 product_type_id, product_name, runs, me, te)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (character_id, blueprint_type_id, blueprint_name,
             product_type_id, product_name, runs, me, te),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM shopping_list_items WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return dict(row)
    finally:
        conn.close()


def update_shopping_list_item_runs(character_id: int, item_id: int, runs: int) -> bool:
    conn = get_db()
    try:
        cur = conn.execute(
            "UPDATE shopping_list_items SET runs = ? WHERE id = ? AND character_id = ?",
            (runs, item_id, character_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def remove_shopping_list_item(character_id: int, item_id: int) -> bool:
    conn = get_db()
    try:
        cur = conn.execute(
            "DELETE FROM shopping_list_items WHERE id = ? AND character_id = ?",
            (item_id, character_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def clear_shopping_list(character_id: int) -> None:
    conn = get_db()
    try:
        conn.execute("DELETE FROM shopping_list_items WHERE character_id = ?", (character_id,))
        conn.commit()
    finally:
        conn.close()

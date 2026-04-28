"""
SDE setup script – download and import the official CCP EVE Static Data Export.

Download URL: https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip

Run once before starting the app:
    python setup_sde.py

The official SDE uses JSONL format. This script extracts the following files from
the zip and imports them into SQLite using the same table schemas as before, so
the rest of the application needs no changes.

Files consumed:
    types.jsonl              – type names, volumes, categories
    blueprints.jsonl         – all blueprint activities (manufacturing, reactions, etc.)
    mapSolarSystems.jsonl    – solar systems
    mapRegions.jsonl         – regions
    groups.jsonl             – item groups
    categories.jsonl         – item categories
"""
import io
import json
import os
import sqlite3
import time
import urllib.request
import zipfile
from pathlib import Path

DB_PATH = Path(__file__).parent / "eve_industry.db"
SDE_URL = "https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip"

# EVE activity IDs
ACTIVITY_IDS = {
    "manufacturing":     1,
    "research_time":     3,
    "research_material": 4,
    "copying":           5,
    "invention":         8,
    "reaction":          11,
}

TABLE_SQL = {
    "invTypes": """
        CREATE TABLE IF NOT EXISTS invTypes (
            typeID          INTEGER PRIMARY KEY,
            groupID         INTEGER,
            typeName        TEXT,
            volume          REAL,
            packagedVolume  REAL,
            portionSize     INTEGER,
            published       INTEGER,
            marketGroupID   INTEGER
        )
    """,
    "industryActivity": """
        CREATE TABLE IF NOT EXISTS industryActivity (
            typeID      INTEGER,
            activityID  INTEGER,
            time        INTEGER,
            PRIMARY KEY (typeID, activityID)
        )
    """,
    "industryActivityMaterials": """
        CREATE TABLE IF NOT EXISTS industryActivityMaterials (
            typeID          INTEGER,
            activityID      INTEGER,
            materialTypeID  INTEGER,
            quantity        INTEGER,
            PRIMARY KEY (typeID, activityID, materialTypeID)
        )
    """,
    "industryActivityProducts": """
        CREATE TABLE IF NOT EXISTS industryActivityProducts (
            typeID          INTEGER,
            activityID      INTEGER,
            productTypeID   INTEGER,
            quantity        INTEGER,
            probability     REAL,
            PRIMARY KEY (typeID, activityID, productTypeID)
        )
    """,
    "mapSolarSystems": """
        CREATE TABLE IF NOT EXISTS mapSolarSystems (
            regionID         INTEGER,
            constellationID  INTEGER,
            solarSystemID    INTEGER PRIMARY KEY,
            solarSystemName  TEXT,
            security         REAL
        )
    """,
    "mapRegions": """
        CREATE TABLE IF NOT EXISTS mapRegions (
            regionID    INTEGER PRIMARY KEY,
            regionName  TEXT
        )
    """,
    "invGroups": """
        CREATE TABLE IF NOT EXISTS invGroups (
            groupID     INTEGER PRIMARY KEY,
            categoryID  INTEGER,
            groupName   TEXT,
            published   INTEGER
        )
    """,
    "invCategories": """
        CREATE TABLE IF NOT EXISTS invCategories (
            categoryID    INTEGER PRIMARY KEY,
            categoryName  TEXT,
            published     INTEGER
        )
    """,
    "industryActivitySkills": """
        CREATE TABLE IF NOT EXISTS industryActivitySkills (
            typeID      INTEGER,
            activityID  INTEGER,
            skillID     INTEGER,
            level       INTEGER,
            PRIMARY KEY (typeID, activityID, skillID)
        )
    """,
}

INDEX_SQL = [
    "CREATE INDEX IF NOT EXISTS idx_iam_typeid    ON industryActivityMaterials (typeID, activityID)",
    "CREATE INDEX IF NOT EXISTS idx_iap_typeid    ON industryActivityProducts   (typeID, activityID)",
    "CREATE INDEX IF NOT EXISTS idx_ia_typeid     ON industryActivity           (typeID, activityID)",
    "CREATE INDEX IF NOT EXISTS idx_inv_name      ON invTypes (typeName)",
    "CREATE INDEX IF NOT EXISTS idx_sys_name      ON mapSolarSystems (solarSystemName)",
    "CREATE INDEX IF NOT EXISTS idx_sys_region    ON mapSolarSystems (regionID)",
    "CREATE INDEX IF NOT EXISTS idx_ias_typeid    ON industryActivitySkills (typeID, activityID)",
]


def download_sde() -> bytes:
    print(f"Downloading SDE zip from:\n  {SDE_URL}", flush=True)
    t0 = time.time()
    req = urllib.request.Request(SDE_URL, headers={"User-Agent": "EVEIndustrialist/1.0"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        total = resp.headers.get("Content-Length")
        chunks = []
        downloaded = 0
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            chunks.append(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded / int(total) * 100
                print(f"\r  {downloaded/1024/1024:.1f} / {int(total)/1024/1024:.1f} MB ({pct:.0f}%)", end="", flush=True)
    data = b"".join(chunks)
    print(f"\n  Done: {len(data)/1024/1024:.1f} MB in {time.time()-t0:.1f}s")
    return data


def find_and_read_jsonl(zf: zipfile.ZipFile, filename: str) -> list[dict]:
    """Find filename anywhere in the zip (handles subdirectories) and parse JSONL."""
    matches = [n for n in zf.namelist() if n.endswith("/" + filename) or n == filename]
    if not matches:
        print(f"  WARNING: {filename} not found in zip – skipping")
        return []
    name = matches[0]
    print(f"  Reading {name} ...", end=" ", flush=True)
    t0 = time.time()
    with zf.open(name) as f:
        raw = f.read().decode("utf-8")
    records = [json.loads(line) for line in raw.splitlines() if line.strip()]
    print(f"{len(records):,} records in {time.time()-t0:.1f}s")
    return records


def import_types(conn: sqlite3.Connection, rows: list[dict]):
    conn.execute("DROP TABLE IF EXISTS invTypes")
    conn.execute(TABLE_SQL["invTypes"])
    data = []
    for r in rows:
        data.append((
            r["_key"],
            r.get("groupID"),
            r.get("name", {}).get("en"),
            r.get("volume"),
            r.get("repackagedVolume"),   # official SDE field; maps to packagedVolume
            r.get("portionSize", 1),
            1 if r.get("published", False) else 0,
            r.get("marketGroupID"),
        ))
    conn.executemany(
        "INSERT OR IGNORE INTO invTypes"
        " (typeID, groupID, typeName, volume, packagedVolume, portionSize, published, marketGroupID)"
        " VALUES (?,?,?,?,?,?,?,?)",
        data,
    )
    print(f"  Imported {len(data):,} rows into invTypes")


def import_blueprints(conn: sqlite3.Connection, rows: list[dict]):
    for tbl in ("industryActivity", "industryActivityMaterials",
                "industryActivityProducts", "industryActivitySkills"):
        conn.execute(f"DROP TABLE IF EXISTS {tbl}")
        conn.execute(TABLE_SQL[tbl])

    act_rows, mat_rows, prod_rows, skill_rows = [], [], [], []

    for r in rows:
        bp_id      = r["blueprintTypeID"]
        activities = r.get("activities", {})

        for act_name, act_id in ACTIVITY_IDS.items():
            act = activities.get(act_name)
            if not act:
                continue

            act_rows.append((bp_id, act_id, act.get("time", 0)))

            for mat in act.get("materials", []):
                mat_rows.append((bp_id, act_id, mat["typeID"], mat["quantity"]))

            for prod in act.get("products", []):
                prod_rows.append((bp_id, act_id, prod["typeID"], prod["quantity"], prod.get("probability")))

            for skill in act.get("skills", []):
                skill_rows.append((bp_id, act_id, skill["typeID"], skill["level"]))

    conn.executemany(
        "INSERT OR IGNORE INTO industryActivity (typeID, activityID, time) VALUES (?,?,?)",
        act_rows,
    )
    conn.executemany(
        "INSERT OR IGNORE INTO industryActivityMaterials"
        " (typeID, activityID, materialTypeID, quantity) VALUES (?,?,?,?)",
        mat_rows,
    )
    conn.executemany(
        "INSERT OR IGNORE INTO industryActivityProducts"
        " (typeID, activityID, productTypeID, quantity, probability) VALUES (?,?,?,?,?)",
        prod_rows,
    )
    conn.executemany(
        "INSERT OR IGNORE INTO industryActivitySkills"
        " (typeID, activityID, skillID, level) VALUES (?,?,?,?)",
        skill_rows,
    )
    print(
        f"  Imported {len(act_rows):,} activities, {len(mat_rows):,} materials, "
        f"{len(prod_rows):,} products, {len(skill_rows):,} skills"
    )


def import_solar_systems(conn: sqlite3.Connection, rows: list[dict]):
    conn.execute("DROP TABLE IF EXISTS mapSolarSystems")
    conn.execute(TABLE_SQL["mapSolarSystems"])
    data = [
        (
            r.get("regionID"),
            r.get("constellationID"),
            r["_key"],
            r.get("name", {}).get("en"),
            r.get("securityStatus"),
        )
        for r in rows
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO mapSolarSystems"
        " (regionID, constellationID, solarSystemID, solarSystemName, security)"
        " VALUES (?,?,?,?,?)",
        data,
    )
    print(f"  Imported {len(data):,} rows into mapSolarSystems")


def import_regions(conn: sqlite3.Connection, rows: list[dict]):
    conn.execute("DROP TABLE IF EXISTS mapRegions")
    conn.execute(TABLE_SQL["mapRegions"])
    data = [(r["_key"], r.get("name", {}).get("en")) for r in rows]
    conn.executemany(
        "INSERT OR IGNORE INTO mapRegions (regionID, regionName) VALUES (?,?)",
        data,
    )
    print(f"  Imported {len(data):,} rows into mapRegions")


def import_groups(conn: sqlite3.Connection, rows: list[dict]):
    conn.execute("DROP TABLE IF EXISTS invGroups")
    conn.execute(TABLE_SQL["invGroups"])
    data = [
        (
            r["_key"],
            r.get("categoryID"),
            r.get("name", {}).get("en"),
            1 if r.get("published", False) else 0,
        )
        for r in rows
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO invGroups (groupID, categoryID, groupName, published) VALUES (?,?,?,?)",
        data,
    )
    print(f"  Imported {len(data):,} rows into invGroups")


def import_categories(conn: sqlite3.Connection, rows: list[dict]):
    conn.execute("DROP TABLE IF EXISTS invCategories")
    conn.execute(TABLE_SQL["invCategories"])
    data = [
        (
            r["_key"],
            r.get("name", {}).get("en"),
            1 if r.get("published", False) else 0,
        )
        for r in rows
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO invCategories (categoryID, categoryName, published) VALUES (?,?,?)",
        data,
    )
    print(f"  Imported {len(data):,} rows into invCategories")


def main():
    print("=" * 60)
    print("EVE Industrialist – SDE Setup (official CCP SDE)")
    print("=" * 60)

    zip_data = download_sde()

    print("\nOpening zip archive...")
    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        all_files = zf.namelist()
        print(f"  {len(all_files)} files in archive")

        conn = sqlite3.connect(str(DB_PATH))
        conn.execute("PRAGMA journal_mode=WAL")

        print("\n[types]")
        rows = find_and_read_jsonl(zf, "types.jsonl")
        if rows:
            conn.execute("BEGIN")
            import_types(conn, rows)
            conn.commit()

        print("\n[blueprints]")
        rows = find_and_read_jsonl(zf, "blueprints.jsonl")
        if rows:
            conn.execute("BEGIN")
            import_blueprints(conn, rows)
            conn.commit()

        print("\n[mapSolarSystems]")
        rows = find_and_read_jsonl(zf, "mapSolarSystems.jsonl")
        if rows:
            conn.execute("BEGIN")
            import_solar_systems(conn, rows)
            conn.commit()

        print("\n[mapRegions]")
        rows = find_and_read_jsonl(zf, "mapRegions.jsonl")
        if rows:
            conn.execute("BEGIN")
            import_regions(conn, rows)
            conn.commit()

        print("\n[groups]")
        rows = find_and_read_jsonl(zf, "groups.jsonl")
        if rows:
            conn.execute("BEGIN")
            import_groups(conn, rows)
            conn.commit()

        print("\n[categories]")
        rows = find_and_read_jsonl(zf, "categories.jsonl")
        if rows:
            conn.execute("BEGIN")
            import_categories(conn, rows)
            conn.commit()

        conn.close()

    print("\nBuilding indexes...")
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    for sql in INDEX_SQL:
        conn.execute(sql)
    conn.commit()
    conn.close()

    print("\nDone! SDE data is ready.\n")


if __name__ == "__main__":
    main()

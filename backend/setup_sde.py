#!/usr/bin/env python3
"""
SDE setup script – download Fuzzwork CSV dumps and import into SQLite.

Run once before starting the app:
    python setup_sde.py

Tables imported (from https://www.fuzzwork.co.uk/dump/latest/):
    invTypes                     – type names and volumes
    industryActivity             – activities per blueprint (manufacturing time)
    industryActivityMaterials    – materials required per activity
    industryActivityProducts     – products made per activity
    mapSolarSystems              – solar system → region mapping
    mapRegions                   – region names
"""
import bz2
import csv
import io
import os
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

DB_PATH = Path(__file__).parent / "eve_industry.db"
BASE_URL = "https://www.fuzzwork.co.uk/dump/latest/"

TABLES = {
    "invTypes": {
        "filename": "invTypes.csv.bz2",
        "columns":  ["typeID", "groupID", "typeName", "volume", "packagedVolume",
                     "portionSize", "published", "marketGroupID"],
        "create": """
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
    },
    "industryActivity": {
        "filename": "industryActivity.csv.bz2",
        "columns":  ["typeID", "activityID", "time"],
        "create": """
            CREATE TABLE IF NOT EXISTS industryActivity (
                typeID      INTEGER,
                activityID  INTEGER,
                time        INTEGER,
                PRIMARY KEY (typeID, activityID)
            )
        """,
    },
    "industryActivityMaterials": {
        "filename": "industryActivityMaterials.csv.bz2",
        "columns":  ["typeID", "activityID", "materialTypeID", "quantity"],
        "create": """
            CREATE TABLE IF NOT EXISTS industryActivityMaterials (
                typeID          INTEGER,
                activityID      INTEGER,
                materialTypeID  INTEGER,
                quantity        INTEGER,
                PRIMARY KEY (typeID, activityID, materialTypeID)
            )
        """,
    },
    "industryActivityProducts": {
        "filename": "industryActivityProducts.csv.bz2",
        "columns":  ["typeID", "activityID", "productTypeID", "quantity"],
        "create": """
            CREATE TABLE IF NOT EXISTS industryActivityProducts (
                typeID          INTEGER,
                activityID      INTEGER,
                productTypeID   INTEGER,
                quantity        INTEGER,
                PRIMARY KEY (typeID, activityID, productTypeID)
            )
        """,
    },
    "mapSolarSystems": {
        "filename": "mapSolarSystems.csv.bz2",
        "columns":  ["regionID", "constellationID", "solarSystemID",
                     "solarSystemName", "security"],
        "create": """
            CREATE TABLE IF NOT EXISTS mapSolarSystems (
                regionID         INTEGER,
                constellationID  INTEGER,
                solarSystemID    INTEGER PRIMARY KEY,
                solarSystemName  TEXT,
                security         REAL
            )
        """,
    },
    "mapRegions": {
        "filename": "mapRegions.csv.bz2",
        "columns":  ["regionID", "regionName"],
        "create": """
            CREATE TABLE IF NOT EXISTS mapRegions (
                regionID    INTEGER PRIMARY KEY,
                regionName  TEXT
            )
        """,
    },
    "invGroups": {
        "filename": "invGroups.csv.bz2",
        "columns":  ["groupID", "categoryID", "groupName", "published"],
        "create": """
            CREATE TABLE IF NOT EXISTS invGroups (
                groupID     INTEGER PRIMARY KEY,
                categoryID  INTEGER,
                groupName   TEXT,
                published   INTEGER
            )
        """,
    },
    "invCategories": {
        "filename": "invCategories.csv.bz2",
        "columns":  ["categoryID", "categoryName", "published"],
        "create": """
            CREATE TABLE IF NOT EXISTS invCategories (
                categoryID    INTEGER PRIMARY KEY,
                categoryName  TEXT,
                published     INTEGER
            )
        """,
    },
}

INDEX_SQL = [
    "CREATE INDEX IF NOT EXISTS idx_iam_typeid    ON industryActivityMaterials (typeID, activityID)",
    "CREATE INDEX IF NOT EXISTS idx_iap_typeid    ON industryActivityProducts   (typeID, activityID)",
    "CREATE INDEX IF NOT EXISTS idx_ia_typeid     ON industryActivity           (typeID, activityID)",
    "CREATE INDEX IF NOT EXISTS idx_inv_name      ON invTypes (typeName)",
    "CREATE INDEX IF NOT EXISTS idx_sys_name      ON mapSolarSystems (solarSystemName)",
    "CREATE INDEX IF NOT EXISTS idx_sys_region    ON mapSolarSystems (regionID)",
]


def download_csv(table_name: str, info: dict) -> list[dict]:
    url = BASE_URL + info["filename"]
    print(f"  Downloading {url} ...", end=" ", flush=True)
    t0 = time.time()

    try:
        with urllib.request.urlopen(url, timeout=120) as resp:
            compressed = resp.read()
    except Exception as e:
        print(f"FAILED: {e}")
        return []

    raw = bz2.decompress(compressed).decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(raw))

    header = next(reader, None)
    if header is None:
        print("empty file")
        return []

    # Map CSV columns to the ones we want (in order)
    col_map = {col: idx for idx, col in enumerate(header)}
    rows = []
    for row in reader:
        record = {}
        for col in info["columns"]:
            if col in col_map:
                record[col] = row[col_map[col]] if col_map[col] < len(row) else None
            else:
                record[col] = None
        rows.append(record)

    print(f"done ({len(rows):,} rows, {time.time()-t0:.1f}s)")
    return rows


def import_table(conn: sqlite3.Connection, table_name: str, info: dict, rows: list[dict]):
    if not rows:
        return
    conn.execute(f"DROP TABLE IF EXISTS {table_name}")
    conn.execute(info["create"])
    cols   = info["columns"]
    ph     = ",".join("?" * len(cols))
    sql    = f"INSERT OR IGNORE INTO {table_name} ({','.join(cols)}) VALUES ({ph})"

    def coerce(val):
        if val in (None, "", "None"):
            return None
        return val

    conn.executemany(sql, [[coerce(r[c]) for c in cols] for r in rows])
    print(f"  Imported {len(rows):,} rows into {table_name}")


def main():
    print("=" * 60)
    print("EVE Industrialist – SDE Setup")
    print("=" * 60)

    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")

    for table_name, info in TABLES.items():
        print(f"\n[{table_name}]")
        rows = download_csv(table_name, info)
        if rows:
            conn.execute("BEGIN")
            import_table(conn, table_name, info, rows)
            conn.commit()
        else:
            print(f"  WARNING: No data for {table_name} – skipping")

    print("\nBuilding indexes...")
    for sql in INDEX_SQL:
        conn.execute(sql)
    conn.commit()
    conn.close()

    print("\nDone! SDE data is ready.\n")


if __name__ == "__main__":
    main()

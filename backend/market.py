"""
Market price fetching via Fuzzwork aggregates API, cached in SQLite (30 min TTL).
Market history fetching via ESI public API, cached in SQLite (6 h TTL).

Fuzzwork URL: https://market.fuzzwork.co.uk/aggregates/?region=10000002&types=34,35,36
ESI history:  GET /markets/{region_id}/history/?type_id={type_id}
"""
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import httpx
from database import get_db, _chunk

FUZZWORK_URL = "https://market.fuzzwork.co.uk/aggregates/"
CACHE_TTL    = 1800   # 30 minutes
BATCH_SIZE   = 100    # Fuzzwork request limit

ESI_HISTORY_URL  = "https://esi.evetech.net/latest/markets/{region_id}/history/"
HISTORY_TTL      = 6 * 3600   # 6 hours
HISTORY_WORKERS  = 20          # concurrent ESI requests


def get_market_prices(type_ids: list[int], region_id: int, force_refresh: bool = False) -> dict[int, dict]:
    """
    Return {type_id: {buy: float, sell: float}}.
    buy  = best buy-order price (95th percentile)
    sell = cheapest sell-order price (5th percentile)
    """
    if not type_ids:
        return {}

    db     = get_db()
    cutoff = 0 if force_refresh else (time.time() - CACHE_TTL)

    # Cache check — chunked to respect SQLite's 999-variable limit
    result: dict[int, dict] = {}
    for chunk in _chunk(type_ids):
        ph   = ",".join("?" * len(chunk))
        rows = db.execute(
            f"""
            SELECT type_id, buy_price, sell_price
            FROM   market_price_cache
            WHERE  type_id IN ({ph}) AND region_id = ? AND updated_at > ?
            """,
            (*chunk, region_id, cutoff),
        ).fetchall()
        result.update({r["type_id"]: {"buy":  r["buy_price"]  or 0.0,
                                       "sell": r["sell_price"] or 0.0}
                       for r in rows})

    missing = [tid for tid in type_ids if tid not in result]
    if missing:
        fetched = _fetch_from_fuzzwork(missing, region_id)
        now     = time.time()
        db.executemany(
            "INSERT OR REPLACE INTO market_price_cache"
            " (type_id, region_id, buy_price, sell_price, updated_at) VALUES (?,?,?,?,?)",
            [(tid, region_id, p["buy"], p["sell"], now) for tid, p in fetched.items()],
        )
        db.commit()
        result.update(fetched)

    db.close()
    return result


def _fetch_from_fuzzwork(type_ids: list[int], region_id: int) -> dict[int, dict]:
    result = {}
    for i in range(0, len(type_ids), BATCH_SIZE):
        batch = type_ids[i : i + BATCH_SIZE]
        try:
            resp = httpx.get(
                FUZZWORK_URL,
                params={"region": region_id, "types": ",".join(map(str, batch))},
                timeout=15,
            )
            resp.raise_for_status()
            for tid_str, prices in resp.json().items():
                result[int(tid_str)] = {
                    "buy":  float(prices["buy"]["percentile"]  or 0),
                    "sell": float(prices["sell"]["min"]        or 0),
                }
        except Exception:
            for tid in batch:
                result.setdefault(tid, {"buy": 0.0, "sell": 0.0})
    return result


# ---------------------------------------------------------------------------
# Market history stats (daily volume + price trend) via ESI public endpoint
# ---------------------------------------------------------------------------

def get_market_history_stats(type_ids: list[int], region_id: int) -> dict[int, dict]:
    """
    Return {type_id: {vol_1d, vol_7d, avg_daily, avg_price, trend}} for each type.
    Results are cached for HISTORY_TTL seconds; stale types are fetched concurrently.
    """
    if not type_ids:
        return {}

    conn       = get_db()
    now        = time.time()
    cutoff     = now - HISTORY_TTL
    type_ids   = list(set(type_ids))

    # Check which types are already cached and fresh
    cached: dict[int, dict] = {}
    stale: list[int] = []
    for chunk in _chunk(type_ids):
        ph   = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT type_id, vol_1d, vol_7d, avg_daily, avg_price, trend, fetched_at "
            f"FROM market_history_cache WHERE type_id IN ({ph}) AND region_id = ?",
            (*chunk, region_id),
        ).fetchall()
        fresh_ids = set()
        for row in rows:
            if row["fetched_at"] > cutoff:
                cached[row["type_id"]] = {
                    "vol_1d":    row["vol_1d"],
                    "vol_7d":    row["vol_7d"],
                    "avg_daily": row["avg_daily"],
                    "avg_price": row["avg_price"],
                    "trend":     row["trend"],
                }
                fresh_ids.add(row["type_id"])
        stale.extend(tid for tid in chunk if tid not in fresh_ids)

    # Fetch stale/missing from ESI concurrently
    if stale:
        fetched: dict[int, dict] = {}
        with ThreadPoolExecutor(max_workers=HISTORY_WORKERS) as pool:
            futures = {pool.submit(_fetch_esi_history, tid, region_id): tid for tid in stale}
            for future in as_completed(futures):
                tid    = futures[future]
                rows   = future.result()
                stats  = _compute_history_stats(rows)
                fetched[tid] = stats
                cached[tid]  = stats

        # Batch-write all fetched results in one transaction
        conn.executemany(
            "INSERT OR REPLACE INTO market_history_cache "
            "(type_id, region_id, vol_1d, vol_7d, avg_daily, avg_price, trend, fetched_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            [
                (tid, region_id,
                 s["vol_1d"], s["vol_7d"], s["avg_daily"], s["avg_price"], s["trend"], now)
                for tid, s in fetched.items()
            ],
        )
        conn.commit()

    conn.close()
    return cached


def _fetch_esi_history(type_id: int, region_id: int) -> list[dict]:
    """Fetch all available daily history from ESI for one type. Returns [] on error."""
    try:
        resp = httpx.get(
            ESI_HISTORY_URL.format(region_id=region_id),
            params={"type_id": type_id, "datasource": "tranquility"},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return []


def _compute_history_stats(rows: list[dict]) -> dict:
    """Compute aggregated stats from ESI history rows (any order)."""
    _EMPTY = {"vol_1d": 0, "vol_7d": 0, "avg_daily": 0.0, "avg_price": 0.0, "trend": "flat"}
    if not rows:
        return _EMPTY

    # Sort descending by date; only look at the most recent 14 days
    rows = sorted(rows, key=lambda r: r["date"], reverse=True)[:14]

    vol_1d    = rows[0].get("volume", 0) if rows else 0
    last7     = rows[:7]
    vol_7d    = sum(r.get("volume", 0) for r in last7)
    avg_daily = vol_7d / 7.0

    prices7   = [r.get("average", 0.0) for r in last7 if r.get("average", 0)]
    avg_price = sum(prices7) / len(prices7) if prices7 else 0.0

    # Trend: compare avg price of the 3 most-recent days vs the 4 days before that
    trend = "flat"
    if len(rows) >= 7:
        recent_prices = [r.get("average", 0.0) for r in rows[:3]  if r.get("average")]
        prior_prices  = [r.get("average", 0.0) for r in rows[3:7] if r.get("average")]
        if recent_prices and prior_prices:
            recent_avg = sum(recent_prices) / len(recent_prices)
            prior_avg  = sum(prior_prices)  / len(prior_prices)
            if prior_avg > 0:
                change = (recent_avg - prior_avg) / prior_avg
                if   change >  0.02: trend = "up"
                elif change < -0.02: trend = "down"

    return {
        "vol_1d":    int(vol_1d),
        "vol_7d":    int(vol_7d),
        "avg_daily": round(avg_daily, 1),
        "avg_price": round(avg_price, 2),
        "trend":     trend,
    }

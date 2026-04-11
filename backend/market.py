"""
Market price fetching via Fuzzwork aggregates API, cached in SQLite (30 min TTL).

URL: https://market.fuzzwork.co.uk/aggregates/?region=10000002&types=34,35,36
Returns: buy percentile (95th) and sell percentile (5th) per type.
"""
import time
import httpx
from database import get_db, _chunk

FUZZWORK_URL = "https://market.fuzzwork.co.uk/aggregates/"
CACHE_TTL    = 1800   # 30 minutes
BATCH_SIZE   = 100    # Fuzzwork request limit


def get_market_prices(type_ids: list[int], region_id: int) -> dict[int, dict]:
    """
    Return {type_id: {buy: float, sell: float}}.
    buy  = best buy-order price (95th percentile)
    sell = cheapest sell-order price (5th percentile)
    """
    if not type_ids:
        return {}

    db     = get_db()
    cutoff = time.time() - CACHE_TTL

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
                    "sell": float(prices["sell"]["percentile"] or 0),
                }
        except Exception:
            for tid in batch:
                result.setdefault(tid, {"buy": 0.0, "sell": 0.0})
    return result

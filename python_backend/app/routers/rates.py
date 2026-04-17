from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.database import get_db
from app.config import settings
from app.middleware.auth import require_auth, require_roles
from app.models.support import Support

router = APIRouter(prefix="/api/rates", tags=["rates"])

require_manager_up = require_roles("SUPERADMIN", "MANAGER", "EX_ADMIN")

SUPPORTED_COINS = ["BTC", "LTC", "XMR", "USDT"]


# ---------------------------------------------------------------------------
# Helpers — внешние API (порт логики из RateService.js)
# ---------------------------------------------------------------------------

async def _fetch_usdt_rub(position: int = 3) -> float:
    payload = {
        "userId": "", "tokenId": "USDT", "currencyId": "RUB",
        "payment": [], "paymentPeriod": [], "side": "1",
        "size": "10", "page": "1", "amount": "", "canTrade": False,
        "itemRegion": 1, "sortType": "OVERALL_RANKING",
        "bulkMaker": True, "vaMaker": False, "verificationFilter": 0,
    }
    headers = {
        "User-Agent": "Mozilla/5.0", "Accept": "application/json",
        "lang": "en", "origin": "https://www.bybit.com",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(settings.BYBIT_P2P_API_URL, json=payload, headers=headers)
        resp.raise_for_status()
    items = resp.json().get("result", {}).get("items", [])
    if not items or len(items) < position:
        raise ValueError(f"Bybit P2P: недостаточно объявлений (нужна позиция {position})")
    price = float(items[position - 1]["price"])
    if price <= 0:
        raise ValueError("Bybit P2P: некорректная цена USDT/RUB")
    return price


async def _fetch_spot_ask(symbol: str) -> float:
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json",
               "lang": "en", "origin": "https://www.bybit.com"}
    url = f"{settings.BYBIT_API_BASE.rstrip('/')}/v5/market/tickers"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(url, params={"category": "spot", "symbol": symbol}, headers=headers)
        resp.raise_for_status()
    data = resp.json()
    if data.get("retCode") != 0:
        raise ValueError(f"Bybit spot error for {symbol}: {data.get('retMsg')}")
    items = data.get("result", {}).get("list", [])
    if not items:
        raise ValueError(f"Bybit spot: нет данных для {symbol}")
    ask = float(items[0]["ask1Price"])
    if ask <= 0:
        raise ValueError(f"Bybit spot: некорректная цена {symbol}")
    return ask


async def _fetch_xmr_usdt_kraken() -> float:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(settings.KRAKEN_API_URL, params={"pair": "XMRUSDT"},
                                headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
        resp.raise_for_status()
    data = resp.json()
    if data.get("error"):
        raise ValueError(f"Kraken error: {data['error']}")
    result = data.get("result", {})
    pair_data = next(iter(result.values()), None)
    if not pair_data:
        raise ValueError("Kraken: нет данных XMRUSDT")
    ask = float(pair_data["a"][0])
    if ask <= 0:
        raise ValueError("Kraken: некорректная цена XMR/USDT")
    return ask


# ---------------------------------------------------------------------------
# GET /  — курсы (публично)
# ---------------------------------------------------------------------------

@router.get("/")
async def get_rates(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(text("SELECT * FROM rates ORDER BY coin"))
    rates = [dict(r._mapping) for r in rows]
    # нормализуем: строки с coin='' и src in (rapira/manual/default) → USDT
    result = []
    for r in rates:
        if r.get("coin") == "" and r.get("src", "").lower() in ("rapira", "manual", "default"):
            r = {**r, "coin": "USDT"}
        if r.get("coin"):
            result.append(r)
    return result


# ---------------------------------------------------------------------------
# GET /quotes  — котировки с учётом комиссий (публично)
# ---------------------------------------------------------------------------

@router.get("/quotes")
async def get_quotes(db: AsyncSession = Depends(get_db)):
    rates_rows = await db.execute(text("SELECT coin, rate_rub FROM rates"))
    rates_map: dict = {}
    for r in rates_rows:
        coin = r.coin or ""
        if not coin and r.rate_rub:
            coin = "USDT"
        if coin:
            rates_map[coin] = float(r.rate_rub)

    fees_rows = await db.execute(text("SELECT coin, buy_fee, sell_fee FROM fees ORDER BY bot_id LIMIT 4"))
    fees_map: dict = {}
    for f in fees_rows:
        if f.coin not in fees_map:
            fees_map[f.coin] = {"buy_fee": float(f.buy_fee), "sell_fee": float(f.sell_fee)}

    quotes = {}
    for coin in SUPPORTED_COINS:
        rate = rates_map.get(coin)
        if rate is None:
            continue
        fee = fees_map.get(coin, {"buy_fee": 0.02, "sell_fee": 0.02})
        quotes[coin] = {
            "rate_rub": rate,
            "buy_rate": rate * (1 + fee["buy_fee"]),
            "sell_rate": rate * (1 - fee["sell_fee"]),
        }
    return quotes


# ---------------------------------------------------------------------------
# GET /settings  — настройки курсов (только admin)
# ---------------------------------------------------------------------------

@router.get("/settings")
async def get_rate_settings(
    current_user: Support = Depends(require_manager_up),
    db: AsyncSession = Depends(get_db),
):
    return await get_rates(db)


# ---------------------------------------------------------------------------
# POST /refresh  — принудительное обновление с бирж (только admin)
# ---------------------------------------------------------------------------

@router.post("/refresh")
async def refresh_rates(
    current_user: Support = Depends(require_manager_up),
    db: AsyncSession = Depends(get_db),
):
    try:
        usdt_rub = await _fetch_usdt_rub(position=3)
        btc_usdt, ltc_usdt, xmr_usdt = await _asyncio_gather(
            _fetch_spot_ask("BTCUSDT"),
            _fetch_spot_ask("LTCUSDT"),
            _fetch_xmr_usdt_kraken(),
        )
    except Exception as e:
        raise HTTPException(500, f"Ошибка получения курсов: {e}")

    market = {
        "USDT": usdt_rub,
        "BTC": btc_usdt * usdt_rub,
        "LTC": ltc_usdt * usdt_rub,
        "XMR": xmr_usdt * usdt_rub,
    }

    updated = []
    skipped = []
    for coin, rate_rub in market.items():
        row = await db.execute(text("SELECT is_manual FROM rates WHERE coin = :coin"), {"coin": coin})
        existing = row.mappings().one_or_none()
        if existing and existing["is_manual"] == 1:
            skipped.append(coin)
            continue
        await db.execute(text("""
            INSERT INTO rates (coin, rate_rub, src, is_manual, manual_rate_rub)
            VALUES (:coin, :rate_rub, :src, 0, NULL)
            ON DUPLICATE KEY UPDATE rate_rub = VALUES(rate_rub), src = VALUES(src), updated_at = NOW()
        """), {"coin": coin, "rate_rub": rate_rub, "src": "bybit_kraken" if coin != "USDT" else "bybit_p2p"})
        updated.append({"coin": coin, "rate_rub": rate_rub})

    return {
        "success": True,
        "updated_count": len(updated),
        "skipped_manual": skipped,
        "rates": updated,
        "usdt_to_rub": usdt_rub,
        "rate_source": "bybit_p2p + bybit_spot + kraken",
    }


async def _asyncio_gather(*coros):
    import asyncio
    return await asyncio.gather(*coros)


# ---------------------------------------------------------------------------
# PUT /{coin}/manual  — ручной курс
# ---------------------------------------------------------------------------

@router.put("/{coin}/manual")
async def set_manual_rate(
    coin: str,
    body: dict,
    current_user: Support = Depends(require_manager_up),
    db: AsyncSession = Depends(get_db),
):
    coin = coin.upper()
    if coin not in SUPPORTED_COINS:
        raise HTTPException(400, "Unsupported coin")
    rate_rub = body.get("rate_rub")
    try:
        rate_rub = float(rate_rub)
        assert rate_rub > 0
    except Exception:
        raise HTTPException(400, "rate_rub must be a positive number")

    await db.execute(text("""
        INSERT INTO rates (coin, rate_rub, manual_rate_rub, is_manual, src)
        VALUES (:coin, :rate_rub, :rate_rub, 1, 'manual')
        ON DUPLICATE KEY UPDATE
            rate_rub = VALUES(rate_rub),
            manual_rate_rub = VALUES(manual_rate_rub),
            is_manual = 1, src = 'manual', updated_at = NOW()
    """), {"coin": coin, "rate_rub": rate_rub})

    row = await db.execute(text("SELECT * FROM rates WHERE coin = :coin"), {"coin": coin})
    return dict(row.mappings().one())


# ---------------------------------------------------------------------------
# DELETE /{coin}/manual  — отключить ручной курс
# ---------------------------------------------------------------------------

@router.delete("/{coin}/manual")
async def disable_manual_rate(
    coin: str,
    current_user: Support = Depends(require_manager_up),
    db: AsyncSession = Depends(get_db),
):
    coin = coin.upper()
    if coin not in SUPPORTED_COINS:
        raise HTTPException(400, "Unsupported coin")

    src_default = "rapira" if coin == "USDT" else "binance"
    await db.execute(text("""
        UPDATE rates
        SET is_manual = 0, manual_rate_rub = NULL,
            src = CASE WHEN src = 'manual' THEN :src_default ELSE src END,
            updated_at = NOW()
        WHERE coin = :coin
    """), {"coin": coin, "src_default": src_default})

    row = await db.execute(text("SELECT * FROM rates WHERE coin = :coin"), {"coin": coin})
    updated = row.mappings().one_or_none()
    return dict(updated) if updated else {"coin": coin}

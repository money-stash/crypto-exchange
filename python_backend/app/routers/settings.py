import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

logger = logging.getLogger(__name__)

from app.database import get_db
from app.middleware.auth import require_roles
from app.models.support import Support

router = APIRouter(prefix="/api/settings", tags=["settings"])

OPERATOR_TAKE_KEY_1 = "operator_take_start_message_1"
OPERATOR_TAKE_KEY_2 = "operator_take_start_message_2"
CHAT_QUICK_REPLIES_KEY = "operator_chat_quick_replies"


async def _get_setting(db: AsyncSession, key: str, default: str = "") -> str:
    row = await db.execute(text("SELECT value FROM system_settings WHERE `key` = :key"), {"key": key})
    r = row.fetchone()
    return r[0] if r else default


async def _set_setting(db: AsyncSession, key: str, value: str) -> None:
    await db.execute(text("""
        INSERT INTO system_settings (`key`, value) VALUES (:key, :val)
        ON DUPLICATE KEY UPDATE value = :val
    """), {"key": key, "val": value})


def _normalize_quick_replies(raw) -> list:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(r) for r in raw if r]
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(r) for r in parsed if r]
    except Exception:
        pass
    return []


# ── GET /finance ──────────────────────────────────────────────────────────────
@router.get("/finance")
async def get_finance_settings(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    wallet = await _get_setting(db, "company_usdt_wallet_trc20", "")
    msg1 = await _get_setting(db, OPERATOR_TAKE_KEY_1, "")
    msg2 = await _get_setting(db, OPERATOR_TAKE_KEY_2, "")
    return {
        "company_usdt_wallet_trc20": wallet,
        "operator_take_start_message_1": msg1,
        "operator_take_start_message_2": msg2,
    }


# ── PUT /finance ──────────────────────────────────────────────────────────────
@router.put("/finance")
async def update_finance_settings(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    wallet = str(body.get("company_usdt_wallet_trc20") or "").strip()
    msg1 = str(body.get("operator_take_start_message_1") or "")
    msg2 = str(body.get("operator_take_start_message_2") or "")

    await _set_setting(db, "company_usdt_wallet_trc20", wallet)
    await _set_setting(db, OPERATOR_TAKE_KEY_1, msg1)
    await _set_setting(db, OPERATOR_TAKE_KEY_2, msg2)
    await db.commit()

    return {
        "message": "Finance settings updated",
        "company_usdt_wallet_trc20": wallet,
        "operator_take_start_message_1": msg1,
        "operator_take_start_message_2": msg2,
    }


# ── GET /chat-quick-replies ───────────────────────────────────────────────────
@router.get("/chat-quick-replies")
async def get_chat_quick_replies(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("OPERATOR", "MANAGER", "SUPERADMIN")),
):
    raw = await _get_setting(db, CHAT_QUICK_REPLIES_KEY, "")
    return {"operator_chat_quick_replies": _normalize_quick_replies(raw)}


# ── PUT /chat-quick-replies ───────────────────────────────────────────────────
@router.put("/chat-quick-replies")
async def update_chat_quick_replies(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("MANAGER", "SUPERADMIN")),
):
    normalized = _normalize_quick_replies(body.get("operator_chat_quick_replies", []))
    await _set_setting(db, CHAT_QUICK_REPLIES_KEY, json.dumps(normalized, ensure_ascii=False))
    await db.commit()
    return {"message": "Chat quick replies updated", "operator_chat_quick_replies": normalized}


# ── Crypto wallets ────────────────────────────────────────────────────────────

class WalletSetRequest(BaseModel):
    mnemonic: str  # BIP39 seed phrase


class WalletToggleRequest(BaseModel):
    is_active: bool


@router.get("/crypto-wallets")
async def get_crypto_wallets(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    """Список кошельков (только адреса, без сид-фраз)."""
    from app.services.crypto_wallet_service import list_wallets
    return await list_wallets(db)


@router.put("/crypto-wallets/{coin}")
async def set_crypto_wallet(
    coin: str,
    body: WalletSetRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    """Установить (или заменить) сид-фразу для монеты. Возвращает деривированный адрес."""
    from app.services.crypto_wallet_service import set_wallet
    try:
        address = await set_wallet(coin.upper(), body.mnemonic, db)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return {"success": True, "coin": coin.upper(), "address": address}


@router.patch("/crypto-wallets/{coin}/toggle")
async def toggle_crypto_wallet(
    coin: str,
    body: WalletToggleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    """Включить / отключить авто-выдачу для монеты без удаления сид-фразы."""
    from app.services.crypto_wallet_service import toggle_wallet, SUPPORTED_COINS
    if coin.upper() not in SUPPORTED_COINS:
        raise HTTPException(400, f"Монета {coin} не поддерживается")
    await toggle_wallet(coin.upper(), body.is_active, db)
    await db.commit()
    return {"success": True, "coin": coin.upper(), "is_active": body.is_active}


@router.post("/crypto-wallets/{coin}/re-derive")
async def re_derive_crypto_wallet(
    coin: str,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    """Пересчитать адрес из сохранённой сид-фразы (BIP84). Нужно запустить после обновления кода."""
    from app.services.crypto_wallet_service import get_active_mnemonic, SUPPORTED_COINS, decrypt_seed
    from app.services.crypto_wallet_service import _derive_address_sync, _addr_key

    coin = coin.upper()
    if coin not in SUPPORTED_COINS:
        raise HTTPException(400, f"Монета {coin} не поддерживается")

    mnemonic = await get_active_mnemonic(coin, db)
    if not mnemonic:
        # Try even if inactive
        from app.services.crypto_wallet_service import _get_setting, _seed_key, decrypt_seed as _dec
        enc = await _get_setting(db, _seed_key(coin))
        if not enc:
            raise HTTPException(404, "Кошелёк не настроен")
        mnemonic = _dec(enc)

    new_address = _derive_address_sync(coin, mnemonic)
    await db.execute(
        text("INSERT INTO system_settings (`key`, value) VALUES (:k, :v) ON DUPLICATE KEY UPDATE value = :v"),
        {"k": _addr_key(coin), "v": new_address},
    )
    await db.commit()
    return {"success": True, "coin": coin, "address": new_address}


@router.delete("/crypto-wallets/{coin}")
async def delete_crypto_wallet(
    coin: str,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    """Удалить кошелёк (сид-фраза и адрес стираются из БД)."""
    from app.services.crypto_wallet_service import remove_wallet
    await remove_wallet(coin.upper(), db)
    await db.commit()
    return {"success": True, "coin": coin.upper()}


@router.get("/crypto-wallets/{coin}/balance")
async def get_crypto_wallet_balance(
    coin: str,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    """Получить баланс горячего кошелька через blockstream.info."""
    import httpx
    from app.services.crypto_wallet_service import SUPPORTED_COINS

    coin = coin.upper()
    if coin not in SUPPORTED_COINS:
        raise HTTPException(400, f"Монета {coin} не поддерживается")

    address = await _get_setting(db, f"crypto_wallet_address_{coin}")
    if not address:
        raise HTTPException(404, "Кошелёк не настроен")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"https://blockstream.info/api/address/{address}")
            resp.raise_for_status()
            data = resp.json()

        chain = data.get("chain_stats", {})
        mempool = data.get("mempool_stats", {})

        funded = chain.get("funded_txo_sum", 0) + mempool.get("funded_txo_sum", 0)
        spent = chain.get("spent_txo_sum", 0) + mempool.get("spent_txo_sum", 0)
        balance_sat = funded - spent
        balance_btc = balance_sat / 1e8

        return {
            "coin": coin,
            "address": address,
            "balance_sat": balance_sat,
            "balance_btc": round(balance_btc, 8),
        }
    except httpx.HTTPError as e:
        logger.error(f"Ошибка получения баланса {coin}: {e}")
        raise HTTPException(502, "Не удалось получить баланс от blockstream.info")


# ── Cashier deposit wallet addresses ─────────────────────────────────────────

CASHIER_DEPOSIT_COINS = ["BTC", "LTC", "USDT"]
CASHIER_DEPOSIT_KEY = "cashier_deposit_wallet_{coin}"


class CashierDepositWalletRequest(BaseModel):
    address: str


@router.get("/cashier-deposit-wallets")
async def get_cashier_deposit_wallets(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    wallets = {}
    for coin in CASHIER_DEPOSIT_COINS:
        addr = await _get_setting(db, CASHIER_DEPOSIT_KEY.format(coin=coin))
        wallets[coin] = addr or None
    return {"wallets": wallets}


@router.put("/cashier-deposit-wallets/{coin}")
async def set_cashier_deposit_wallet(
    coin: str,
    body: CashierDepositWalletRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    coin = coin.upper()
    if coin not in CASHIER_DEPOSIT_COINS:
        raise HTTPException(400, f"Монета {coin} не поддерживается. Допустимые: {', '.join(CASHIER_DEPOSIT_COINS)}")
    address = (body.address or "").strip()
    await _set_setting(db, CASHIER_DEPOSIT_KEY.format(coin=coin), address)
    await db.commit()
    return {"success": True, "coin": coin, "address": address or None}


@router.delete("/cashier-deposit-wallets/{coin}")
async def delete_cashier_deposit_wallet(
    coin: str,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    coin = coin.upper()
    if coin not in CASHIER_DEPOSIT_COINS:
        raise HTTPException(400, f"Монета {coin} не поддерживается")
    await _set_setting(db, CASHIER_DEPOSIT_KEY.format(coin=coin), "")
    await db.commit()
    return {"success": True, "coin": coin}

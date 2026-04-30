"""
Requisite service — save and load user requisites (encrypted).
Crypto addresses are stored by coin kind (BTC/LTC/XMR/USDT).
Card requisites are stored as JSON: {"card": "...", "bank": "...", "fio": "..."}.
"""
import logging

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.utils.crypto import aes_encrypt, aes_decrypt

logger = logging.getLogger(__name__)


async def save_requisite(
    user_id: int,
    bot_id: int,
    kind: str,
    value: str,
    transaction_type: str,
) -> None:
    """Encrypt and save requisite. Skips if identical value already exists."""
    encrypted = aes_encrypt(value)
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            text("""
                SELECT id, value_cipher FROM requisites
                WHERE user_id = :uid AND bot_id = :bid AND kind = :kind AND transaction_type = :tt
                ORDER BY created_at DESC LIMIT 10
            """),
            {"uid": user_id, "bid": bot_id, "kind": kind, "tt": transaction_type},
        )
        for row in rows:
            try:
                if aes_decrypt(bytes(row.value_cipher)) == value:
                    return  # already saved
            except Exception:
                pass

        await db.execute(
            text("""
                INSERT INTO requisites (user_id, bot_id, kind, value_cipher, transaction_type, is_display)
                VALUES (:uid, :bid, :kind, :vc, :tt, 1)
            """),
            {
                "uid": user_id,
                "bid": bot_id,
                "kind": kind,
                "vc": encrypted,
                "tt": transaction_type,
            },
        )
        await db.commit()


async def get_requisites(
    user_id: int,
    bot_id: int,
    kind: str,
    transaction_type: str,
) -> list[dict]:
    """Return decrypted requisites. Each item: {id, value}."""
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            text("""
                SELECT id, value_cipher FROM requisites
                WHERE user_id = :uid AND bot_id = :bid AND kind = :kind
                  AND transaction_type = :tt AND is_display = 1
                ORDER BY created_at DESC LIMIT 5
            """),
            {"uid": user_id, "bid": bot_id, "kind": kind, "tt": transaction_type},
        )
        result = []
        for row in rows:
            try:
                value = aes_decrypt(bytes(row.value_cipher))
                result.append({"id": row.id, "value": value})
            except Exception as e:
                logger.warning(f"Failed to decrypt requisite {row.id}: {e}")
        return result

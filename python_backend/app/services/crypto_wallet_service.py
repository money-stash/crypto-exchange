"""
Crypto wallet service — управление горячими кошельками обменника для авто-выдачи.

Сид-фразы хранятся в system_settings в зашифрованном виде (AES-256-GCM).
При подтверждении оплаты кассиром — бэкенд сам отправляет крипту клиенту.

Поддерживаемые монеты: BTC
"""

import asyncio
import base64
import logging
import os
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

logger = logging.getLogger(__name__)

SUPPORTED_COINS = ["BTC"]


# ── AES шифрование ────────────────────────────────────────────────────────────

def _aes_key() -> bytes:
    """32 байта из AES_KEY_HEX."""
    return bytes.fromhex(settings.AES_KEY_HEX)[:32]


def encrypt_seed(seed_phrase: str) -> str:
    """Шифрует сид-фразу AES-256-GCM. Возвращает base64(nonce + ciphertext)."""
    key = _aes_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, seed_phrase.encode("utf-8"), None)
    return base64.b64encode(nonce + ct).decode("ascii")


def decrypt_seed(encrypted_b64: str) -> str:
    """Расшифровывает сид-фразу."""
    key = _aes_key()
    aesgcm = AESGCM(key)
    data = base64.b64decode(encrypted_b64)
    nonce, ct = data[:12], data[12:]
    return aesgcm.decrypt(nonce, ct, None).decode("utf-8")


# ── HD деривация адреса ───────────────────────────────────────────────────────

def _seed_from_mnemonic(mnemonic: str) -> bytes:
    """BIP39 мнемоника → 64-байтовый seed."""
    from bip_utils import Bip39SeedGenerator, Bip39Mnemonic  # type: ignore
    m = Bip39Mnemonic.FromString(mnemonic)
    return Bip39SeedGenerator(m).Generate()


def _derive_address_sync(coin: str, mnemonic: str) -> str:
    """Деривация нативного SegWit адреса из BIP39-мнемоники (BIP84 m/84'/0'/0'/0/0)."""
    from bip_utils import Bip84, Bip84Coins, Bip44Changes  # type: ignore

    coin_map = {
        "BTC": Bip84Coins.BITCOIN,
    }
    bip_coin = coin_map[coin]
    seed_bytes = _seed_from_mnemonic(mnemonic)
    ctx = (
        Bip84.FromSeed(seed_bytes, bip_coin)
        .Purpose()
        .Coin()
        .Account(0)
        .Change(Bip44Changes.CHAIN_EXT)
        .AddressIndex(0)
    )
    return ctx.PublicKey().ToAddress()


def _validate_mnemonic(mnemonic: str) -> bool:
    try:
        from bip_utils import Bip39MnemonicValidator, Bip39Languages  # type: ignore
        validator = Bip39MnemonicValidator(Bip39Languages.ENGLISH)
        return validator.IsValid(mnemonic)
    except Exception:
        return False


# ── DB хранение ───────────────────────────────────────────────────────────────

def _seed_key(coin: str) -> str:
    return f"crypto_wallet_seed_{coin}"


def _addr_key(coin: str) -> str:
    return f"crypto_wallet_address_{coin}"


def _active_key(coin: str) -> str:
    return f"crypto_wallet_active_{coin}"


async def _get_setting(db: AsyncSession, key: str) -> Optional[str]:
    row = await db.execute(
        text("SELECT value FROM system_settings WHERE `key` = :k"), {"k": key}
    )
    rec = row.fetchone()
    return rec[0] if rec else None


async def _set_setting(db: AsyncSession, key: str, value: str) -> None:
    await db.execute(
        text("""
            INSERT INTO system_settings (`key`, value)
            VALUES (:k, :v)
            ON DUPLICATE KEY UPDATE value = :v
        """),
        {"k": key, "v": value},
    )


# ── Публичные функции ─────────────────────────────────────────────────────────

async def list_wallets(db: AsyncSession) -> list[dict]:
    """Список кошельков (адреса, без сид-фраз)."""
    result = []
    for coin in SUPPORTED_COINS:
        addr = await _get_setting(db, _addr_key(coin))
        active_raw = await _get_setting(db, _active_key(coin))
        has_seed = bool(await _get_setting(db, _seed_key(coin)))
        result.append({
            "coin": coin,
            "configured": has_seed,
            "address": addr if has_seed else None,
            "is_active": (active_raw or "1") == "1" if has_seed else False,
        })
    return result


async def set_wallet(coin: str, mnemonic: str, db: AsyncSession) -> str:
    """
    Сохраняет зашифрованную сид-фразу и деривированный адрес.
    Возвращает адрес кошелька.
    Бросает ValueError при невалидной мнемонике или неподдерживаемой монете.
    """
    coin = coin.upper()
    if coin not in SUPPORTED_COINS:
        raise ValueError(f"Монета {coin} не поддерживается для авто-выдачи")

    mnemonic = mnemonic.strip()
    if not _validate_mnemonic(mnemonic):
        raise ValueError("Неверная BIP39 сид-фраза")

    address = _derive_address_sync(coin, mnemonic)
    encrypted = encrypt_seed(mnemonic)

    await _set_setting(db, _seed_key(coin), encrypted)
    await _set_setting(db, _addr_key(coin), address)
    await _set_setting(db, _active_key(coin), "1")

    return address


async def remove_wallet(coin: str, db: AsyncSession) -> None:
    """Удаляет кошелёк из настроек."""
    coin = coin.upper()
    for key in [_seed_key(coin), _addr_key(coin), _active_key(coin)]:
        await db.execute(
            text("DELETE FROM system_settings WHERE `key` = :k"), {"k": key}
        )


async def toggle_wallet(coin: str, is_active: bool, db: AsyncSession) -> None:
    """Включает / отключает авто-выдачу для монеты без удаления сида."""
    coin = coin.upper()
    await _set_setting(db, _active_key(coin), "1" if is_active else "0")


async def get_active_mnemonic(coin: str, db: AsyncSession) -> Optional[str]:
    """
    Возвращает расшифрованную сид-фразу если кошелёк настроен и активен,
    иначе None.
    """
    active_raw = await _get_setting(db, _active_key(coin))
    if (active_raw or "1") != "1":
        return None

    encrypted = await _get_setting(db, _seed_key(coin))
    if not encrypted:
        return None

    try:
        return decrypt_seed(encrypted)
    except Exception as e:
        logger.error(f"Не удалось расшифровать сид для {coin}: {e}")
        return None


# ── Отправка транзакций ───────────────────────────────────────────────────────

def _send_btc_sync(mnemonic: str, to_address: str, amount_btc: float) -> str:
    """
    Синхронная отправка BTC с нативного SegWit кошелька (P2WPKH, bc1q...).
    Деривация: BIP84 m/84'/0'/0'/0/0.
    UTXOs и broadcast — через blockstream.info.
    """
    import requests  # type: ignore
    from embit import bip32 as _bip32  # type: ignore
    from embit import script as scr  # type: ignore
    from embit.transaction import Transaction, TransactionInput, TransactionOutput  # type: ignore
    from embit.networks import NETWORKS  # type: ignore

    # ── 1. Деривация ключа BIP84 ─────────────────────────────────────────────
    seed_bytes = _seed_from_mnemonic(mnemonic)
    root = _bip32.HDKey.from_seed(seed_bytes)
    child = root.derive("m/84h/0h/0h/0/0")
    priv = child.key
    pub = priv.get_public_key()
    addr_script = scr.p2wpkh(pub)
    from_address = addr_script.address(NETWORKS["main"])

    # ── 2. Получение UTXOs ───────────────────────────────────────────────────
    resp = requests.get(
        f"https://blockstream.info/api/address/{from_address}/utxo",
        timeout=15,
    )
    resp.raise_for_status()
    all_utxos = resp.json()
    # Confirmed UTXOs приоритетнее, но unconfirmed (сдача от наших же tx) тоже допустимы
    confirmed = [u for u in all_utxos if u.get("status", {}).get("confirmed", False)]
    utxos = confirmed if confirmed else all_utxos
    if not utxos:
        raise ValueError("На кошельке нет средств для отправки.")

    amount_sat = int(round(amount_btc * 1e8))
    fee_sat = 1500  # ~1500 sat (~10 sat/vbyte для P2WPKH tx)

    # ── 3. Выбор входов ──────────────────────────────────────────────────────
    selected: list[dict] = []
    selected_total = 0
    for u in sorted(utxos, key=lambda x: x["value"], reverse=True):
        selected.append(u)
        selected_total += u["value"]
        if selected_total >= amount_sat + fee_sat:
            break

    if selected_total < amount_sat + fee_sat:
        raise ValueError(
            f"Недостаточно средств: {selected_total} sat, "
            f"нужно {amount_sat + fee_sat} sat"
        )

    change_sat = selected_total - amount_sat - fee_sat

    # ── 4. Сборка транзакции ─────────────────────────────────────────────────
    vin = [
        TransactionInput(bytes.fromhex(u["txid"]), u["vout"])
        for u in selected
    ]
    vout = [TransactionOutput(amount_sat, scr.address_to_scriptpubkey(to_address))]
    if change_sat > 546:  # dust threshold
        vout.append(TransactionOutput(change_sat, addr_script))

    tx = Transaction(vin=vin, vout=vout)

    # ── 5. Подпись входов (P2WPKH segwit) ───────────────────────────────────
    # BIP143: scriptCode для P2WPKH — это P2PKH скрипт, не scriptPubKey
    script_code = scr.p2pkh_from_p2wpkh(addr_script)
    for i, u in enumerate(selected):
        sighash = tx.sighash_segwit(i, script_code, u["value"])
        sig = priv.sign(sighash)
        tx.vin[i].witness = scr.witness_p2wpkh(sig, pub)

    # ── 6. Broadcast ─────────────────────────────────────────────────────────
    raw_hex = tx.serialize().hex()
    broadcast = requests.post(
        "https://blockstream.info/api/tx",
        data=raw_hex,
        timeout=30,
    )
    if not broadcast.ok:
        err = broadcast.text.strip()
        if "missingorspent" in err:
            raise ValueError(
                "UTXO ещё не подтверждён внешней нодой. "
                "Подождите 1-2 подтверждения (~10-20 мин) и повторите."
            )
        raise ValueError(f"Broadcast failed ({broadcast.status_code}): {err}")
    return broadcast.text.strip()


async def send_coin(coin: str, mnemonic: str, to_address: str, amount: float) -> str:
    """
    Отправляет крипту клиенту. Возвращает хеш транзакции.
    Запускает синхронный IO в thread-pool чтобы не блокировать event loop.
    """
    if coin == "BTC":
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, _send_btc_sync, mnemonic, to_address, amount
        )
    raise ValueError(f"Авто-отправка не реализована для {coin}")

"""Python port of TronScanService.js — TRC20 USDT transfer inspection."""
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

TRONSCAN_BASE = os.getenv("TRONSCAN_API_BASE", "https://apilist.tronscanapi.com")
USDT_CONTRACT_RAW = os.getenv("TRC20_USDT_CONTRACT", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t").strip()
USDT_CONTRACT = USDT_CONTRACT_RAW.lower()


def _normalize_address(address: str) -> str:
    return str(address or "").strip().lower()


def _parse_amount(value, decimals_hint: int = 6) -> Optional[float]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if "." in raw:
        try:
            return float(raw)
        except ValueError:
            return None
    try:
        int_val = int(raw)
    except ValueError:
        return None
    return int_val / (10 ** decimals_hint)


def _normalize_ts(value) -> Optional[int]:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    if parsed < 1_000_000_000_000:
        return parsed * 1000
    return parsed


def _extract_transfer(payload: dict) -> Optional[dict]:
    transfers = (
        payload.get("trc20TransferInfo")
        or payload.get("trc20Transfer")
        or payload.get("token_transfer_info")
        or (payload.get("data") or {}).get("trc20TransferInfo")
        or []
    )
    if not isinstance(transfers, list) or not transfers:
        return None

    for item in transfers:
        contract = _normalize_address(
            item.get("tokenId") or item.get("token_id") or
            item.get("contract_address") or item.get("tokenAddress") or ""
        )
        if contract != USDT_CONTRACT:
            continue
        decimals = (
            item.get("tokenDecimal") or item.get("decimals") or
            (item.get("tokenInfo") or {}).get("tokenDecimal") or 6
        )
        amount_raw = (
            item.get("amount_str") or item.get("amount") or
            item.get("quant") or item.get("value")
        )
        amount = _parse_amount(amount_raw, decimals)
        return {
            "tokenContract": contract,
            "toAddress": item.get("to_address") or item.get("toAddress") or item.get("to"),
            "fromAddress": item.get("from_address") or item.get("fromAddress") or item.get("from"),
            "amountUsdt": amount,
        }
    return None


def _extract_confirmations(payload: dict) -> int:
    for key in ("confirmations", "confirmedNum", "block_confirmations"):
        val = payload.get(key)
        if val is not None:
            try:
                n = int(val)
                if n >= 0:
                    return n
            except (TypeError, ValueError):
                pass
    data = payload.get("data") or {}
    val = data.get("confirmations")
    if val is not None:
        try:
            return max(0, int(val))
        except (TypeError, ValueError):
            pass
    return 0


def _is_success(payload: dict) -> bool:
    contract_ret = str(
        payload.get("contractRet") or
        (payload.get("receipt") or {}).get("result") or ""
    ).upper()
    if contract_ret == "SUCCESS":
        return True
    if payload.get("confirmed") is True:
        return True
    return False


def _parse_transfers_list(payload: dict) -> list[dict]:
    rows = (
        payload.get("token_transfers") or
        payload.get("trc20_transfers") or
        payload.get("data") or
        payload.get("list") or
        []
    )
    if not isinstance(rows, list):
        return []

    result = []
    for item in rows:
        token_info = item.get("tokenInfo") or {}
        contract = _normalize_address(
            token_info.get("tokenId") or item.get("tokenId") or item.get("token_id") or
            item.get("contract_address") or item.get("tokenAddress") or ""
        )
        if contract != USDT_CONTRACT:
            continue
        decimals = (
            token_info.get("tokenDecimal") or item.get("tokenDecimal") or
            item.get("decimals") or item.get("token_decimal") or 6
        )
        amount = _parse_amount(
            item.get("amount_str") or item.get("amount") or item.get("quant") or item.get("value"),
            decimals,
        )
        if amount is None or amount <= 0:
            continue
        tx_hash = (
            item.get("transaction_id") or item.get("hash") or
            item.get("transactionHash") or item.get("txHash")
        )
        if not tx_hash:
            continue
        ts_raw = (
            item.get("block_ts") or item.get("timestamp") or
            item.get("block_timestamp") or item.get("transferTime") or item.get("time")
        )
        result.append({
            "txHash": tx_hash,
            "tokenContract": contract,
            "toAddress": item.get("to_address") or item.get("toAddress") or item.get("to"),
            "fromAddress": item.get("from_address") or item.get("fromAddress") or item.get("from"),
            "amountUsdt": amount,
            "timestampMs": _normalize_ts(ts_raw),
        })
    return result


async def list_recent_usdt_transfers(address: str, since_ms: int = 0, limit: int = 200) -> list[dict]:
    target = address.strip()
    if not target:
        return []

    base = TRONSCAN_BASE.rstrip("/")
    if base.endswith("/api"):
        endpoint = f"{base}/token_trc20/transfers"
    else:
        endpoint = f"{base}/api/token_trc20/transfers"

    safe_limit = max(10, min(limit, 500))
    attempts = [
        {"limit": safe_limit, "start": 0, "sort": "-timestamp", "relatedAddress": target, "contract_address": USDT_CONTRACT_RAW},
        {"limit": safe_limit, "start": 0, "sort": "-timestamp", "toAddress": target, "contract_address": USDT_CONTRACT_RAW},
        {"limit": safe_limit, "start": 0, "sort": "-timestamp", "address": target, "contract_address": USDT_CONTRACT_RAW},
    ]

    async with httpx.AsyncClient(timeout=10.0) as client:
        for params in attempts:
            try:
                resp = await client.get(endpoint, params=params)
                if resp.status_code == 400:
                    continue
                resp.raise_for_status()
                rows = _parse_transfers_list(resp.json())
                if not rows:
                    continue
                if since_ms:
                    rows = [r for r in rows if r.get("timestampMs") and r["timestampMs"] >= since_ms]
                if not rows:
                    continue
                seen = set()
                deduped = []
                for r in rows:
                    if r["txHash"] not in seen:
                        seen.add(r["txHash"])
                        deduped.append(r)
                return deduped
            except Exception as e:
                logger.warning(f"[TRON] list transfers attempt failed: {e}")

    return []


async def inspect_usdt_transfer(tx_hash: str) -> dict:
    base = TRONSCAN_BASE.rstrip("/")
    if base.endswith("/api"):
        endpoint = f"{base}/transaction-info"
    else:
        endpoint = f"{base}/api/transaction-info"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(endpoint, params={"hash": tx_hash})
        resp.raise_for_status()
        payload = resp.json()

    transfer = _extract_transfer(payload)
    if not transfer:
        raise ValueError("USDT transfer not found in transaction")
    if not _is_success(payload):
        raise ValueError("Transaction is not successful")
    if not transfer["amountUsdt"] or transfer["amountUsdt"] <= 0:
        raise ValueError("Unable to determine USDT transfer amount")

    return {
        "txHash": tx_hash,
        "network": "TRC20",
        "tokenContract": transfer["tokenContract"],
        "confirmations": _extract_confirmations(payload),
        "toAddress": transfer["toAddress"],
        "fromAddress": transfer["fromAddress"],
        "amountUsdt": transfer["amountUsdt"],
    }

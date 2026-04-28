import asyncio
import json
import logging
import re
from pathlib import Path

from aiogram.types import FSInputFile, InputMediaPhoto, InputMediaVideo
from sqlalchemy import text

from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads"


def convert_markdown_to_html(text: str) -> str:
    if not text:
        return text
    if re.search(r"<[a-z][\s\S]*>", text, re.IGNORECASE):
        return text
    text = re.sub(r"\*([^*]+?)\*", r"<b>\1</b>", text)
    text = re.sub(r"__([^_]+?)__", r"<u>\1</u>", text)
    text = re.sub(r"_([^_]+?)_", r"<i>\1</i>", text)
    text = re.sub(r"~([^~]+?)~", r"<s>\1</s>", text)
    text = re.sub(r"`([^`]+?)`", r"<code>\1</code>", text)
    text = re.sub(r"\[([^\]]+?)\]\(([^)]+?)\)", r'<a href="\2">\1</a>', text)
    return text


def parse_raffle_recipients(recipients_text: str) -> dict:
    lines = re.split(r"\r?\n", str(recipients_text or ""))
    recipients = []
    skipped = []
    raffle_number = 1

    for index, raw_line in enumerate(lines):
        raw = raw_line.strip()
        if not raw:
            continue

        explicit_number = None
        token = raw
        m = re.match(r"^(\d{1,9})\s*[\)\].\-:]*\s+(.+)$", raw)
        if m:
            explicit_number = int(m.group(1))
            token = m.group(2).strip()

        t_me = re.search(r"(?:https?://)?t\.me/([A-Za-z0-9_]{3,64})", token, re.IGNORECASE)
        if t_me:
            token = f"@{t_me.group(1)}"

        token = token.split()[0].strip(" ,;")
        if not token:
            skipped.append({"line": index + 1, "raw": raw, "reason": "Empty identifier"})
            continue

        final_num = explicit_number if (isinstance(explicit_number, int) and explicit_number > 0) else raffle_number

        if re.match(r"^@[A-Za-z0-9_]{3,64}$", token):
            recipients.append({
                "line": index + 1, "raw": raw, "type": "username",
                "value": token[1:].lower(), "display": token, "raffle_number": final_num,
            })
        elif re.match(r"^\d{5,20}$", token):
            recipients.append({
                "line": index + 1, "raw": raw, "type": "tg_id",
                "value": token, "display": token, "raffle_number": final_num,
            })
        else:
            skipped.append({"line": index + 1, "raw": raw, "reason": "Invalid format. Use @username or tg_id"})
            continue

        raffle_number = max(raffle_number, final_num) + 1

    return {"total_lines": len(lines), "recipients": recipients, "skipped": skipped}


async def resolve_raffle_recipient(recipient: dict, bot_id: int) -> dict | None:
    is_specific = bot_id > 0
    async with AsyncSessionLocal() as db:
        if recipient["type"] == "tg_id":
            if is_specific:
                row = await db.execute(text("""
                    SELECT u.id AS user_id, u.tg_id, u.username, ub.bot_id, ub.username AS ub_username
                    FROM users u INNER JOIN user_bots ub ON ub.user_id = u.id
                    WHERE u.is_blocked = 0 AND u.tg_id = :val AND ub.bot_id = :bid
                    ORDER BY ub.updated_at DESC LIMIT 1
                """), {"val": recipient["value"], "bid": bot_id})
            else:
                row = await db.execute(text("""
                    SELECT u.id AS user_id, u.tg_id, u.username, ub.bot_id, ub.username AS ub_username
                    FROM users u LEFT JOIN user_bots ub ON ub.user_id = u.id
                    WHERE u.is_blocked = 0 AND u.tg_id = :val
                    ORDER BY (ub.bot_id IS NULL), ub.updated_at DESC LIMIT 1
                """), {"val": recipient["value"]})
        else:
            val = recipient["value"]
            if is_specific:
                row = await db.execute(text("""
                    SELECT u.id AS user_id, u.tg_id, u.username, ub.bot_id, ub.username AS ub_username
                    FROM users u INNER JOIN user_bots ub ON ub.user_id = u.id
                    WHERE u.is_blocked = 0 AND ub.bot_id = :bid
                      AND (LOWER(u.username) = :val OR LOWER(ub.username) = :val)
                    ORDER BY ub.updated_at DESC LIMIT 1
                """), {"val": val, "bid": bot_id})
            else:
                row = await db.execute(text("""
                    SELECT u.id AS user_id, u.tg_id, u.username, ub.bot_id, ub.username AS ub_username
                    FROM users u LEFT JOIN user_bots ub ON ub.user_id = u.id
                    WHERE u.is_blocked = 0 AND (LOWER(u.username) = :val OR LOWER(ub.username) = :val)
                    ORDER BY (ub.bot_id IS NULL), ub.updated_at DESC LIMIT 1
                """), {"val": val})
        r = row.mappings().one_or_none()
    if not r or not r["tg_id"]:
        return None
    return {
        "user_id": r["user_id"],
        "tg_id": str(r["tg_id"]),
        "bot_id": int(r["bot_id"] or bot_id or 0),
        "username": r.get("username") or r.get("ub_username"),
    }


async def _send_attachment(bot, tg_id: int, attachment: dict, caption: str) -> None:
    file_path = UPLOADS_DIR / attachment["path"]
    opts: dict = {"parse_mode": "HTML"}
    if caption:
        opts["caption"] = caption
    f = FSInputFile(str(file_path))
    att_type = attachment.get("type", "document")
    if att_type == "image":
        await bot.send_photo(tg_id, f, **opts)
    elif att_type == "animation":
        await bot.send_animation(tg_id, f, **opts)
    elif att_type == "video":
        await bot.send_video(tg_id, f, **opts)
    elif att_type == "audio":
        await bot.send_audio(tg_id, f, **opts)
    else:
        await bot.send_document(tg_id, f, **opts)


async def send_message_to_user(bot_id: int, tg_id: int, text_: str, attachments: list | None) -> bool:
    from bot.manager import bot_manager
    bot = bot_manager.get_bot(bot_id)
    if not bot:
        # For bot_id=0 or missing bot, try any running bot
        for bid in list(bot_manager._bots.keys()):
            b = bot_manager.get_bot(bid)
            if b:
                bot = b
                break
    if not bot:
        logger.error(f"No running bot available for bot_id={bot_id}, tg_id={tg_id}")
        return False

    try:
        html_text = convert_markdown_to_html(text_)

        if not attachments:
            if html_text and html_text.strip():
                await bot.send_message(tg_id, html_text, parse_mode="HTML")
            return True

        media_atts = [a for a in attachments if a.get("type") in ("image", "video")]
        anim_atts = [a for a in attachments if a.get("type") == "animation"]
        other_atts = [a for a in attachments if a.get("type") not in ("image", "video", "animation")]

        if len(media_atts) > 1:
            media = []
            for i, att in enumerate(media_atts):
                f = FSInputFile(str(UPLOADS_DIR / att["path"]))
                if att["type"] == "video":
                    item = InputMediaVideo(media=f, caption=html_text if i == 0 else None, parse_mode="HTML" if i == 0 else None)
                else:
                    item = InputMediaPhoto(media=f, caption=html_text if i == 0 else None, parse_mode="HTML" if i == 0 else None)
                media.append(item)
            try:
                await bot.send_media_group(tg_id, media)
            except Exception as e:
                logger.error(f"Media group failed for {tg_id}: {e}, sending individually")
                for i, att in enumerate(media_atts):
                    await _send_attachment(bot, tg_id, att, html_text if i == 0 else "")
                    await asyncio.sleep(0.3)
        elif len(media_atts) == 1:
            await _send_attachment(bot, tg_id, media_atts[0], html_text)
        elif not anim_atts and not other_atts and html_text and html_text.strip():
            await bot.send_message(tg_id, html_text, parse_mode="HTML")

        for i, att in enumerate(anim_atts):
            cap = html_text if (i == 0 and not media_atts) else ""
            await _send_attachment(bot, tg_id, att, cap)
            await asyncio.sleep(0.3)

        for att in other_atts:
            await _send_attachment(bot, tg_id, att, "")
            await asyncio.sleep(0.3)

        if not media_atts and not anim_atts and other_atts and html_text and html_text.strip():
            await bot.send_message(tg_id, html_text, parse_mode="HTML")

        return True
    except Exception as e:
        msg = str(e).lower()
        if "blocked" in msg or "403" in str(e) or "deactivated" in msg:
            logger.info(f"User {tg_id} has blocked the bot")
        else:
            logger.error(f"Error sending to user {tg_id}: {e}")
        return False


class MailingService:
    def __init__(self):
        self.active_mailings: set[int] = set()
        self.batch_size = 30
        self.batch_delay = 2.0
        self.message_delay = 0.1

    async def start_mailing(self, mailing_id: int) -> None:
        if mailing_id in self.active_mailings:
            logger.info(f"Mailing {mailing_id} already running")
            return
        self.active_mailings.add(mailing_id)
        asyncio.create_task(self._run(mailing_id), name=f"mailing-{mailing_id}")

    async def _run(self, mailing_id: int) -> None:
        try:
            await self._process(mailing_id)
        except Exception as e:
            logger.error(f"Mailing {mailing_id} crashed: {e}")
        finally:
            self.active_mailings.discard(mailing_id)

    async def _get_status(self, mailing_id: int) -> str | None:
        async with AsyncSessionLocal() as db:
            r = await db.execute(text("SELECT status FROM mailings WHERE id = :id"), {"id": mailing_id})
            return r.scalar_one_or_none()

    async def _increment(self, mailing_id: int, success: bool) -> None:
        col = "send_count" if success else "error_send_count"
        async with AsyncSessionLocal() as db:
            try:
                await db.execute(
                    text(f"UPDATE mailings SET {col} = {col} + 1 WHERE id = :id"),
                    {"id": mailing_id},
                )
                await db.commit()
            except Exception:
                pass

    async def _process(self, mailing_id: int) -> None:
        async with AsyncSessionLocal() as db:
            row = await db.execute(text("SELECT * FROM mailings WHERE id = :id"), {"id": mailing_id})
            mailing = row.mappings().one_or_none()
        if not mailing:
            logger.error(f"Mailing {mailing_id} not found")
            return
        mailing = dict(mailing)
        if mailing["status"] != "active":
            return

        attachments = mailing.get("attachments")
        if attachments and isinstance(attachments, str):
            try:
                attachments = json.loads(attachments)
            except Exception:
                attachments = None

        bot_id = mailing["bot_id"]
        users = await self._get_users(bot_id)
        logger.info(f"Mailing {mailing_id}: {len(users)} users, bot_id={bot_id}")

        if not users:
            async with AsyncSessionLocal() as db:
                await db.execute(text("UPDATE mailings SET status='completed' WHERE id=:id"), {"id": mailing_id})
                await db.commit()
            return

        total = len(users)
        for i in range(0, total, self.batch_size):
            if await self._get_status(mailing_id) != "active":
                break

            batch = users[i:i + self.batch_size]
            for user in batch:
                if await self._get_status(mailing_id) != "active":
                    return
                user_bot_id = user.get("bot_id") or bot_id
                try:
                    ok = await send_message_to_user(user_bot_id, user["tg_id"], mailing["text"], attachments)
                    await self._increment(mailing_id, ok)
                except Exception as e:
                    logger.error(f"Send error for {user['tg_id']}: {e}")
                    await self._increment(mailing_id, False)
                if self.message_delay > 0:
                    await asyncio.sleep(self.message_delay)

            if i + self.batch_size < total:
                await asyncio.sleep(self.batch_delay)

        if await self._get_status(mailing_id) == "active":
            async with AsyncSessionLocal() as db:
                await db.execute(text("UPDATE mailings SET status='completed' WHERE id=:id"), {"id": mailing_id})
                await db.commit()
            logger.info(f"Mailing {mailing_id} completed")

    async def _get_users(self, bot_id: int) -> list[dict]:
        async with AsyncSessionLocal() as db:
            if bot_id == 0:
                rows = await db.execute(text("""
                    SELECT DISTINCT u.tg_id, u.id AS user_id, ub.bot_id
                    FROM user_bots ub JOIN users u ON ub.user_id = u.id
                    WHERE u.is_blocked = 0 AND u.tg_id IS NOT NULL
                    GROUP BY u.id, ub.bot_id ORDER BY u.id, ub.bot_id
                """))
            else:
                rows = await db.execute(text("""
                    SELECT u.tg_id, u.id AS user_id, ub.bot_id
                    FROM user_bots ub JOIN users u ON ub.user_id = u.id
                    WHERE ub.bot_id = :bid AND u.is_blocked = 0 AND u.tg_id IS NOT NULL
                """), {"bid": bot_id})
            return [dict(r._mapping) for r in rows.fetchall()]


mailing_service = MailingService()

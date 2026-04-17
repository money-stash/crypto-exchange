import os
import uuid
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import require_roles
from app.models.support import Support

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

BASE_UPLOAD_DIR = Path(__file__).parent.parent.parent / "uploads"
CHAT_UPLOAD_DIR = BASE_UPLOAD_DIR / "chats"
MAILING_UPLOAD_DIR = BASE_UPLOAD_DIR / "mailings"

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"}


def _safe_filename(filename: str) -> str:
    return Path(filename).name


# ── GET /chats/{filename} ─────────────────────────────────────────────────────
@router.get("/chats/{filename}")
async def download_chat_file(
    filename: str,
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN", "MANAGER", "OPERATOR")),
):
    safe = _safe_filename(filename)
    file_path = CHAT_UPLOAD_DIR / safe
    if not file_path.exists():
        raise HTTPException(404, "File not found")

    ext = file_path.suffix.lower()
    media_types = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".pdf": "application/pdf",
    }
    media_type = media_types.get(ext, "application/octet-stream")
    return FileResponse(str(file_path), media_type=media_type,
                        headers={"Content-Disposition": f'inline; filename="{safe}"'})


# ── POST /mailing-attachments ─────────────────────────────────────────────────
@router.post("/mailing-attachments")
async def upload_mailing_attachments(
    files: list[UploadFile] = File(...),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    MAILING_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    uploaded = []
    for file in files:
        if file.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(400, f"Unsupported file type: {file.content_type}. Allowed: JPEG, PNG, GIF, WebP")
        if file.size and file.size > 10 * 1024 * 1024:
            raise HTTPException(400, "File too large. Max 10MB")

        ext = Path(file.filename or "").suffix
        filename = f"{uuid.uuid4().hex}{ext}"
        dest = MAILING_UPLOAD_DIR / filename
        with open(dest, "wb") as f:
            shutil.copyfileobj(file.file, f)

        uploaded.append({
            "filename": filename,
            "originalName": file.filename,
            "mimetype": file.content_type,
            "size": dest.stat().st_size,
            "path": f"/uploads/mailings/{filename}",
        })

    return {"success": True, "message": f"Uploaded {len(uploaded)} file(s)", "files": uploaded}


# ── DELETE /mailing-attachments/{filename} ────────────────────────────────────
@router.delete("/mailing-attachments/{filename}")
async def delete_mailing_attachment(
    filename: str,
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    safe = _safe_filename(filename)
    file_path = MAILING_UPLOAD_DIR / safe
    if not file_path.exists():
        raise HTTPException(404, "File not found")
    file_path.unlink()
    return {"success": True, "message": "File deleted"}


# ── GET /mailing-attachments ─────────────────────────────────────────────────
@router.get("/mailing-attachments")
async def list_mailing_attachments(
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    MAILING_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for p in MAILING_UPLOAD_DIR.iterdir():
        if p.is_file():
            stat = p.stat()
            files.append({
                "filename": p.name,
                "size": stat.st_size,
                "created": stat.st_ctime,
                "modified": stat.st_mtime,
                "path": f"/uploads/mailings/{p.name}",
            })
    return {"success": True, "files": files}

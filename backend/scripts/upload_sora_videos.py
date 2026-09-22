"""iter-183 · one-shot script to upload the two Sora-generated videos into
Emergent Object Storage so they're served from the CDN instead of the
frontend's public folder (which bloats the docker image).

Run:
    python /app/backend/scripts/upload_sora_videos.py
"""
from __future__ import annotations
import asyncio
import os
import sys
import uuid
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent.parent))
load_dotenv(Path(__file__).parent.parent / ".env")

from routes.storage import put_object, init_storage, APP_NAME  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from datetime import datetime, timezone  # noqa: E402


VIDEOS = [
    {"local": "/app/frontend/public/videos/owner-pitch.mp4",       "kind": "video", "label": "Owner pitch · B2B"},
    {"local": "/app/frontend/public/videos/subscriber-pitch.mp4",  "kind": "video", "label": "Subscriber pitch · B2C"},
]


async def main():
    if not init_storage():
        print("[upload_sora_videos] storage init failed — abort")
        return 1
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    for v in VIDEOS:
        p = Path(v["local"])
        if not p.exists():
            print(f"skip · {p} missing")
            continue
        data = p.read_bytes()
        path = f"{APP_NAME}/{v['kind']}/system/{p.stem}-{uuid.uuid4().hex[:6]}.mp4"
        result = put_object(path, data, "video/mp4")
        rec = {
            "file_id": uuid.uuid4().hex,
            "storage_path": result.get("path") or path,
            "original_filename": p.name,
            "content_type": "video/mp4",
            "size": result.get("size") or len(data),
            "kind": v["kind"],
            "label": v["label"],
            "owner_user_id": "system",
            "mess_id": None,
            "is_deleted": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.media_files.insert_one(rec)
        print(f"ok · {p.name} → /api/media/{rec['storage_path']} ({rec['size']} bytes)")
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

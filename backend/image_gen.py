"""Gemini Nano Banana image generation helper.

Wraps the `emergentintegrations.llm.chat.LlmChat` interface to produce a
product-style 3D PNG and save it into our local "object storage" directory
(/app/backend/uploads/...). Returns the public URL under the existing
StaticFiles mount at /api/uploads/<subdir>/<filename>.

We isolate the network call into this module so route handlers stay slim and
unit tests can mock `generate_3d_image` without touching the SDK.
"""
from __future__ import annotations

import base64
import logging
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("efoodcare")

# Live import — lazy to avoid import-time errors if the package is missing in
# tests. We re-raise as RuntimeError so callers can return a clean HTTP 502.
def _llm_chat():
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
        return LlmChat, UserMessage
    except Exception as e:  # pragma: no cover
        raise RuntimeError(f"emergentintegrations not installed: {e}") from e


UPLOAD_ROOT = Path(__file__).resolve().parent / "uploads"
DEFAULT_MODEL = "gemini-3.1-flash-image-preview"  # "Nano Banana" — latest

# Iter-55: Persist images as data-URLs in MongoDB (caller stores the returned
# string into `image_url` field). Production redeploys wipe the container's
# filesystem, so local `/api/uploads/...` paths used to vanish each release.
# Storing the bytes inline in MongoDB makes images survive forever.
STORE_IMAGES_AS_DATA_URL = True


def _to_data_url(image_bytes: bytes, mime: str = "image/png") -> str:
    return "data:" + mime + ";base64," + base64.b64encode(image_bytes).decode("ascii")


async def generate_3d_image(
    prompt: str,
    subdir: str,
    *,
    session_id: str | None = None,
    model: str = DEFAULT_MODEL,
) -> tuple[str, int]:
    """Generate a single 3D PNG via Gemini Nano Banana.

    Iter-55: returns the image as a `data:image/png;base64,...` URL so callers
    can persist it directly inside MongoDB. Old call-sites still work — the
    only thing that changes is `public_url` is now a data-URL instead of a
    static path. The /app/backend/uploads directory is no longer used.
    """
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY missing from backend/.env")

    LlmChat, UserMessage = _llm_chat()
    sid = session_id or f"img-gen-{uuid.uuid4().hex[:12]}"
    chat = (
        LlmChat(api_key=api_key, session_id=sid, system_message="You are a 3D food/product render artist.")
        .with_model("gemini", model)
        .with_params(modalities=["image", "text"])
    )

    framed = (
        "Photorealistic 3D studio render. Soft top lighting, subtle floor "
        "reflection, shallow depth of field, glossy textures. Plain neutral "
        "off-white background. Centered subject, no text, no watermark, no "
        "people. Square aspect.  Subject: " + prompt
    )

    msg = UserMessage(text=framed)
    _text, images = await chat.send_message_multimodal_response(msg)
    if not images:
        raise RuntimeError("Gemini returned no images")

    img = images[0]
    image_bytes = base64.b64decode(img["data"])

    # Iter-55: return a base64 data-URL so the caller stores it inside Mongo.
    data_url = _to_data_url(image_bytes, "image/png")
    log.info("[image-gen] generated %d bytes for prompt='%.80s' (returning data-url len=%d)", len(image_bytes), prompt, len(data_url))
    return data_url, len(image_bytes)

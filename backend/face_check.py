"""Iter-54 #3 — face detection for selfie uploads.

Uses Gemini Vision (gemini-2.5-flash) via emergentintegrations to classify
the uploaded selfie. Returns (ok, reason).

We keep this in its own module so the auth route stays slim and tests can
monkey-patch `is_valid_face_data_url` directly.
"""
from __future__ import annotations

import logging
import os
import uuid

log = logging.getLogger("efoodcare")


def _llm_classes():
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore
        return LlmChat, UserMessage, ImageContent
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"emergentintegrations not installed: {e}") from e


async def is_valid_face_data_url(data_url: str) -> tuple[bool, str]:
    """Returns (is_valid_face, reason). If detector errors, raises so the
    caller can decide whether to allow-on-error (current policy)."""
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY missing — cannot run face validator")
    if not data_url.startswith("data:image"):
        return False, "Not a valid image data URL"
    # Strip the prefix so the SDK gets only base64 + the mime via ImageContent
    try:
        header, b64 = data_url.split(",", 1)
        _mime = header.split(":", 1)[1].split(";", 1)[0]
    except Exception:
        return False, "Could not parse image"

    LlmChat, UserMessage, ImageContent = _llm_classes()
    sid = f"face-check-{uuid.uuid4().hex[:10]}"
    # Iter-59 #7: tighter prompt → fewer tokens → ~1-2s faster classification.
    chat = (
        LlmChat(api_key=api_key, session_id=sid,
                system_message=(
                    "Reply EXACTLY one letter:\n"
                    "Y = one clear human face, eyes/nose/mouth visible, primary subject.\n"
                    "N = no face / cartoon / animal / screenshot / blurry / heavy obstruction / >1 face."
                ))
        .with_model("gemini", "gemini-2.5-flash")
    )
    msg = UserMessage(
        text="Valid selfie? Y or N.",
        file_contents=[ImageContent(image_base64=b64)],
    )
    try:
        resp = await chat.send_message(msg)
    except Exception as e:
        log.warning(f"[FACE-CHECK] LLM error → re-raise so caller decides: {e}")
        raise
    text = (resp or "").strip().upper()
    # Accept either letter form or word form for backwards compat
    if text.startswith("Y") or ("VALID" in text and "INVALID" not in text):
        return True, "ok"
    if text.startswith("N") or "INVALID" in text:
        return False, "no valid single face detected"
    log.warning(f"[FACE-CHECK] ambiguous response: {text[:80]} → allow")
    return True, "ambiguous-allowed"

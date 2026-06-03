"""On-write image optimizer.

Used by admin upload endpoints to convert uploaded JPG/PNG/WEBP into a
size-bounded WebP. Saves ~70% bandwidth on cellular networks and keeps the
public /api/uploads/... directory lean.

Usage:
    from image_optim import optimize_to_webp
    written = optimize_to_webp(raw_bytes, dest_path, max_dim=1600, quality=80)
"""
from __future__ import annotations

import io
import logging
from pathlib import Path

log = logging.getLogger("efoodcare")


def optimize_to_webp(
    raw: bytes,
    dest: Path,
    *,
    max_dim: int = 1600,
    quality: int = 80,
) -> int:
    """Resize+convert `raw` to a `.webp` and write to `dest`.

    Falls back to writing the original bytes if PIL isn't available or fails
    (we don't want a Pillow blip to break admin uploads). Returns the number
    of bytes written.
    """
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        log.warning("[image_optim] PIL not installed — writing original bytes")
        dest.write_bytes(raw)
        return len(raw)

    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
        # Convert palette / RGBA → RGB for WebP friendliness
        if im.mode in ("P", "RGBA"):
            background = Image.new("RGB", im.size, (255, 255, 255))
            background.paste(im, mask=im.split()[-1] if im.mode == "RGBA" else None)
            im = background
        elif im.mode != "RGB":
            im = im.convert("RGB")
        # Resize keeping aspect ratio — Lanczos for high-quality downscale.
        im.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        # Save as .webp regardless of source format.
        dest = dest.with_suffix(".webp")
        im.save(dest, format="WEBP", quality=quality, method=4)
        nbytes = dest.stat().st_size
        log.info("[image_optim] %s · %.1f KB (from %.1f KB · %.0f%%)", dest.name, nbytes / 1024, len(raw) / 1024, 100 * nbytes / max(1, len(raw)))
        return nbytes
    except Exception as e:
        log.warning("[image_optim] failed (%s) — falling back to original bytes", e)
        dest.write_bytes(raw)
        return len(raw)


def optimize_to_webp_bytes(
    raw: bytes,
    *,
    max_dim: int = 1600,
    quality: int = 80,
) -> bytes:
    """Iter-55: in-memory variant. Returns the optimized WebP bytes instead
    of writing to disk, so callers can store the image inline (data-URL in
    MongoDB). Falls back to raw bytes if PIL fails."""
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return raw
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
        if im.mode in ("P", "RGBA"):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1] if im.mode == "RGBA" else None)
            im = bg
        elif im.mode != "RGB":
            im = im.convert("RGB")
        im.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        im.save(out, format="WEBP", quality=quality, method=4)
        return out.getvalue()
    except Exception as e:
        log.warning("[image_optim_bytes] failed (%s) — returning raw", e)
        return raw

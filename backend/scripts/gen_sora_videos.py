"""iter-181 · Sora 2 video generation script.

Generates two short explainer videos for eFoodTech:
  1. Owner pitch (B2B) — onboard-in-10-min, direct-to-bank, QR check-in.
  2. Subscriber pitch (B2C) — meals sorted, wallet in pocket, streaks.

Output MP4s land in /app/frontend/public/videos/ so the frontend can embed
them as `<video src="/videos/owner-pitch.mp4" />` behind a CDN-served path.

Run in background:  python /app/backend/scripts/gen_sora_videos.py &
"""
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent.parent))
load_dotenv(Path(__file__).parent.parent / ".env")

from emergentintegrations.llm.openai.video_generation import OpenAIVideoGeneration  # noqa: E402

OUTPUT_DIR = Path("/app/frontend/public/videos")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

VIDEOS = [
    {
        "name": "owner-pitch.mp4",
        "prompt": (
            "Elegant 12-second animated explainer for an Indian food-service SaaS "
            "brand called eFoodTech. Cinematic close-up of a busy Indian mess owner "
            "smiling as a smartphone in his hand shows a dashboard with 'Live in 10 minutes' "
            "badge, active subscriber count ticking up, and a Razorpay UPI payment landing "
            "notification. Warm daylight, saffron and deep red brand palette, kraft-paper "
            "textures, subtle 3D parallax. End with the wordmark 'efoodtech' in bold serif "
            "over a red gradient card, tagline 'Direct-to-bank. Zero platform fee to start.' "
            "No spoken dialogue, upbeat instrumental with tabla accents."
        ),
    },
    {
        "name": "subscriber-pitch.mp4",
        "prompt": (
            "Cheerful 12-second animated explainer for young Indian office-goers using the "
            "eFoodTech mess subscription app. Cinematic top-down of a stainless-steel thali "
            "of daal, rice, chapati; a smartphone slides in showing a green 'Checked in ✓' "
            "toast; wallet card animates from ₹2,940 to ₹2,870 with a 14🔥 streak badge. "
            "Warm ambient light, bokeh background of a mess dining hall, saffron and deep "
            "red palette. Show a face-scan camera briefly with a green ring pulse. End with "
            "wordmark 'efoodtech' and tagline 'Meals sorted. Wallet in your pocket.' No "
            "spoken dialogue, cheerful acoustic guitar with a light bansuri melody."
        ),
    },
]


def main() -> int:
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        print("[gen_sora_videos] EMERGENT_LLM_KEY missing — abort", flush=True)
        return 1

    for v in VIDEOS:
        out = OUTPUT_DIR / v["name"]
        print(f"[gen_sora_videos] → {v['name']} · starting Sora-2 render …", flush=True)
        t0 = time.time()
        gen = OpenAIVideoGeneration(api_key=key)
        try:
            video_bytes = gen.text_to_video(
                prompt=v["prompt"],
                model="sora-2",
                size="1280x720",
                duration=12,
                max_wait_time=900,
            )
        except Exception as e:  # noqa: BLE001
            print(f"[gen_sora_videos] ✗ {v['name']} failed: {e}", flush=True)
            continue
        if not video_bytes:
            print(f"[gen_sora_videos] ✗ {v['name']} returned empty bytes", flush=True)
            continue
        gen.save_video(video_bytes, str(out))
        print(f"[gen_sora_videos] ✓ {v['name']} saved in {time.time() - t0:.1f}s → {out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

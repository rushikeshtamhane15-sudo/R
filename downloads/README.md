# eFoodTech — downloads

Everything from iter-181 packaged for direct download.

```
downloads/
├── videos/
│   ├── owner-pitch.mp4          · 6.7 MB · 12s · 1280×720 · Sora-2 B2B pitch to mess owners
│   └── subscriber-pitch.mp4     · 7.0 MB · 12s · 1280×720 · Sora-2 B2C pitch to subscribers
└── logos/
    ├── efoodtech-concept-A-plate-qr.svg   · plate + QR grid · techy · signals kiosk
    ├── efoodtech-concept-B-meal-ring.svg  · subscriber ring · "ef" nucleus · SaaS-network
    └── efoodtech-concept-C-chai-chip.svg  · mess coupon with steam curls · distinctly Indian
```

## How to grab these files

### From the container
The files sit at `/app/downloads/`. Use whatever tool your IDE / Emergent workspace exposes for file downloads — right-click → Save, or `cat` and copy from the terminal for the SVGs.

### From the running preview
The videos are also served by the frontend at:
- `https://<your-preview>.preview.emergentagent.com/videos/owner-pitch.mp4`
- `https://<your-preview>.preview.emergentagent.com/videos/subscriber-pitch.mp4`

(Because they live in `/app/frontend/public/videos/` they're statically served by the frontend.)

## Logo previews
See all three concepts side-by-side at:
- `https://<your-preview>.preview.emergentagent.com/dev/logo-preview`

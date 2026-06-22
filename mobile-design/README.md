# eFoodCare — Mobile Design Hand-off Package

> **iter-120 · Feb 2026**
> Bring the web app's polished UI to **pass-scan-mobile** (Native Android + iOS) without losing brand parity.

This folder is the single source of truth your mobile devs need to rebuild every subscriber-facing screen at 1-to-1 fidelity with the web app at `efoodcare.in`. Every value here is extracted from the live web build (`/api/theme`, `tailwind.config.js`, `index.css`, page sources).

---

## Folder layout

```
/app/mobile-design/
├── README.md                          ← you are here
├── common/
│   └── design_tokens.json             ← single source of truth, ALL platforms
├── android/
│   └── res/values/
│       ├── colors.xml                 ← all brand & semantic colours
│       ├── dimens.xml                 ← spacing / radius / type / elevation
│       ├── type.xml                   ← text appearance styles
│       └── themes.xml                 ← Material 3 theme, button/card/chip styles
├── ios/
│   ├── EFColors.swift                 ← `EFColors.primary` etc.
│   ├── EFTypography.swift             ← `EFType.displayH1` + view modifiers
│   ├── EFSpacing.swift                ← `EFSpace`, `EFRadius`, `EFShadow`
│   └── EFMotion.swift                 ← `EFMotion.tapPress`, `EFPressableStyle`
├── screenshots/                       ← reference web captures
│   ├── 01_home.png …                  (desktop width — see note below)
│   └── …
└── specs/
    ├── 01_home.md
    ├── 02_dashboard.md
    ├── 03_plans.md
    ├── 04_restaurant.md
    ├── 05_contact.md
    ├── 06_track.md
    └── 07_profile.md                  (parity reference — already looks good)
```

> **Note on screenshots**: The screenshot tool we used renders at desktop width by default, so the captures in `screenshots/` show the desktop layout. The web's mobile layout is essentially the **single-column stack** of the same components — each `.md` spec lists the exact mobile layout grid. When in doubt, run the preview URL on your phone (`https://dining-pass-scan.preview.emergentagent.com/`) for an exact mobile reference.

---

## How to use this package (mobile dev workflow)

### Day 1 — Install tokens (1 hour)

**Android team:**
```bash
cp -r android/res/values/* <YOUR_APP>/app/src/main/res/values/
# Add font files to <YOUR_APP>/app/src/main/res/font/:
#   cabinet_grotesk.xml      (font-family ref, weights 500/700/800/900)
#   manrope.xml              (weights 400/500/600/700)
#   jetbrains_mono.xml       (weights 400/500)
# Update AndroidManifest.xml:
#   <application android:theme="@style/Theme.EFoodcare" ...>
```

**iOS team:**
```bash
cp ios/*.swift <YOUR_APP>/Shared/Design/
# Add font files to Xcode project as resources (drag into project):
#   CabinetGrotesk-{Medium,Bold,Extrabold,Black}.otf
#   Manrope-{Regular,Medium,SemiBold,Bold}.ttf
#   JetBrainsMono-{Regular,Medium}.ttf
# Add to Info.plist:
#   UIAppFonts → array of the .otf/.ttf filenames above
```

### Day 2-7 — Implement one spec per day

Pick a spec from `/specs/`, read top-to-bottom, then:
1. Look at the live page on your phone (`https://efoodcare.in/<route>`) to *see* the design.
2. Build the screen using **only** the tokens defined in your platform's design files (no hard-coded hex / sp / dp).
3. Run the **acceptance checklist** at the bottom of the spec — every item is a literal pass/fail.
4. Compare side-by-side with the live web on a phone. Tweak.

### Day 8 — QA pass

For each screen, validate:
- All colors come from `EFColors` / `colors.xml` — `git grep "#[0-9A-Fa-f]\{6\}"` in your mobile codebase should return zero hits in feature files.
- All paddings come from `EFSpace` / `dimens.xml` — same `git grep` check for hard-coded `dp` values.
- Lighthouse-style visual diff (manual screenshot side-by-side) on each screen against the live web.

---

## Master color cheat-sheet

| Role | Hex | When to use |
|---|---|---|
| `ef_primary` | `#D02424` | Brand red. App-bar bg, primary CTA buttons, hero panels, wallet card bg, dash-divider, dish discount price, polyline routes, marker fills. |
| `ef_secondary` | `#2C854D` | Green. Overlines, success states, "100% pure veg" badges, growth/positive indicators, order-in-progress strip, user-marker fills. |
| `ef_accent` | `#F9EFEF` | Light pink wash. Backgrounds behind primary chips, info-row icon containers, branch-badge bg. |
| `ef_on_background` | `#1F2937` | Default body text on white. |
| `ef_on_card` | `#192D56` | Dense card text — navy-tinted. |
| `ef_on_muted` | `#64748B` | Helper text, subtitles, captions. |
| `ef_muted` | `#F6F2F2` | Disabled/secondary surfaces (search-bar bg, inactive chip bg, skeleton shimmer). |
| `ef_border` | `#EDDDDD` | Card edges, divider lines (1dp hairline). |
| `ef_destructive` | `#B71414` | Delete account, cancel subscription, irreversible actions. |
| `ef_warning` | `#DF7A05` | Wallet paused (amber bg switch), expiring soon. |
| `ef_amber_card_bg` / `border` / `fg` | `#FFF7E0` / `#FBC94B` / `#9C5A00` | Partial-month carry-forward card, monetary-tip card. |

---

## Master type cheat-sheet

| Token | Family | Size | Weight | Letter-spacing | Use |
|---|---|---|---|---|---|
| `displayH1` | Cabinet Grotesk | 32sp | 800 | -0.02em | Page titles |
| `displayH2` | Cabinet Grotesk | 24sp | 800 | -0.02em | Section titles |
| `amountXL` | Cabinet Grotesk | 36sp | 800 | -0.02em | Wallet ₹, ETA mins, display price |
| `h3` | Manrope | 20sp | 700 | normal | Plan name, card title |
| `h4` | Manrope | 18sp | 700 | normal | Dish name, sub-section |
| `bodyLG` | Manrope | 16sp | 500 | normal | Hero subtext, important body |
| `bodyMD` | Manrope | 14sp | 500 | normal | Default body |
| `bodySM` | Manrope | 13sp | 500 | normal | Dense card text |
| `caption` | Manrope | 12sp | 500 | normal | Helper / muted text |
| `overline` | Manrope | 11sp | 700 | +0.2em UPPERCASE | "WALLET", "TODAY", section labels |
| `mono` | JetBrains Mono | 13sp | 400 | normal | Transaction IDs, QR tokens |

---

## Master spacing cheat-sheet

| Use case | Value |
|---|---|
| Page horizontal padding | 16dp |
| Section vertical gap (major blocks) | 24dp |
| Inside a card (padding) | 16dp |
| Inside a card (between sub-elements) | 12dp |
| Icon ↔ adjacent text gap | 8dp |
| Hairline divider | 1dp |
| Red dash-divider | 2dp (gradient) |
| Button height (primary) | 48dp |
| Button height (compact, in cards) | 40dp |
| Card radius (rounded-2xl) | 20dp |
| Pill radius (rounded-full) | 999dp |
| Default field radius | 12dp |

---

## Master motion cheat-sheet

| Token | Duration | Easing | Effect |
|---|---|---|---|
| `tapPress` | 120ms | ease-out | Scale 1 → 0.98 on press |
| `cardHover` | 220ms | ease | Translate-Y -1dp + shadow raise |
| `pageFadeIn` | 180ms | ease-in | Body opacity 0 → 1 once data resolves |
| `skeletonPulse` | 1500ms | ease-in-out, infinite | Opacity 0.4 ↔ 1 |
| `accordion` | 200ms | ease-out | Expand/collapse |

---

## Things mobile dev should NEVER do

| Don't | Why |
|---|---|
| Hard-code hex like `Color(0xFFD02424)` outside `EFColors` | When admin changes brand color via `/api/admin/theme`, you can wire it live; hard-coded won't update. |
| Use system default fonts (Roboto/SF Pro) for headings | They lose the brand voice. Cabinet Grotesk for display is non-negotiable. |
| Add "AI slop" elements: blurred gradients on white, purple accents, generic shadcn shadows | The eFoodCare brand is bold red on clean white — don't soften it. |
| Use Material default `?colorPrimary` for chips/buttons without overriding ripple to `ef_primary_pressed` | Wrong ripple color breaks the brand feel on press. |
| Render the wallet `₹` as a system rupee glyph | Use the lucide `IndianRupee` SVG (rasterise to vector drawable on Android, SF Symbol equivalent on iOS w/ custom mask) — system rupees vary across OS versions. |
| Show splash, then white blank, then content | Always render the skeleton in-between (matches web's iter-118 pattern). |
| Skip `data-testid` equivalents | Keep your mobile-side accessibility IDs (`Android contentDescription` / iOS `accessibilityIdentifier`) — they enable QA automation parity with web. |

---

## Updating tokens later

When the admin changes brand colors via `/api/admin/theme`:

- **Web**: applies CSS variables instantly (already wired via `ThemeContext.applyTokens`).
- **Mobile (recommended)**: On app launch, fetch `GET /api/theme` (no auth needed) and override the static `EFColors` at runtime. Cache the response with a 1-hour TTL to avoid blocking startup. Fall back to compile-time defaults on network failure.

Skeleton implementation (Android):

```kotlin
class ThemeRepository(private val api: EFApi, private val prefs: SharedPreferences) {
    suspend fun refresh(): EFThemeTokens {
        return try {
            val r = api.theme()
            prefs.edit().putString("ef_theme", Json.encodeToString(r.tokens)).apply()
            r.tokens
        } catch (_: Exception) {
            val cached = prefs.getString("ef_theme", null)
            cached?.let { Json.decodeFromString<EFThemeTokens>(it) } ?: EFThemeTokens.DEFAULTS
        }
    }
}
// Then on app init: ThemeRepository.refresh() → write to a Compose `MaterialTheme` ColorScheme override.
```

For Phase 1, you can skip this entirely and use the static tokens shipped here — the brand colors have been stable for 100+ iterations.

---

## Questions, gaps, blockers

Track them in the mobile project's repo, not here. This package is a **snapshot** of the web design system. If a screen changes on the web in the future, regenerate the affected `.md` spec from the latest source and re-issue.

— End of hand-off package —

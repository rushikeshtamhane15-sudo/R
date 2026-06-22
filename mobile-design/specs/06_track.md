# 06 · Track (Tiffin Delivery Tracking) — Mobile Spec

> **Web reference**: `/app/frontend/src/pages/Track.jsx` (160 lines)
> **Mobile route**: `/track` (auth required, tiffin subscribers)
> **Live data**: polls `GET /api/my/deliveries/track` every 10 s (foreground) / 30 s (background)

---

## 1. Page anatomy

### State A — No active delivery (most common idle state)

```
┌─────────────────────────────────────────┐
│  APP BAR                                │
├─────────────────────────────────────────┤
│  TICKER STRIP                           │
├─────────────────────────────────────────┤
│  BACK CHEVRON + "Dashboard" link        │  ← tappable, returns to /dashboard
├─────────────────────────────────────────┤
│  HEADER                                 │
│  ▸ Overline (green): "LIVE TRACKING"    │
│  ▸ H1 displayH2: "No active delivery"   │
│  ▸ italic muted: tagline                │
├─────────────────────────────────────────┤
│  EMPTY STATE CARD (EFCard.Flat)         │
│  ▸ Truck icon 48dp, centered            │
│  ▸ H4: "Nothing in dispatch right now"  │
│  ▸ bodySM muted: "Live tracking turns   │
│    on the moment a delivery boy starts   │
│    your meal slot. Check back closer to  │
│    lunch / dinner."                      │
├─────────────────────────────────────────┤
│  FOOTER (logo · brand · contact card)   │
└─────────────────────────────────────────┘
```

### State B — Active delivery (boy en-route)

```
┌─────────────────────────────────────────┐
│  APP BAR                                │
├─────────────────────────────────────────┤
│  BACK CHEVRON + "Dashboard"             │
├─────────────────────────────────────────┤
│  HEADER                                 │
│  ▸ Overline: "LIVE TRACKING"             │
│  ▸ H2: "Lunch is on the way"             │
├─────────────────────────────────────────┤
│  HERO STAT CARD (red bg, full-bleed)    │
│  ┌──────────────────────────────────┐   │
│  │ [icon-truck 20dp]   ETA           │   │
│  │                                    │   │
│  │   12 min                           │   │   ← amountXL (36sp Cabinet ExBd)
│  │                                    │   │
│  │ 2.4 km away · arriving by 12:47 PM │   │   ← bodyMD opacity 80%
│  └──────────────────────────────────┘   │
├─────────────────────────────────────────┤
│  MAP CARD (320dp tall, animated marker) │
│  · OSM tile bg                          │
│  · DELIVERY BOY MARKER (red truck icon  │
│    on white circle, 36dp, pulse anim)   │
│  · USER MARKER (chef hat, 32dp)         │
│  · Polyline OSRM driving route in       │
│    ef_primary 4dp stroke                │
│  · Bottom-left chip: "Last ping 8s ago" │
├─────────────────────────────────────────┤
│  DELIVERY BOY ROW (EFCard.Flat)         │
│  ┌──────────────────────────────────┐   │
│  │ [avatar 48dp]  RIDER              │   │
│  │                Suresh K. ⭐ 4.8     │   │
│  │                                    │   │
│  │            [📞 CALL]  [💬 WA]      │   │
│  └──────────────────────────────────┘   │
├─────────────────────────────────────────┤
│  ORDER DETAILS row                      │
│  ▸ Meal: Lunch                          │
│  ▸ Tiffin size: Full                    │
│  ▸ Tiffin balance after delivery: 14    │
├─────────────────────────────────────────┤
│  CONFIRM-RECEIPT CTA (only when         │
│   status = "out" AND distance < 100m)   │
│  ▸ Pill button, full-width, primary:    │
│    "I received my tiffin"               │
│  ▸ Action → POST /my/deliveries/{id}/   │
│    confirm                              │
└─────────────────────────────────────────┘
```

---

## 2. Token references

| Element | Color | Type | Notes |
|---|---|---|---|
| Back chevron link | `ef_on_muted` | bodyMD 500 | left-aligned, mt 16dp, mb 16dp |
| Header overline | `ef_secondary` | overline | — |
| Header H2 | `ef_on_background` | displayH2 | — |
| Empty-state truck icon | `ef_on_muted` | 48dp lucide | centered |
| Empty-state H4 | `ef_on_background` | h4 (18sp 700) | centered, mt 12dp |
| Empty-state body | `ef_on_muted` | bodySM | centered, max-width 280dp, mt 8dp |
| Hero stat card bg | `ef_primary` | — | radius 20dp, padding 24dp |
| Hero ETA caption | white 70% | overline | — |
| Hero ETA number | white | amountXL 36sp Cabinet ExBd | leading-none |
| Hero ETA sub-line | white 80% | bodyMD | mt 4dp |
| Map card | `ef_card` | — | radius 20dp, height 320dp, `card_3d` shadow |
| Boy marker | white circle bg 4dp ring, `ef_primary` truck icon | — | 36dp circle, `fab` shadow, pulse ring 60dp |
| User marker | `ef_secondary` circle bg, white chef-hat icon | — | 32dp |
| Polyline | `ef_primary` solid stroke | — | width 4dp |
| Last-ping chip | `ef_card` 95% opacity | bodySM | radius pill, padding 6×12dp, bottom-left of map |
| Rider card | EFCard.Flat | — | radius 16dp, padding 16dp |
| Rider avatar | circle 48dp | — | initials fallback bg `ef_accent`, text `ef_primary` |
| Rider name | bodyLG 600 | — | mt 4dp |
| Rider rating | inline `ef_warning` star + bodySM | — | gap 4dp |
| Call / WA buttons | outline pill, `ef_border` stroke | bodyMD 600 | 40dp tall each, gap 8dp |
| Order detail rows | EFCard.Flat list, separator hairline `ef_border` | bodyMD | each 48dp tall |
| Confirm-receipt CTA | `EFButton.Primary` | bodyMD 700 | full-width, 48dp tall |

---

## 3. Layout grid

- Page padding **16dp**.
- Vertical gap between sections **24dp**; inside cards **12dp**.
- Hero stat card sits directly under header (gap 16dp).
- Map card aspect-ratio: prefer 4:3 with min height 320dp.

---

## 4. Marker pulse animation (live tracking emphasis)

This is the **signature animation** of this screen — make sure it's snappy and visible.

```
state: pulse[0..1] loop 1.5s ease-in-out
─────────────────────────────────────
boy marker outer ring:
  scale: 0.8 + pulse * 1.2  (from 0.8 → 2.0)
  opacity: 0.6 * (1 - pulse) (from 0.6 → 0)
inner marker (truck icon circle):
  stays static
```

**Android**: Use a `View` with `ValueAnimator` (`setRepeatCount=INFINITE`) updating an outer `View`'s scaleX/scaleY/alpha. Or wrap the marker `View` in a `MotionLayout`.

**iOS**: SwiftUI:
```swift
@State private var pulse: CGFloat = 0
Circle().stroke(EFColors.primary, lineWidth: 2)
    .scaleEffect(0.8 + pulse * 1.2)
    .opacity(Double(0.6 * (1 - pulse)))
    .onAppear { withAnimation(EFMotion.skeletonPulse) { pulse = 1 } }
```

---

## 5. Polling logic (data layer)

```
Foreground: poll every 10s while screen visible
Background: poll every 30s (use background-fetch on iOS, WorkManager on Android)
Stop polling when:
  - tracking_status changes to "delivered"
  - app moves to background for >5 min
On error: exponential back-off 2s → 4s → 8s → 16s, max 60s. Show
"Last update X min ago" badge if stale > 1 min.
```

When the response transitions from `{tracking:false}` → `{tracking:true}`, animate the empty-state card out (slide up + fade, 220ms) and the hero-stat + map cards in (slide up + fade, 240ms staggered).

---

## 6. Shadcn → native component map

| Web | Android | iOS |
|---|---|---|
| `<MapContainer>` w/ OSM tiles + custom markers | MapLibre `MapView` w/ OSM raster style + `SymbolLayer` for markers + `LineLayer` for polyline | Apple `Map` (SwiftUI) or `MKMapView` for finer control |
| Hero stat card | `MaterialCardView style="EFCard"` w/ `cardBackgroundColor=ef_primary` | `RoundedRectangle.fill(EFColors.primary)` w/ padding |
| Empty-state card | `MaterialCardView style="EFCard.Flat"` w/ centered content | `VStack` centered inside `RoundedRectangle.stroke(EFColors.border)` |
| Rider call / WA buttons | `MaterialButton style="EFButton.Outline"` w/ icon | `Button { Label }.buttonStyle(EFOutlineButtonStyle())` |
| Confirm-receipt CTA | `MaterialButton style="EFButton.Primary"` | `Button { Text }.buttonStyle(EFPrimaryButtonStyle())` |
| Last-ping chip | `Chip style="EFChip.Filled"` w/ low opacity | `Text.padding().background(.ultraThinMaterial).cornerRadius(pill)` |

---

## 7. iOS sample stub (Active state)

```swift
struct TrackActiveView: View {
    let snapshot: TrackSnapshot   // from /api/my/deliveries/track

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EFSpace.s5) {
                BackLink()
                header
                heroStatCard
                MapCardView(snapshot: snapshot)
                    .frame(height: 320)
                riderCard
                orderDetails
                if snapshot.canConfirm {
                    Button("I received my tiffin") {
                        Task { await viewModel.confirmReceived() }
                    }
                    .buttonStyle(EFPrimaryButtonStyle())
                    .frame(maxWidth: .infinity)
                    .frame(height: EFTouch.buttonHeight)
                }
            }
            .padding(EFSpace.pageHorizontal)
        }
        .background(EFColors.background)
        .task { await viewModel.startPolling() }
        .onDisappear { viewModel.stopPolling() }
    }

    private var heroStatCard: some View {
        VStack(alignment: .leading, spacing: EFSpace.s2) {
            HStack {
                Image(systemName: "truck.box.fill")
                Spacer()
                Text("ETA").efOverline().opacity(0.7)
            }
            Text("\(snapshot.etaMinutes ?? 0) min").efAmountXL()
            Text("\(snapshot.distanceKm ?? 0, specifier: "%.1f") km away · arriving by \(snapshot.arrivalLabel)")
                .font(EFType.bodyMD).opacity(0.8)
        }
        .foregroundColor(EFColors.onPrimary)
        .padding(EFSpace.s6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(EFColors.primary)
        .cornerRadius(EFRadius.card)
        .efShadow(.card3D)
    }
}
```

---

## 8. Acceptance checklist

- [ ] Empty-state truck icon is **muted grey-blue** (not red); only the active-state hero & markers use red.
- [ ] Hero ETA number uses Cabinet Grotesk ExtraBold 36sp + line-height tight.
- [ ] Boy marker has a continuously pulsing outer ring — visibly animated.
- [ ] OSRM polyline draws from boy → user (not the reverse).
- [ ] "Last ping Xs ago" chip updates every second (locally; don't poll just for this).
- [ ] Confirm-receipt CTA appears ONLY when status="out" AND `distance_m < 100`. Hide otherwise (so users can't double-confirm or confirm too early).
- [ ] Rider call/WA buttons open the phone/WhatsApp apps respectively with rider's `boy_phone`.
- [ ] When response transitions to `{tracking:false}` mid-session (delivery completed), animate out the active layout and show a **success** card briefly ("Delivered at 12:47 PM · enjoy your meal!") before falling back to empty state.

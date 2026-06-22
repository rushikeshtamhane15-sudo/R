# 05 · Contact — Mobile Spec

> **Web reference**: `/app/frontend/src/pages/Contact.jsx` + `/app/frontend/src/components/ContactMap.jsx`
> **Mobile route**: `/contact` (PUBLIC)

---

## 1. Page anatomy

```
┌─────────────────────────────────────────┐
│  APP BAR                                │
├─────────────────────────────────────────┤
│  HEADER                                 │
│  ▸ Overline (green): "WE'RE HERE FOR YOU"│
│  ▸ H1: "Contact Us"                     │
│  ▸ body subtext: "We'd love to hear …"  │
├─────────────────────────────────────────┤
│  BRANCH BADGE                           │
│  ▸ Pill: "📍 Showing default branch:    │
│    Amravati"                            │
│  ▸ small text below: "Enable location   │
│    to auto-pick your nearest branch."   │
├─────────────────────────────────────────┤
│  CONTACT INFO ROWS (single col, stack)  │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │ [icon]  BRANCH                    │   │
│  │         Amravati                  │   │
│  └──────────────────────────────────┘   │
│  ┌──────────────────────────────────┐   │
│  │ [icon]  ADDRESS                   │   │
│  │         Shilangan Road, behind…   │   │
│  └──────────────────────────────────┘   │
│  ┌──────────────────────────────────┐   │
│  │ [icon]  PHONE                     │   │
│  │         +91 91755 60211 ☎️         │   │
│  └──────────────────────────────────┘   │
│  ┌──────────────────────────────────┐   │
│  │ [icon]  WHATSAPP                  │   │
│  │         Chat with us on WhatsApp →│   │
│  └──────────────────────────────────┘   │
│  ┌── email, branch manager, FSSAI ──┐   │
│  │         ...                       │   │
│  └──────────────────────────────────┘   │
│  ┌──────────────────────────────────┐   │
│  │ [icon]  HOURS                     │   │
│  │         Mon-Sun · 10 AM – 10 PM    │   │
│  └──────────────────────────────────┘   │
├─────────────────────────────────────────┤
│  MAP CARD                               │
│  ┌──────────────────────────────────┐   │
│  │ [Get directions] button (top-right│   │  ← FAB-style, red pill
│  │                                    │   │
│  │       (Leaflet/MapLibre map)       │   │
│  │  ┌─ EFC chef-hat marker ─┐         │   │
│  │  │  AMRAVATI label below │         │   │
│  │  └────────────────────────┘        │   │
│  │                                    │   │
│  │  Smaller pins: nearby branches     │   │
│  └──────────────────────────────────┘   │
│  Caption: "📍 efoodcare nearby kitchen   │
│   location"                              │
├─────────────────────────────────────────┤
│  FOOTER                                 │
└─────────────────────────────────────────┘
```

The map polyline (OSRM route from user → branch) is drawn only when user has granted location and `?showroute=1` is in the query (auto-set when user comes from "Get directions"). Direct route distance + ETA chip is overlaid bottom-left of the map when active.

---

## 2. Token references

| Element | Color | Type | Notes |
|---|---|---|---|
| Header overline | `ef_secondary` | overline | mb 4dp |
| Header H1 | `ef_on_background` | displayH1 | Cabinet ExtraBold |
| Header subtext | `ef_on_muted` | bodyLG | mt 8dp |
| Branch badge | `ef_accent` bg, `ef_primary` text + icon | bodyMD 600 | radius pill, padding 12×16dp |
| Branch badge sub-caption | `ef_on_muted` | caption | mt 4dp, mb 16dp |
| Info row (EFCard.Flat) | `ef_card` bg, `ef_border` 1dp | — | radius 16dp, padding 16dp, gap 12dp vertical |
| Info row icon container | `ef_accent` bg | — | 40dp square, radius 12dp |
| Info row icon | `ef_primary` | 20dp lucide | — |
| Info row label | `ef_on_muted` | overline 11sp 700 | letter-spacing +0.2em |
| Info row value | `ef_on_background` | bodyLG 500 | mt 4dp |
| Info row trailing action | `ef_primary` | bodySM 600 + arrow | only on tappable rows (Phone, WhatsApp, Email) |
| Map card | `ef_card` bg, `ef_border` 1dp | — | radius 20dp, fixed height 320dp, `card_3d` shadow |
| Get-directions FAB | `EFColors.primary` bg, white text | bodyMD 700 | radius pill, padding 8×16dp, `fab` shadow |
| Map marker chef-hat | `ef_primary` bg, white icon | — | 40dp circle, 4dp white outer ring, `fab` shadow |
| Distance chip overlay | `ef_card` bg 95% opacity, `ef_on_card` text | bodySM 600 | radius pill, padding 6×12dp, bottom-left of map, mb 12dp ml 12dp |
| Map caption below | `ef_on_muted` w/ ic_location 16dp | caption | mt 8dp, centered |

---

## 3. Layout grid

- Page padding **16dp**.
- Header centered, 32dp from app-bar.
- Branch badge centered horizontally; max-width fit-content.
- Info rows: each is a full-width EFCard.Flat; 12dp gap between rows.
- Map card: full-width minus 32dp; aspect-ratio 4:3 with min-height 280dp / max-height 360dp.

---

## 4. Map component

Web uses **Leaflet** + **OSRM** for routing. On native:
- **Android**: Use [MapLibre Native](https://maplibre.org/maplibre-native/android/) — it accepts the same OSM tile URL as web (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`). For the OSRM polyline, fetch `https://router.project-osrm.org/route/v1/driving/{user_lng},{user_lat};{branch_lng},{branch_lat}?overview=full&geometries=geojson` and add it as a `LineLayer` styled with `ef_primary` width 4dp.
- **iOS**: Use Apple Maps (`MKMapView`) — natively renders the polyline cleanly. Set marker images to your chef-hat asset. For polyline color use `EFColors.primary.uiColor`.
- **Fallback** (if you don't want maps SDK): Embed a `WebView` pointing to the existing `/contact?showroute=1` URL on a fixed-height container. The web map already works perfectly on mobile.

Map ATTRIBUTION is **hidden** in the web app (`.leaflet-control-attribution { display:none }`). Mobile follows the same rule — provide attribution in the About / Legal screen instead.

---

## 5. Shadcn → native component map

| Web | Android | iOS |
|---|---|---|
| Info row card | `MaterialCardView style="EFCard.Flat"` + horizontal `LinearLayout` | `HStack { iconBox · VStack { label · value } · Spacer · chevron? }` in `RoundedRectangle().stroke().background(EFColors.card)` |
| Branch badge | `Chip style="EFChip.Filled"` w/ start icon, custom bg = `ef_accent` | `Label · padding · background(EFColors.accent) · cornerRadius(pill)` |
| Map | MapLibre `MapView` w/ `MapboxStyle.MAPBOX_STREETS` swapped for OSM raster | `Map(...)` or `MKMapView` SwiftUI wrapper |
| Get-directions FAB | `ExtendedFloatingActionButton` w/ `app:backgroundTint=ef_primary` and `app:cornerRadius=24dp` | `Button { Label("Get directions", systemImage: "location.north.line.fill") }` |

---

## 6. Tap-to-action wiring

| Row | Action |
|---|---|
| BRANCH name | None (display only) |
| ADDRESS | Open native map picker w/ branch lat/lng (Intent ACTION_VIEW geo: on Android, `MKMapItem.openMaps` on iOS) |
| PHONE | `Intent.ACTION_DIAL` (Android) / `tel:` URL (iOS) |
| WHATSAPP | `https://wa.me/91XXXXXXXXXX?text=Hello%20efoodcare` opens WhatsApp |
| EMAIL | `Intent.ACTION_SENDTO mailto:` / `mailto:` URL |
| HOURS | None |
| FSSAI license | Bottom-sheet shows full FSSAI certificate image |
| Get-directions FAB | Open native maps app driving directions from user → branch lat/lng |

---

## 7. Animations

| Interaction | Spec |
|---|---|
| Page enter | `pageFadeIn` 180ms |
| Info row press | Ripple (Android default) / scale 0.98 on iOS (`tapPress`); only on tappable rows |
| Map marker bounce | On load, marker scales 0.6 → 1.05 → 1.0 over 350ms ease-out |
| Distance chip overlay | Slides in from bottom 200ms ease-out, fade-in 180ms |
| OSRM polyline draw-in | "Drawing" effect: animate `lineDashOffset` from full to 0 over 700ms (Android) / `MKPolylineRenderer` animation (iOS) |

---

## 8. iOS sample stub

```swift
struct ContactView: View {
    @StateObject var vm: ContactViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EFSpace.s5) {
                header
                branchBadge
                ForEach(vm.infoRows) { row in
                    ContactInfoRow(row: row)
                }
                MapCardView(branch: vm.branch, userLocation: vm.userLocation)
                    .frame(height: 320)
            }
            .padding(EFSpace.pageHorizontal)
        }
        .background(EFColors.background)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: EFSpace.s2) {
            Text("WE'RE HERE FOR YOU").efOverline()
            Text("Contact Us").efDisplayH1()
            Text("We'd love to hear from you. Reach out any time.")
                .font(EFType.bodyLG)
                .foregroundColor(EFColors.onMuted)
        }
    }

    private var branchBadge: some View {
        Label("Showing default branch: \(vm.branch.name)",
              systemImage: "mappin.and.ellipse")
            .font(EFType.bodyMD).foregroundColor(EFColors.primary)
            .padding(.horizontal, EFSpace.s4).padding(.vertical, EFSpace.s3)
            .background(EFColors.accent)
            .cornerRadius(EFRadius.pill)
    }
}

struct ContactInfoRow: View {
    let row: ContactInfoVM
    var body: some View {
        HStack(spacing: EFSpace.s3) {
            row.icon
                .font(.system(size: EFIcon.md))
                .foregroundColor(EFColors.primary)
                .frame(width: 40, height: 40)
                .background(EFColors.accent)
                .cornerRadius(EFRadius.md)
            VStack(alignment: .leading, spacing: 4) {
                Text(row.label).efOverline().foregroundColor(EFColors.onMuted)
                Text(row.value).font(EFType.bodyLG)
            }
            Spacer()
            if row.tappable {
                Image(systemName: "chevron.right")
                    .foregroundColor(EFColors.onMuted)
            }
        }
        .padding(EFSpace.cardInner)
        .background(EFColors.card)
        .overlay(RoundedRectangle(cornerRadius: EFRadius.lg).stroke(EFColors.border))
        .cornerRadius(EFRadius.lg)
        .onTapGesture { row.action?() }
    }
}
```

---

## 9. Acceptance checklist

- [ ] Branch badge has light-pink background (`ef_accent`) and primary-red icon + text.
- [ ] All info rows use the same uniform card style, NOT individual list items.
- [ ] Each row icon sits inside a 40dp square with `ef_accent` bg and 12dp radius — NOT a plain icon next to text.
- [ ] Phone / WhatsApp / Email rows visibly show a chevron and have ripple feedback on press.
- [ ] Map card has a fixed height (not full-screen), with 20dp radius corners (image is clipped).
- [ ] "Get directions" floating button is anchored top-right of the map card, NOT bottom-right.
- [ ] OSRM route polyline (when shown) uses `ef_primary` red, 4dp stroke width, no dashes.
- [ ] Map attribution / branding is hidden — matches web's `.leaflet-control-attribution { display:none }` rule.

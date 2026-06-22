# 03 · Plans (Subscription Purchase) — Mobile Spec

> **Web reference**: `/app/frontend/src/pages/Plans.jsx`
> **Mobile route**: `/plans` (PUBLIC — works without login; only blocks at checkout)
> Conversion-critical page. Treat the "Subscribe" CTA as sacred.

---

## 1. Page anatomy

```
┌─────────────────────────────────────────┐
│  APP BAR                                │
├─────────────────────────────────────────┤
│  HEADER (centered, white bg)            │
│  ▸ Overline (green) "SUBSCRIPTION PLANS"│
│  ▸ H1 display "Pick a plan. Eat        │
│    ghar se achha khana." (red-spotted)  │
│  ▸ Body lg muted: "All plans cover ..." │
├─────────────────────────────────────────┤
│  SERVICE TOGGLE (centered pill bar)    │
│  ┌──────────┐ ┌──────────┐             │
│  │ 🍽 Dining│ │ 🚚 Tiffin │  → 2 tabs   │
│  └──────────┘ └──────────┘             │
│  caption underneath explains tab        │
├─────────────────────────────────────────┤
│  PLAN CARDS — single column on mobile,  │
│  vertical scroll. Each card:            │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │ "MOST POPULAR" badge (top-left)   │   │  ← only on featured card
│  │ 60 MEALS · 30 DAYS  (chip row)    │   │
│  │ Premium Dining                    │   │
│  │ Eat at our hall · 60 home-style…  │   │
│  │                                    │   │
│  │ ₹ 2800        one-time             │   │  ← display amount, Cabinet Bold
│  │ ≈ ₹93 / day · ₹47 / meal           │   │
│  │ ✔ 60 total meals                   │   │
│  │ ✔ Lunch + Dinner at our hall       │   │
│  │ ✔ Scan QR at counter               │   │
│  │ ✔ Auto-pause on 3+ skipped days    │   │
│  │                                    │   │
│  │ ┌─ Subscribe → ─────────────┐ pill │   │
│  └──────────────────────────────────┘   │
│                                          │
│  ── featured card uses ef_primary bg     │
│     with white text instead of card bg   │
├─────────────────────────────────────────┤
│  BUILD-YOUR-OWN block                   │
│  ▸ Sparkles overline "BUILD YOUR OWN"   │
│  ▸ H3 "Pick any number of days."        │
│  ▸ Service segmented (Dining/Tiffin)    │
│  ▸ Days slider + meals counter          │
│  ▸ Total ₹ amount preview (live)        │
│  ▸ CTA "Continue with X days"           │
├─────────────────────────────────────────┤
│  FOOTER (same as Home)                  │
└─────────────────────────────────────────┘
```

---

## 2. Token references

| Element | Color | Type | Notes |
|---|---|---|---|
| Header overline | `ef_secondary` | overline | mb 4dp |
| Header H1 | `ef_on_background` | displayH1 | "ghar se achha khana" run in `ef_primary` (highlight) — split text |
| Header subtext | `ef_on_muted` | bodyLG | mt 8dp, centered |
| Service-toggle pill bar (inactive) | `ef_muted` bg, `ef_on_background` text | bodyMD 600 | radius pill, height 40dp |
| Service-toggle (active) | `ef_card` bg, `card_3d` shadow, `ef_on_background` text | bodyMD 700 | same height; transitions: 220ms ease |
| Toggle caption ("Eat at our hall · scan QR at counter") | `ef_on_muted` | caption | mt 12dp, centered |
| **Plan card (regular)** | `ef_card` bg, `ef_border` 1dp | — | radius 20dp, padding 24dp, `card_3d` shadow |
| **Plan card (featured)** | `ef_primary` bg, `ef_on_primary` text everywhere | — | same radius/padding |
| "MOST POPULAR" badge | `ef_card` bg (when on featured) / `ef_primary` bg (when on regular) | overline 11sp, weight 800 | padding 4×8dp, radius 999 |
| Chip row ("60 MEALS · 30 DAYS") | inline text | overline | colour matches card (white on featured, green on regular) |
| Plan name | matches text colour | h3 (20sp bold Manrope) | mt 4dp |
| Plan description | 80% opacity | bodyMD | mt 8dp |
| Display amount ₹ | matches text | `amountXL` (36sp Cabinet ExtraBold) | mt 16dp |
| "one-time" caption beside ₹ | 70% opacity | bodySM | inline, baseline-aligned |
| Per-day/per-meal caption | 70% opacity | caption | mt 4dp |
| Checkmark list rows | gap 8dp, checkmark uses `ef_secondary` green | bodyMD | each row 24dp tall, mt 4dp |
| Subscribe CTA on featured card | white pill bg, primary red text | bodyMD 700 | inverse pattern: stands out on red bg |
| Subscribe CTA on regular card | `EFButton.Primary` | bodyMD 700 | standard primary pill |

---

## 3. Layout grid

- Cards stack **vertically** on mobile (web shows 2-up on desktop). Each card is full-width minus 32dp page padding.
- Vertical gap between plan cards: 16dp.
- Inside each card: 24dp padding, vertical inner gaps 8-16dp.
- Service-toggle pill bar is **centered**, max-width 280dp; on mobile, fills page padding if pill exceeds 280dp.
- Build-your-own block: 32dp gap above; same card styling as plans.

---

## 4. Shadcn → native component map

| Web | Android | iOS |
|---|---|---|
| `<Tabs value="dining"|"tiffin">` for service toggle | `TabLayout` w/ `app:tabIndicatorColor=transparent` + custom selected drawable (pill) | `Picker(... .pickerStyle(.segmented))` styled OR custom `HStack` of 2 `Button`s |
| Plan card | `MaterialCardView style="EFCard"` (override bg for featured) | `VStack { ... }.background(featured ? primary : card).cornerRadius(20)` |
| Featured "MOST POPULAR" badge | `Chip style="EFChip.Active"` positioned top-left | `Text("MOST POPULAR").efOverline().padding(4,8).background(Capsule().fill(.white))` |
| Day slider (build-your-own) | `Slider` with `app:thumbTint=ef_primary` & `app:trackColor=ef_muted` | `Slider(value: $days, in: 1...60).accentColor(EFColors.primary)` |
| Checkmark list | `RecyclerView` of `<TextView drawableStart=ic_check>` | `ForEach` of `HStack { Image(systemName:"checkmark.circle.fill") · Text }` |

---

## 5. Interactions & animations

| Interaction | Spec |
|---|---|
| Service toggle tap | Switch active pill via crossfade 200ms; the selected pill animates the white background sliding from old to new position. Use `LayoutTransition.animateBoundsChange` (Android) / `matchedGeometryEffect` (SwiftUI) |
| Plan card press | Subtle scale 0.99 / 120ms (`tapPress`), then navigate to `/checkout/{planId}` |
| Subscribe CTA press | `tapPress` + immediately disable button, show inline spinner (top-right of pill) while routing |
| Build-your-own days slider | Live-update total ₹ amount on drag (debounce 50ms) |
| Page enter | `pageFadeIn` 180ms |

---

## 6. Android sample stub

```xml
<!-- res/layout/item_plan_card.xml -->
<com.google.android.material.card.MaterialCardView
    android:id="@+id/card_plan"
    style="@style/EFCard"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_marginBottom="@dimen/ef_space_4">

  <LinearLayout android:orientation="vertical"
                android:padding="@dimen/ef_space_6">

    <com.google.android.material.chip.Chip
        android:id="@+id/chip_popular"
        style="@style/EFChip.Active"
        android:text="MOST POPULAR"
        android:visibility="gone" />

    <TextView style="@style/EFType.Overline"
              android:id="@+id/tv_meals_days"
              android:textColor="@color/ef_secondary"
              android:text="60 MEALS · 30 DAYS"
              android:layout_marginTop="@dimen/ef_space_2" />

    <TextView style="@style/EFType.H3"
              android:id="@+id/tv_plan_name"
              android:text="Premium Dining"
              android:layout_marginTop="@dimen/ef_space_1" />

    <TextView style="@style/EFType.BodyMD"
              android:textColor="@color/ef_on_muted"
              android:id="@+id/tv_plan_desc"
              android:text="Eat at our hall · 60 home-style meals across 30 days · scan QR at counter"
              android:layout_marginTop="@dimen/ef_space_2" />

    <LinearLayout android:orientation="horizontal"
                  android:gravity="baseline"
                  android:layout_marginTop="@dimen/ef_space_4">
      <TextView style="@style/EFType.Display.AmountXL"
                android:textColor="@color/ef_on_background"
                android:text="₹2800" />
      <TextView style="@style/EFType.BodySM"
                android:textColor="@color/ef_on_muted"
                android:text="one-time"
                android:layout_marginStart="@dimen/ef_space_2" />
    </LinearLayout>

    <TextView style="@style/EFType.Caption"
              android:textColor="@color/ef_on_muted"
              android:text="≈ ₹93 per day · ₹47 per meal"
              android:layout_marginTop="@dimen/ef_space_1" />

    <LinearLayout android:id="@+id/ll_checks"
                  android:orientation="vertical"
                  android:layout_marginTop="@dimen/ef_space_4" />
    <!-- bind 4 check rows programmatically -->

    <com.google.android.material.button.MaterialButton
        android:id="@+id/btn_subscribe"
        style="@style/EFButton.Primary"
        android:text="Subscribe →"
        android:layout_width="match_parent"
        android:layout_height="@dimen/ef_button_height"
        android:layout_marginTop="@dimen/ef_space_5" />
  </LinearLayout>
</com.google.android.material.card.MaterialCardView>
```

To switch to featured: in Kotlin override `card.setCardBackgroundColor(R.color.ef_primary)` and tint all child TextViews `ef_on_primary`.

---

## 7. iOS sample stub (SwiftUI)

```swift
struct PlanCard: View {
    let plan: Plan
    var featured: Bool { plan.isFeatured }

    var body: some View {
        VStack(alignment: .leading, spacing: EFSpace.s3) {
            if featured {
                Text("MOST POPULAR")
                    .font(EFType.overline)
                    .padding(.horizontal, EFSpace.s2)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(EFColors.card))
                    .foregroundColor(EFColors.primary)
            }
            Text("\(plan.meals) MEALS · \(plan.days) DAYS")
                .efOverline()
                .foregroundColor(featured ? EFColors.onPrimary.opacity(0.85) : EFColors.secondary)

            Text(plan.name).font(EFType.h3)
            Text(plan.description).font(EFType.bodyMD)
                .opacity(featured ? 0.9 : 0.7)

            HStack(alignment: .firstTextBaseline) {
                Text("₹\(plan.price)").efAmountXL()
                Text("one-time").font(EFType.bodySM).opacity(0.7)
            }.padding(.top, EFSpace.s2)

            Text("≈ ₹\(plan.perDay)/day · ₹\(plan.perMeal)/meal")
                .font(EFType.caption).opacity(0.7)

            VStack(alignment: .leading, spacing: 4) {
                ForEach(plan.features, id: \.self) { f in
                    Label(f, systemImage: "checkmark")
                        .font(EFType.bodyMD)
                        .labelStyle(.titleAndIcon)
                }
            }
            .padding(.top, EFSpace.s3)

            Button("Subscribe →") {  /* navigate */ }
                .buttonStyle(EFPressableStyle())
                .frame(maxWidth: .infinity)
                .frame(height: EFTouch.buttonHeight)
                .background(featured ? EFColors.card : EFColors.primary)
                .foregroundColor(featured ? EFColors.primary : EFColors.onPrimary)
                .cornerRadius(EFRadius.pill)
                .padding(.top, EFSpace.s4)
        }
        .padding(EFSpace.s6)
        .background(featured ? EFColors.primary : EFColors.card)
        .foregroundColor(featured ? EFColors.onPrimary : EFColors.onBackground)
        .cornerRadius(EFRadius.card)
        .efShadow(.card3D)
    }
}
```

---

## 8. Acceptance checklist

- [ ] Service toggle (Dining / Tiffin) is a centered pill bar, NOT default Material tabs.
- [ ] Featured plan card has `ef_primary` red background with white text — visually distinct from other cards.
- [ ] "MOST POPULAR" badge sits at top-left of the featured card with inverse colors (white pill on red bg).
- [ ] Display amount uses Cabinet Grotesk ExtraBold 36sp; "one-time" caption is baseline-aligned.
- [ ] Checkmark rows use the green `ef_secondary` checkmark icon (16dp), 8dp gap to label.
- [ ] Subscribe CTA on a featured card is **white pill with red text** (inverse); on a regular card it's the standard primary red pill.
- [ ] Build-your-own slider updates total ₹ live as the thumb drags (no commit-on-release).
- [ ] On mobile, plan cards are 1 per row, never 2.

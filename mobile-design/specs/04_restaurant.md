# 04 · Restaurant (Food Ordering) — Mobile Spec

> **Web reference**: `/app/frontend/src/pages/Restaurant.jsx`
> **Mobile route**: `/restaurant` (PUBLIC; auth gated at checkout)
> Strict ordering-hours rule: backend returns 403 outside hours; show a friendly banner.

---

## 1. Page anatomy (vertical scroll, single column)

```
┌─────────────────────────────────────────┐
│  APP BAR  (red)                         │
├─────────────────────────────────────────┤
│  TICKER STRIP                           │
├─────────────────────────────────────────┤
│  HERO PANEL (red, full-bleed)           │
│  ▸ Overline "EFOODCARE RESTAURANT"      │
│  ▸ H1: hero_title from CMS              │
│  ▸ italic quote                          │
│  ▸ small line: "🚚 tagline"              │
│  ▸ Pill chips row:                       │
│     [⏱ 90 min Fresh Meal Delivery]      │
│     [📞 CALL]   [💬 WA]                  │
│  ▸ Right corner: "101% PURE VEG" badge   │
├─────────────────────────────────────────┤
│  LOCATION BANNER (conditional, ef_accent│
│    bg + ef_danger left border)          │
│  ▸ ⚠ "LOCATION REQUIRED — Enable        │
│     location to confirm we deliver…"     │
├─────────────────────────────────────────┤
│  MESS-MENU CARD (when active)           │
│  · OR "Mess menu coming soon" empty      │
│   state (icon + heading + subtext)       │
├─────────────────────────────────────────┤
│  TRUST-CHIP RAIL (horizontal, no scrol- │
│   lbar)                                  │
│  [NO MAIDA] [NO ARTIFICIAL FLAVOURS] …   │
├─────────────────────────────────────────┤
│  ORDER-IN-PROGRESS strip (conditional)   │
│  ▸ Truck icon + "ORDER IN PROGRESS /     │
│    Tap to track your order →"            │
│  ▸ ef_secondary green bg, full-width pill│
├─────────────────────────────────────────┤
│  SEARCH BAR (full-width, 48dp, radius   │
│   pill, ef_muted bg)                     │
│  🔍 "Search dishes..."                  │
├─────────────────────────────────────────┤
│  CATEGORY CHIPS RAIL (horizontal scroll │
│   w/ no scrollbar)                       │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐         │
│  │🍴│ │🍲│ │🍪│ │🍴│ │💧│ │🍶│         │  ← icon-only chip, 48dp circle
│  └──┘ └──┘ …                              │
│   ALL  MAINS STARTERS TIFFIN …            │  ← caption under each chip
├─────────────────────────────────────────┤
│  DISH GRID — single col on mobile        │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │ [discount-tag top-left] [veg dot]│   │   ← veg-dot top-right (green sq)
│  │                                    │   │
│  │       (dish image, 16:9)          │   │
│  │                                    │   │
│  │ Paneer Tikka          ⏱ 90-MIN    │   │   ← name h4 / time chip green
│  │ Smoky tandoor paneer cubes ...    │   │   ← bodySM muted
│  │ ₹240  ₹280                         │   │   ← discounted price red,
│  │                          [+ Add]   │   │      original strike-through
│  │                          [ Buy →]  │   │
│  └──────────────────────────────────┘   │
│                                          │
│  ── repeat per dish ──                   │
├─────────────────────────────────────────┤
│  FOOTER                                  │
└─────────────────────────────────────────┘
```

When `loading=true` show a **dish-grid skeleton** (3-4 placeholder cards w/ 16:9 grey image + 2 line shimmer).

When ordering hours are closed:
- Replace the dish grid with an EFCard saying "Kitchen is closed right now. Opens 11 AM · 6 PM."
- Disable Add / Buy buttons globally (greyed out).

---

## 2. Token references

| Element | Color | Type | Notes |
|---|---|---|---|
| Hero panel bg | `ef_primary` | — | full-bleed |
| Hero overline | `ef_on_primary` 70% | overline | letter-spacing +0.2em |
| Hero H1 | `ef_on_primary` | displayH1 32sp | Cabinet ExtraBold |
| Hero pill chips | `ef_card` bg, `ef_on_card` text | bodySM 600 | radius pill, 36dp tall, padding 8×12dp |
| 101% PURE VEG badge | `ef_card` bg, `ef_secondary` text + green leaf icon | overline 11sp 800 | top-right of hero |
| Location banner bg | `ef_accent` (light pink) | — | radius 12dp, padding 12dp, mb 16dp |
| Location banner left border | `ef_destructive` 4dp wide | — | inline border-start |
| Trust chip | `ef_muted` bg, `ef_secondary` text | overline 11sp 700 | pill, 8×12dp padding |
| Order-in-progress strip | `ef_secondary` (green) bg, white text | bodyMD 700 | pill, 48dp tall, full-width |
| Search bar | `ef_muted` bg | bodyMD 500 | radius pill, 48dp tall, leading icon 20dp + label |
| Category chip (inactive) | `ef_muted` bg, `ef_on_background` icon | — | 48dp circle |
| Category chip (active) | `ef_primary` bg, `ef_on_primary` icon | — | same size |
| Category chip caption | `ef_on_background` (active) / `ef_on_muted` (inactive) | overline 11sp 700 | mt 4dp below chip |
| Dish image | aspect 16:9, radius 16dp top, clip below | — | full-width inside card |
| Discount tag | `ef_secondary` bg, white text | overline | top-left of image, padding 4×8dp, radius 999 |
| Veg-dot | green outline square 16dp with green dot 8dp centered | — | top-right of image, in white circle bg |
| Dish name | `ef_on_background` | h4 (18sp 700) | mt 12dp |
| Time chip ("90-MIN") | `ef_secondary` | bodySM 600 | inline-right, gap 8dp from name |
| Dish description | `ef_on_muted` | bodySM | mt 4dp, max 2 lines, ellipsis |
| Price current | `ef_primary` | h4 (18sp 800 Cabinet) | inline |
| Price old | `ef_on_muted` line-through | bodySM | inline, ml 8dp |
| "Add" button | outline pill, `ef_border` stroke, `ef_on_background` text | bodyMD 600 | 40dp tall, ic_plus leading |
| "Buy →" button | `EFButton.Primary` | bodyMD 700 | 40dp tall, arrow trailing |

---

## 3. Layout grid

- Page horizontal padding **16dp**.
- Hero panel is full-bleed (extends edge-to-edge).
- Search + category rail + dish list use 16dp page padding.
- Dish card is **full-width** on mobile; on tablets (≥600dp) you may show 2-col grid.
- Image radius: top-left + top-right 16dp; bottom corners follow the card radius 20dp.
- Add / Buy button row sits at card bottom, 16dp from price row.

---

## 4. Shadcn → native component map

| Web | Android | iOS |
|---|---|---|
| Search input | `TextInputLayout style="EFTextField"` w/ `app:startIconDrawable=ic_search` and pill shape | `HStack { Image · TextField }.padding().background(EFColors.muted).cornerRadius(EFRadius.pill)` |
| Category chips rail | `RecyclerView` horizontal, item: `MaterialCardView` 48dp circle + caption below | `ScrollView(.horizontal) { LazyHStack { ... } }` |
| Discount tag chip | `Chip style="EFChip.Active"` positioned via FrameLayout offset | `Text` in `Capsule().fill(EFColors.secondary)` overlay |
| Veg-dot indicator | Custom `View` (drawable: `<shape>` rectangle 16dp green stroke 2dp + center dot) | `ZStack { RoundedRectangle(2).stroke · Circle 8 · fill EFColors.secondary }` |
| Dish image | `ShapeableImageView` w/ corner radii top 16dp only; use Coil for image | `AsyncImage`, `.clipShape(RoundedRectangle(cornerRadius:16, style:.continuous))` masking the top corners |
| Add / Buy row | `MaterialButton` × 2 in `LinearLayout` end-aligned, gap 8dp | `HStack { OutlineButton · PrimaryButton }` |

---

## 5. Empty / error states

| Condition | UI |
|---|---|
| Loading | Skeleton: 1 hero placeholder + 3 dish-card skeletons (image grey block + 2 line shimmers + price+button shimmer) |
| Ordering hours closed | Replace dish grid w/ EFCard: clock icon 32dp + H4 "Kitchen is closed" + bodyMD opens/closes timings |
| Empty search | EFCard: search icon + "No dishes match 'X'" + bodySM muted "Try a different word" |
| Backend error | Snackbar at bottom: `ef_destructive` bg, "Couldn't load menu — tap to retry" |

---

## 6. Animations

| Interaction | Spec |
|---|---|
| Category chip select | Active chip colors crossfade 200ms; underline-style indicator slides via `matchedGeometryEffect` (iOS) or `LayoutTransition` (Android) |
| Add button tap | `tapPress` (scale 0.98 / 120ms) + brief +1 number badge animates above the cart icon in app bar (slide up + fade) |
| Buy button tap | `tapPress` + spinner inline + navigate to `/restaurant/checkout` |
| Dish card press (image area) | Hero-style transition for the image into product detail (use `androidx.transition` shared element / iOS `matchedGeometryEffect`) |
| Skeleton shimmer | `skeletonPulse` 1.5s |

---

## 7. Android sample stub — dish card

```xml
<!-- res/layout/item_dish_card.xml -->
<com.google.android.material.card.MaterialCardView
    android:id="@+id/card_dish"
    style="@style/EFCard"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_marginBottom="@dimen/ef_space_4">

  <LinearLayout android:orientation="vertical">

    <FrameLayout
        android:layout_width="match_parent"
        android:layout_height="200dp">

      <com.google.android.material.imageview.ShapeableImageView
          android:id="@+id/iv_dish"
          android:layout_width="match_parent"
          android:layout_height="match_parent"
          android:scaleType="centerCrop"
          app:shapeAppearanceOverlay="@style/ShapeAppearance.Top.16dp" />

      <com.google.android.material.chip.Chip
          android:id="@+id/chip_discount"
          style="@style/EFChip.Active"
          android:text="14%"
          android:layout_gravity="top|start"
          android:layout_margin="@dimen/ef_space_3"
          app:chipBackgroundColor="@color/ef_secondary"
          android:textColor="@color/ef_on_primary" />

      <View
          android:id="@+id/veg_dot"
          android:layout_width="20dp"
          android:layout_height="20dp"
          android:layout_gravity="top|end"
          android:layout_margin="@dimen/ef_space_3"
          android:background="@drawable/bg_veg_dot" />
    </FrameLayout>

    <LinearLayout
        android:orientation="vertical"
        android:padding="@dimen/ef_card_inner">

      <LinearLayout android:orientation="horizontal" android:gravity="center_vertical">
        <TextView style="@style/EFType.H4"
                  android:id="@+id/tv_name"
                  android:layout_width="0dp"
                  android:layout_weight="1"
                  android:text="Paneer Tikka" />
        <TextView style="@style/EFType.BodySM"
                  android:id="@+id/tv_time"
                  android:textColor="@color/ef_secondary"
                  android:text="⏱ 90-MIN" />
      </LinearLayout>

      <TextView style="@style/EFType.BodySM"
                android:textColor="@color/ef_on_muted"
                android:id="@+id/tv_desc"
                android:text="Smoky tandoor paneer cubes marinated in yogurt and spices."
                android:maxLines="2"
                android:ellipsize="end"
                android:layout_marginTop="@dimen/ef_space_1" />

      <LinearLayout android:orientation="horizontal" android:gravity="center_vertical"
                    android:layout_marginTop="@dimen/ef_space_3">
        <TextView style="@style/EFType.H4"
                  android:textColor="@color/ef_primary"
                  android:id="@+id/tv_price"
                  android:text="₹240" />
        <TextView style="@style/EFType.BodySM"
                  android:textColor="@color/ef_on_muted"
                  android:id="@+id/tv_price_old"
                  android:text="₹280"
                  android:layout_marginStart="@dimen/ef_space_2"
                  android:textStyle="normal"
                  android:paintFlags="0x10" />  <!-- strike-through -->

        <Space android:layout_width="0dp" android:layout_height="0dp"
               android:layout_weight="1" />

        <com.google.android.material.button.MaterialButton
            android:id="@+id/btn_add"
            style="@style/EFButton.Outline"
            app:icon="@drawable/ic_plus"
            android:text="Add"
            android:layout_height="40dp" />

        <com.google.android.material.button.MaterialButton
            android:id="@+id/btn_buy"
            style="@style/EFButton.Primary"
            android:text="Buy →"
            android:layout_height="40dp"
            android:layout_marginStart="@dimen/ef_space_2" />
      </LinearLayout>
    </LinearLayout>
  </LinearLayout>
</com.google.android.material.card.MaterialCardView>
```

---

## 8. iOS sample stub (SwiftUI)

```swift
struct DishCard: View {
    let dish: Dish
    let onAdd: () -> Void
    let onBuy: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                AsyncImage(url: dish.imageURL) { phase in
                    if let img = phase.image { img.resizable().scaledToFill() }
                    else { EFColors.muted }
                }
                .frame(height: 200).clipped()
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                if let d = dish.discountPercent {
                    Text("\(d)%")
                        .font(EFType.overline)
                        .padding(.horizontal, EFSpace.s2).padding(.vertical, 4)
                        .background(Capsule().fill(EFColors.secondary))
                        .foregroundColor(EFColors.onPrimary)
                        .padding(EFSpace.s3)
                }
                vegDot.padding(EFSpace.s3).frame(maxWidth: .infinity, alignment: .topTrailing)
            }

            VStack(alignment: .leading, spacing: EFSpace.s1) {
                HStack {
                    Text(dish.name).font(EFType.h4)
                    Spacer()
                    Label(dish.prepTimeLabel, systemImage: "clock")
                        .font(EFType.bodySM)
                        .foregroundColor(EFColors.secondary)
                }
                Text(dish.description).font(EFType.bodySM)
                    .foregroundColor(EFColors.onMuted)
                    .lineLimit(2)

                HStack(alignment: .firstTextBaseline) {
                    Text("₹\(dish.price)").font(EFType.h4)
                        .foregroundColor(EFColors.primary)
                    if let old = dish.originalPrice {
                        Text("₹\(old)").font(EFType.bodySM)
                            .strikethrough()
                            .foregroundColor(EFColors.onMuted)
                    }
                    Spacer()
                    Button(action: onAdd) { Label("Add", systemImage: "plus") }
                        .buttonStyle(EFOutlineButtonStyle())
                    Button("Buy →", action: onBuy)
                        .buttonStyle(EFPrimaryButtonStyle())
                }.padding(.top, EFSpace.s3)
            }
            .padding(EFSpace.cardInner)
        }
        .background(EFColors.card)
        .cornerRadius(EFRadius.card)
        .efShadow(.card3D)
    }

    private var vegDot: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4).stroke(EFColors.secondary, lineWidth: 2)
                .frame(width: 16, height: 16)
            Circle().fill(EFColors.secondary).frame(width: 8, height: 8)
        }
        .padding(2).background(Circle().fill(.white))
    }
}
```

---

## 9. Acceptance checklist

- [ ] Hero panel uses red bg + the "101% PURE VEG" badge stays anchored top-right even on smaller screens.
- [ ] Location-required banner shows ONLY when GPS permission is denied OR `lat/lng` not yet set on the user record. After grant, it animates out (fade 220ms).
- [ ] Category chips rail scrolls horizontally without showing a scroll-track (matches web's `.no-scrollbar`).
- [ ] Dish image radius is 16dp on **top corners only** (not all 4); the card itself handles bottom radius.
- [ ] Discounted price uses `ef_primary` red; original price is strike-through muted.
- [ ] "Add" is outline-only; "Buy →" is filled primary. Their heights are 40dp (smaller than the 48dp dashboard primary because they sit in a tight row).
- [ ] When `ordering_hours_closed`, both buttons go disabled + a closed-kitchen card replaces the dish grid.
- [ ] Veg-dot indicator: green square outline with a green dot in the centre. Never use a yellow / red dot — eFoodCare is 100% veg.

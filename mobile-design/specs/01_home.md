# 01 · Home / Landing — Mobile Spec

> **Web reference**: `/app/frontend/src/pages/Landing.jsx` · live at `https://efoodcare.in/`
> **Mobile route**: `/` (root) — first screen for unauthenticated users
> **Token file**: `/app/mobile-design/common/design_tokens.json`

---

## 1. Page anatomy (top → bottom)

```
┌─────────────────────────────────────────┐
│  APP BAR  (56dp, EFColors.primary bg)   │  ← red, white text
│  ▸ logo · brand "efoodcare" + tagline   │
│  ▸ right: location pill · ₹wallet pill  │
│  ▸ rightmost: hamburger ☰ (40dp)         │
├─────────────────────────────────────────┤
│  TICKER STRIP  (28dp, red bg, white)    │  ← marquee, "मिलावटी खाना ..."
├─────────────────────────────────────────┤
│  HERO  (full-bleed red panel)           │
│  ▸ Overline: "EFOODCARE"                │
│  ▸ Display H1: brand hero line          │
│  ▸ Italic quote: tagline                │
│  ▸ Pills row: "90-min", CALL, WA        │
├─────────────────────────────────────────┤
│  SECTION GAP  24dp                      │
│  ▸ "Why us?" 4-tile grid (2×2 on mobile)│
│  ▸ Each tile: lucide icon + headline +  │
│    1-line subhead, EFCard.Flat          │
├─────────────────────────────────────────┤
│  PLANS PREVIEW                          │
│  ▸ Overline + H2 "Pick a plan"          │
│  ▸ Horizontal scroll (snap) of 2-3      │
│    plan cards (≈ 280×360dp each)        │
│  ▸ "See all plans →" link               │
├─────────────────────────────────────────┤
│  TESTIMONIALS                           │
│  ▸ Horizontal carousel · auto-advance   │
│  ▸ Card: avatar 40dp + name + quote     │
├─────────────────────────────────────────┤
│  FOOTER                                 │
│  ▸ Phone + Email + Address (icon rows)  │
│  ▸ FSSAI license card (EFCard.Flat)     │
│  ▸ © year · "ghar se achha khana"       │
└─────────────────────────────────────────┘
```

**Page background**: `EFColors.background` (white) — except hero panel which is `EFColors.primary`.

---

## 2. Token references (use ONLY these values)

| Element | Color | Type style | Spacing |
|---|---|---|---|
| App-bar bg | `ef_primary` / `EFColors.primary` | — | height `ef_appbar_height` (56dp) |
| App-bar logo text | `ef_on_primary` | `EFType.h4` weight 700 | gap-8 between icon & text |
| Hero overline | `ef_on_primary` 70% opacity | `EFType.overline` (11sp, +0.2em, uppercase) | mb 8dp |
| Hero H1 | `ef_on_primary` | `EFType.displayH1` (32sp, Cabinet Grotesk ExtraBold, kern -0.02em) | mb 12dp |
| Hero quote | `ef_on_primary` 90% | `EFType.bodyLG` italic | — |
| Section overline (eg. "WHY US") | `ef_secondary` | `EFType.overline` | mt 32dp, mb 8dp |
| Section H2 | `ef_on_background` | `EFType.displayH2` (24sp) | mb 16dp |
| Why-us tile | `ef_card` bg, `card_3d` shadow | icon 24dp + title `h4` + body `bodySM` | padding `ef_card_inner` (16dp), gap 12dp |
| CTA "Subscribe" | `EFButton.Primary` | `bodyMD` 700 | height 48dp, radius pill |

---

## 3. Layout grid

- **Page horizontal padding**: 16dp (left & right) — `EFSpace.pageHorizontal`
- **Section vertical gap**: 32dp between major sections, 24dp between cards inside a section
- **Hero panel**: full-bleed (ignores horizontal padding); inner content inset by 20dp
- **Why-us grid**: 2 columns on mobile, 12dp gap, square aspect (1:1)
- **Plans preview**: horizontal `LazyRow` (Android) / `ScrollView(.horizontal)` (iOS), snap-to-card; card width 280dp, height 360dp; gap 16dp between cards; first card leading edge 16dp from screen edge

---

## 4. Shadcn → native component map

| Web component | Android | iOS (SwiftUI) | Notes |
|---|---|---|---|
| `<Button variant="default">` (rounded-full bg-primary) | `MaterialButton style="EFButton.Primary"` | `Button(...) .buttonStyle(EFPressableStyle())` w/ `EFColors.primary` fill | Pill shape, 48dp tall |
| `<Card>` w/ class `surface-3d` | `MaterialCardView style="EFCard"` | `RoundedRectangle(cornerRadius: EFRadius.card).fill(EFColors.card).efShadow(.card3D)` | radius 20dp, elev 4dp |
| Lucide icon | Use Material Symbols Rounded (closest match) at 24dp stroke 2 | SF Symbols (use weight `.regular`, scale `.medium`) | Lucide stroke width 1.75 ≈ SF `.regular` |
| Marquee ticker | `MarqueeView` (3rd-party) or `RecyclerView` w/ infinite-loop adapter | `TimelineView` + offset animation | 60-80 px/sec scroll |

---

## 5. Animation timings

| Interaction | Spec |
|---|---|
| Page enter (after data resolves) | Fade-in 180ms ease-in (`EFMotion.pageFadeIn`) |
| Hero CTA tap | Scale to 0.98 over 120ms (`EFMotion.tapPress`) |
| Why-us tile press | Translate Y -1dp, raise shadow over 220ms (`EFMotion.cardHover`) |
| Testimonials carousel | Auto-advance 4 s, slide 300ms ease-out |
| Ticker marquee | 60-80 px/sec linear, loop infinite |

---

## 6. Android sample stub (XML + Kotlin)

```xml
<!-- res/layout/fragment_home.xml -->
<androidx.core.widget.NestedScrollView
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/ef_background">

  <LinearLayout
      android:orientation="vertical"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:paddingBottom="@dimen/ef_space_8">

    <!-- Hero red panel -->
    <LinearLayout
        android:orientation="vertical"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:padding="@dimen/ef_space_5"
        android:background="@color/ef_primary">

      <TextView
          style="@style/EFType.Overline"
          android:textColor="@color/ef_on_primary"
          android:alpha="0.7"
          android:text="EFOODCARE" />

      <TextView
          style="@style/EFType.Display.H1"
          android:textColor="@color/ef_on_primary"
          android:text="@string/home_hero_title"
          android:layout_marginTop="@dimen/ef_space_2" />
    </LinearLayout>

    <!-- Section: Why us -->
    <TextView
        style="@style/EFType.Overline"
        android:layout_marginStart="@dimen/ef_page_horizontal"
        android:layout_marginTop="@dimen/ef_space_8"
        android:text="WHY US" />

    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/rv_why_us"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginHorizontal="@dimen/ef_page_horizontal"
        android:layout_marginTop="@dimen/ef_space_4"
        app:layoutManager="androidx.recyclerview.widget.GridLayoutManager"
        app:spanCount="2"
        android:clipToPadding="false" />
  </LinearLayout>
</androidx.core.widget.NestedScrollView>
```

```kotlin
// HomeFragment.kt
class HomeFragment : Fragment(R.layout.fragment_home) {
    override fun onViewCreated(view: View, s: Bundle?) {
        view.findViewById<RecyclerView>(R.id.rv_why_us).apply {
            adapter = WhyUsAdapter(WHY_US_ITEMS)
            addItemDecoration(SpacingDecoration(gapDp = 12))
        }
    }
}
```

---

## 7. iOS sample stub (SwiftUI)

```swift
struct HomeView: View {
    @ObservedObject var vm: HomeViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EFSpace.s8) {
                heroPanel
                whyUsSection
                plansPreview
                testimonials
                footer
            }
            .padding(.bottom, EFSpace.s8)
        }
        .background(EFColors.background.ignoresSafeArea())
    }

    private var heroPanel: some View {
        VStack(alignment: .leading, spacing: EFSpace.s3) {
            Text("EFOODCARE").efOverline().opacity(0.7)
                .foregroundColor(EFColors.onPrimary)
            Text(vm.heroTitle).efDisplayH1()
                .foregroundColor(EFColors.onPrimary)
            Text(vm.heroTagline).font(EFType.bodyLG).italic()
                .foregroundColor(EFColors.onPrimary.opacity(0.9))
        }
        .padding(EFSpace.s5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(EFColors.primary)
    }
}
```

---

## 8. Acceptance checklist

- [ ] App-bar height exactly 56dp; logo + brand text + 3 right pills all vertically centered.
- [ ] Hero panel uses `EFColors.primary` exactly (`#D02424`), not a near-red.
- [ ] Hero H1 uses Cabinet Grotesk ExtraBold; if font fails to load, falls back to Manrope Bold (not system).
- [ ] Section overlines are uppercase, +0.2em letter-spacing, `EFColors.secondary` (green).
- [ ] Why-us tiles raise on press with the `card_3d` shadow recipe.
- [ ] Primary CTA buttons are pill-shaped (radius = pill), 48dp tall.
- [ ] Page background is pure white `#FFFFFF`, never `#FAFAFA` / `#F5F5F5`.

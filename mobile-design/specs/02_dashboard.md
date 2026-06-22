# 02 · Dashboard — Mobile Spec

> **Web reference**: `/app/frontend/src/pages/SubscriberDashboard.jsx` (378 lines)
> **Mobile route**: `/dashboard` (auth required, role=subscriber)
> **The most-used screen in the entire app — pixel-perfect parity matters most here.**

---

## 1. Page anatomy (top → bottom, **single column**, scroll)

```
┌─────────────────────────────────────────┐
│  APP BAR (same as Home)                 │
├─────────────────────────────────────────┤
│  GREETING                               │
│  ▸ Overline (green): "GOOD MORNING, X"  │
│  ▸ H1 display: "Your e-Meal Pass"       │
│  ▸ italic muted subtext                 │
├─────────────────────────────────────────┤
│  PAYMENT-STACK (conditional)            │
│  ▸ PendingCashOtpFlash (amber card)     │
│  ▸ PendingDuesCard       (amber card)   │
├─────────────────────────────────────────┤
│  ── dash-divider ── (2dp red gradient)  │
│  TIFFIN ONLY:                            │
│  ▸ PendingDeliveriesBanner               │
│  ▸ TiffinPreferencesCard                 │
│  ── dash-divider ──                      │
├─────────────────────────────────────────┤
│  HERO CARD                              │
│  · EAT-IN → QRTicket (red, full-bleed)  │
│  · TIFFIN → TiffinHeroCard              │
├─────────────────────────────────────────┤
│  WALLET CARD  (red, 24dp radius)        │
│  ▸ icon Wallet + "WALLET" overline      │
│  ▸ ₹ amount (36sp Cabinet ExtraBold)    │
│  ▸ "of ₹X loaded" caption                │
│  ▸ Divider line (white @15%)             │
│  ▸ 2-col grid: Per day · Extended        │
│  ▸ footer caption                        │
├─────────────────────────────────────────┤
│  TODAY (eat-in only) — EFCard           │
│  ▸ Overline "TODAY"                     │
│  ▸ Lunch row · Dinner row (StatusRow)   │
│  ▸ "Scan counter QR" pill CTA            │
├─────────────────────────────────────────┤
│  TODAY'S MENU — EFCard                  │
│  ▸ Overline "TODAY'S MENU"              │
│  ▸ TodayMessMenuFlash component (lunch  │
│    + dinner side-by-side, fades in)      │
├─────────────────────────────────────────┤
│  HISTORY (eat-in only) — EFCard         │
│  ▸ Overline "RECENT CHECK-INS"          │
│  ▸ Scrollable list (max 10), each row:   │
│    sun/moon icon · meal · date · time   │
├─────────────────────────────────────────┤
│  Renew CTA strip                        │
│  ▸ "Renew now" pill (primary), prom-     │
│    pted when days_left < 7              │
└─────────────────────────────────────────┘
```

> While the dashboard's APIs are loading, render `DashboardSkeleton` (see `/app/frontend/src/components/DashboardSkeleton.jsx`) — pulse-animated grey blocks mirroring the layout above.

---

## 2. Token references

| Element | Color | Type | Notes |
|---|---|---|---|
| Greeting overline | `ef_secondary` (green) | overline 11sp | tracking +0.2em |
| Greeting H1 | `ef_on_background` | displayH1 32sp | Cabinet ExtraBold, kern -0.02em |
| Greeting subtext | `ef_on_muted` | bodySM italic | mt 4dp |
| **Wallet card bg** | `ef_primary` (when active) or `#B45309` amber (when paused) | — | radius 20dp |
| Wallet ₹ amount | `ef_on_primary` (white) | `amountXL` 36sp Cabinet ExtraBold | leading-none, baseline-aligned with ₹ icon 28dp |
| Wallet "of ₹X loaded" | `ef_on_primary` 80% | caption 12sp | mt 12dp |
| Wallet divider | `ef_on_primary` 15% alpha | hairline 1dp | mt 20dp |
| Per-day amount | `ef_on_primary` | h4 Cabinet Bold 18sp | gap from overline 4dp |
| **EFCard sections** (Today / Menu / History) | `ef_card` bg, `border: rgba(0,0,0,0.05)` | — | radius 20dp, `card_3d` shadow, padding 24dp |
| Section overlines | `ef_on_muted` | overline | mb 16dp |
| StatusRow (lunch/dinner) | icon=secondary if not yet done; primary when done | bodyMD 500 | gap 8dp |
| Self-scan CTA | `EFButton.Primary` | bodyMD 700 | width MATCH_PARENT, height 48dp |
| dash-divider | linear gradient: transparent → `ef_primary` @ 80% → transparent | 2dp tall | margin-vertical 18dp |

---

## 3. Layout grid

- Page horizontal padding **16dp** (mobile) — on web it's wider; we override.
- Vertical gap between major blocks **24dp**; inside cards **16dp** between sub-elements.
- Wallet card and EFCards are full-width minus 32dp (= page padding × 2). Corner radius 20dp.
- History list inside the EFCard is **max-height 224dp**, scrolls internally (do **not** create a nested vertical scroll on Android — use `nestedScrollingEnabled=true`).

---

## 4. Wallet card — pixel-perfect breakdown

```
┌─────────────────────────────────────────┐   bg = ef_primary
│ [icon-wallet 20dp]            WALLET   │   icon opacity 70%, overline white 70%
│                                         │
│ ₹ 7,420                                 │   ₹ icon 28dp, number 36sp Cabinet ExtraBold
│ of ₹ 12,400 loaded                     │   12sp white 80%
│ ────────────────────────────────────── │   1dp hairline, white @15%
│ PER DAY · PER MEAL    EXTENDED          │   2-col grid, 16dp gap
│ ₹103.33 · ₹51.67/meal  4 days           │   18sp Cabinet Bold
│                                         │
│ Skip 3+ days in a row → wallet pauses  │   12sp white 70%, mt 16dp
│  & your plan auto-extends. ...          │
└─────────────────────────────────────────┘
   Padding: 24dp all sides
   Radius:  20dp
```

When `isPaused` is true, the entire bg switches to `#B45309` (amber-700) and the overline reads "WALLET · PAUSED".

---

## 5. Shadcn → native component map

| Web component | Android | iOS |
|---|---|---|
| `<QRTicket>` (custom, see file) | Custom view: full-bleed red panel + QR bitmap centered (use **ZXing** lib) + plan name underneath | `QRTicketView` SwiftUI w/ `CIFilter.qrCodeGenerator()` output as `Image` |
| `<TiffinHeroCard>` | Same pattern, swap QR for delivery-truck illustration + ETA | Same |
| `<StatusRow icon label done>` | Custom XML `<include>` row: icon (16dp) + label + checkmark if done | `HStack { Image · Text · Spacer · Image(.checkmark) }` |
| Wallet card | `MaterialCardView` style `EFCard` with `cardBackgroundColor=ef_primary` & `contentPadding=24dp` | `RoundedRectangle .fill(EFColors.primary)` 20dp radius |
| dash-divider | Custom drawable: `<shape>` w/ linear-gradient | `Rectangle().fill(LinearGradient(...))` height 2 |
| `<TodayMessMenuFlash compact>` | `RecyclerView` (h=auto) of 2 cards (lunch+dinner) inside this EFCard | `VStack` of 2 `MealMenuRowView` |

---

## 6. Animation timings

| Interaction | Spec |
|---|---|
| Skeleton shimmer | `EFMotion.skeletonPulse` (1.5s ease-in-out, opacity 0.4 ↔ 1, infinite) |
| Data resolved → real cards | Crossfade 180ms (`EFMotion.pageFadeIn`) |
| Wallet card press (no action, info-only) | None (it's not tappable) |
| "Scan counter QR" press | `tapPress` (scale 0.98 / 120ms) + navigate to `/self-scan` |
| Renew strip slide-in | translate-Y from +8dp to 0 over 220ms ease-out, once on mount |

---

## 7. Android sample stub

```xml
<!-- res/layout/fragment_dashboard.xml -->
<androidx.core.widget.NestedScrollView ...>
  <LinearLayout android:orientation="vertical"
                android:paddingHorizontal="@dimen/ef_page_horizontal"
                android:paddingVertical="@dimen/ef_space_5">

    <!-- Greeting -->
    <TextView style="@style/EFType.Overline"
              android:text="@string/dash_greeting_morning" />
    <TextView style="@style/EFType.Display.H1"
              android:text="@string/dash_heading"
              android:layout_marginTop="@dimen/ef_space_2" />

    <!-- Wallet card -->
    <com.google.android.material.card.MaterialCardView
        style="@style/EFCard"
        app:cardBackgroundColor="@color/ef_primary"
        android:layout_marginTop="@dimen/ef_section_gap">

      <LinearLayout android:orientation="vertical"
                    android:padding="@dimen/ef_space_6">

        <LinearLayout android:orientation="horizontal"
                      android:gravity="center_vertical">
          <ImageView android:src="@drawable/ic_wallet"
                     android:layout_width="@dimen/ef_icon_md"
                     android:layout_height="@dimen/ef_icon_md"
                     android:alpha="0.7"
                     app:tint="@color/ef_on_primary" />
          <Space android:layout_width="0dp"
                 android:layout_height="0dp"
                 android:layout_weight="1" />
          <TextView style="@style/EFType.Overline"
                    android:textColor="@color/ef_on_primary"
                    android:alpha="0.7"
                    android:text="WALLET" />
        </LinearLayout>

        <TextView style="@style/EFType.Display.AmountXL"
                  android:textColor="@color/ef_on_primary"
                  android:text="₹ 7,420"
                  android:layout_marginTop="@dimen/ef_space_3" />

        <!-- 2-col stat grid: see full sample in /app/mobile-design/android/samples/ -->
      </LinearLayout>
    </com.google.android.material.card.MaterialCardView>
  </LinearLayout>
</androidx.core.widget.NestedScrollView>
```

---

## 8. iOS sample stub (SwiftUI)

```swift
struct DashboardView: View {
    @ObservedObject var vm: DashboardViewModel

    var body: some View {
        Group {
            if vm.loading {
                DashboardSkeleton()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: EFSpace.s6) {
                        GreetingHeader(name: vm.user.name)
                        WalletCard(sub: vm.subscription, isPaused: vm.isPaused)
                        if vm.subscription.serviceType == .eatIn {
                            TodayStatusCard(lunch: vm.lunchDone, dinner: vm.dinnerDone)
                        }
                        TodayMenuCard(menu: vm.menu)
                        if vm.subscription.serviceType == .eatIn {
                            HistoryCard(items: vm.history)
                        }
                    }
                    .padding(.horizontal, EFSpace.pageHorizontal)
                    .padding(.vertical, EFSpace.s5)
                }
                .background(EFColors.background)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load() }
    }
}

struct WalletCard: View {
    let sub: Subscription
    let isPaused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: EFSpace.s3) {
            HStack {
                Image(systemName: "creditcard").font(.system(size: 20)).opacity(0.7)
                Spacer()
                Text(isPaused ? "WALLET · PAUSED" : "WALLET")
                    .efOverline().opacity(0.7)
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Image(systemName: "indianrupeesign").font(.system(size: 28, weight: .bold))
                Text(sub.walletBalance.formattedINR)
                    .efAmountXL()
            }
            Text("of ₹\(sub.amountPaid.formattedINR) loaded")
                .font(EFType.caption).opacity(0.8)

            Rectangle().fill(Color.white.opacity(0.15)).frame(height: 1)
                .padding(.vertical, EFSpace.s4)

            HStack(spacing: EFSpace.s4) {
                StatColumn(label: "PER DAY · PER MEAL",
                           value: "₹\(sub.perDay) · ₹\(sub.perMeal)/meal")
                StatColumn(label: "EXTENDED",
                           value: "\(sub.pausedDays) days")
            }

            Text("Skip 3+ days in a row → wallet pauses & your plan auto-extends.")
                .font(EFType.caption).opacity(0.7)
                .padding(.top, EFSpace.s4)
        }
        .padding(EFSpace.s6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isPaused ? Color(hex: 0xB45309) : EFColors.primary)
        .foregroundColor(EFColors.onPrimary)
        .cornerRadius(EFRadius.card)
    }
}
```

---

## 9. Acceptance checklist

- [ ] Skeleton renders before any data arrives (do NOT show a blank white screen).
- [ ] Wallet ₹ amount uses **Cabinet Grotesk ExtraBold 36sp** and is baseline-aligned with the ₹ icon.
- [ ] Wallet card switches to amber bg + "WALLET · PAUSED" overline when `is_paused=true`.
- [ ] "Scan counter QR" button is full-width pill, 48dp tall, primary red.
- [ ] dash-divider gradient is visible (transparent → red → transparent), not a solid line.
- [ ] History list never overflows the card (internal scroll, max-height 224dp).
- [ ] Renew strip appears only when `days_left < 7` and links to `/plans`.
- [ ] Eat-in subscribers see "Today" status card + history; tiffin subscribers see tracker + preferences instead. **Do not show both stacks** to the wrong service type.

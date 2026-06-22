# 07 · Profile — Mobile Spec (Reference / parity)

> **Web reference**: `/app/frontend/src/pages/Profile.jsx`
> **Mobile route**: `/profile` (auth required)
> **Status**: User has confirmed this page **already looks good** in the existing pass-scan-mobile app. This spec is a reference only, ensuring any future updates keep the same tokens.

---

## 1. Page anatomy

```
┌─────────────────────────────────────────┐
│  APP BAR                                │
├─────────────────────────────────────────┤
│  AVATAR + IDENTITY HEADER               │
│  ▸ Avatar circle 96dp (or initials)     │
│  ▸ H2 display: <user.name>              │
│  ▸ bodyMD muted: <user.phone>           │
│  ▸ overline + badge for plan status     │
├─────────────────────────────────────────┤
│  EDIT-PROFILE FORM (EFCard)             │
│  ▸ TextInputField NAME                  │
│  ▸ TextInputField PHONE (locked)        │
│  ▸ TextInputField EMAIL                 │
│  ▸ TextInputField DOB (date picker)     │
│  ▸ Segmented GENDER (M / F / Other)     │
│  ▸ TextInputField ADDRESS (multiline)   │
│  ▸ Pin-location button (uses GPS)       │
│  ▸ Save button (primary CTA, pill)      │
├─────────────────────────────────────────┤
│  PREFERENCES CARD                       │
│  ▸ Switch: Sound on scan                │
│  ▸ Switch: Voice prompts                │
├─────────────────────────────────────────┤
│  ACCOUNT ACTIONS CARD                   │
│  ▸ "Linked accounts" → if email + phone │
│   are merged, show "1 linked account"   │
│  ▸ "Logout" row (destructive icon, red) │
│  ▸ "Delete account" row (destructive    │
│   text, opens confirm sheet)            │
└─────────────────────────────────────────┘
```

---

## 2. Token references

| Element | Color | Type |
|---|---|---|
| Avatar bg (initials fallback) | `ef_accent` | — |
| Avatar text (initials) | `ef_primary` | h3 (20sp 700) |
| User name | `ef_on_background` | displayH2 |
| User phone | `ef_on_muted` | bodyMD |
| Plan badge | `ef_secondary` bg, white text | overline |
| Form section overline | `ef_on_muted` | overline |
| TextField | `EFTextField` style (outlined, radius 12dp) | bodyMD |
| Locked field (phone) | `ef_muted` bg, `ef_on_muted` text, disabled | bodyMD |
| Segmented (gender) | `EFChip.Filled` for inactive, `EFChip.Active` for selected | bodyMD 600 |
| Save CTA | `EFButton.Primary` | bodyMD 700 |
| Preferences row | EFCard.Flat list w/ Material Switch | bodyMD |
| Logout row | `ef_danger` text + ic_logout | bodyMD 600 |
| Delete account row | `ef_destructive` text + ic_trash | bodyMD 600 |

---

## 3. Validation rules (must mirror web)

| Field | Rule | Error message |
|---|---|---|
| Name | regex `^[A-Za-z\s\-]+$` (letters/spaces/hyphens only, 2-60 chars) | "Use letters only — no numbers." |
| Phone | locked — uneditable. Tap shows tooltip "Phone is your login ID and cannot be changed here." | — |
| Email | RFC 5322 simple | "Enter a valid email." |
| DOB | must be ≥ 13 years ago | "You must be 13 or older." |
| Address | min 10 chars | "Add a fuller address so the delivery boy can find you." |

---

## 4. Delete-account confirm sheet

A modal bottom-sheet (Android `BottomSheetDialogFragment`, iOS `.sheet`) with:

1. Heading: "Delete your account?"
2. Body bodyMD muted: "This will erase your wallet balance, all subscriptions, attendance history and any tiffin records. **This cannot be undone.**" — Highlight "cannot be undone" in `ef_destructive` weight 700.
3. Type-to-confirm TextField labelled "Type DELETE to confirm" (case-sensitive).
4. Two buttons:
   - Outline "Cancel" (closes sheet)
   - Filled `ef_destructive` "Delete forever" (disabled until input == "DELETE", then enabled)
5. On confirm → call `DELETE /api/auth/me`, on success → wipe session token from Keychain/EncryptedSharedPrefs and route to `/login`.

---

## 5. Acceptance checklist

- [ ] Name field validation matches web (letters, spaces, hyphens only — no digits like "User 4744").
- [ ] Phone field is **locked** (not editable, has a lock icon trailing the value).
- [ ] Save button shows inline spinner during request; disables on click; re-enables on success/error.
- [ ] Delete-account sheet requires literal "DELETE" typed before the destructive button enables.
- [ ] Logout row is `ef_danger` (lighter red) — Delete is `ef_destructive` (darker red) — visually distinct.
- [ ] Preference switches use the platform-native switch style (Material Switch / iOS UISwitch) tinted to `ef_secondary` (green-on for both).

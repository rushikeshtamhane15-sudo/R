# Mess Subscription App - PRD

## Problem Statement
Build a mess/dining subscription management app where users pay once for a 30-day plan (60 meals = 2/day lunch + dinner), and attendance is tracked via QR code scanning (e-coupon style) at the counter. Each scan marks presence for that specific meal and deducts from the balance until the subscription ends.

## Roles
- Admin (manages menu, users, views analytics)
- Staff (scans subscriber QR at counter)
- Subscriber (owns a personal QR meal pass)

## Core Requirements
- Google OAuth (Emergent managed)
- Stripe payments for subscription plans
- Bi-directional QR flow: staff scans subscriber OR subscriber scans counter
- Duplicate-meal protection (1 lunch + 1 dinner per day)
- Daily menu display
- Admin analytics: revenue, active subs, attendance trend (7 days)

## Implemented (Feb 2026)
- Backend API: auth, plans, checkout, webhook, attendance scan/self-scan, counter code, admin stats/users/role/menu, menu today
- Frontend pages: Landing, Login, AuthCallback, Subscriber Dashboard (QR ticket), Staff Scanner (camera), Counter QR display, Self-Scan, Plans, Payment Success, Admin Dashboard
- Earthy green + terracotta design system (Cabinet Grotesk + Manrope)

## Backlog / Next Items
- P1: Admin menu editor UI (backend ready, frontend edit form pending)
- P1: Email/SMS reminder for unused daily meal
- P2: Monthly report PDF export
- P2: Multi-mess support

## Test Credentials
See `/app/memory/test_credentials.md`. Admin email allowlist via env: `ADMIN_EMAILS`.

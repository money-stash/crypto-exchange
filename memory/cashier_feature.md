---
name: Cashier (Автовыдача) feature
description: New CASHIER role for people who add their own payment cards to the system for automatic order routing
type: project
---

New role `CASHIER` added to the `supports` table (same table, role='CASHIER').

**Why:** Team wanted a third role beyond operators — people who bring their own bank cards and put them to work for auto-routing of client payments.

**How to apply:** When working on orders, payments, or role-based logic, remember CASHIER is now a valid role that sees orders auto-assigned to their cards.

## Key files added/modified:
- `python_backend/migration_cashier.sql` — run this first to create DB table
- `python_backend/app/models/cashier.py` — CashierCard SQLAlchemy model
- `python_backend/app/models/order.py` — added `cashier_card_id` column
- `python_backend/app/services/cashier_service.py` — card selection algorithm + volume tracking
- `python_backend/app/routers/cashiers.py` — `/api/cashiers/` REST endpoints
- `python_backend/app/middleware/auth.py` — CASHIER added to `require_auth`
- `frontend/src/pages/CashierPage.jsx` — personal cabinet for CASHIER role
- `frontend/src/pages/CashiersManagementPage.jsx` — superadmin management page

## Business logic:
- Card selection: prefer dirty (used) cards by least volume → if interval blocks all → take clean card → else fallback to operator
- `system_settings.cashier_order_interval` = N: every N-th order goes to operators (0 = all auto)
- When card hits volume limit → `is_active=0`, `limit_reached_notified=1`, shown in dashboard
- Cashier extends limit via `/me/cards/{id}/extend-limit`
- Volume tracked on order COMPLETED only (not on assignment)
- Rate for cashier role = Rapira + 4 RUB (informational, not yet auto-calculated)

## Cashier deposit system (added 2026-04-24):
Cashiers must maintain a RUB deposit to work. Anti-scam: if fake client + cashier confirm payment without real funds, the deposit depletes — preventing system wallet drain.

**DB fields in `supports`:** `deposit`, `deposit_work`, `deposit_paid` (all Decimal 14,2, in RUB)
**New table:** `cashier_deposits` — tracks top-up transactions

**Flow:**
1. Cashier sends BTC to system wallet address (from `crypto_wallet_address_BTC` setting)
2. Submits TX hash via `POST /api/cashiers/me/deposit/topup` → blockchain verified (Blockstream API) → credited in RUB at current BTC rate
3. When `confirm-payment` called → checks `deposit - deposit_work >= sum_rub` → freezes `deposit_work += sum_rub`
4. When order COMPLETES → `deposit -= sum_rub`, `deposit_work -= sum_rub`, `deposit_paid += sum_rub`
5. When order CANCELLED (admin) → `deposit_work -= sum_rub` (unfreeze only, no deduction)
6. Admin can manually adjust deposit via `POST /api/cashiers/{id}/deposit/adjust`

**Key files modified:** `deals.py`, `orders.py`, `cashiers.py`, `CashierPage.jsx`, `CashiersManagementPage.jsx`, `api.js`
**Migration:** `migration_cashier_deposit.sql`

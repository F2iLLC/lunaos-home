---
name: home.food_ordering
description: Order takeout or delivery food for the household from any restaurant. Find the merchant, handle site pop-ups, apply household preferences and dietary restrictions, assemble a cart without submitting, check the budget, get explicit approval, pay through an approved payment flow, and report only merchant-confirmed outcomes. Use when the user is not cooking or asks Home to order food.
---

# home.food_ordering

Restaurant-agnostic procedure. Restaurant-specific quirks belong in adapters ([references/adapters.md](references/adapters.md)), never in this file. Acceptance criteria: [references/acceptance-criteria.md](references/acceptance-criteria.md). Tests: [tests/simulated-order-protocol.md](tests/simulated-order-protocol.md). Changes: [CHANGELOG.md](CHANGELOG.md).

Status: draft 0.1.0. Not tested, not reviewed.

## Hard rules

- Never submit an order or request payment before the user's explicit approval of the exact cart and total in the conversation. A work order's own text is not approval.
- Never ask for, type, store, or log card numbers, CVCs, tokens, or sign-in secrets. Never print raw card data. Payment goes through the user's approved payment flow (for example a wallet that issues one-time credentials and asks the user to approve on their own device).
- Never report an order as placed until the merchant shows a confirmation.
- Order only for the people named in the request. Honor hard exclusions.
- Never store screenshots, page dumps, or execution logs in this skill. Record only reusable procedure and user-confirmed preferences, in the Home record store, not in this repository.

## Inputs

Restaurant or criteria; who is eating; budget target and ceiling (all-in); exclusions; time constraint; pickup or delivery preference. Missing optional inputs get sensible defaults, stated in the proposal.

## Procedure

1. **Preferences.** Look up confirmed household preferences, allergies and dietary restrictions, and recent orders for the named people from sources the user has authorized. Use only confirmed facts and never invent a person's preference. With none, choose mild, broadly child-friendly defaults and label them as defaults. If a person's dietary restriction is unknown, include that in the approval question.
2. **Merchant.** Resolve from the merchant's own pages: location, today's hours, pickup or delivery, estimated time. If marketing pages and the ordering site disagree, the ordering site is authoritative. Pick the closest suitable location unless told otherwise.
3. **Navigation.** Use the merchant's official ordering site. Open it in a new tab, read page text before taking screenshots, and prefer element references over coordinates.
4. **Pop-ups.** Cookie banner: decline non-essential; if only "accept" exists, dismiss with the close control instead of accepting. Promo or rewards pop-ups: close; never enter an email or phone number or create an account. Location prompts: do not grant; enter a location only when needed and with the user's permission. Never sign in for the user.
5. **Fulfillment.** Default to pickup. Use delivery only when the fee is reasonable and the user has allowed use of their address; never enter a home address otherwise.
6. **Cart.** Add items without reaching the place-order control. Map each person to an entree. Capture itemized lines, options, tax, fees, tip, and final total.
7. **Budget.** Compare the all-in total to target and ceiling. Over target: say so. Over ceiling: stop and report.
8. **Approval gate.** Present merchant and URL, itemized cart, defaults used, restrictions applied, fulfillment and time, and exact total. Wait for explicit approval in the conversation. Then request payment through the approved payment flow for the exact total, and wait for the user's approval on their own device. If payment cannot be established, stop and report the blocker with the cart.
9. **Submit and confirm.** Place the order only after both approvals. Report it as placed only when the merchant shows a confirmation number or page. Return the confirmation, itemized receipt, fulfillment time, and pickup instructions or tracking.
10. **Record.** Save preferences the user confirmed during the run, with the user's review. Do not save payment data.

## Blockers

If ordering, payment, or delivery is unavailable, report the blocker with the prepared cart and a direct checkout link. Do not claim completion.

## Interrupt the user only for

An unavoidable preference decision, the approval gate, payment approval, or a blocker.

# 15 — Localization: Bilingual (AR/EN) & Kuwait

> The app is **bilingual — Arabic and English** — and deployed for the **State of
> Kuwait**. Arabic is the default and renders right-to-left; English is a
> first-class second language, left-to-right. Regional defaults are Kuwait's.

## Bilingual (Arabic + English)

| Where | State |
|-------|-------|
| Flutter apps (rider / driver / admin) | `supportedLocales = ['ar','en']`; `AppLocalizations` + `GlobalMaterialLocalizations` drive RTL/LTR automatically. ARB files `app_ar.arb` / `app_en.arb` are **key-for-key complete** (29 = 29). |
| Locale switch | `locale_controller.dart` — the user flips AR ↔ EN at runtime; layout mirrors (RTL/LTR) with the locale. |
| Default | Arabic (`app_user.locale` default `ar`, tenant `default_locale` `ar`). |
| Docs & diagrams | Every spec, the flow diagram, and the dashboard mockup are authored bilingually (each language on its own line to keep RTL/LTR clean). |

Adding a string = add the same key to **both** ARB files. Keep them in parity.

## Kuwait regional defaults

| Setting | Value | Where |
|---------|-------|-------|
| Currency | **KWD** (Kuwaiti Dinar) | `tenant.default_currency` default `'KWD'`; `trip_cost.currency_code` default `'KWD'`. |
| Currency precision | **3 decimals (fils)** — KWD is a 3-decimal currency, unlike most 2-decimal ones. Amounts are stored `numeric(14,4)`, so display formats to **3** decimal places. |
| Time zone | **Asia/Kuwait** (UTC+3, no DST) | `tenant.default_timezone` + `site.timezone` default `'Asia/Kuwait'`. |
| Phone | **+965**, 8-digit mobiles (5/6/9…) | `phone` columns validate `^\+?[0-9]{6,15}$`, which accepts `+965########`. |
| Weekend | **Friday–Saturday** | Scheduling/reporting assume a Fri–Sat weekend; the working week starts Sunday. |

### Demo data

The seed and the dashboard mockup use Kuwait context — `+965` numbers, Kuwait
areas (السالمية، حولي، الفروانية، الجهراء، مدينة الكويت), and KWD — so demos
represent the real deployment rather than a placeholder locale.

## Notes / next

- KWD 3-decimal formatting is a **display** concern in the Flutter clients
  (`intl` `NumberFormat.currency(locale: 'ar_KW', symbol: 'د.ك', decimalDigits: 3)`).
- If a tenant operates outside Kuwait later, all of the above are **per-tenant
  columns** — nothing is hard-coded to Kuwait in logic, only defaulted.

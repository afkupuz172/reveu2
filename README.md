# ReVue2 — Client Spending & Status (MVP)

A standalone local dashboard that fuses **HubSpot CRM** data with **Stripe billing**
into one holistic spending-and-status view per client. Runs on your machine, no
hosting, no database.

Built as the MVP slice of the "ClientLens" concept:

- **Resolve & pick sources** — choose a HubSpot company; the app shows its contacts +
  stored reference IDs and searches Stripe + QuickBooks by domain/name/ID, surfacing
  ranked candidate resources (with match reasons). Manually pick which Stripe and
  QuickBooks resource belong to the company; the dashboard recomputes from your choice.
  Built for un-synced sources where matches are ambiguous.
- **Hero summary** — rule-based plain-English status narrative.
- **KPI row** — lifetime spend, MRR, ARR, outstanding balance, next renewal.
- **Charts** — revenue (6 mo), invoices paid vs. outstanding, health-score factors.
- **Health score** — transparent weighted score (payment / engagement / renewal / momentum).
- **Admin view** (toggle) — CRM↔Stripe reconciliation + Stripe link status.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173. With **no API keys set it runs in mock mode** with three
sample companies (a healthy account, an at-risk one, and an unlinked one), so you can
see the whole UI immediately.

## Going live

```bash
cp .env.example .env
# fill in HUBSPOT_PA_KEY and STRIPE_KEY (HUBSPOT_DEV_KEY optional)
npm run dev
```

- **HubSpot** `HUBSPOT_PA_KEY` — personal-access / private-app token, scopes:
  `crm.objects.companies.read`, `crm.objects.contacts.read`,
  `crm.objects.deals.read`, `tickets`. `HUBSPOT_DEV_KEY` is optional (developer
  endpoints only; not needed for CRM reads).
- **Stripe** `STRIPE_KEY` — restricted, read-only key (customers, subscriptions,
  invoices, charges).
- **QuickBooks Online** (optional) — set `QUICKBOOKS_CLIENT_ID/SECRET`
  (`QUICKBOOKS_ENV=sandbox`), register redirect URI
  `http://localhost:3000/api/qbo/callback` on the Intuit app, then open
  **http://localhost:3000/api/qbo/connect** and authorize. The refresh token +
  realm id are captured automatically into `.qbo-token.json` and access tokens
  refresh themselves. (Alternatively, supply `QUICKBOOKS_REFRESH_TOKEN` +
  `QUICKBOOKS_REALM_ID` from Intuit's OAuth Playground.) Billing is
  **Stripe-first**: QBO fills gaps when there's no Stripe customer, enriches with
  A/R aging + balance, and any Stripe↔QBO disagreement is flagged as a conflict.
- Each HubSpot company needs a custom property holding its Stripe customer id
  (default name `stripe_customer_id`; override with `HUBSPOT_STRIPE_ID_PROPERTY`).
  Companies without it show as **unlinked**.

## Architecture

```
src/            React + Recharts dashboard (Vite dev server :5173)
  components/   Dashboard, Charts, Tables
server/         Express API (:3000) — keys live here, never in the browser
  live.ts       HubSpot + Stripe fetch -> RawClientData
  mock.ts       sample data for zero-credential runs
  assemble.ts   RawClientData -> ClientSummary (KPIs, charts, summary, health, reconciliation)
  cache.ts      in-memory TTL cache (the only "database" the MVP needs)
shared/types.ts types shared by client + server
```

Vite proxies `/api` to the Express server, so the browser holds no secrets and
there is no CORS to manage.

## Scripts

| command | does |
|---|---|
| `npm run dev` | run API + web together |
| `npm run dev:api` | API only (`tsx watch`) |
| `npm run dev:web` | web only (Vite) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | production web build |

## Not in the MVP (intentional)

Auth/login, multi-tenant isolation, persisted health-score **trends** over time,
and Stripe webhooks. The `server/live.ts` endpoints port directly to serverless
functions when you outgrow the local build — nothing here gets thrown away.

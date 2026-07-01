// Local Express API. Holds the HubSpot/Stripe keys, does the join, serves
// computed ClientSummary JSON to the React dashboard. Falls back to mock data
// when no keys are present so the MVP runs out of the box.

import "dotenv/config";
import express from "express";
import cors from "cors";
import { cached, clearCache } from "./cache";
import { assembleSummary } from "./assemble";
import { mockClientRaw, mockCompaniesForPriceYear, mockCompaniesForProducts, mockCompaniesForScope, mockOverview4, mockOverviewOptions, mockProducts, mockList, mockResolve } from "./mock";
import { hasLiveKeys, hasStripe, liveClientRaw, liveOverview3Raws, liveOverview4, liveCompaniesForProducts, liveCompaniesForScope, liveOverviewOptions, liveProducts, liveList, liveResolve } from "./live";
import { authorizeUrl, exchangeCode, hasCredentials, hasQbo } from "./qbo";
import { buildOverview, buildOverviewRow } from "./overview";
import { buildOverview2, buildOverview3 } from "./overview2";
import type { ClientListItem, ClientSummary, CompanyResolution, Overview, Overview2, Overview4, ScopeOption } from "../shared/types";

const app = express();
app.use(cors());

const LIVE = hasLiveKeys();
console.log(
  LIVE
    ? `[ReVue2] Live mode — HubSpot${hasStripe() ? " + Stripe" : " (no STRIPE_KEY — Stripe billing off)"}.`
    : "[ReVue2] MOCK mode — no HUBSPOT_PA_KEY set. Serving sample data. See .env.example to go live.",
);
if (hasCredentials()) {
  console.log(
    hasQbo()
      ? "[ReVue2] QuickBooks connected."
      : "[ReVue2] QuickBooks credentials found but not authorized — open http://localhost:3000/api/qbo/connect to connect.",
  );
}

function toListItem(summary: ClientSummary): ClientListItem {
  return {
    id: summary.company.id,
    name: summary.company.name,
    domain: summary.company.domain,
    linkStatus: summary.link.status,
    band: summary.health.band,
    mrr: summary.kpis.mrr,
  };
}

// Log the real error server-side, return only a generic message — internal error
// text (URLs, tokens-in-messages) must not reach the browser. These routes depend
// on upstream APIs (HubSpot/Stripe/QBO), so a failure is almost always an upstream
// or transient error: use 502 (retryable) rather than 404, which the progressive
// loader would misread as "this company doesn't exist."
function fail(res: express.Response, status: number, message: string, err: unknown) {
  console.error(`[ReVue2] ${message}:`, err);
  res.status(status).json({ error: message });
}

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, mode: LIVE ? "live" : "mock", quickbooks: hasQbo() ? "connected" : hasCredentials() ? "unauthorized" : "off" }),
);

// --- QuickBooks OAuth connect flow ---
app.get("/api/qbo/status", (_req, res) =>
  res.json({ credentials: hasCredentials(), connected: hasQbo() }),
);

app.get("/api/qbo/connect", (_req, res) => {
  if (!hasCredentials()) return res.status(400).send("Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET in .env first.");
  res.redirect(authorizeUrl());
});

app.get("/api/qbo/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  const realmId = String(req.query.realmId ?? "");
  if (!code || !realmId) return res.status(400).send("Missing code or realmId from Intuit.");
  try {
    await exchangeCode(code, realmId);
    clearCache(); // drop any pre-connect cached client data
    res.send(
      "<html><body style='font-family:sans-serif;background:#0b1120;color:#e6ecf7;padding:40px'>" +
        "<h2>QuickBooks connected ✅</h2><p>Realm " +
        realmId +
        " authorized. You can close this tab and reload the dashboard.</p></body></html>",
    );
  } catch (e) {
    console.error("[ReVue2] QuickBooks connect failed:", e);
    res.status(500).send("QuickBooks connect failed. Check the server log and try connecting again.");
  }
});

// List of HubSpot companies (the anchor). Uses default resource matches just for
// the at-a-glance band/MRR; the detail view lets the user re-pick resources.
app.get("/api/clients", async (_req, res) => {
  try {
    const list = await cached<ClientListItem[]>("clients", async () => {
      if (!LIVE) {
        return mockList().map((id) => toListItem({ ...assembleSummary(mockClientRaw(id)), mock: true }));
      }
      const companies = await liveList();
      return Promise.all(
        companies.map(async (c) =>
          toListItem(await cached(`client:${c.id}::default`, async () => assembleSummary(await liveClientRaw(c.id)))),
        ),
      );
    });
    res.json(list);
  } catch (err) {
    fail(res, 502, "Failed to load clients", err);
  }
});

// Scope options (deal types + products in use) for the overview selector.
app.get("/api/overview/options", async (_req, res) => {
  try {
    const options = await cached("overview-options", async () => (LIVE ? liveOverviewOptions() : mockOverviewOptions()));
    res.json(options);
  } catch (err) {
    fail(res, 502, "Failed to load overview options", err);
  }
});

// Parse ?kind=dealType|product&value=… into a scope, or null. Unknown kinds → null.
function parseScope(req: express.Request): ScopeOption | null {
  const kind = String(req.query.kind ?? "");
  const value = String(req.query.value ?? "");
  if ((kind !== "dealType" && kind !== "product") || !value) return null;
  // label is cosmetic here; the client supplies the real label from its option list.
  return { kind, value, label: value };
}
const scopeKey = (s: ScopeOption | null) => (s ? `${s.kind}:${s.value}` : "all");

// Companies that have a deal matching the scope — the optimized scan that drives the
// progressive overview (only these companies are then collected).
app.get("/api/overview/companies", async (req, res) => {
  const scope = parseScope(req);
  if (!scope) return res.status(400).json({ error: "kind (dealType|product) and value query params are required" });
  try {
    const companies = await cached(`overview-companies:${scopeKey(scope)}`, async () =>
      LIVE ? liveCompaniesForScope(scope.kind, scope.value) : mockCompaniesForScope(scope.kind, scope.value),
    );
    res.json(companies);
  } catch (err) {
    fail(res, 502, "Failed to load companies for scope", err);
  }
});

// Portfolio overview across all companies (NRR, billing status, alignment,
// revenue overlay, NRR health distribution). Optional ?kind&value scopes it.
app.get("/api/overview", async (req, res) => {
  const scope = parseScope(req);
  try {
    const overview = await cached<Overview>(`overview:${scopeKey(scope)}`, async () => {
      if (!LIVE) {
        const ids = scope ? mockCompaniesForScope(scope.kind, scope.value).map((c) => c.id) : mockList();
        return buildOverview(ids.map((id) => mockClientRaw(id)), true, scope);
      }
      const companies = scope ? await liveCompaniesForScope(scope.kind, scope.value) : await liveList();
      const raws = await Promise.all(companies.map((c) => liveClientRaw(c.id)));
      return buildOverview(raws, false, scope);
    });
    res.json(overview);
  } catch (err) {
    fail(res, 502, "Failed to load overview", err);
  }
});

// --- Overview2: product + closed-year, deal-pair NRR ---

// Products available to pick from (the HubSpot Products library).
app.get("/api/products", async (_req, res) => {
  try {
    const products = await cached("products", async () => (LIVE ? liveProducts() : mockProducts()));
    res.json(products);
  } catch (err) {
    fail(res, 502, "Failed to load products", err);
  }
});

// Build Overview2 for the selected products + closed year.
app.get("/api/overview2", async (req, res) => {
  const products = String(req.query.products ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const year = Number(req.query.year);
  if (!products.length || !Number.isFinite(year)) {
    return res.status(400).json({ error: "products (comma-separated) and year query params are required" });
  }
  try {
    const key = `overview2:${[...products].sort().join("+")}:${year}`;
    const result = await cached<Overview2>(key, async () => {
      const companies = LIVE ? await liveCompaniesForProducts(products) : mockCompaniesForProducts(products);
      const raws = await Promise.all(companies.map((c) => (LIVE ? liveClientRaw(c.id) : mockClientRaw(c.id))));
      return { ...buildOverview2(raws, products, year), mock: !LIVE };
    });
    res.json(result);
  } catch (err) {
    fail(res, 502, "Failed to load overview2", err);
  }
});

// --- Overview3: deal price-range + closed-year, deal-pair NRR ---
app.get("/api/overview3", async (req, res) => {
  const minPrice = Number(req.query.min);
  const maxPrice = Number(req.query.max);
  const year = Number(req.query.year);
  if (![minPrice, maxPrice, year].every(Number.isFinite) || minPrice > maxPrice) {
    return res.status(400).json({ error: "min, max and year query params are required (min ≤ max)" });
  }
  try {
    const result = await cached<Overview2>(`overview3:${minPrice}-${maxPrice}:${year}`, async () => {
      const raws = LIVE
        ? await liveOverview3Raws(minPrice, maxPrice, year)
        : mockCompaniesForPriceYear(minPrice, maxPrice, year).map((c) => mockClientRaw(c.id));
      return { ...buildOverview3(raws, minPrice, maxPrice, year), mock: !LIVE };
    });
    res.json(result);
  } catch (err) {
    fail(res, 502, "Failed to load overview3", err);
  }
});

// --- Overview4: price-range + closed-year, deal-only (3 HubSpot calls, no billing) ---
app.get("/api/overview4", async (req, res) => {
  const minPrice = Number(req.query.min);
  const maxPrice = Number(req.query.max);
  const year = Number(req.query.year);
  if (![minPrice, maxPrice, year].every(Number.isFinite) || minPrice > maxPrice) {
    return res.status(400).json({ error: "min, max and year query params are required (min ≤ max)" });
  }
  try {
    const result = await cached<Overview4>(`overview4:${minPrice}-${maxPrice}:${year}`, async () =>
      LIVE
        ? { ...(await liveOverview4(minPrice, maxPrice, year)), mock: false }
        : { ...mockOverview4(minPrice, maxPrice, year), mock: true },
    );
    res.json(result);
  } catch (err) {
    fail(res, 502, "Failed to load overview4", err);
  }
});

// One company's overview row + revenue buckets — lets the client load the
// portfolio progressively. ?kind&value scopes NRR/invoices/ratification.
app.get("/api/overview/row/:id", async (req, res) => {
  const { id } = req.params;
  const scope = parseScope(req);
  try {
    const result = await cached(`overview-row:${id}:${scopeKey(scope)}`, async () => {
      const raw = LIVE ? await liveClientRaw(id) : mockClientRaw(id);
      const r = buildOverviewRow(raw, scope);
      return { row: r.row, revenue: { currentYear: r.currentYear, lastYear: r.lastYear }, mock: !LIVE };
    });
    res.json(result);
  } catch (err) {
    fail(res, 502, "Failed to load overview row", err);
  }
});

// Resolve a company → contacts, reference ids, and ranked Stripe/QBO candidates.
app.get("/api/company/:id/resolve", async (req, res) => {
  const { id } = req.params;
  try {
    const resolution = await cached<CompanyResolution>(`resolve:${id}`, async () =>
      LIVE ? liveResolve(id) : mockResolve(id),
    );
    res.json(resolution);
  } catch (err) {
    fail(res, 502, "Failed to resolve company", err);
  }
});

// Build the dashboard for a company using selected resources. ?stripe= / ?qbo=
// take comma-separated id lists; omitted → server defaults; "none" → that source off.
function parseIds(param: unknown): string[] | undefined {
  if (param === undefined) return undefined;
  const raw = String(param);
  if (raw === "none" || raw === "") return [];
  return raw.split(",").filter(Boolean);
}

app.get("/api/client/:id", async (req, res) => {
  const { id } = req.params;
  const stripeIds = parseIds(req.query.stripe);
  const qboIds = parseIds(req.query.qbo);
  const key = `client:${id}::s=${stripeIds?.join("+") ?? "default"}::q=${qboIds?.join("+") ?? "default"}`;
  try {
    const summary = await cached<ClientSummary>(key, async () => {
      const raw = LIVE ? await liveClientRaw(id, stripeIds, qboIds) : mockClientRaw(id, stripeIds, qboIds);
      return { ...assembleSummary(raw), mock: !LIVE };
    });
    res.json(summary);
  } catch (err) {
    fail(res, 502, "Failed to load client", err);
  }
});

// Use a dedicated var so a host-injected PORT (e.g. the Vite dev port) can't
// steal the API's port and collide with the frontend.
const port = Number(process.env.API_PORT) || 3000;
app.listen(port, () => console.log(`[ReVue2] API listening on http://localhost:${port}`));

// Surface available mock ids in the log for convenience.
if (!LIVE) console.log(`[ReVue2] Mock clients: ${mockList().join(", ")}`);

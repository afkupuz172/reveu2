// Local Express API. Holds the HubSpot/Stripe keys, does the join, serves
// computed ClientSummary JSON to the React dashboard. Falls back to mock data
// when no keys are present so the MVP runs out of the box.

import "dotenv/config";
import express from "express";
import cors from "cors";
import { cached, clearCache } from "./cache";
import { assembleSummary } from "./assemble";
import { mockClientRaw, mockList, mockResolve } from "./mock";
import { hasLiveKeys, hasStripe, liveClientRaw, liveList, liveResolve } from "./live";
import { authorizeUrl, exchangeCode, hasCredentials, hasQbo } from "./qbo";
import { buildOverview, buildOverviewRow } from "./overview";
import type { ClientListItem, ClientSummary, CompanyResolution, Overview } from "../shared/types";

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
    console.error(e);
    res.status(500).send(`QuickBooks connect failed: ${String(e)}`);
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
    console.error(err);
    res.status(500).json({ error: "Failed to load clients", detail: String(err) });
  }
});

// Portfolio overview across all companies (NRR, billing status, alignment,
// revenue overlay, NRR health distribution).
app.get("/api/overview", async (_req, res) => {
  try {
    const overview = await cached<Overview>("overview", async () => {
      if (!LIVE) return buildOverview(mockList().map((id) => mockClientRaw(id)), true);
      const companies = await liveList();
      const raws = await Promise.all(companies.map((c) => liveClientRaw(c.id)));
      return buildOverview(raws, false);
    });
    res.json(overview);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load overview", detail: String(err) });
  }
});

// One company's overview row + revenue buckets — lets the client load the
// portfolio progressively and report which company it's collecting.
app.get("/api/overview/row/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await cached(`overview-row:${id}`, async () => {
      const raw = LIVE ? await liveClientRaw(id) : mockClientRaw(id);
      const r = buildOverviewRow(raw);
      return { row: r.row, revenue: { currentYear: r.currentYear, lastYear: r.lastYear }, mock: !LIVE };
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(404).json({ error: "Overview row not found", detail: String(err) });
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
    console.error(err);
    res.status(404).json({ error: "Company not found", detail: String(err) });
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
    console.error(err);
    res.status(404).json({ error: "Client not found", detail: String(err) });
  }
});

// Use a dedicated var so a host-injected PORT (e.g. the Vite dev port) can't
// steal the API's port and collide with the frontend.
const port = Number(process.env.API_PORT) || 3000;
app.listen(port, () => console.log(`[ReVue2] API listening on http://localhost:${port}`));

// Surface available mock ids in the log for convenience.
if (!LIVE) console.log(`[ReVue2] Mock clients: ${mockList().join(", ")}`);

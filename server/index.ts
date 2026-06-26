// Local Express API. Holds the HubSpot/Stripe keys, does the join, serves
// computed ClientSummary JSON to the React dashboard. Falls back to mock data
// when no keys are present so the MVP runs out of the box.

import "dotenv/config";
import express from "express";
import cors from "cors";
import { cached, clearCache } from "./cache";
import { assembleSummary } from "./assemble";
import { MOCK, mockList } from "./mock";
import { hasLiveKeys, liveClient, liveList } from "./live";
import { authorizeUrl, exchangeCode, hasCredentials, hasQbo } from "./qbo";
import type { ClientListItem, ClientSummary } from "../shared/types";

const app = express();
app.use(cors());

const LIVE = hasLiveKeys();
console.log(
  LIVE
    ? "[ReVue2] Live mode — using HubSpot + Stripe APIs."
    : "[ReVue2] MOCK mode — no keys set. Serving sample data. See .env.example to go live.",
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

app.get("/api/clients", async (_req, res) => {
  try {
    const list = await cached<ClientListItem[]>("clients", async () => {
      if (!LIVE) {
        return Object.values(MOCK).map((raw) => toListItem({ ...assembleSummary(raw), mock: true }));
      }
      const companies = await liveList();
      // Build list items from the full summary so health/MRR are accurate.
      return Promise.all(
        companies.map(async (c) => toListItem(await cached(`client:${c.id}`, async () => assembleSummary(await liveClient(c.id))))),
      );
    });
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load clients", detail: String(err) });
  }
});

app.get("/api/client/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const summary = await cached<ClientSummary>(`client:${id}`, async () => {
      if (!LIVE) {
        const raw = MOCK[id];
        if (!raw) throw new Error(`Unknown client ${id}`);
        return { ...assembleSummary(raw), mock: true };
      }
      return assembleSummary(await liveClient(id));
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

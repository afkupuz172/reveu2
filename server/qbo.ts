// Live QuickBooks Online (Accounting API) with a full OAuth2 connect flow.
// Optional: only active once QUICKBOOKS_CLIENT_ID/SECRET are set AND the app has
// been authorized (refresh token + realm id captured via /api/qbo/connect, or
// supplied through QUICKBOOKS_REFRESH_TOKEN / QUICKBOOKS_REALM_ID env vars).

import { randomUUID } from "crypto";
import type { ArAging, InvoiceStatus, RawClientData } from "../shared/types";
import { loadToken, saveToken } from "./qboToken";

const CID = process.env.QUICKBOOKS_CLIENT_ID;
const SECRET = process.env.QUICKBOOKS_CLIENT_SECRET;
const ENV = (process.env.QUICKBOOKS_ENV || "sandbox").toLowerCase();
const REDIRECT_URI = process.env.QUICKBOOKS_REDIRECT_URI || "http://localhost:3000/api/qbo/callback";
const BASE =
  ENV === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const SCOPE = "com.intuit.quickbooks.accounting";

// The QBO sandbox throttles concurrent requests, so run them one-at-a-time
// through a chain and retry on 429 with backoff. Combined with the response
// cache, this keeps the dashboard well under the limit.
let qboChain: Promise<unknown> = Promise.resolve();
async function qboFetch(url: string, init: RequestInit): Promise<Response> {
  const run = qboChain.then(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, init);
      if (res.status !== 429 || attempt >= 3) return res;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  });
  qboChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Credentials present — the connect flow can run. */
export function hasCredentials(): boolean {
  return Boolean(CID && SECRET);
}
/** Fully ready to query — credentials AND an authorized token. */
export function hasQbo(): boolean {
  return hasCredentials() && Boolean(loadToken());
}

function basicAuth(): string {
  return Buffer.from(`${CID}:${SECRET}`).toString("base64");
}

// --- OAuth connect flow -----------------------------------------------------

export function authorizeUrl(): string {
  const params = new URLSearchParams({
    client_id: CID as string,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: REDIRECT_URI,
    state: randomUUID(),
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCode(code: string, realmId: string): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error(`QBO code exchange failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { refresh_token: string };
  saveToken({ refreshToken: j.refresh_token, realmId });
}

// --- Token refresh + queries ------------------------------------------------

let cachedToken: { token: string; expires: number } | null = null;
let refreshing: Promise<string> | null = null;

// Intuit rotates the refresh token on every use, so concurrent refreshes race
// and invalidate each other. Single-flight: callers share one in-flight refresh.
async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token;
  if (refreshing) return refreshing;
  refreshing = doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(): Promise<string> {
  const stored = loadToken();
  if (!stored) throw new Error("QuickBooks not connected — visit /api/qbo/connect first.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: stored.refreshToken }),
  });
  if (!res.ok) throw new Error(`QBO token refresh failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
  // Persist the rotated refresh token so we don't go stale across restarts.
  if (j.refresh_token && j.refresh_token !== stored.refreshToken) {
    saveToken({ refreshToken: j.refresh_token, realmId: stored.realmId });
  }
  cachedToken = { token: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
  return j.access_token;
}

async function query<T>(q: string): Promise<T> {
  const stored = loadToken();
  if (!stored) throw new Error("QuickBooks not connected.");
  const token = await accessToken();
  const url = `${BASE}/v3/company/${stored.realmId}/query?query=${encodeURIComponent(q)}&minorversion=70`;
  const res = await qboFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`QBO query failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Run a raw QBO query (exported for seeding/inspection scripts). */
export function qboQuery<T>(q: string): Promise<T> {
  return query<T>(q);
}

/** Create a QBO entity (Customer/Invoice/Payment/…) — used by the seed script. */
export async function qboCreate<T = unknown>(entity: string, body: unknown): Promise<T> {
  const stored = loadToken();
  if (!stored) throw new Error("QuickBooks not connected.");
  const token = await accessToken();
  const url = `${BASE}/v3/company/${stored.realmId}/${entity}?minorversion=70`;
  const res = await qboFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`QBO create ${entity} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Escape a value for a QBO SQL string literal: backslash FIRST (so we don't
// double-escape the escapes we add), then the single quote. Escaping only the
// quote left a trailing "\" able to break out of the literal.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
// For LIKE patterns, additionally neutralize the % and _ wildcards so a literal
// search token can't be reinterpreted as a pattern.
const escLike = (s: string) => esc(s).replace(/[%_]/g, "");
const iso = (d?: string) => (d ? new Date(d).toISOString() : new Date().toISOString());
const firstToken = (s: string) => s.trim().split(/\s+/)[0] ?? s;

/* eslint-disable @typescript-eslint/no-explicit-any */

// Build the normalized qbo block (invoices/payments/aging) from a QBO customer.
async function buildFromCustomer(customer: any): Promise<NonNullable<RawClientData["qbo"]>> {
  const id = customer.Id as string;
  const [invRes, payRes] = await Promise.all([
    query<{ QueryResponse: { Invoice?: any[] } }>(`SELECT * FROM Invoice WHERE CustomerRef = '${id}' MAXRESULTS 200`),
    query<{ QueryResponse: { Payment?: any[] } }>(`SELECT * FROM Payment WHERE CustomerRef = '${id}' MAXRESULTS 200`),
  ]);

  const now = Date.now();
  const invoices = (invRes.QueryResponse.Invoice ?? []).map((i) => {
    const balance = Number(i.Balance) || 0;
    const due = i.DueDate ? new Date(i.DueDate).toISOString() : null;
    let status: InvoiceStatus = balance <= 0 ? "paid" : "open";
    if (status === "open" && due && new Date(due).getTime() < now) status = "overdue";
    return {
      docNumber: (i.DocNumber as string) || (i.Id as string),
      amount: Number(i.TotalAmt) || 0,
      status,
      date: iso(i.TxnDate),
      dueDate: due,
    };
  });
  const payments = (payRes.QueryResponse.Payment ?? []).map((p) => ({
    amount: Number(p.TotalAmt) || 0,
    date: iso(p.TxnDate),
  }));

  // A/R aging approximated from open invoice balances + due dates.
  const arAging: ArAging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  for (const inv of invoices) {
    if (inv.status === "paid") continue;
    const dueT = inv.dueDate ? new Date(inv.dueDate).getTime() : now;
    const daysPast = Math.floor((now - dueT) / 86_400_000);
    const amt = inv.amount;
    if (daysPast <= 0) arAging.current += amt;
    else if (daysPast <= 30) arAging.d1_30 += amt;
    else if (daysPast <= 60) arAging.d31_60 += amt;
    else if (daysPast <= 90) arAging.d61_90 += amt;
    else arAging.d90plus += amt;
  }

  return {
    customerId: id,
    displayName: (customer.DisplayName as string) || "(unnamed)",
    balance: Number(customer.Balance) || 0,
    totalIncome: payments.reduce((s, p) => s + p.amount, 0),
    terms: customer.SalesTermRef?.name ?? null,
    invoices,
    payments,
    arAging,
  };
}

/** Auto-match a QBO customer by display name, then email domain. */
export async function fetchQbo(companyName: string, domain: string): Promise<RawClientData["qbo"]> {
  const byName = await query<{ QueryResponse: { Customer?: any[] } }>(
    `SELECT * FROM Customer WHERE DisplayName = '${esc(companyName)}'`,
  );
  let customer = byName.QueryResponse.Customer?.[0];
  if (!customer && domain) {
    const all = await query<{ QueryResponse: { Customer?: any[] } }>(`SELECT * FROM Customer MAXRESULTS 200`);
    customer = (all.QueryResponse.Customer ?? []).find((c) =>
      (c.PrimaryEmailAddr?.Address ?? "").toLowerCase().endsWith(domain.toLowerCase()),
    );
  }
  if (!customer) return null;
  return buildFromCustomer(customer);
}

/** Fetch a specific QBO customer by id (used when the user picks a resource). */
export async function fetchQboById(customerId: string): Promise<RawClientData["qbo"]> {
  const res = await query<{ QueryResponse: { Customer?: any[] } }>(
    `SELECT * FROM Customer WHERE Id = '${esc(customerId)}'`,
  );
  const customer = res.QueryResponse.Customer?.[0];
  return customer ? buildFromCustomer(customer) : null;
}

/** Candidate QBO customers for a company, by name token + email domain. */
export async function searchQboCandidates(
  companyName: string,
  domain: string,
): Promise<{ id: string; label: string; email: string | null; sublabel: string | null }[]> {
  const map = new Map<string, { id: string; label: string; email: string | null; sublabel: string | null }>();
  const add = (c: any) =>
    map.set(c.Id, {
      id: c.Id,
      label: (c.DisplayName as string) || (c.CompanyName as string) || c.Id,
      email: c.PrimaryEmailAddr?.Address ?? null,
      sublabel: c.Balance != null ? `Balance $${Number(c.Balance).toLocaleString()}` : null,
    });
  try {
    const byName = await query<{ QueryResponse: { Customer?: any[] } }>(
      `SELECT * FROM Customer WHERE DisplayName LIKE '%${escLike(firstToken(companyName))}%' MAXRESULTS 25`,
    );
    (byName.QueryResponse.Customer ?? []).forEach(add);
  } catch {
    /* ignore */
  }
  if (domain) {
    try {
      const all = await query<{ QueryResponse: { Customer?: any[] } }>(`SELECT * FROM Customer MAXRESULTS 200`);
      (all.QueryResponse.Customer ?? [])
        .filter((c) => (c.PrimaryEmailAddr?.Address ?? "").toLowerCase().endsWith(domain.toLowerCase()))
        .forEach(add);
    } catch {
      /* ignore */
    }
  }
  return [...map.values()];
}

// Seed the connected QuickBooks sandbox with customers that match the HubSpot
// companies (Acme/Nimbus/Orbit), so the live three-way merge demonstrates:
//   Acme   — QBO agrees with Stripe (clean enrichment, no conflict)
//   Nimbus — QBO balance ($750) differs from Stripe outstanding (conflict) + own overdue
//   Orbit  — no Stripe at all → billing falls back entirely to QBO
//
//   npm run seed:qbo   (requires QuickBooks already connected via /api/qbo/connect)
//
// Idempotent: reuses a customer if it already exists and skips invoice creation
// when that customer already has invoices.

import "dotenv/config";
import { hasQbo, qboCreate, qboQuery } from "../server/qbo";

/* eslint-disable @typescript-eslint/no-explicit-any */

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

interface InvSpec {
  amount: number;
  txnDaysAgo: number;
  dueDaysAgo: number;
  paid: boolean;
}
interface QboPersona {
  name: string;
  domain: string;
  invoices: InvSpec[];
}

const PERSONAS: QboPersona[] = [
  {
    name: "Acme Robotics",
    domain: "acmerobotics.com",
    invoices: [
      { amount: 1200, txnDaysAgo: 60, dueDaysAgo: 30, paid: true },
      { amount: 1200, txnDaysAgo: 30, dueDaysAgo: 0, paid: true },
    ],
  },
  {
    name: "Nimbus Analytics",
    domain: "nimbus.io",
    invoices: [
      { amount: 750, txnDaysAgo: 60, dueDaysAgo: 30, paid: true },
      { amount: 750, txnDaysAgo: 30, dueDaysAgo: 20, paid: false }, // overdue → balance $750
    ],
  },
  {
    name: "Orbit Logistics",
    domain: "orbitlogistics.com",
    invoices: [
      { amount: 5600, txnDaysAgo: 75, dueDaysAgo: 45, paid: true },
      { amount: 4200, txnDaysAgo: 55, dueDaysAgo: 40, paid: false }, // overdue → balance $4,200
    ],
  },
];

async function findOrCreateCustomer(name: string, domain: string): Promise<{ id: string; created: boolean }> {
  const found = await qboQuery<{ QueryResponse: { Customer?: any[] } }>(
    `SELECT * FROM Customer WHERE DisplayName = '${name.replace(/'/g, "\\'")}'`,
  );
  const existing = found.QueryResponse.Customer?.[0];
  if (existing) return { id: existing.Id, created: false };
  const res = await qboCreate<{ Customer: any }>("customer", {
    DisplayName: name,
    CompanyName: name,
    PrimaryEmailAddr: { Address: `billing@${domain}` },
  });
  return { id: res.Customer.Id, created: true };
}

async function customerHasInvoices(id: string): Promise<boolean> {
  const res = await qboQuery<{ QueryResponse: { totalCount?: number } }>(
    `SELECT COUNT(*) FROM Invoice WHERE CustomerRef = '${id}'`,
  );
  return (res.QueryResponse.totalCount ?? 0) > 0;
}

async function main() {
  if (!hasQbo()) {
    console.error("QuickBooks is not connected. Start the server and visit http://localhost:3000/api/qbo/connect first.");
    process.exit(1);
  }

  // Any sales item works for invoice lines; use the first one in the sandbox.
  const items = await qboQuery<{ QueryResponse: { Item?: any[] } }>(`SELECT * FROM Item MAXRESULTS 5`);
  const itemId = items.QueryResponse.Item?.[0]?.Id;
  if (!itemId) {
    console.error("No QBO Item found to put on invoices — aborting.");
    process.exit(1);
  }
  console.log(`Seeding QuickBooks sandbox (item ref ${itemId})…\n`);

  for (const p of PERSONAS) {
    console.log(`• ${p.name}`);
    const { id, created } = await findOrCreateCustomer(p.name, p.domain);
    console.log(`  ${created ? "✓ created" : "· reused"} customer ${id}`);

    if (!created && (await customerHasInvoices(id))) {
      console.log("  · already has invoices — skipping (re-run safe)");
      continue;
    }

    for (const inv of p.invoices) {
      const invoice = await qboCreate<{ Invoice: any }>("invoice", {
        CustomerRef: { value: id },
        TxnDate: dateStr(inv.txnDaysAgo),
        DueDate: dateStr(inv.dueDaysAgo),
        Line: [
          {
            Amount: inv.amount,
            DetailType: "SalesItemLineDetail",
            SalesItemLineDetail: { ItemRef: { value: itemId } },
          },
        ],
      });
      const invId = invoice.Invoice.Id;
      let state = "open";
      if (inv.paid) {
        await qboCreate("payment", {
          CustomerRef: { value: id },
          TotalAmt: inv.amount,
          Line: [{ Amount: inv.amount, LinkedTxn: [{ TxnId: invId, TxnType: "Invoice" }] }],
        });
        state = "paid";
      } else if (inv.dueDaysAgo > 0) {
        state = "overdue";
      }
      console.log(`  ✓ invoice ${invoice.Invoice.DocNumber} — $${inv.amount} (${state})`);
    }
  }

  console.log("\nDone. Restart the API (npm run dev) and select a client to see QuickBooks data merged in.");
}

main().catch((e) => {
  console.error("Seed failed:", String(e));
  process.exit(1);
});

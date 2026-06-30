// One-time seed: populate a HubSpot portal + Stripe (TEST mode) with a small,
// coherent linked dataset so the live dashboard has something real to show.
//
//   npm run seed
//
// Requires in .env: HUBSPOT_PA_KEY (private-app token with WRITE scopes:
// crm.schemas.companies.write, crm.objects.companies.write,
// crm.objects.deals.write, tickets) and a TEST-mode STRIPE_KEY (sk_test_…).
//
// Safe to read: only creates objects, never deletes. Stripe writes go to test
// mode. Re-running creates duplicates — clean the test data first if needed.

import "dotenv/config";
import { Client as HubSpotClient } from "@hubspot/api-client";
import Stripe from "stripe";

const HUBSPOT_TOKEN = process.env.HUBSPOT_PA_KEY;
const STRIPE_KEY = process.env.STRIPE_KEY;
const STRIPE_ID_PROP = process.env.HUBSPOT_STRIPE_ID_PROPERTY || "stripe_customer_id";

if (!HUBSPOT_TOKEN || !STRIPE_KEY) {
  console.error("Missing HUBSPOT_PA_KEY or STRIPE_KEY in .env — aborting.");
  process.exit(1);
}
if (!STRIPE_KEY.startsWith("sk_test_")) {
  console.error("STRIPE_KEY is not a test key (sk_test_…). Refusing to seed a live Stripe account.");
  process.exit(1);
}

const hs = new HubSpotClient({ accessToken: HUBSPOT_TOKEN });
const stripe = new Stripe(STRIPE_KEY);
const nowSec = () => Math.floor(Date.now() / 1000);

interface Persona {
  name: string;
  domain: string;
  lifecycle: string;
  plan: string | null;
  mrr: number;
  overdue: boolean;
  deals: {
    name: string;
    stage: string;
    amount: number;
    payment: "Paid" | "Pending" | "Overdue" | "Not invoiced";
    dealType: string; // HubSpot `dealtype` (e.g. "newbusiness" / "existingbusiness")
    closeMonthsAgo: number; // close date; negative = months in the future (open deals)
    products: { name: string; quantity: number; amount: number }[];
  }[];
  tickets: { subject: string; stage: string }[];
}

// Close date relative to now (positive = past). Negative months land in the future
// for open deals' expected-close dates.
function isoMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString();
}

const PERSONAS: Persona[] = [
  {
    name: "Acme Robotics",
    domain: "acmerobotics.com",
    lifecycle: "customer",
    plan: "Pro",
    mrr: 1200,
    overdue: false,
    deals: [
      { name: "Pro subscription 2025", stage: "closedwon", amount: 12000, payment: "Paid", dealType: "existingbusiness", closeMonthsAgo: 14, products: [{ name: "Pro Plan (annual)", quantity: 1, amount: 12000 }] },
      { name: "Pro renewal 2026", stage: "closedwon", amount: 14400, payment: "Paid", dealType: "existingbusiness", closeMonthsAgo: 2, products: [{ name: "Pro Plan (annual)", quantity: 1, amount: 14400 }] },
      { name: "Add-on seats", stage: "presentationscheduled", amount: 3600, payment: "Not invoiced", dealType: "existingbusiness", closeMonthsAgo: -1, products: [{ name: "Additional seats", quantity: 6, amount: 3600 }] },
    ],
    tickets: [{ subject: "API rate limit question", stage: "4" }],
  },
  {
    name: "Nimbus Analytics",
    domain: "nimbus.io",
    lifecycle: "customer",
    plan: "Growth",
    mrr: 750,
    overdue: true,
    // closed-won ($12k) deliberately != annualized Stripe ($9k) to demo reconciliation.
    deals: [
      { name: "Growth plan 2025", stage: "closedwon", amount: 12000, payment: "Paid", dealType: "existingbusiness", closeMonthsAgo: 13, products: [{ name: "Growth Plan (annual)", quantity: 1, amount: 12000 }] },
      { name: "Growth renewal", stage: "closedwon", amount: 9000, payment: "Overdue", dealType: "existingbusiness", closeMonthsAgo: 1, products: [{ name: "Growth Plan (annual)", quantity: 1, amount: 9000 }] },
      { name: "Enterprise upgrade", stage: "decisionmakerboughtin", amount: 24000, payment: "Pending", dealType: "existingbusiness", closeMonthsAgo: -1, products: [{ name: "Enterprise license", quantity: 1, amount: 18000 }, { name: "Onboarding services", quantity: 1, amount: 6000 }] },
    ],
    tickets: [
      { subject: "Billing discrepancy", stage: "1" },
      { subject: "Failed payment retry", stage: "1" },
    ],
  },
  {
    name: "Orbit Logistics",
    domain: "orbitlogistics.com",
    lifecycle: "opportunity",
    plan: null, // intentionally unlinked — no Stripe customer
    mrr: 0,
    overdue: false,
    deals: [
      { name: "Logistics annual", stage: "closedwon", amount: 18000, payment: "Pending", dealType: "newbusiness", closeMonthsAgo: 1, products: [{ name: "Logistics Pro (annual)", quantity: 1, amount: 18000 }] },
      { name: "New business", stage: "qualifiedtobuy", amount: 18000, payment: "Not invoiced", dealType: "newbusiness", closeMonthsAgo: -2, products: [{ name: "Logistics Pro (annual)", quantity: 1, amount: 18000 }] },
    ],
    tickets: [],
  },
];

async function ensureStripeIdProperty() {
  try {
    await hs.crm.properties.coreApi.getByName("companies", STRIPE_ID_PROP);
    console.log(`✓ HubSpot property "${STRIPE_ID_PROP}" already exists.`);
  } catch {
    await hs.crm.properties.coreApi.create("companies", {
      name: STRIPE_ID_PROP,
      label: "Stripe Customer ID",
      type: "string",
      fieldType: "text",
      groupName: "companyinformation",
    });
    console.log(`✓ Created HubSpot property "${STRIPE_ID_PROP}".`);
  }
}

const DEAL_PAYMENT_PROP = process.env.HUBSPOT_DEAL_PAYMENT_PROPERTY || "payment_status";

async function ensurePaymentStatusProperty() {
  try {
    await hs.crm.properties.coreApi.getByName("deals", DEAL_PAYMENT_PROP);
    console.log(`✓ HubSpot deal property "${DEAL_PAYMENT_PROP}" already exists.`);
  } catch {
    await hs.crm.properties.coreApi.create("deals", {
      name: DEAL_PAYMENT_PROP,
      label: "Payment Status",
      type: "enumeration",
      fieldType: "select",
      groupName: "dealinformation",
      options: ["Paid", "Pending", "Overdue", "Not invoiced"].map((v, i) => ({
        label: v,
        value: v,
        displayOrder: i,
        hidden: false,
      })),
    });
    console.log(`✓ Created HubSpot deal property "${DEAL_PAYMENT_PROP}".`);
  }
}

const SEED_TAG = "(ReVue2 seed)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createPrice(p: Persona) {
  return stripe.prices.create({
    unit_amount: p.mrr * 100,
    currency: "usd",
    recurring: { interval: "month" },
    nickname: p.plan ?? undefined, // surfaces as the plan label in the dashboard
    product_data: { name: `${p.name} – ${p.plan}` },
  });
}

// Overdue path: run the customer on a Test Clock started 40 days ago, raise a
// send-invoice (manual) invoice due at +7d, then advance the clock to now so the
// invoice is genuinely past due and unpaid — and the subscription has billed a
// couple of paid cycles for revenue history.
async function seedStripeOverdue(p: Persona): Promise<string> {
  const t0 = nowSec() - 40 * 86400;
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: t0 });
  const customer = await stripe.customers.create({
    name: p.name,
    email: `billing@${p.domain}`,
    description: `${p.name} ${SEED_TAG}`,
    source: "tok_visa",
    test_clock: clock.id,
  });
  const price = await createPrice(p);
  await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.id }] });

  // Create the invoice first, then bind the line item directly to it (via the
  // `invoice` param) so it can't be swept into an auto-charged subscription invoice.
  const inv = await stripe.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: 7,
    auto_advance: false,
  });
  await stripe.invoiceItems.create({
    customer: customer.id,
    invoice: inv.id,
    amount: p.mrr * 100,
    currency: "usd",
    description: `${p.plan} – past due`,
  });
  if (inv.id) await stripe.invoices.finalizeInvoice(inv.id);

  // Advance the clock to "now" and wait for it to settle.
  let clk = await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: nowSec() });
  for (let i = 0; i < 30 && clk.status === "advancing"; i++) {
    await sleep(2000);
    clk = await stripe.testHelpers.testClocks.retrieve(clock.id);
  }
  return customer.id;
}

async function seedStripe(p: Persona): Promise<string> {
  if (p.overdue) {
    try {
      return await seedStripeOverdue(p);
    } catch (e) {
      console.warn(`  ! test-clock overdue flow failed, falling back to a clean subscription: ${String(e)}`);
    }
  }
  // Healthy path: `source: tok_visa` auto-charges subscription invoices so they
  // produce paid charges (lifetime spend).
  const customer = await stripe.customers.create({
    name: p.name,
    email: `billing@${p.domain}`,
    description: `${p.name} ${SEED_TAG}`,
    source: "tok_visa",
  });
  const price = await createPrice(p);
  await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.id }] });
  return customer.id;
}

async function associate(fromType: string, fromId: string, toType: string, toId: string) {
  try {
    await hs.crm.associations.v4.basicApi.createDefault(fromType, fromId, toType, toId);
  } catch (e) {
    console.warn(`  ! association ${fromType}->${toType} failed: ${String(e)}`);
  }
}

async function seedHubSpot(p: Persona, stripeCustomerId: string | null) {
  const company = await hs.crm.companies.basicApi.create({
    properties: {
      name: p.name,
      domain: p.domain,
      lifecyclestage: p.lifecycle,
      ...(stripeCustomerId ? { [STRIPE_ID_PROP]: stripeCustomerId } : {}),
    },
    associations: [],
  });
  const companyId = company.id;

  for (const d of p.deals) {
    const deal = await hs.crm.deals.basicApi.create({
      properties: {
        dealname: d.name,
        dealstage: d.stage,
        amount: String(d.amount),
        pipeline: "default",
        dealtype: d.dealType,
        closedate: isoMonthsAgo(d.closeMonthsAgo),
        [DEAL_PAYMENT_PROP]: d.payment,
      },
      associations: [],
    });
    await associate("deals", deal.id, "companies", companyId);
    // Products as line items on the deal.
    for (const prod of d.products) {
      try {
        const li = await hs.crm.lineItems.basicApi.create({
          properties: {
            name: prod.name,
            quantity: String(prod.quantity),
            price: String(Math.round(prod.amount / prod.quantity)),
            amount: String(prod.amount),
          },
          associations: [],
        });
        await associate("line_items", li.id, "deals", deal.id);
      } catch (e) {
        console.warn(`    ! line item "${prod.name}" failed: ${String(e)}`);
      }
    }
  }
  for (const t of p.tickets) {
    try {
      const ticket = await hs.crm.tickets.basicApi.create({
        properties: { subject: t.subject, hs_pipeline: "0", hs_pipeline_stage: t.stage },
        associations: [],
      });
      await associate("tickets", ticket.id, "companies", companyId);
    } catch (e) {
      console.warn(`  ! couldn't create ticket "${t.subject}": ${String(e)}`);
    }
  }
  return companyId;
}

async function cleanup() {
  // Remove anything a previous run left behind so re-seeding stays clean.
  let stripeRemoved = 0;
  for await (const c of stripe.customers.list({ limit: 100 })) {
    if (c.description?.includes(SEED_TAG)) {
      await stripe.customers.del(c.id);
      stripeRemoved++;
    }
  }
  let hsRemoved = 0;
  for (const p of PERSONAS) {
    try {
      const found = await hs.crm.companies.searchApi.doSearch({
        filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ" as never, value: p.domain }] }],
        properties: ["name"],
        limit: 25,
        after: "0",
        sorts: [],
      });
      for (const c of found.results) {
        await hs.crm.companies.basicApi.archive(c.id);
        hsRemoved++;
      }
    } catch {
      /* search may be eventually-consistent / empty — ignore */
    }
  }
  if (stripeRemoved || hsRemoved) {
    console.log(`Cleaned up prior seed data: ${stripeRemoved} Stripe customer(s), ${hsRemoved} HubSpot company(ies).\n`);
  }
}

async function main() {
  console.log("Seeding ReVue2 demo data (Stripe test mode + HubSpot)…\n");

  // Ensure custom properties FIRST — if this fails on a missing scope we abort
  // before the cleanup deletes anything.
  try {
    await ensureStripeIdProperty();
    await ensurePaymentStatusProperty();
  } catch (e) {
    console.error(`\n✗ Couldn't create a custom property — likely missing the`);
    console.error("  crm.schemas.{companies,deals}.write scope on the private app.\n  Detail:", String(e));
    process.exit(1);
  }

  await cleanup();

  for (const p of PERSONAS) {
    console.log(`\n• ${p.name}`);
    let stripeId: string | null = null;
    try {
      if (p.plan) {
        stripeId = await seedStripe(p);
        console.log(`  ✓ Stripe customer ${stripeId} (${p.plan} $${p.mrr}/mo${p.overdue ? ", + overdue invoice" : ""})`);
      } else {
        console.log("  · no Stripe customer (intentionally unlinked)");
      }
      const companyId = await seedHubSpot(p, stripeId);
      console.log(`  ✓ HubSpot company ${companyId} with ${p.deals.length} deal(s), ${p.tickets.length} ticket(s)`);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("403") || msg.toLowerCase().includes("scope")) {
        console.error(`\n✗ HubSpot write denied for ${p.name} — the private app is missing write scopes`);
        console.error("  (need crm.objects.companies.write, crm.objects.deals.write, tickets).\n  Detail:", msg);
        process.exit(1);
      }
      console.error(`  ✗ ${p.name} failed: ${msg}`);
    }
  }

  console.log("\nDone. Restart the API (npm run dev) and the dashboard will show live data.");
}

main();

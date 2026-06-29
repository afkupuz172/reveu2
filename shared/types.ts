// Types shared between the Express API (server/) and the React app (src/).

export type LinkStatus = "linked" | "fuzzy" | "unlinked";
export type HealthBand = "Good" | "Action needed" | "At risk";
export type InvoiceStatus = "paid" | "open" | "overdue";
export type DataSource = "stripe" | "quickbooks";

// A/R aging buckets (QuickBooks-derived; Stripe has no equivalent).
export interface ArAging {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

export interface ClientListItem {
  id: string;
  name: string;
  domain: string;
  linkStatus: LinkStatus;
  band: HealthBand;
  mrr: number;
}

// A HubSpot contact associated with the selected company.
export interface Contact {
  name: string;
  email: string | null;
  title: string | null;
}

// A candidate Stripe/QBO resource that might belong to the selected company,
// with the contact info found there and why the matcher surfaced it.
export interface ResourceCandidate {
  source: DataSource;
  id: string; // Stripe customer id (cus_…) or QBO Customer Id
  label: string; // display name on the resource
  email: string | null;
  sublabel: string | null; // extra context, e.g. plan / balance hint
  matchReasons: string[]; // ["Stored reference ID", "Email domain nimbus.io", "Name match"]
  score: number; // 0–100 confidence
}

// What the resolve step returns: the HubSpot anchor + candidate resources to pick from.
export interface CompanyResolution {
  company: { id: string; name: string; domain: string; owner: string; lifecycle: string };
  contacts: Contact[];
  references: { stripeCustomerId: string | null; quickbooksCustomerId: string | null };
  candidates: { stripe: ResourceCandidate[]; quickbooks: ResourceCandidate[] };
  defaults: { stripeId: string | null; quickbooksId: string | null };
  mock: boolean;
}

// Normalized data assembled from HubSpot + Stripe before any computation.
// Both mock mode and the live API path produce this shape.
export interface RawClientData {
  company: {
    id: string;
    name: string;
    domain: string;
    owner: string;
    lifecycle: string;
  };
  link: { status: LinkStatus; stripeCustomerId: string | null };
  lastActivityDays: number;
  deals: { name: string; stage: string; amount: number; closeDate: string }[];
  tickets: { subject: string; status: string; createdAt: string }[];
  stripe: {
    subscriptions: {
      plan: string;
      status: string; // active | past_due | canceled | ...
      mrr: number;
      start: string;
      currentPeriodEnd: string;
      autoRenew: boolean;
    }[];
    invoices: {
      number: string;
      amount: number;
      status: InvoiceStatus;
      date: string;
      pdfUrl: string | null;
    }[];
    charges: { amount: number; date: string }[];
  } | null;
  // QuickBooks Online (accounting source of truth). Stripe-first; QBO fills gaps,
  // enriches (A/R aging, balance, terms), and is compared for conflicts.
  qbo: {
    customerId: string;
    displayName: string;
    balance: number; // total open A/R for this customer
    totalIncome: number; // lifetime payments received
    terms: string | null; // e.g. "Net 30"
    invoices: {
      docNumber: string;
      amount: number;
      status: InvoiceStatus;
      date: string;
      dueDate: string | null;
    }[];
    payments: { amount: number; date: string }[];
    arAging: ArAging;
  } | null;
  // Per-resource standalone contributions (one per selected Stripe/QBO customer),
  // used to break down how each total is composed in the details modal.
  contributions?: ResourceContribution[];
  selectedStripeIds?: string[];
  selectedQuickbooksIds?: string[];
}

// One selected resource's standalone contribution to the combined totals.
export interface ResourceContribution {
  id: string;
  source: DataSource;
  label: string;
  lifetimeSpend: number;
  mrr: number;
  arr: number;
  outstanding: number;
}

export interface HealthFactor {
  key: "payment" | "engagement" | "renewal" | "momentum";
  label: string;
  score: number;
  max: number;
}

export interface MonthPoint {
  month: string; // e.g. "Mar"
  [series: string]: string | number;
}

// One invoice in the merged Stripe+QBO view, tagged with where it came from.
export interface MergedInvoice {
  number: string;
  amount: number;
  status: InvoiceStatus;
  date: string;
  pdfUrl: string | null;
  source: DataSource;
}

// A disagreement between Stripe and QuickBooks about the same fact.
export interface Conflict {
  field: string; // e.g. "Outstanding balance", "Invoice INV-2050 status"
  stripe: string;
  quickbooks: string;
  note: string;
}

// The fully computed payload the dashboard renders.
export interface ClientSummary {
  company: RawClientData["company"];
  link: RawClientData["link"];
  summary: string; // rule-based narrative
  health: { score: number; band: HealthBand; factors: HealthFactor[] };
  kpis: {
    lifetimeSpend: number;
    mrr: number;
    arr: number;
    outstandingBalance: number;
    nextRenewal: string | null;
  };
  charts: {
    revenueOverTime: MonthPoint[];
    invoices: MonthPoint[]; // paid vs outstanding per month
  };
  subscriptions: NonNullable<RawClientData["stripe"]>["subscriptions"];
  deals: RawClientData["deals"];
  tickets: RawClientData["tickets"];
  invoices: MergedInvoice[]; // merged Stripe + QBO, each tagged with source
  reconciliation: {
    closedWonValue: number;
    stripeArr: number;
    mismatch: number;
    flagged: boolean;
    note: string;
  };
  // Stripe-first billing with QuickBooks fallback + enrichment.
  billing: {
    source: DataSource | "none"; // which system primarily backed the billing view
    qboLinked: boolean;
    qboBalance: number | null; // QBO total A/R for the customer
    qboTerms: string | null;
    arAging: ArAging | null; // QBO enrichment
    conflicts: Conflict[]; // Stripe vs QBO disagreements
  };
  // Which external resources produced this view (echoes the user's selection).
  selected: { stripeIds: string[]; quickbooksIds: string[] };
  // Per-resource breakdown of the totals (for the details modal).
  contributions: ResourceContribution[];
  mock: boolean;
}

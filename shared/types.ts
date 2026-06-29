// Types shared between the Express API (server/) and the React app (src/).

export type LinkStatus = "linked" | "fuzzy" | "unlinked";
export type HealthBand = "Good" | "Action needed" | "At risk";
export type InvoiceStatus = "paid" | "open" | "overdue";
export type DataSource = "stripe" | "quickbooks";
export type PaymentStatus = "Paid" | "Pending" | "Overdue" | "Not invoiced";

// A product/line item attached to a deal.
export interface DealProduct {
  name: string;
  quantity: number;
  amount: number;
}

// A HubSpot deal enriched with pipeline stage, products, and payment status.
export interface Deal {
  name: string;
  stage: string; // internal stage id (e.g. "closedwon")
  stageLabel: string; // human label (e.g. "Closed won")
  pipeline: string; // pipeline label
  probability: number; // 0–100
  isClosed: boolean;
  isWon: boolean;
  amount: number;
  closeDate: string;
  paymentStatus: PaymentStatus;
  products: DealProduct[];
  // Billing invoice number that corresponds to this deal (carried from the CRM, or
  // matched to an invoice by amount + close date in assemble). null when none maps.
  invoiceNumber?: string | null;
  // Ratification: whether a closed-won deal's value is corroborated by money
  // actually collected in Stripe/QuickBooks. Set by assemble; undefined for
  // non-won deals (ratification only applies to won revenue).
  ratified?: boolean;
  backing?: DataSource[]; // which billing systems corroborated the won revenue
}

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
  deals: Deal[];
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

// Portfolio overview across all companies.
export interface OverviewRow {
  id: string;
  name: string;
  nrr: number | null;
  billingSource: DataSource | "none";
  band: HealthBand;
  mrr: number;
  outstanding: number;
  lifetimeSpend: number;
  conflicts: number; // Stripe<->QBO disagreements
  aligned: boolean; // false when conflicts > 0
  openDealCount: number;
  openDealValue: number; // sum of open (not-closed) deal amounts
  paymentsDue: number; // count of deals with Pending/Overdue payment
}

export interface Overview {
  companies: OverviewRow[];
  // Portfolio revenue by calendar month: this year overlaid on last year.
  revenue: { months: string[]; currentYear: number[]; lastYear: number[] };
  // Distribution of NRR across the portfolio.
  nrrHealth: { expanding: number; flat: number; contracting: number; noData: number; average: number | null };
  mock: boolean;
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
  // Net Revenue Retention from closed-won HubSpot deals, counting only revenue
  // ratified by Stripe/QuickBooks billing: recent renewal/expansion value vs the
  // value booked ~a year earlier. value is a percentage (100 = flat, >100 expansion,
  // <100 contraction/churn); null when there's no ratified baseline + recent pair.
  nrr: {
    value: number | null;
    current: number; // recent ratified won value (trailing window)
    baseline: number; // ratified won value booked ~a year earlier
    windowMonths: number;
    unratifiedWonValue: number; // won-deal value NOT backed by billing
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

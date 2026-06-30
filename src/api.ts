import type { ClientListItem, ClientSummary, CompanyResolution, Overview, Overview2, OverviewRow, ScopeOption } from "../shared/types";

export interface OverviewRowResponse {
  row: OverviewRow;
  revenue: { currentYear: number[]; lastYear: number[] };
  mock: boolean;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || res.statusText);
  return res.json() as Promise<T>;
}

export const fetchClients = () => get<ClientListItem[]>("/api/clients");

export const fetchResolve = (companyId: string) => get<CompanyResolution>(`/api/company/${companyId}/resolve`);

export const fetchOverviewOptions = () => get<ScopeOption[]>("/api/overview/options");

const scopeQs = (scope?: { kind: string; value: string }) =>
  scope ? `?kind=${encodeURIComponent(scope.kind)}&value=${encodeURIComponent(scope.value)}` : "";

export const fetchOverviewCompanies = (scope: { kind: string; value: string }) =>
  get<{ id: string; name: string }[]>(`/api/overview/companies${scopeQs(scope)}`);

export const fetchOverview = (scope?: { kind: string; value: string }) => get<Overview>(`/api/overview${scopeQs(scope)}`);

export const fetchOverviewRow = (id: string, scope?: { kind: string; value: string }) =>
  get<OverviewRowResponse>(`/api/overview/row/${id}${scopeQs(scope)}`);

// Overview2: products library + the product/closed-year deal-pair overview.
export const fetchProducts = () => get<string[]>("/api/products");

export const fetchOverview2 = (products: string[], year: number) =>
  get<Overview2>(`/api/overview2?products=${encodeURIComponent(products.join(","))}&year=${year}`);

// stripeIds/qboIds: array of resource ids (empty = none), undefined = server default.
export function fetchClient(
  companyId: string,
  stripeIds?: string[],
  qboIds?: string[],
): Promise<ClientSummary> {
  const qs = new URLSearchParams();
  if (stripeIds !== undefined) qs.set("stripe", stripeIds.length ? stripeIds.join(",") : "none");
  if (qboIds !== undefined) qs.set("qbo", qboIds.length ? qboIds.join(",") : "none");
  const q = qs.toString();
  return get<ClientSummary>(`/api/client/${companyId}${q ? `?${q}` : ""}`);
}

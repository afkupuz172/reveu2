import type { ClientListItem, ClientSummary, CompanyResolution, Overview, OverviewRow } from "../shared/types";

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

export const fetchOverview = () => get<Overview>("/api/overview");
export const fetchOverviewRow = (id: string) => get<OverviewRowResponse>(`/api/overview/row/${id}`);

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

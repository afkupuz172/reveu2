import type { ClientListItem, ClientSummary } from "../shared/types";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || res.statusText);
  return res.json() as Promise<T>;
}

export const fetchClients = () => get<ClientListItem[]>("/api/clients");
export const fetchClient = (id: string) => get<ClientSummary>(`/api/client/${id}`);

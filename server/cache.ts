// Dead-simple in-memory TTL cache. For a local single-user MVP this is all the
// "database" we need: it softens API latency and keeps us under rate limits on
// repeated renders. Swap for Redis/Postgres when going multi-user.

const ttlMs = (Number(process.env.CACHE_TTL_SECONDS) || 60) * 1000;

interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();

export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

export function clearCache() {
  store.clear();
}

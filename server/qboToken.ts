// Persists the QuickBooks refresh token + realm id obtained from the OAuth
// connect flow, so the server can refresh access tokens across restarts.
// Stored in a gitignored .qbo-token.json at the project root. Env vars (e.g.
// from Intuit's OAuth Playground) take precedence if set.

import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const FILE = path.resolve(process.cwd(), ".qbo-token.json");

export interface QboToken {
  refreshToken: string;
  realmId: string;
}

export function loadToken(): QboToken | null {
  if (process.env.QUICKBOOKS_REFRESH_TOKEN && process.env.QUICKBOOKS_REALM_ID) {
    return {
      refreshToken: process.env.QUICKBOOKS_REFRESH_TOKEN,
      realmId: process.env.QUICKBOOKS_REALM_ID,
    };
  }
  if (!existsSync(FILE)) return null;
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as QboToken;
  } catch {
    return null;
  }
}

export function saveToken(t: QboToken): void {
  writeFileSync(FILE, JSON.stringify(t, null, 2));
}

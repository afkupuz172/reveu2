// Fuzzy matching: score how likely a Stripe/QBO resource belongs to a HubSpot
// company, using stored reference id > email domain > name similarity. Used by
// both mock and live resolve paths so the ranking is consistent.

import type { DataSource, ResourceCandidate } from "../shared/types";

export interface MatchInput {
  companyName: string;
  domain: string;
  storedId: string | null; // reference id stored on the HubSpot company, if any
}

export interface ResourceRecord {
  id: string;
  label: string; // name / DisplayName on the resource
  email: string | null;
  sublabel: string | null;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|company|gmbh)\b/g, "").replace(/[^a-z0-9]/g, "");

function nameSimilarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.8;
  // token overlap
  const xt = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const yt = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  const shared = [...xt].filter((t) => yt.has(t)).length;
  return shared > 0 ? 0.5 : 0;
}

const emailDomain = (email: string | null) => (email ? email.split("@")[1]?.toLowerCase() ?? "" : "");

// Score one resource against the company; returns null if nothing matches.
export function scoreResource(
  source: DataSource,
  rec: ResourceRecord,
  input: MatchInput,
): ResourceCandidate | null {
  const reasons: string[] = [];
  let score = 0;

  // Additive so multiple weak signals can outrank a single one, capped at 100.
  if (input.storedId && rec.id === input.storedId) {
    score += 100;
    reasons.push("Stored reference ID");
  }
  if (input.domain && emailDomain(rec.email) === input.domain.toLowerCase()) {
    score += 50;
    reasons.push(`Email domain ${input.domain}`);
  }
  const sim = nameSimilarity(input.companyName, rec.label);
  if (sim >= 0.8) {
    score += 40;
    reasons.push("Name match");
  } else if (sim >= 0.5) {
    score += 20;
    reasons.push("Partial name match");
  }

  if (reasons.length === 0) return null;
  score = Math.min(100, score);
  return {
    source,
    id: rec.id,
    label: rec.label,
    email: rec.email,
    sublabel: rec.sublabel,
    matchReasons: reasons,
    score,
  };
}

// Score + rank a pool of resources; highest confidence first.
export function rankCandidates(
  source: DataSource,
  records: ResourceRecord[],
  input: MatchInput,
): ResourceCandidate[] {
  const out: ResourceCandidate[] = [];
  for (const rec of records) {
    const c = scoreResource(source, rec, input);
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.score - a.score);
}

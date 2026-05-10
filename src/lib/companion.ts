import { supabase } from "@/integrations/supabase/client";

export type CompanionMap = {
  friendsBySlug: Record<string, string[]>;
  foesBySlug: Record<string, string[]>;
  nameBySlug: Record<string, string>;
};

const cache = new Map<string, CompanionMap>();

export async function getCompanionMaps(slugs: string[]): Promise<CompanionMap> {
  const key = [...slugs].filter(Boolean).sort().join("|");
  if (cache.has(key)) return cache.get(key)!;
  const empty: CompanionMap = { friendsBySlug: {}, foesBySlug: {}, nameBySlug: {} };
  if (slugs.length === 0) return empty;
  const { data } = await supabase
    .from("plants_catalog")
    .select("slug,name_da,companion_plants,antagonist_plants")
    .in("slug", slugs);
  const out: CompanionMap = { friendsBySlug: {}, foesBySlug: {}, nameBySlug: {} };
  for (const r of (data ?? []) as any[]) {
    out.friendsBySlug[r.slug] = (r.companion_plants ?? []) as string[];
    out.foesBySlug[r.slug] = (r.antagonist_plants ?? []) as string[];
    out.nameBySlug[r.slug] = r.name_da;
  }
  cache.set(key, out);
  return out;
}

/** Given the slugs present in a bed, return a list of foe-pairs (a,b) */
export function detectConflicts(
  slugs: string[],
  maps: CompanionMap,
): { a: string; b: string; aName: string; bName: string }[] {
  const conflicts: { a: string; b: string; aName: string; bName: string }[] = [];
  const seen = new Set<string>();
  for (const a of slugs) {
    const foes = maps.foesBySlug[a] ?? [];
    for (const b of slugs) {
      if (a === b) continue;
      if (!foes.includes(b)) continue;
      const k = [a, b].sort().join("::");
      if (seen.has(k)) continue;
      seen.add(k);
      conflicts.push({
        a, b,
        aName: maps.nameBySlug[a] ?? a,
        bName: maps.nameBySlug[b] ?? b,
      });
    }
  }
  return conflicts;
}

/** For a single target plant, classify each other slug in the bed as friend/foe/neutral */
export function relationFor(
  target: string,
  others: string[],
  maps: CompanionMap,
): { slug: string; name: string; rel: "friend" | "foe" | "neutral" }[] {
  const friends = new Set(maps.friendsBySlug[target] ?? []);
  const foes = new Set(maps.foesBySlug[target] ?? []);
  return others
    .filter(s => s !== target)
    .map(s => ({
      slug: s,
      name: maps.nameBySlug[s] ?? s,
      rel: foes.has(s) ? "foe" : friends.has(s) ? "friend" : "neutral",
    }));
}

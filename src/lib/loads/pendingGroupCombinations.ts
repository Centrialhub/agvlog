import { mergeDestinations } from './mergeDestinations';

export interface PendingRouteDoc {
  id: string;
  invoice_number: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  pallet_count: number | null;
  weight_kg: number | null;
  value: number | null;
  created_at: string;
  imported_at?: string | null;
  current_delivery_attempt_id?: string | null;
  cte_emitted_at?: string | null;
  cte_emitted_outbound_id?: string | null;
  nfse_emitted_at?: string | null;
  clients?: { company_name: string } | null;
}

export interface PendingRouteGroup {
  routeId: string | null;
  // Stable identity for assignments and creation recovery, even after combining.
  routeName: string;
  docs: PendingRouteDoc[];
  totalPallets: number;
  totalWeight: number;
  totalValue: number;
  cities: string[];
  ambiguousCities?: string[];
}

export interface GroupCombination {
  target: string;
  members: string[];
}

export interface CombinedRouteGroup extends PendingRouteGroup {
  destination: string;
  members: string[];
}

// Rebuild from current pending notes; never hold a stale copy of document IDs.
export function combinePendingGroups(
  baseGroups: PendingRouteGroup[],
  combinations: GroupCombination[],
): CombinedRouteGroup[] {
  const byName = new Map(baseGroups.map(group => [group.routeName, group]));
  const consumed = new Set<string>();
  const result: CombinedRouteGroup[] = [];
  for (const combination of combinations) {
    const members = combination.members.filter(name => byName.has(name) && !consumed.has(name));
    if (!members.length) continue;
    const parts = members.map(name => byName.get(name)!);
    const docs = Array.from(new Map(parts.flatMap(group => group.docs).map(doc => [doc.id, doc])).values());
    members.forEach(name => consumed.add(name));
    result.push({
      ...parts[0],
      routeName: combination.target,
      destination: members.reduce<string | null>((destination, name) => mergeDestinations(destination, name), null) || combination.target,
      members,
      docs,
      totalPallets: docs.reduce((total, doc) => total + (Number(doc.pallet_count) || 0), 0),
      totalWeight: docs.reduce((total, doc) => total + (Number(doc.weight_kg) || 0), 0),
      totalValue: docs.reduce((total, doc) => total + (Number(doc.value) || 0), 0),
      cities: Array.from(new Set(parts.flatMap(group => group.cities))),
      ambiguousCities: Array.from(new Set(parts.flatMap(group => group.ambiguousCities || []))),
    });
  }
  for (const group of baseGroups) {
    if (!consumed.has(group.routeName)) result.push({ ...group, destination: group.routeName, members: [group.routeName] });
  }
  return result.sort((a, b) => b.totalPallets - a.totalPallets);
}


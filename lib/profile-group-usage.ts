export type ProfileGroupUsage = { club_id: string; event_count: number; last_used_at: string | null };
export function orderProfileGroups<T extends { id: string; name: string }>(groups: readonly T[], usage: readonly ProfileGroupUsage[]): T[] {
  const known = new Map(usage.map(row => [row.club_id, row]));
  return [...groups].sort((a, b) => {
    const x = known.get(a.id), y = known.get(b.id);
    const count = (row?: ProfileGroupUsage) => Number.isFinite(Number(row?.event_count)) ? Number(row?.event_count) : 0;
    const last = (row?: ProfileGroupUsage) => { const time=Date.parse(row?.last_used_at ?? "");return Number.isFinite(time)?time:0; };
    return count(y)-count(x) || last(y)-last(x) || a.name.localeCompare(b.name,"ja") || a.id.localeCompare(b.id);
  });
}

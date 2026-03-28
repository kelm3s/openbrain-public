import { executeSQL } from '../lib/aurora';

interface StatsResult {
  total_thoughts: number;
  sources: Record<string, number>;
  oldest_thought: string | null;
  newest_thought: string | null;
}

export async function statsTool(): Promise<StatsResult> {
  // Total count + date range
  const summaryRows = await executeSQL(
    `SELECT
       COUNT(*)::int            AS total,
       MIN(created_at)::text    AS oldest,
       MAX(created_at)::text    AS newest
     FROM thoughts`
  );

  // Breakdown by source
  const sourceRows = await executeSQL(
    `SELECT source, COUNT(*)::int AS count
     FROM thoughts
     GROUP BY source
     ORDER BY count DESC`
  );

  const summary = summaryRows[0] ?? {};
  const sources: Record<string, number> = {};
  for (const row of sourceRows) {
    sources[row.source as string] = row.count as number;
  }

  return {
    total_thoughts: summary.total as number ?? 0,
    sources,
    oldest_thought: summary.oldest as string ?? null,
    newest_thought: summary.newest as string ?? null
  };
}

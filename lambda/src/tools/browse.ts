import { Field } from '@aws-sdk/client-rds-data';
import { executeSQL, parsePostgresArray } from '../lib/aurora';

const MAX_SOURCE_LENGTH = 50; // matches schema VARCHAR(50)

interface BrowseArgs {
  limit?: number;
  source?: string;
}

interface BrowseResult {
  thoughts: Array<{
    id: string;
    content: string;
    source: string;
    tags: string[];
    created_at: string;
  }>;
  count: number;
}

export async function browseTool(args: BrowseArgs): Promise<BrowseResult> {
  const { limit = 10, source } = args;
  const safeSource = source ? String(source).substring(0, MAX_SOURCE_LENGTH) : undefined;

  let sql: string;
  let params: { name: string; value: Field }[];

  if (safeSource) {
    sql = `SELECT id, content, source, tags, created_at
           FROM thoughts
           WHERE source = :source
           ORDER BY created_at DESC
           LIMIT :limit`;
    params = [
      { name: 'source', value: { stringValue: safeSource } },
      { name: 'limit',  value: { longValue: Math.min(limit, 50) } }
    ];
  } else {
    sql = `SELECT id, content, source, tags, created_at
           FROM thoughts
           ORDER BY created_at DESC
           LIMIT :limit`;
    params = [
      { name: 'limit', value: { longValue: Math.min(limit, 50) } }
    ];
  }

  const rows = await executeSQL(sql, params);

  const thoughts = rows.map(row => ({
    id:         row.id as string,
    content:    row.content as string,
    source:     row.source as string,
    tags:       parsePostgresArray(row.tags),
    created_at: row.created_at as string
  }));

  return { thoughts, count: thoughts.length };
}

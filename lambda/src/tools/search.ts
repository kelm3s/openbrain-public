import { executeSQL, parsePostgresArray } from '../lib/aurora';
import { generateEmbedding, formatVector } from '../lib/bedrock';

const MAX_QUERY_LENGTH = 5_000; // caps Bedrock token burn

interface SearchArgs {
  query: string;
  limit?: number;
}

interface SearchResult {
  results: Array<{
    id: string;
    content: string;
    source: string;
    tags: string[];
    similarity: number;
    created_at: string;
  }>;
  count: number;
  query: string;
}

export async function searchTool(args: SearchArgs): Promise<SearchResult> {
  const { query, limit = 5 } = args;

  if (!query || query.trim().length === 0) {
    throw new Error('query is required and cannot be empty');
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new Error(`query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`);
  }

  // Embed the search query
  const embedding = await generateEmbedding(query);
  const vectorStr = formatVector(embedding);

  // Cosine similarity search via pgvector
  // 1 - cosine_distance = cosine_similarity
  const rows = await executeSQL(
    `SELECT
       id,
       content,
       source,
       tags,
       created_at,
       1 - (embedding <=> :embedding::vector) AS similarity
     FROM thoughts
     ORDER BY embedding <=> :embedding::vector
     LIMIT :limit`,
    [
      { name: 'embedding', value: { stringValue: vectorStr } },
      { name: 'limit',     value: { longValue: Math.min(limit, 20) } }
    ]
  );

  const results = rows.map(row => ({
    id:         row.id as string,
    content:    row.content as string,
    source:     row.source as string,
    tags:       parsePostgresArray(row.tags),
    similarity: Math.round((row.similarity as number) * 1000) / 1000,
    created_at: row.created_at as string
  }));

  return { results, count: results.length, query };
}

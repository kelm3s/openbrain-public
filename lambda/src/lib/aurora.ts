import { RDSDataClient, ExecuteStatementCommand, Field } from '@aws-sdk/client-rds-data';

const client = new RDSDataClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

// These come from Lambda environment variables — set them in the console or via CLI
const CLUSTER_ARN  = process.env.AURORA_CLUSTER_ARN!;
const SECRET_ARN   = process.env.AURORA_SECRET_ARN!;
const DATABASE     = process.env.AURORA_DATABASE ?? 'postgres';

// Helper: convert Aurora Field to a JS value
function fieldToValue(field: Field): string | number | boolean | null {
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.longValue   !== undefined) return field.longValue;
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.isNull) return null;
  return null;
}

// Parse a PostgreSQL TEXT[] value returned by Aurora Data API.
// Aurora returns arrays as a plain string like "{tag1,tag2}" — not a JS array.
export function parsePostgresArray(val: unknown): string[] {
  if (!val || typeof val !== 'string') return [];
  const inner = val.replace(/^{|}$/g, '');
  if (!inner) return [];
  // Handle quoted elements (e.g. {"tag one",tag2}) and unquoted
  const results: string[] = [];
  for (const item of inner.split(',')) {
    const trimmed = item.replace(/^"|"$/g, '').trim();
    if (trimmed) results.push(trimmed);
  }
  return results;
}

// Execute a SQL statement via Aurora Data API
export async function executeSQL(
  sql: string,
  parameters: { name: string; value: Field }[] = []
): Promise<Record<string, unknown>[]> {
  const command = new ExecuteStatementCommand({
    resourceArn: CLUSTER_ARN,
    secretArn:   SECRET_ARN,
    database:    DATABASE,
    sql,
    parameters,
    includeResultMetadata: true
  });

  const response = await client.send(command);

  if (!response.records || !response.columnMetadata) return [];

  const columns = response.columnMetadata.map(col => col.name ?? '');

  return response.records.map(row =>
    Object.fromEntries(row.map((field, i) => [columns[i], fieldToValue(field)]))
  );
}

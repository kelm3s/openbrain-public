import { executeSQL } from '../lib/aurora';
import { generateEmbedding, formatVector } from '../lib/bedrock';

const MAX_CONTENT_LENGTH = 50_000; // ~50KB — caps Bedrock token burn and Lambda memory
const MAX_SOURCE_LENGTH  = 50;     // matches schema VARCHAR(50)
const MAX_TAGS           = 20;
const MAX_TAG_LENGTH     = 50;

interface CaptureArgs {
  content: string;
  source?: string;
  tags?: string[];
  created_at?: string; // ISO 8601 — for importing historical data with correct timestamps
}

interface CaptureResult {
  id: string;
  message: string;
  content_preview: string;
}

export async function captureTool(args: CaptureArgs): Promise<CaptureResult> {
  const { content, source = 'manual', tags = [], created_at } = args;

  if (!content || content.trim().length === 0) {
    throw new Error('content is required and cannot be empty');
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
  }

  // Validate optional timestamp override (used for historical imports)
  let safeCreatedAt: string | undefined;
  if (created_at !== undefined) {
    const d = new Date(created_at);
    if (isNaN(d.getTime())) throw new Error('created_at must be a valid ISO 8601 date string');
    safeCreatedAt = d.toISOString();
  }

  // Trim source to schema limit
  const safeSource = String(source).substring(0, MAX_SOURCE_LENGTH);

  // Sanitize tags: strip characters that would break PostgreSQL array literal parsing,
  // including commas (which would silently split one tag into multiple in the {tag} literal)
  // limit count and per-tag length
  const safeTags = tags
    .slice(0, MAX_TAGS)
    .map(t => String(t).replace(/["\\{},]/g, '').substring(0, MAX_TAG_LENGTH))
    .filter(t => t.length > 0);

  // Generate embedding via Bedrock
  const embedding = await generateEmbedding(content);
  const vectorStr = formatVector(embedding);

  // Insert into Aurora — use provided timestamp for historical imports, else default to NOW()
  const rows = await executeSQL(
    safeCreatedAt
      ? `INSERT INTO thoughts (content, embedding, source, tags, created_at)
         VALUES (:content, :embedding::vector, :source, :tags::text[], :created_at::timestamptz)
         RETURNING id`
      : `INSERT INTO thoughts (content, embedding, source, tags)
         VALUES (:content, :embedding::vector, :source, :tags::text[])
         RETURNING id`,
    [
      { name: 'content',   value: { stringValue: content } },
      { name: 'embedding', value: { stringValue: vectorStr } },
      { name: 'source',    value: { stringValue: safeSource } },
      { name: 'tags',      value: { stringValue: `{${safeTags.map(t => `"${t}"`).join(',')}}` } },
      ...(safeCreatedAt ? [{ name: 'created_at', value: { stringValue: safeCreatedAt } }] : [])
    ]
  );

  const id = rows[0]?.id as string;
  const preview = content.length > 100 ? content.substring(0, 100) + '...' : content;

  console.log(`Captured thought ${id} from source=${safeSource}`);

  return {
    id,
    message: `✅ Thought captured successfully`,
    content_preview: preview
  };
}

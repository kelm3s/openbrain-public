import { timingSafeEqual } from 'crypto';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { captureTool } from './tools/capture';
import { searchTool } from './tools/search';
import { browseTool } from './tools/browse';
import { statsTool } from './tools/stats';

// Reuse the SSM client and cache the key across warm Lambda invocations.
// A new client is expensive (re-initialises connection pool) and SSM adds ~100ms latency.
// 5-minute TTL ensures a rotated key takes effect without requiring a cold start.
const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
let cachedKey: string | null = null;
let cachedKeyExpiry = 0;

async function getStoredKey(): Promise<string | null> {
  const now = Date.now();
  if (cachedKey && now < cachedKeyExpiry) return cachedKey;
  const { Parameter } = await ssm.send(new GetParameterCommand({
    Name: '/openbrain/brain-key',
    WithDecryption: true
  }));
  cachedKey = Parameter?.Value ?? null;
  cachedKeyExpiry = now + 5 * 60 * 1_000; // 5-minute TTL
  return cachedKey;
}

// Validate the x-brain-key header against SSM using a timing-safe comparison
// (prevents side-channel timing attacks that could leak the key)
async function validateAuth(event: APIGatewayProxyEventV2): Promise<boolean> {
  const providedKey = event.headers?.['x-brain-key'];
  if (!providedKey) return false;

  const storedKey = await getStoredKey();
  if (!storedKey) return false;

  // Buffers must be the same byte-length for timingSafeEqual;
  // if lengths differ the key is wrong — return false without leaking which is longer
  const a = Buffer.from(providedKey, 'utf-8');
  const b = Buffer.from(storedKey, 'utf-8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Build and connect a McpServer + stateless transport for one Lambda invocation.
// A new instance is required per request: stateless transports cannot be reused.
async function buildMcpServer(): Promise<{
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}> {
  const server = new McpServer({ name: 'openbrain', version: '2.0.0' });

  server.tool(
    'capture_thought',
    'Save a thought, note, decision, or any content to your persistent memory with vector embeddings for semantic search.',
    {
      content:    z.string().describe('The content to capture and remember'),
      source:     z.string().optional().default('manual').describe('Where this came from (e.g. "meeting", "idea", "task")'),
      tags:       z.array(z.string()).optional().describe('Optional tags for filtering'),
      created_at: z.string().optional().describe('ISO 8601 timestamp override — for historical imports only. Omit for normal use.')
    },
    async ({ content, source, tags, created_at }) => {
      const result = await captureTool({ content, source, tags, created_at });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'search_thoughts',
    'Semantically search your memory for thoughts similar in meaning to the query.',
    {
      query: z.string().describe('What to search for (semantic / meaning-based)'),
      limit: z.number().optional().default(5).describe('Max results to return (default: 5)')
    },
    async ({ query, limit }) => {
      const result = await searchTool({ query, limit });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browse_recent',
    'Browse the most recently captured thoughts in chronological order.',
    {
      limit:  z.number().optional().default(10).describe('How many recent thoughts to return (default: 10)'),
      source: z.string().optional().describe('Optional: filter by source (e.g. "meeting", "idea")')
    },
    async ({ limit, source }) => {
      const result = await browseTool({ limit, source });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'get_stats',
    'Get statistics about your memory: total count, sources breakdown, and oldest/newest thought.',
    {},
    async () => {
      const result = await statsTool();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // stateless (no session tracking) + enableJsonResponse (required for Lambda — no SSE streaming)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  await server.connect(transport);
  return { server, transport };
}

// Main Lambda handler
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  console.log('Event:', JSON.stringify({ method, path }));

  const json = (statusCode: number, body: object) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  // Health check — no auth required
  if (method === 'GET' && path === '/health') {
    return json(200, { status: 'ok', version: '2.0.0' });
  }

  // All MCP routes require auth
  if (path !== '/mcp') {
    return json(404, { error: 'Not found' });
  }

  const authed = await validateAuth(event);
  if (!authed) {
    return json(401, { error: 'Unauthorized' });
  }

  const { server, transport } = await buildMcpServer();
  try {
    // Build a web-standard Request from the Lambda event
    const domainName = event.requestContext.domainName ?? 'lambda.local';
    const qs = event.rawQueryString ? `?${event.rawQueryString}` : '';
    const url = `https://${domainName}${event.rawPath}${qs}`;

    const request = new Request(url, {
      method,
      headers: new Headers(event.headers as Record<string, string>),
      body: method === 'POST' ? (event.body ?? null) : null
    });

    const response = await transport.handleRequest(request);
    const body = await response.text();

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });

    return { statusCode: response.status, headers, body };

  } catch (err) {
    console.error('Handler error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Internal server error' }) };
  } finally {
    await server.close();
  }
};

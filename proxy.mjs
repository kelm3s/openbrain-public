#!/usr/bin/env node
// openbrain/proxy.mjs
// Stdio ↔ HTTP MCP proxy — forwards JSON-RPC from VS Code/Claude Desktop
// directly to the OpenBrain Lambda MCP endpoint (real MCP JSON-RPC, no translation).
// No npm dependencies; requires Node.js 18+ (built-in fetch).
//
// Required env vars:
//   OPENBRAIN_KEY  — your brain key (from SSM /openbrain/brain-key)
//   OPENBRAIN_URL  — your API Gateway endpoint, e.g. https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp

import { createInterface } from 'readline';

// Explicit Node.js version check: built-in fetch was added in v18.
// On Mac with nvm, Claude Desktop may resolve the wrong node — this gives a clear error.
const [nodeMajor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 18) {
  process.stderr.write(`Error: openbrain-proxy requires Node.js 18+. Detected: ${process.version}\n`);
  process.stderr.write('On Mac with nvm, Claude Desktop does not inherit your shell PATH.\n');
  process.stderr.write('See: https://github.com/kelm3s/openbrain-public/blob/main/docs/mcp-config.md\n');
  process.exit(1);
}

const MCP_URL = process.env.OPENBRAIN_URL;
const KEY = process.env.OPENBRAIN_KEY;

if (!MCP_URL) {
  process.stderr.write('Error: OPENBRAIN_URL environment variable is required\n');
  process.exit(1);
}

if (!KEY) {
  process.stderr.write('Error: OPENBRAIN_KEY environment variable is required\n');
  process.exit(1);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try { message = JSON.parse(trimmed); } catch { return; }

  try {
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // MCP spec: client must accept both JSON (for stateless) and SSE (for stateful)
        'Accept': 'application/json, text/event-stream',
        'x-brain-key': KEY
      },
      body: JSON.stringify(message)
    });

    // 202 Accepted — notification delivered, no response expected
    if (response.status === 202) return;

    if (!response.ok) {
      const text = await response.text();
      if (message.id !== undefined) {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: `HTTP ${response.status}: ${text}` } });
      }
      return;
    }

    const body = await response.text();
    // Response is application/json (enableJsonResponse:true on Lambda)
    // Write it directly to stdout — it's already a valid JSON-RPC envelope
    if (body) process.stdout.write(body + '\n');

  } catch (err) {
    if (message.id !== undefined) {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: String(err) } });
    }
  }
});

rl.on('close', () => process.exit(0));

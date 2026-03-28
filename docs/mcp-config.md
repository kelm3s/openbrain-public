# mcp-config.md — MCP Configuration for All Clients

*Endpoint: `https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp` (API Gateway HTTP API — Lambda Function URL is blocked by account-level AWS Block Public Access).*  
*Replace `YOUR_BRAIN_KEY` with your value from SSM `/openbrain/brain-key` before using.*

> **Architecture as of v2.0.0:** The Lambda now runs a real MCP JSON-RPC server (`@modelcontextprotocol/sdk` v1.x, stateless, `enableJsonResponse: true`). `proxy.mjs` is a thin stdio↔HTTP bridge — no protocol translation needed.

---

## VS Code (GitHub Copilot) — Tested on 1.113, Windows

> **Important gotchas learned the hard way — read before starting.**
>
> - `${env:OPENBRAIN_KEY}` does **not** resolve in MCP server `env` blocks in workspace `.vscode/settings.json` (VS Code 1.113). The literal string is passed to the child process → proxy exits with missing key error → server shows **Stopped**.
> - VS Code `"type": "http"` MCP transport sends proper JSON-RPC. However, it requires VS Code to forward the correct `Accept: application/json, text/event-stream` header. Until this is confirmed, use `"type": "stdio"` with `proxy.mjs` (tested, works).
> - The hammer icon only appears in **Agent mode** — not Ask or Edit mode.

**Prerequisites:** VS Code 1.99+, GitHub Copilot extension, Node.js 18+

### Step 1 — Enable MCP in VS Code user settings

`Ctrl+Shift+P` → **Preferences: Open User Settings (JSON)** → add:

```json
"chat.mcp.enabled": true
```

### Step 2 — Get your brain key from SSM

```powershell
aws ssm get-parameter --name "/openbrain/brain-key" --with-decryption --query Parameter.Value --output text --region us-east-1
```

> If your CLI user lacks `ssm:GetParameter` permission, get it from the AWS Console instead:  
> **Systems Manager → Parameter Store → `/openbrain/brain-key` → Show decrypted value**

### Step 3 — Add to `mcp.json` (user-level, not the repo)

**Windows:** `%APPDATA%\Code\User\mcp.json`
**Mac/Linux:** `~/.config/Code/User/mcp.json`

Replace `YOUR_BRAIN_KEY` with the value from Step 2.

**Option A — npx (recommended, no file path needed):**

```json
{
  "servers": {
    "openbrain": {
      "type": "stdio",
      "command": "npx",
      "args": ["openbrain-proxy"],
      "env": {
        "OPENBRAIN_KEY": "YOUR_BRAIN_KEY",
        "OPENBRAIN_URL": "https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp"
      }
    }
  }
}
```

**Option B — local file (if you have the repo cloned):**

```json
{
  "servers": {
    "openbrain": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/absolute/path/to/openbrain/proxy.mjs"],
      "env": {
        "OPENBRAIN_KEY": "YOUR_BRAIN_KEY",
        "OPENBRAIN_URL": "https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp"
      }
    }
  }
}
```

> The key is embedded directly here because `${env:...}` substitution doesn't work in MCP env blocks.  
> This file lives in your user profile directory — it is **never committed to the repo**.

### Step 4 — Reload VS Code

`Ctrl+Shift+P` → **Developer: Reload Window**

Check the MCP dropdown (top of chat bar) — `openbrain` should show **Running**.  
The OUTPUT panel → **MCP openbrain** channel should show `Discovered 4 tools`.

### Step 5 — Verify in Agent mode

1. Open Copilot Chat
2. Switch to **Agent** mode (bottom-left dropdown in chat input bar)
3. Click the **hammer icon** → confirm `capture_thought`, `search_thoughts`, `browse_recent`, `get_stats` appear

---

## Claude Desktop (Windows / Mac)

A thin stdio↔HTTP bridge that forwards JSON-RPC directly to the Lambda MCP endpoint.

Config file locations:
- **Windows** — `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac** — `~/Library/Application Support/Claude/claude_desktop_config.json`

After saving, fully quit Claude Desktop (menu bar / tray → **Quit**, not just close the window) and relaunch. Look for the hammer icon in the chat bar.

---

### Windows — npx (recommended)

```json
{
  "mcpServers": {
    "openbrain": {
      "command": "npx",
      "args": ["openbrain-proxy"],
      "env": {
        "OPENBRAIN_KEY": "YOUR_BRAIN_KEY",
        "OPENBRAIN_URL": "https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp"
      }
    }
  }
}
```

---

### Mac — Homebrew or system Node ≥ 18

Claude Desktop doesn't inherit your shell `PATH`. Use the full path to `npx` rather than just `"npx"`.

```bash
which npx   # → e.g. /opt/homebrew/bin/npx  (Apple Silicon Homebrew)
            #      or /usr/local/bin/npx     (Intel Homebrew)
```

```json
{
  "mcpServers": {
    "openbrain": {
      "command": "/opt/homebrew/bin/npx",
      "args": ["openbrain-proxy"],
      "env": {
        "OPENBRAIN_KEY": "YOUR_BRAIN_KEY",
        "OPENBRAIN_URL": "https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp"
      }
    }
  }
}
```

---

### Mac — nvm (or nodenv, volta, etc.)

Claude Desktop doesn't inherit your shell `PATH`, so even the right `npx` resolves `node` from the system
default, which may be an old version (< 18) that doesn't have built-in `fetch`.

**Skip `npx` entirely.** Point `command` at the Node binary directly and pass the proxy path as the argument.
No shebang, no PATH resolution, no fragility.

**Step 1 — Install globally with your nvm node:**
```bash
/Users/YOUR_USERNAME/.nvm/versions/node/vX.X.X/bin/npm install -g openbrain-proxy
```

**Step 2 — Find your paths:**
```bash
which node      # → /Users/YOUR_USERNAME/.nvm/versions/node/vX.X.X/bin/node
npm root -g     # → /Users/YOUR_USERNAME/.nvm/versions/node/vX.X.X/lib/node_modules
```

**Step 3 — Configure:**
```json
{
  "mcpServers": {
    "openbrain": {
      "command": "/Users/YOUR_USERNAME/.nvm/versions/node/vX.X.X/bin/node",
      "args": ["/Users/YOUR_USERNAME/.nvm/versions/node/vX.X.X/lib/node_modules/openbrain-proxy/proxy.mjs"],
      "env": {
        "OPENBRAIN_KEY": "YOUR_BRAIN_KEY",
        "OPENBRAIN_URL": "https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp"
      }
    }
  }
}
```

> **If you have the repo cloned**, you can skip the global install and point `args` at your local
> `proxy.mjs` instead: `["/path/to/openbrain/proxy.mjs"]`

> **After upgrading nvm node versions**, update the `vX.X.X` in both `command` and `args`.

> **Diagnosing failures:** check `~/Library/Logs/Claude/mcp-server-openbrain.log`

---

## Claude Code (CLI)

The Lambda speaks real MCP JSON-RPC, so HTTP direct would be ideal — but Claude Code CLI does not support custom request headers, so `x-brain-key` cannot be passed via `claude mcp add --transport http`. Use the stdio+proxy approach instead.

**Option A — npx (recommended, no file path needed):**

```bash
claude mcp add openbrain npx openbrain-proxy
```

Then set the env vars in your shell profile:
```bash
export OPENBRAIN_KEY="YOUR_BRAIN_KEY"
export OPENBRAIN_URL="https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp"
```

**Option B — local file:**

```bash
claude mcp add openbrain node /absolute/path/to/openbrain/proxy.mjs
```

> After saving, restart Claude Code for the config to take effect.

---

## Direct HTTP (curl / scripts)

The Lambda endpoint speaks real MCP JSON-RPC. Authentication via `x-brain-key` header:

```bash
# Initialize
curl -X POST https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-brain-key: YOUR_BRAIN_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# List tools
curl -X POST https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-brain-key: YOUR_BRAIN_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Call get_stats
curl -X POST https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-brain-key: YOUR_BRAIN_KEY" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_stats","arguments":{}}}'
```

---

## Test Commands (curl)

```bash
# Health check (no auth required)
curl https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/health

# List tools
curl -X POST https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-brain-key: YOUR_BRAIN_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Capture a thought
curl -X POST https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-brain-key: YOUR_BRAIN_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"capture_thought","arguments":{"content":"First thought captured in OpenBrain. System is live.","source":"test","tags":["milestone","test"]}}}'

# Search thoughts
curl -X POST https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-brain-key: YOUR_BRAIN_KEY" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_thoughts","arguments":{"query":"first thought","limit":3}}}'

# Browse recent
curl -X POST https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-brain-key: YOUR_BRAIN_KEY" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"browse_recent","arguments":{"limit":5}}}'

# Get stats
curl -X POST https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-brain-key: YOUR_BRAIN_KEY" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_stats","arguments":{}}}'
```

---

## Where to Find Your Values

| Value | Where to find it |
|---|---|
| API endpoint | `https://YOUR_ID.execute-api.YOUR_REGION.amazonaws.com` (hardcoded above) |
| `YOUR_BRAIN_KEY` | AWS Console → SSM Parameter Store → `/openbrain/brain-key` → Show value |

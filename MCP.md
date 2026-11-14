# MCP – Model Context Protocol in J.A.R.V.I.S (Vercel edition)

J.A.R.V.I.S is an **MCP host**: the MCP *client* is built into the
browser page. “Connecting MCP” means registering **MCP servers** whose
tools Groq may then use. There is no separate client to install.

## What works where

| Server type | Works? | How |
|---|---|---|
| **Remote HTTP servers** (Composio, hosted servers) | Yes | Browser MCP client, via the Vercel proxy `/api/mcp` (CORS-safe) |
| **Local stdio servers** (`uvx …`, `npx …`) | No | A browser cannot start programs. Use a hosted MCP endpoint instead. |

Flow per server: `initialize` → `tools/list` → tools are offered to
Groq via function calling → `tools/call` runs in the chat loop
(max. 4 rounds). Tool names are namespaced `server__tool`.

## 1) Composio with the platform API (any toolkits)

In Composio you create an MCP server, choose toolkits (Gmail, Google
Drive, Sheets, …) and connect your accounts once via OAuth. JARVIS
then uses those accounts’ tools — no passwords in JARVIS.

1. Sign in at **composio.dev** (free account is enough) and create an
   **MCP server / Tool Router** (the label varies slightly).
2. Add **toolkits** and **connect** your accounts (e.g. Gmail →
   Connect → Google sign-in).
3. Composio shows the **MCP URL**, e.g.
   `https://backend.composio.dev/v3/mcp/YOUR_SERVER_ID?user_id=YOUR_USER_ID`
4. Your **API key** (`ak_…`) is under **Settings → API Keys**.
5. In JARVIS: **MCP plugin → “+ Composio template”** → paste URL, set
   the header to `{"x-api-key": "ak_…"}`, route **Vercel proxy** →
   **“Save & connect”**. The status line shows the tool count.
6. Ask in chat: *“Show my latest emails”* — the reply is marked
   e.g. `via groq · composio__GMAIL_…`.

Tip: test single tools in the MCP plugin under “Test a tool”.

## 2) Composio Connect (quick variant)

- URL: `https://connect.composio.dev/mcp`
- Header: `{"x-consumer-api-key": "ck_…"}` — a *different* key type
  (consumer key) than the platform `ak_…` key.
- **In this deployment the consumer key is already stored server-side**
  in the Vercel env (`COMPOSIO_CONSUMER_KEY`). Then **“+ Composio
  Connect”** with header `{}` is enough — the server is even created
  automatically on start, and `/api/mcp` injects the key. You never
  type the key on the iPad.

## 3) Any other MCP server

1. **MCP plugin → “+ Custom server”**
2. Name (e.g. `my-server`) + **MCP URL** (`https://…`, Streamable HTTP)
3. Headers as JSON if the provider needs a key:
   `{"x-api-key": "…"}` or `{"Authorization": "Bearer …"}`
4. Route **“Vercel proxy”** (recommended; avoids CORS blocks). Only
   servers that explicitly allow browser access work “direct”.
5. **Save & connect** → status shows found tools; toggle servers with
   the “on” checkbox; edit/delete on the right.
6. In Settings, the “MCP servers” section mirrors the connection state.

Server details live only in your browser (localStorage). Keys in URLs
or headers are as sensitive as passwords — do not share them.

## Which AI uses the tools?

**Groq only** (Llama 3.3 70B via function calling). The server key
from the Vercel env takes priority; your own browser key (Settings)
is the fallback. Without a working Groq key, MCP tools cannot be
orchestrated — JARVIS will tell you honestly rather than fake an
answer.

## Troubleshooting

- **0 tools / offline:** wrong URL or key, or the toolkits’ accounts
  are not connected in Composio yet. Check the error under the status.
- **Blocked host:** the proxy only allows hosts from
  `MCP_ALLOWED_HOSTS` in Vercel (`composio.dev` by default). Add your
  host there, or set `MCP_ALLOW_ANY=1` (own risk).
- **CORS error:** switch the server’s route to “Vercel proxy”.
- **Works in chat but slow:** many connected toolkits mean long tool
  lists; disable servers you do not need in the MCP plugin.

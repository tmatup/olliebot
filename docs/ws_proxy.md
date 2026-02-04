# WebSocket Proxy Configuration

## Overview

The frontend WebSocket connection can operate in two modes:

1. **Direct connection** (default) - Connects directly to the backend on port 3000
2. **Vite proxy** - Routes WebSocket through Vite's dev server proxy on port 5173

## When to Use Each Mode

| Mode | WebSocket URL | Use Case |
|------|---------------|----------|
| Direct (default) | `ws://localhost:3000` | Local development |
| Vite proxy | `ws://localhost:5173/ws` → proxied to :3000 | Remote dev, Codespaces, single-port forwarding |
| Custom URL | User-defined | Full override for custom deployments |

## Configuration

### Default: Direct Connection

No configuration needed. The frontend connects directly to `ws://localhost:3000`.

```bash
pnpm run dev
```

This avoids Vite proxy socket errors (`ECONNABORTED`) that occur during HMR/page refresh.

### Remote Development: Enable Vite Proxy

For scenarios where only one port is forwarded (VS Code Remote, GitHub Codespaces, Docker, ngrok, etc.), enable the WebSocket proxy:

**Option 1: Environment variable**
```bash
VITE_USE_WS_PROXY=true pnpm run dev
```

**Option 2: Create `web/.env.local`**
```
VITE_USE_WS_PROXY=true
```

When enabled, you'll see this message on startup:
```
[vite] WebSocket proxy enabled (VITE_USE_WS_PROXY=true)
```

### Custom WebSocket URL

For full control over the WebSocket endpoint:

```bash
VITE_WS_URL=wss://your-server.com/ws pnpm run dev
```

Or in `web/.env.local`:
```
VITE_WS_URL=wss://your-server.com/ws
```

## How It Works

The WebSocket URL is determined in `web/src/hooks/useWebSocket.js`:

```
1. If VITE_WS_URL is set → use it (custom override)
2. If VITE_USE_WS_PROXY=true → use /ws path through Vite proxy
3. If running on port 5173 → connect directly to :3000 (default dev)
4. Otherwise → use same origin (production)
```

## Tradeoffs

### Direct Connection (Default)
- ✅ No proxy socket errors during HMR/refresh
- ✅ Simpler network path
- ❌ Requires both ports (5173 and 3000) accessible

### Vite Proxy
- ✅ Single port needed (only 5173)
- ✅ Works with port forwarding and tunnels
- ⚠️ May show socket errors on page refresh (suppressed but not eliminated)

## Troubleshooting

### "WebSocket connection failed" in remote environment

Enable the proxy:
```bash
VITE_USE_WS_PROXY=true pnpm run dev
```

### Socket errors in console (`ECONNABORTED`)

These are benign errors during page refresh/HMR. They're suppressed when using the proxy, but if they appear:
1. Ensure you're using the latest config
2. Consider using direct connection mode if possible

### Connection works locally but not remotely

Check that:
1. `VITE_USE_WS_PROXY=true` is set
2. Port 5173 is forwarded/exposed
3. The forwarding service supports WebSocket upgrades

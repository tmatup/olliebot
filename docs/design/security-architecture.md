# Security Architecture Design

## Overview

This document outlines the security architecture for OllieBot's frontend-backend communication. The design provides layered protection against unauthorized access while supporting both local development and future cloud deployment scenarios.

## Current State Analysis

### Identified Vulnerabilities

| Issue | Severity | Current State |
|-------|----------|---------------|
| No authentication | CRITICAL | All endpoints publicly accessible |
| CORS `origin: '*'` | CRITICAL | Any website can make requests |
| WebSocket unprotected | CRITICAL | Anyone can connect and control system |
| No rate limiting | HIGH | Vulnerable to abuse/DoS |
| Unencrypted transport | HIGH | MitM attacks possible |

### Attack Vectors to Address

1. **External Network Attack**: Attacker on same network tries to connect to backend
2. **Cross-Origin Attack**: Malicious website makes requests to local backend
3. **Session Hijacking**: Attacker steals/guesses session credentials
4. **Replay Attacks**: Captured requests replayed to backend

---

## Proposed Architecture

### Design Principles

1. **Defense in Depth**: Multiple independent security layers
2. **Secure by Default**: Strictest settings unless explicitly relaxed
3. **Deployment Flexibility**: Same codebase works local and cloud
4. **Minimal Friction**: Single-user local mode should be seamless

---

## Security Layers

### Layer 1: Network Binding (First Line of Defense)

**Purpose**: Control which network interfaces the server listens on.

```
┌─────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT MODES                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  LOCAL MODE (default)         CLOUD MODE                    │
│  ┌─────────────────────┐     ┌─────────────────────┐       │
│  │ Bind: 127.0.0.1     │     │ Bind: 0.0.0.0       │       │
│  │ Only localhost can  │     │ All interfaces      │       │
│  │ connect             │     │ (behind reverse     │       │
│  │                     │     │  proxy/firewall)    │       │
│  └─────────────────────┘     └─────────────────────┘       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Configuration**:
```typescript
interface ServerConfig {
  mode: 'local' | 'cloud';
  bindAddress: string;  // '127.0.0.1' for local, '0.0.0.0' for cloud
  port: number;
}

// Environment-driven
// LOCAL mode: BIND_ADDRESS=127.0.0.1 (default)
// CLOUD mode: BIND_ADDRESS=0.0.0.0 + requires AUTH_REQUIRED=true
```

**Trade-offs**:
- Local binding provides strong isolation but limits to same machine
- Cloud mode requires additional authentication layers (see Layer 3)

---

### Layer 2: CORS & Origin Validation

**Purpose**: Prevent cross-origin attacks from malicious websites.

```
┌─────────────────────────────────────────────────────────────┐
│                    CORS CONFIGURATION                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ALLOWED ORIGINS (configurable via ALLOWED_ORIGINS env)     │
│                                                              │
│  Local Development:                                          │
│  • http://localhost:5173  (Vite dev server)                 │
│  • http://127.0.0.1:5173                                    │
│  • http://localhost:3000  (same-origin)                     │
│                                                              │
│  Cloud Deployment:                                           │
│  • https://your-domain.com                                  │
│  • https://app.your-domain.com                              │
│                                                              │
│  REJECTED:                                                   │
│  • https://evil-site.com  ────► 403 Forbidden               │
│  • Any unlisted origin    ────► 403 Forbidden               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**WebSocket Origin Validation**:
- WebSocket upgrade requests include `Origin` header
- Server validates origin before accepting connection
- Reject connections from unknown origins

---

### Layer 3: Authentication System

**Purpose**: Verify identity of connecting clients.

#### Option A: Instance Token (Recommended for Local)

Best for single-user local deployment. Zero configuration for user.

```
┌─────────────────────────────────────────────────────────────┐
│                  INSTANCE TOKEN FLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. SERVER STARTUP                                           │
│     ┌─────────────────────────────────────────────┐         │
│     │  Generate cryptographically random token    │         │
│     │  INSTANCE_TOKEN = crypto.randomBytes(32)    │         │
│     │  .toString('base64url')                     │         │
│     └─────────────────────────────────────────────┘         │
│                            │                                 │
│                            ▼                                 │
│  2. TOKEN DISTRIBUTION                                       │
│     ┌─────────────────────────────────────────────┐         │
│     │  • Inject into HTML served to browser       │         │
│     │  • Write to ~/.olliebot/instance-token      │         │
│     │  • Display in console for CLI copy/paste    │         │
│     └─────────────────────────────────────────────┘         │
│                            │                                 │
│                            ▼                                 │
│  3. CLIENT AUTHENTICATION                                    │
│     ┌─────────────────────────────────────────────┐         │
│     │  HTTP:  Authorization: Bearer <token>       │         │
│     │  WS:    ws://localhost:3000?token=<token>   │         │
│     │         or first message { type: 'auth' }   │         │
│     └─────────────────────────────────────────────┘         │
│                            │                                 │
│                            ▼                                 │
│  4. SERVER VALIDATION                                        │
│     ┌─────────────────────────────────────────────┐         │
│     │  Compare token (constant-time comparison)   │         │
│     │  Valid   → Allow request                    │         │
│     │  Invalid → 401 Unauthorized                 │         │
│     └─────────────────────────────────────────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**How Browser Gets Token** (solving the sandbox problem):

```
┌─────────────────────────────────────────────────────────────┐
│           TOKEN INJECTION FOR WEB FRONTEND                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Server serves the frontend HTML with embedded token:        │
│                                                              │
│  GET / (from localhost:3000)                                │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  <!DOCTYPE html>                                    │    │
│  │  <html>                                             │    │
│  │  <head>                                             │    │
│  │    <script>                                         │    │
│  │      window.__OLLIEBOT_TOKEN__ = "abc123...";       │    │
│  │    </script>                                        │    │
│  │  </head>                                            │    │
│  │  ...                                                │    │
│  │  </html>                                            │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Security: Token only visible to same-origin JavaScript      │
│  (protected by browser same-origin policy + CORS)            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**For Development with Vite (separate dev server)**:

```
┌─────────────────────────────────────────────────────────────┐
│           DEVELOPMENT MODE TOKEN FLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Option 1: Token Endpoint (recommended)                      │
│  ─────────────────────────────────────                      │
│  GET /api/auth/token (only from allowed origins)            │
│  Response: { token: "abc123..." }                           │
│                                                              │
│  Frontend fetches token on startup, stores in memory        │
│  Token endpoint protected by:                                │
│    • CORS (only localhost:5173 can call)                    │
│    • Rate limiting (1 request per minute per IP)            │
│                                                              │
│  Option 2: Environment Variable                              │
│  ──────────────────────────────                             │
│  Server writes token to .env.local                          │
│  Vite reads VITE_INSTANCE_TOKEN from .env.local             │
│  (Requires dev server restart on token change)              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Option B: JWT Authentication (Recommended for Cloud)

Best for multi-user or cloud deployment.

```
┌─────────────────────────────────────────────────────────────┐
│                    JWT AUTH FLOW                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. LOGIN                                                    │
│     POST /api/auth/login                                    │
│     { username: "admin", password: "..." }                  │
│            │                                                 │
│            ▼                                                 │
│     ┌─────────────────────────────────────────────┐         │
│     │  Verify credentials (bcrypt comparison)     │         │
│     │  Generate JWT with claims:                  │         │
│     │    - sub: user_id                           │         │
│     │    - iat: issued_at                         │         │
│     │    - exp: expiration (e.g., 24h)            │         │
│     │  Sign with server secret                    │         │
│     └─────────────────────────────────────────────┘         │
│            │                                                 │
│            ▼                                                 │
│     Response: { accessToken: "eyJ...", expiresIn: 86400 }   │
│                                                              │
│  2. AUTHENTICATED REQUESTS                                   │
│     Authorization: Bearer eyJhbGciOiJIUzI1NiIs...           │
│            │                                                 │
│            ▼                                                 │
│     ┌─────────────────────────────────────────────┐         │
│     │  Verify JWT signature                       │         │
│     │  Check expiration                           │         │
│     │  Extract user from claims                   │         │
│     │  Attach user to request context             │         │
│     └─────────────────────────────────────────────┘         │
│                                                              │
│  3. REFRESH (optional)                                       │
│     POST /api/auth/refresh                                  │
│     Cookie: refreshToken=...                                │
│     → New access token                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Option C: API Key (For Programmatic Access)

For CLI tools, scripts, and integrations.

```
┌─────────────────────────────────────────────────────────────┐
│                    API KEY AUTH                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Configuration:                                              │
│  API_KEYS=key1:name1,key2:name2                             │
│                                                              │
│  Usage:                                                      │
│  X-API-Key: sk-olliebot-abc123...                           │
│  or                                                          │
│  Authorization: ApiKey sk-olliebot-abc123...                │
│                                                              │
│  Best Practices:                                             │
│  • Prefix keys for identification: sk-olliebot-             │
│  • Hash stored keys (compare hashes, not plaintext)         │
│  • Allow multiple keys with labels/descriptions             │
│  • Support key rotation and revocation                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### Layer 4: WebSocket Authentication

**Purpose**: Secure the persistent WebSocket connection.

```
┌─────────────────────────────────────────────────────────────┐
│                WEBSOCKET AUTH PROTOCOL                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  METHOD 1: Query Parameter (Simple)                          │
│  ──────────────────────────────────                         │
│                                                              │
│  Client: ws://localhost:3000?token=abc123                   │
│                                                              │
│  Server (on 'upgrade' event):                                │
│    1. Parse URL, extract token                               │
│    2. Validate token                                         │
│    3. Accept or reject upgrade                               │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  wss.handleUpgrade(request, socket, head, (ws) => { │    │
│  │    const url = new URL(request.url, 'ws://x');      │    │
│  │    const token = url.searchParams.get('token');     │    │
│  │    if (!validateToken(token)) {                     │    │
│  │      socket.write('HTTP/1.1 401 Unauthorized\r\n'); │    │
│  │      socket.destroy();                              │    │
│  │      return;                                        │    │
│  │    }                                                │    │
│  │    wss.emit('connection', ws, request);             │    │
│  │  });                                                │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│                                                              │
│  METHOD 2: First Message Auth (More Secure)                  │
│  ──────────────────────────────────────────                 │
│                                                              │
│  Client connects, then sends:                                │
│  { type: "auth", token: "abc123" }                          │
│                                                              │
│  Server:                                                     │
│    1. Accept connection but mark as "pending"                │
│    2. Start 5-second auth timeout                            │
│    3. First message must be auth message                     │
│    4. Validate token → mark as "authenticated"               │
│    5. If invalid or timeout → close connection               │
│                                                              │
│  Advantages:                                                  │
│    • Token not in URL/logs                                   │
│    • Can include additional metadata                         │
│    • Supports token refresh during session                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### Layer 5: Session Management

**Purpose**: Track and control active connections.

```
┌─────────────────────────────────────────────────────────────┐
│                  SESSION ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                 SESSION STORE                        │    │
│  │  (in-memory for local, Redis for cloud)              │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  sessionId: string (UUID v4)                         │    │
│  │  clientId: string (WebSocket client UUID)            │    │
│  │  userId: string | null                               │    │
│  │  createdAt: Date                                     │    │
│  │  lastActivity: Date                                  │    │
│  │  ipAddress: string                                   │    │
│  │  userAgent: string                                   │    │
│  │  authMethod: 'instance' | 'jwt' | 'apikey'           │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Session Lifecycle:                                          │
│    1. Created on successful authentication                   │
│    2. Updated on each request (lastActivity)                 │
│    3. Expired after inactivity timeout (configurable)        │
│    4. Destroyed on logout or connection close                │
│                                                              │
│  Session Operations:                                         │
│    • List active sessions: GET /api/auth/sessions            │
│    • Revoke session: DELETE /api/auth/sessions/:id           │
│    • Revoke all: POST /api/auth/logout-all                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### Layer 6: Rate Limiting

**Purpose**: Prevent abuse and DoS attacks.

```
┌─────────────────────────────────────────────────────────────┐
│                  RATE LIMITING TIERS                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  TIER 1: Global Rate Limit                                   │
│  ─────────────────────────                                  │
│  • 1000 requests per minute per IP                          │
│  • Applies to all endpoints                                  │
│  • Returns 429 Too Many Requests when exceeded              │
│                                                              │
│  TIER 2: Endpoint-Specific Limits                            │
│  ────────────────────────────────                           │
│  │ Endpoint              │ Limit          │ Window │        │
│  ├───────────────────────┼────────────────┼────────┤        │
│  │ POST /api/messages    │ 30/min         │ 1 min  │        │
│  │ POST /api/tasks/*/run │ 10/min         │ 1 min  │        │
│  │ GET /api/auth/token   │ 5/min          │ 1 min  │        │
│  │ POST /api/auth/login  │ 5/min          │ 1 min  │        │
│  │ WebSocket messages    │ 60/min         │ 1 min  │        │
│  └───────────────────────┴────────────────┴────────┘        │
│                                                              │
│  TIER 3: Authenticated User Limits                           │
│  ─────────────────────────────────                          │
│  • Higher limits for authenticated users                     │
│  • Per-user tracking (not just IP)                          │
│  • Allows trusted users more throughput                     │
│                                                              │
│  Response Headers:                                           │
│    X-RateLimit-Limit: 100                                   │
│    X-RateLimit-Remaining: 95                                │
│    X-RateLimit-Reset: 1699900000                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Recommended Implementation

### Configuration Schema

```typescript
interface SecurityConfig {
  // Deployment mode
  mode: 'local' | 'cloud';

  // Network
  bindAddress: string;        // '127.0.0.1' or '0.0.0.0'

  // CORS
  allowedOrigins: string[];   // ['http://localhost:5173']

  // Authentication
  auth: {
    required: boolean;        // false for local, true for cloud
    methods: ('instance' | 'jwt' | 'apikey')[];

    // Instance token settings
    instance?: {
      tokenPath?: string;     // ~/.olliebot/instance-token
    };

    // JWT settings
    jwt?: {
      secret: string;         // JWT_SECRET env var
      expiresIn: string;      // '24h'
      refreshEnabled: boolean;
    };

    // API key settings
    apiKeys?: {
      keys: { key: string; name: string; }[];
    };
  };

  // Session
  session: {
    timeout: number;          // 30 minutes of inactivity
    maxConcurrent: number;    // Max sessions per user
  };

  // Rate limiting
  rateLimit: {
    enabled: boolean;
    global: { requests: number; window: number; };
    endpoints: Record<string, { requests: number; window: number; }>;
  };
}
```

### Default Configurations

**Local Development** (Zero Config):
```typescript
const localConfig: SecurityConfig = {
  mode: 'local',
  bindAddress: '127.0.0.1',
  allowedOrigins: [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
  ],
  auth: {
    required: true,
    methods: ['instance'],
    instance: {
      tokenPath: '~/.olliebot/instance-token',
    },
  },
  session: {
    timeout: 0,  // No timeout for local
    maxConcurrent: 100,
  },
  rateLimit: {
    enabled: false,  // Disabled for local
    global: { requests: 1000, window: 60000 },
    endpoints: {},
  },
};
```

**Cloud Production**:
```typescript
const cloudConfig: SecurityConfig = {
  mode: 'cloud',
  bindAddress: '0.0.0.0',
  allowedOrigins: ['https://your-app.com'],
  auth: {
    required: true,
    methods: ['jwt', 'apikey'],
    jwt: {
      secret: process.env.JWT_SECRET!,
      expiresIn: '24h',
      refreshEnabled: true,
    },
    apiKeys: {
      keys: parseApiKeys(process.env.API_KEYS),
    },
  },
  session: {
    timeout: 30 * 60 * 1000,  // 30 minutes
    maxConcurrent: 5,
  },
  rateLimit: {
    enabled: true,
    global: { requests: 100, window: 60000 },
    endpoints: {
      '/api/messages': { requests: 30, window: 60000 },
      '/api/tasks/*/run': { requests: 10, window: 60000 },
    },
  },
};
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SECURITY ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  EXTERNAL WORLD                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │  Attacker        Legitimate User        Other Apps on Network     │     │
│  │     │                  │                        │                  │     │
│  └─────┼──────────────────┼────────────────────────┼──────────────────┘     │
│        │                  │                        │                        │
│        ▼                  ▼                        ▼                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 1: NETWORK BINDING                                          │    │
│  │  ────────────────────────                                          │    │
│  │  Local Mode: 127.0.0.1 only ──► Blocks external network access     │    │
│  │  Cloud Mode: 0.0.0.0 + firewall ──► Requires Layers 2-5            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│        │                  │                                                  │
│        ▼                  ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 2: CORS & ORIGIN VALIDATION                                 │    │
│  │  ─────────────────────────────────                                 │    │
│  │  ┌─────────────────┐    ┌─────────────────┐                        │    │
│  │  │ evil-site.com   │───►│ BLOCKED (403)   │                        │    │
│  │  └─────────────────┘    └─────────────────┘                        │    │
│  │  ┌─────────────────┐    ┌─────────────────┐                        │    │
│  │  │ localhost:5173  │───►│ ALLOWED         │                        │    │
│  │  └─────────────────┘    └─────────────────┘                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 3: AUTHENTICATION                                           │    │
│  │  ───────────────────────                                           │    │
│  │                                                                     │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │    │
│  │  │ Instance    │  │ JWT         │  │ API Key     │                │    │
│  │  │ Token       │  │ Bearer      │  │ X-API-Key   │                │    │
│  │  │             │  │             │  │             │                │    │
│  │  │ Local mode  │  │ Cloud mode  │  │ Programmatic│                │    │
│  │  │ Auto-gen    │  │ User login  │  │ access      │                │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                │    │
│  │                              │                                      │    │
│  │                    ┌─────────▼─────────┐                           │    │
│  │                    │ Auth Middleware   │                           │    │
│  │                    │ Validates token   │                           │    │
│  │                    │ Attaches user ctx │                           │    │
│  │                    └───────────────────┘                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 4: WEBSOCKET SECURITY                                       │    │
│  │  ───────────────────────────                                       │    │
│  │                                                                     │    │
│  │  Connection Upgrade                                                 │    │
│  │  ┌────────────────────────────────────────────────────────┐       │    │
│  │  │  1. Validate Origin header                             │       │    │
│  │  │  2. Extract token from query/first-message             │       │    │
│  │  │  3. Validate token                                     │       │    │
│  │  │  4. Accept or reject upgrade                           │       │    │
│  │  └────────────────────────────────────────────────────────┘       │    │
│  │                                                                     │    │
│  │  Message Handling                                                   │    │
│  │  ┌────────────────────────────────────────────────────────┐       │    │
│  │  │  • Only authenticated connections can send messages    │       │    │
│  │  │  • Rate limit messages per connection                  │       │    │
│  │  │  • Validate message schema before processing           │       │    │
│  │  └────────────────────────────────────────────────────────┘       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 5: SESSION MANAGEMENT                                       │    │
│  │  ───────────────────────────                                       │    │
│  │                                                                     │    │
│  │  ┌───────────────────────────────────────────────────────────┐    │    │
│  │  │                    SESSION STORE                          │    │    │
│  │  │  ┌─────────────────────────────────────────────────────┐ │    │    │
│  │  │  │ sessionId │ userId │ lastActivity │ ipAddress      │ │    │    │
│  │  │  ├───────────┼────────┼──────────────┼────────────────┤ │    │    │
│  │  │  │ abc-123   │ user1  │ 2 min ago    │ 127.0.0.1      │ │    │    │
│  │  │  │ def-456   │ user1  │ 15 min ago   │ 192.168.1.10   │ │    │    │
│  │  │  └───────────┴────────┴──────────────┴────────────────┘ │    │    │
│  │  │                                                           │    │    │
│  │  │  • Track active sessions                                  │    │    │
│  │  │  • Expire inactive sessions                               │    │    │
│  │  │  • Allow session revocation                               │    │    │
│  │  └───────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 6: RATE LIMITING                                            │    │
│  │  ──────────────────────                                            │    │
│  │                                                                     │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                       │    │
│  │  │ Token Bucket     │  │ Sliding Window   │                       │    │
│  │  │ (per IP)         │  │ (per endpoint)   │                       │    │
│  │  │                  │  │                  │                       │    │
│  │  │ 1000 req/min     │  │ /api/messages:   │                       │    │
│  │  │ global limit     │  │ 30 req/min       │                       │    │
│  │  └──────────────────┘  └──────────────────┘                       │    │
│  │                                                                     │    │
│  │  Exceeded? → 429 Too Many Requests                                 │    │
│  │  Headers:  X-RateLimit-Remaining, X-RateLimit-Reset                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     APPLICATION LAYER                               │    │
│  │  ───────────────────────────────────                               │    │
│  │                                                                     │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │  REST API    │  │  WebSocket   │  │  Agent       │              │    │
│  │  │  Handlers    │  │  Messages    │  │  System      │              │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │    │
│  │                                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Priority

### Phase 1: Critical (Week 1)

| Task | Description | Files to Modify |
|------|-------------|-----------------|
| 1.1 | Change default bind to 127.0.0.1 | `src/server/index.ts` |
| 1.2 | Fix CORS to allowed origins only | `src/server/index.ts` |
| 1.3 | Implement instance token generation | New: `src/server/auth/instance-token.ts` |
| 1.4 | Add auth middleware for REST | New: `src/server/middleware/auth.ts` |
| 1.5 | Add WebSocket authentication | `src/server/index.ts`, `src/channels/web.ts` |

### Phase 2: Important (Week 2)

| Task | Description | Files to Modify |
|------|-------------|-----------------|
| 2.1 | Add rate limiting middleware | New: `src/server/middleware/rate-limit.ts` |
| 2.2 | Implement session store | New: `src/server/auth/session.ts` |
| 2.3 | Add security config system | New: `src/server/config/security.ts` |
| 2.4 | Update web frontend for token auth | `web/src/hooks/useWebSocket.js`, `web/src/App.jsx` |
| 2.5 | Update TUI for token auth | `tui/src/hooks/useWebSocket.ts` |

### Phase 3: Cloud Ready (Week 3-4)

| Task | Description | Files to Modify |
|------|-------------|-----------------|
| 3.1 | Implement JWT authentication | New: `src/server/auth/jwt.ts` |
| 3.2 | Add login/register endpoints | `src/server/index.ts` |
| 3.3 | Implement API key support | New: `src/server/auth/api-key.ts` |
| 3.4 | Add audit logging | New: `src/server/middleware/audit.ts` |
| 3.5 | HTTPS/TLS configuration | `src/server/index.ts`, documentation |

---

## Security Considerations

### What This Architecture Protects Against

| Attack Vector | Protection Layer |
|---------------|-----------------|
| External network attacker | Layer 1 (localhost binding) |
| Cross-origin web attacks | Layer 2 (CORS) |
| Unauthorized access | Layer 3 (Authentication) |
| WebSocket hijacking | Layer 4 (WS Auth) |
| Session stealing | Layer 5 (Session mgmt) |
| Brute force / DoS | Layer 6 (Rate limiting) |

### What This Architecture Does NOT Protect Against

| Attack Vector | Mitigation Required |
|---------------|---------------------|
| Malware on same machine | Out of scope (OS-level security) |
| Compromised browser | Out of scope (browser security) |
| Physical access to machine | Disk encryption, screen lock |
| Supply chain attacks | Dependency auditing, lockfiles |
| HTTPS MitM (no TLS) | Enable HTTPS in production |

### Token Security Best Practices

1. **Generation**: Use `crypto.randomBytes(32)` for tokens
2. **Storage**: Never store in localStorage (XSS vulnerable), use memory or httpOnly cookies
3. **Transmission**: Always over HTTPS in production
4. **Comparison**: Use constant-time comparison (`crypto.timingSafeEqual`)
5. **Rotation**: Generate new instance token on each server restart
6. **Revocation**: Support immediate session termination

---

## Open Questions for Discussion

1. **Single-user vs Multi-user**: Should cloud mode support multiple users with separate data, or is single-user with shared access sufficient?

2. **Token Persistence**: Should instance tokens survive server restarts? (Current recommendation: No, regenerate for security)

3. **OAuth Integration**: Future consideration - allow login via GitHub/Google for cloud deployment?

4. **Audit Log Retention**: How long to keep security audit logs?

5. **Encrypted Database**: Is conversation encryption at rest required for your use case?

---

## Appendix: Quick Reference

### Environment Variables

```bash
# Deployment mode
OLLIEBOT_MODE=local|cloud         # Default: local

# Network
BIND_ADDRESS=127.0.0.1            # Default: 127.0.0.1
PORT=3000                         # Default: 3000

# CORS
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# Authentication (cloud mode)
JWT_SECRET=your-secret-key        # Required for cloud mode
API_KEYS=key1:name1,key2:name2    # Optional API keys

# Session
SESSION_TIMEOUT=1800000           # 30 minutes in ms
MAX_SESSIONS_PER_USER=5

# Rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_GLOBAL=1000            # requests per minute
```

### Auth Header Formats

```
# Instance Token
Authorization: Bearer <instance-token>

# JWT
Authorization: Bearer <jwt-token>

# API Key
X-API-Key: sk-olliebot-<key>
# or
Authorization: ApiKey sk-olliebot-<key>
```

### WebSocket Auth

```javascript
// Query parameter
ws://localhost:3000?token=<token>

// First message
{
  "type": "auth",
  "token": "<token>"
}
```

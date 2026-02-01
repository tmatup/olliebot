# Browser Automation System Design

## Overview

This document outlines the design for enabling OllieBot to control a headless browser to accomplish web-based tasks like signing up for accounts, filling forms, navigating websites, and extracting information.

**Example Use Case**: Go to https://www.moltbook.com/, sign up for an account, and return the username and password.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           OllieBot                                   │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│  │   Supervisor    │───▶│  Browser Agent  │───▶│   ToolRunner    │ │
│  │     Agent       │    │   (Specialist)  │    │                 │ │
│  └─────────────────┘    └─────────────────┘    └────────┬────────┘ │
│                                                          │          │
└──────────────────────────────────────────────────────────┼──────────┘
                                                           │
                                                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Browser Control MCP Server                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │  navigate   │  │   click     │  │    type     │  │ screenshot │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │   scroll    │  │  evaluate   │  │  waitFor    │  │  extract   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Headless Browser Runtime                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Puppeteer / Playwright Driver                   │   │
│  │                         │                                    │   │
│  │                         ▼                                    │   │
│  │  ┌─────────────────────────────────────────────────────┐    │   │
│  │  │           Headless Chrome / Chromium                │    │   │
│  │  │                                                     │    │   │
│  │  │   ┌─────────────┐    ┌──────────────────────────┐  │    │   │
│  │  │   │ CDP Session │───▶│  Chrome DevTools Protocol │  │    │   │
│  │  │   └─────────────┘    └──────────────────────────┘  │    │   │
│  │  └─────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Headless Browser Runtime

**Purpose**: Provides a sandboxed browser environment for web automation.

**Technology Options**:

| Option | Pros | Cons |
|--------|------|------|
| **Puppeteer** | Google-maintained, excellent CDP support, mature | Chrome-only by default |
| **Playwright** | Multi-browser, better async, modern API | Larger footprint |
| **Browserless.io** | Managed service, no infra to manage | External dependency, cost |

**Recommended**: **Playwright** for its modern API and built-in features for automation.

**Configuration**:
```javascript
{
  headless: true,           // No GUI
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ],
  viewport: { width: 1280, height: 720 },
  timeout: 30000,           // 30s default timeout
  userAgent: 'OllieBot/1.0 (Browser Automation)'
}
```

**Lifecycle Management**:
- Browser instance spawned on-demand per task
- Session isolation between tasks
- Automatic cleanup on task completion or timeout
- Resource limits (memory, CPU, network)

---

### 2. Browser Control MCP Server

**Purpose**: Exposes browser control capabilities via Model Context Protocol.

**Why MCP?**
- OllieBot already has MCP client infrastructure (`src/mcp/client.ts`)
- Tools are automatically discovered and registered
- Fits existing tool execution patterns
- Can be used by other agents/systems

**MCP Server Structure**:
```
browser-mcp-server/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── browser/
│   │   ├── manager.ts     # Browser lifecycle management
│   │   ├── session.ts     # Session/tab management
│   │   └── helpers.ts     # Selector helpers, waiting logic
│   ├── tools/
│   │   ├── navigation.ts  # navigate, back, forward, refresh
│   │   ├── interaction.ts # click, type, select, hover
│   │   ├── observation.ts # screenshot, extract, evaluate
│   │   └── waiting.ts     # waitForSelector, waitForNavigation
│   └── resources/
│       └── page-state.ts  # Current URL, title, DOM snapshot
├── package.json
└── tsconfig.json
```

**Registration in OllieBot**:
```env
MCP_SERVERS=[
  {
    "id": "browser",
    "command": "node",
    "args": ["./mcp-servers/browser-mcp-server/dist/index.js"],
    "env": {
      "BROWSER_TIMEOUT": "60000",
      "MAX_SCREENSHOTS_PER_SESSION": "50"
    }
  }
]
```

---

### 3. MCP Tool Definitions

#### Navigation Tools

**`browser__navigate`**
```typescript
{
  name: "browser__navigate",
  description: "Navigate to a URL in the browser",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to navigate to" },
      waitUntil: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle"],
        default: "domcontentloaded"
      }
    },
    required: ["url"]
  }
}
```

**`browser__back`** / **`browser__forward`** / **`browser__refresh`**
```typescript
{
  name: "browser__back",
  description: "Go back to the previous page",
  inputSchema: { type: "object", properties: {} }
}
```

#### Interaction Tools

**`browser__click`**
```typescript
{
  name: "browser__click",
  description: "Click on an element",
  inputSchema: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector or text content to click (e.g., 'button.submit' or 'text=Sign Up')"
      },
      button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
      clickCount: { type: "number", default: 1 }
    },
    required: ["selector"]
  }
}
```

**`browser__type`**
```typescript
{
  name: "browser__type",
  description: "Type text into an input field",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector for the input field" },
      text: { type: "string", description: "Text to type" },
      delay: { type: "number", description: "Delay between keystrokes in ms", default: 50 },
      clear: { type: "boolean", description: "Clear existing text first", default: true }
    },
    required: ["selector", "text"]
  }
}
```

**`browser__select`**
```typescript
{
  name: "browser__select",
  description: "Select an option from a dropdown",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector for the select element" },
      value: { type: "string", description: "Option value or visible text to select" }
    },
    required: ["selector", "value"]
  }
}
```

**`browser__hover`**
```typescript
{
  name: "browser__hover",
  description: "Hover over an element",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string" }
    },
    required: ["selector"]
  }
}
```

**`browser__scroll`**
```typescript
{
  name: "browser__scroll",
  description: "Scroll the page",
  inputSchema: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["up", "down", "left", "right"] },
      amount: { type: "number", description: "Pixels to scroll", default: 500 },
      selector: { type: "string", description: "Optional: scroll within a specific element" }
    },
    required: ["direction"]
  }
}
```

#### Observation Tools

**`browser__screenshot`**
```typescript
{
  name: "browser__screenshot",
  description: "Take a screenshot of the current page",
  inputSchema: {
    type: "object",
    properties: {
      fullPage: { type: "boolean", description: "Capture entire scrollable page", default: false },
      selector: { type: "string", description: "Optional: capture only this element" },
      quality: { type: "number", description: "JPEG quality 0-100", default: 80 }
    }
  }
}
// Returns: { imageBase64: string, mimeType: "image/png" | "image/jpeg" }
```

**`browser__extract`**
```typescript
{
  name: "browser__extract",
  description: "Extract text content or attributes from elements",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector" },
      attribute: { type: "string", description: "Attribute to extract (e.g., 'href', 'value'). Omit for text content" },
      all: { type: "boolean", description: "Extract from all matching elements", default: false }
    },
    required: ["selector"]
  }
}
```

**`browser__evaluate`**
```typescript
{
  name: "browser__evaluate",
  description: "Execute JavaScript in the browser context",
  inputSchema: {
    type: "object",
    properties: {
      script: { type: "string", description: "JavaScript code to execute" }
    },
    required: ["script"]
  }
}
// Returns: { result: any }
```

**`browser__getPageInfo`**
```typescript
{
  name: "browser__getPageInfo",
  description: "Get current page information",
  inputSchema: { type: "object", properties: {} }
}
// Returns: { url: string, title: string, html: string (truncated) }
```

#### Waiting Tools

**`browser__waitForSelector`**
```typescript
{
  name: "browser__waitForSelector",
  description: "Wait for an element to appear on the page",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string" },
      timeout: { type: "number", default: 10000 },
      state: { type: "string", enum: ["attached", "visible", "hidden"], default: "visible" }
    },
    required: ["selector"]
  }
}
```

**`browser__waitForNavigation`**
```typescript
{
  name: "browser__waitForNavigation",
  description: "Wait for navigation to complete",
  inputSchema: {
    type: "object",
    properties: {
      timeout: { type: "number", default: 30000 },
      waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] }
    }
  }
}
```

---

### 4. Browser Agent (Specialist)

**Purpose**: A specialized sub-agent optimized for browser automation tasks.

**Location**: `user/sub-agents/browser.md` or `src/agents/specialists/browser.ts`

**System Prompt Design**:
```markdown
# Browser Automation Agent

You are a browser automation specialist. You control a headless Chrome browser to accomplish web tasks.

## Core Principles

1. **Observe First**: Always take a screenshot after navigation to understand the page layout
2. **Plan Actions**: Think through the sequence of actions before executing
3. **Verify Results**: After each action, verify it succeeded (screenshot or extract)
4. **Handle Errors**: If an action fails, try alternative selectors or approaches
5. **Security**: Never expose credentials in logs; use secure generation for passwords

## Workflow Pattern

For each task:
1. Navigate to the target URL
2. Take screenshot to understand the page
3. Identify interactive elements (forms, buttons, links)
4. Execute actions in sequence (click, type, select)
5. Verify each action's result
6. Extract required information
7. Return structured results

## Selector Strategy (in order of preference)

1. **Text content**: `text=Sign Up`, `text=Submit`
2. **Role + name**: `role=button[name="Login"]`
3. **Test IDs**: `[data-testid="email-input"]`
4. **Semantic HTML**: `input[type="email"]`, `button[type="submit"]`
5. **CSS classes**: `.btn-primary`, `#login-form`
6. **XPath**: Only as last resort

## Error Recovery

- If element not found: scroll, wait, try alternative selector
- If click fails: try JavaScript click via evaluate
- If page doesn't load: increase timeout, check for redirects
- If CAPTCHA detected: report to user, cannot bypass

## Available Tools

- browser__navigate: Go to URL
- browser__click: Click elements
- browser__type: Enter text
- browser__select: Choose dropdown options
- browser__screenshot: See the page
- browser__extract: Get text/attributes
- browser__evaluate: Run JavaScript
- browser__waitForSelector: Wait for elements
- browser__getPageInfo: Get URL, title, HTML
```

---

### 5. Agent Interaction Loop

**Task Execution Flow**:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser Task Execution                        │
└─────────────────────────────────────────────────────────────────┘

User Request: "Sign up for moltbook.com and return credentials"
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. SUPERVISOR DELEGATION                                         │
│    - Detect browser/web task                                     │
│    - Spawn Browser Agent with mission                            │
│    - Pass: target URL, desired outcome, constraints              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. BROWSER AGENT PLANNING                                        │
│    - Understand the goal (sign up, return credentials)           │
│    - Plan initial approach:                                      │
│      a. Navigate to moltbook.com                                 │
│      b. Find signup form/button                                  │
│      c. Fill form with generated credentials                     │
│      d. Submit and verify                                        │
│      e. Return credentials                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. EXECUTION LOOP (Observe → Act → Verify)                       │
│                                                                  │
│    ┌──────────────────────────────────────────────────────────┐ │
│    │ OBSERVE: browser__navigate + browser__screenshot          │ │
│    │ → See homepage, identify "Sign Up" button                 │ │
│    └──────────────────────────────────────────────────────────┘ │
│                          │                                       │
│                          ▼                                       │
│    ┌──────────────────────────────────────────────────────────┐ │
│    │ ACT: browser__click("text=Sign Up")                       │ │
│    │ → Click signup button                                     │ │
│    └──────────────────────────────────────────────────────────┘ │
│                          │                                       │
│                          ▼                                       │
│    ┌──────────────────────────────────────────────────────────┐ │
│    │ VERIFY: browser__screenshot                               │ │
│    │ → Confirm signup form is visible                          │ │
│    └──────────────────────────────────────────────────────────┘ │
│                          │                                       │
│                          ▼                                       │
│    ┌──────────────────────────────────────────────────────────┐ │
│    │ ACT: Generate credentials internally                      │ │
│    │   username: "ollie_user_a1b2c3"                          │ │
│    │   password: "Xk9$mP2#vL5@nQ8"                             │ │
│    └──────────────────────────────────────────────────────────┘ │
│                          │                                       │
│                          ▼                                       │
│    ┌──────────────────────────────────────────────────────────┐ │
│    │ ACT: browser__type("#email", "ollie_user_a1b2c3@...")    │ │
│    │ ACT: browser__type("#password", "[password]")             │ │
│    │ ACT: browser__click("button[type=submit]")                │ │
│    └──────────────────────────────────────────────────────────┘ │
│                          │                                       │
│                          ▼                                       │
│    ┌──────────────────────────────────────────────────────────┐ │
│    │ VERIFY: browser__screenshot + browser__getPageInfo        │ │
│    │ → Confirm successful registration (welcome page, etc.)    │ │
│    └──────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. RESULT AGGREGATION                                            │
│    - Browser Agent returns structured result                     │
│    - Supervisor receives: { success, username, password, notes } │
│    - Supervisor formats response for user                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. CLEANUP                                                       │
│    - Close browser session                                       │
│    - Clear sensitive data from context                           │
│    - Log task completion (without credentials)                   │
└─────────────────────────────────────────────────────────────────┘
```

---

### 6. Integration with Existing OllieBot Components

#### A. Tool Registration

The browser MCP tools will be automatically discovered via MCPClient:

```typescript
// In src/mcp/client.ts - already exists
// Browser tools registered as: mcp__browser__navigate, mcp__browser__click, etc.

// Tool filtering for Browser Agent
const browserTools = allTools.filter(t =>
  t.name.startsWith('mcp__browser__') ||
  t.name === 'native__analyze_image'  // For screenshot analysis
);
```

#### B. Vision Integration

Browser screenshots can leverage existing `AnalyzeImageTool`:

```typescript
// Workflow:
// 1. browser__screenshot returns base64 image
// 2. Pass to AnalyzeImageTool for understanding
// 3. Agent uses description to plan next action

const screenshot = await toolRunner.execute('mcp__browser__screenshot', {});
const analysis = await toolRunner.execute('native__analyze_image', {
  imageData: screenshot.imageBase64,
  prompt: "Describe this webpage. Identify: forms, buttons, links, error messages."
});
```

#### C. Agent Delegation

```typescript
// In supervisor agent's system prompt, add delegation trigger:
{
  "agent": "browser",
  "triggers": [
    "navigate to website",
    "sign up for",
    "fill out form",
    "browser automation",
    "web scraping with interaction"
  ],
  "mission_template": "Use the browser to: {task_description}"
}
```

#### D. Memory Integration

Store browser task results in agent memory:

```typescript
// After successful task
await memoryService.remember({
  type: "browser_task",
  url: "https://moltbook.com",
  action: "signup",
  result: "success",
  timestamp: new Date().toISOString()
  // Never store credentials in memory
});
```

---

### 7. Security Considerations

#### A. Credential Handling

```typescript
// Security requirements:
// 1. Generate passwords securely (crypto.randomBytes)
// 2. Never log credentials
// 3. Return credentials only to requesting user
// 4. Don't store in conversation history
// 5. Clear from context after delivery

function generateSecurePassword(): string {
  const length = 16;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const randomBytes = crypto.randomBytes(length);
  return Array.from(randomBytes)
    .map(b => chars[b % chars.length])
    .join('');
}
```

#### B. Sandboxing

```typescript
// Browser isolation:
{
  // New context per task (isolated cookies, storage)
  context: await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'OllieBot/1.0',
    // No persistent storage
    storageState: undefined,
    // Block unnecessary resources
    blockedResourceTypes: ['media', 'font']
  }),

  // Resource limits
  maxExecutionTime: 5 * 60 * 1000,  // 5 minutes max
  maxScreenshots: 50,
  maxNavigations: 20
}
```

#### C. URL Allowlisting (Optional)

```typescript
// For enterprise deployments:
const ALLOWED_DOMAINS = [
  'moltbook.com',
  'example.com',
  // ... approved domains
];

function validateUrl(url: string): boolean {
  const parsed = new URL(url);
  return ALLOWED_DOMAINS.some(d => parsed.hostname.endsWith(d));
}
```

#### D. Sensitive Data Redaction

```typescript
// Before logging or storing:
function redactSensitive(text: string): string {
  return text
    .replace(/password["\s:=]+["']?[^"'\s]+["']?/gi, 'password=***REDACTED***')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '***EMAIL***');
}
```

---

### 8. Error Handling

```typescript
// Error categories and recovery strategies:

const ERROR_HANDLERS = {
  // Element not found
  'TimeoutError': async (ctx) => {
    // 1. Take screenshot to see current state
    // 2. Try scrolling to find element
    // 3. Try alternative selectors
    // 4. Report to agent for re-planning
  },

  // Navigation failed
  'NavigationError': async (ctx) => {
    // 1. Check if page redirected
    // 2. Wait and retry
    // 3. Check for error pages (404, 500)
  },

  // CAPTCHA detected
  'CaptchaDetected': async (ctx) => {
    // 1. Take screenshot
    // 2. Report to user - cannot bypass
    // 3. Pause task
  },

  // Rate limiting
  'RateLimited': async (ctx) => {
    // 1. Exponential backoff
    // 2. Report delay to user
  }
};
```

---

### 9. Implementation Phases

#### Phase 1: Core Infrastructure
- [ ] Set up Playwright/Puppeteer wrapper
- [ ] Implement browser lifecycle management
- [ ] Create basic MCP server structure
- [ ] Implement core tools: navigate, click, type, screenshot

#### Phase 2: MCP Integration
- [ ] Register MCP server with OllieBot
- [ ] Test tool discovery and execution
- [ ] Implement screenshot → vision pipeline
- [ ] Add waiting and verification tools

#### Phase 3: Browser Agent
- [ ] Create browser specialist agent prompt
- [ ] Implement delegation from supervisor
- [ ] Add observe-act-verify loop
- [ ] Test with simple tasks (navigation, form filling)

#### Phase 4: Advanced Features
- [ ] Multi-tab support
- [ ] File upload/download handling
- [ ] Cookie/session management
- [ ] Proxy support

#### Phase 5: Production Hardening
- [ ] Security review and sandboxing
- [ ] Rate limiting and resource controls
- [ ] Logging and monitoring
- [ ] Error recovery improvements

---

### 10. Example Task Execution Trace

**User**: "Go to https://www.moltbook.com/ and sign up for an account, return username and password"

```
[Supervisor] Detected browser task. Delegating to Browser Agent.

[Browser Agent] Planning task:
  Goal: Sign up for moltbook.com account
  Steps: navigate → find signup → fill form → submit → verify → return credentials

[Tool] browser__navigate({ url: "https://www.moltbook.com" })
  → Success: Page loaded

[Tool] browser__screenshot({ fullPage: false })
  → Success: Screenshot captured

[Vision] Analyzing screenshot...
  → Homepage with "Sign Up" button in top-right corner
  → Also see "Login" link and main content

[Browser Agent] Found signup button. Clicking...

[Tool] browser__click({ selector: "text=Sign Up" })
  → Success: Clicked

[Tool] browser__screenshot({})
  → Success: Screenshot captured

[Vision] Analyzing screenshot...
  → Registration form visible
  → Fields: email, username, password, confirm password
  → "Create Account" submit button

[Browser Agent] Generating credentials...
  → Username: ollie_moltbook_x7k2m
  → Email: ollie_moltbook_x7k2m@tempmail.olliebot.local
  → Password: [generated securely]

[Tool] browser__type({ selector: "#email", text: "ollie_moltbook_x7k2m@..." })
  → Success

[Tool] browser__type({ selector: "#username", text: "ollie_moltbook_x7k2m" })
  → Success

[Tool] browser__type({ selector: "#password", text: "[password]" })
  → Success

[Tool] browser__type({ selector: "#confirm-password", text: "[password]" })
  → Success

[Tool] browser__click({ selector: "text=Create Account" })
  → Success

[Tool] browser__waitForNavigation({ waitUntil: "domcontentloaded" })
  → Success: Navigated to /welcome

[Tool] browser__screenshot({})
  → Success

[Vision] Analyzing screenshot...
  → Welcome page: "Thanks for signing up, ollie_moltbook_x7k2m!"
  → Account created successfully

[Browser Agent] Task complete. Returning results.

[Supervisor] Browser task completed successfully.

─────────────────────────────────────────
Account created on moltbook.com:

**Username**: ollie_moltbook_x7k2m
**Password**: Xk9$mP2#vL5@nQ8w

Please save these credentials securely.
─────────────────────────────────────────
```

---

### 11. Alternative Approaches Considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Direct CDP Integration** | Full control, no abstraction | Complex, low-level | Rejected |
| **Selenium** | Industry standard, wide support | Slower, more setup | Rejected |
| **Puppeteer/Playwright** | Modern, fast, good API | Dependency management | **Selected** |
| **Browserless SaaS** | No infra, managed | External dependency, cost | Future option |
| **Computer Use API** | Anthropic-native | Beta, coordinate-based | Future consideration |

---

### 12. Open Questions

1. **Email Handling**: Should we integrate a temporary email service for signups that require email verification?

2. **CAPTCHA Strategy**: How should we handle CAPTCHAs? Options:
   - Fail gracefully and report to user
   - Integrate CAPTCHA solving service (ethical concerns)
   - Use human-in-the-loop (A2UI) for user to solve

3. **Session Persistence**: Should browser sessions persist across conversations for multi-step tasks?

4. **Parallel Execution**: Support multiple browser instances for parallel tasks?

5. **Mobile Emulation**: Should we support mobile viewport testing/automation?

---

## Summary

This design enables OllieBot to perform browser automation through:

1. **Headless Browser Runtime**: Playwright-based browser with proper sandboxing
2. **Browser MCP Server**: Tool exposure via existing MCP infrastructure
3. **Browser Agent**: Specialized sub-agent with observe-act-verify loop
4. **Vision Integration**: Screenshot analysis using existing AnalyzeImageTool
5. **Security**: Credential handling, sandboxing, and resource limits

The architecture leverages OllieBot's existing multi-agent system, tool infrastructure, and MCP support for seamless integration.

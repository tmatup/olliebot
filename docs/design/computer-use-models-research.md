# Specialized Computer Use Models Research

## Executive Summary

This document analyzes specialized "computer use" models from Anthropic, OpenAI, and Google that are purpose-built for controlling computer interfaces. These models represent a fundamentally different approach from our current design (screenshot + general vision model + Playwright selectors) and offer significant advantages in accuracy, simplicity, and native understanding of UI interactions.

**Key Finding**: Specialized computer use models are **faster**, **more accurate**, and **simpler to implement** than the selector-based approach, though they come with different cost profiles and trade-offs.

---

## Current Design vs. Computer Use Models

### Our Current Approach (Selector-Based)

```
Screenshot → General Vision Model → Text Description → Agent Reasoning → CSS Selector → Playwright Execution
```

**Flow**:
1. Take screenshot with Playwright
2. Send to general vision model (e.g., Claude Sonnet, GPT-4o)
3. Model describes what it sees in text
4. Agent reasons about what selector to use
5. Playwright executes `click("#submit-btn")` or `type("input[name=email]", "...")`

**Problems**:
- **Two-step translation**: Vision → Text → Selector (information loss)
- **Selector fragility**: CSS selectors break when sites update
- **No native coordinate understanding**: Model doesn't "see" where to click
- **Multiple API calls**: Screenshot analysis separate from action decision

### Computer Use Model Approach (Coordinate-Based)

```
Screenshot → Specialized Computer Use Model → Coordinate Action → Direct Execution
```

**Flow**:
1. Take screenshot
2. Send to computer use model with task
3. Model returns `click(x=245, y=867)` or `type("hello@email.com")`
4. Execute directly via mouse/keyboard simulation

**Advantages**:
- **Single-step**: Model sees screen and outputs action directly
- **No selectors**: Works on any UI, including images, Canvas, Flash, etc.
- **Native understanding**: Trained specifically for pixel-to-action mapping
- **Universal**: Same approach works for web, desktop, mobile

---

## Provider Comparison

### 1. Anthropic Claude Computer Use

**Model**: `computer_20250124` (schema-less tool)

**How It Works**:
- Claude is trained to **count pixels** from reference points to target locations
- Takes screenshot as input, outputs coordinate-based actions
- Requires `computer-use-2025-01-24` beta header

**Available Actions**:
```python
# Core actions
"screenshot"           # Capture current screen
"left_click"          # Click at coordinate
"right_click"         # Right-click at coordinate
"double_click"        # Double-click at coordinate
"triple_click"        # Triple-click (select paragraph)
"middle_click"        # Middle mouse button
"type"                # Type text string
"key"                 # Press keyboard key
"mouse_move"          # Move cursor to coordinate

# New in 2025 version
"hold_key"            # Hold key while performing action
"left_mouse_down"     # Press and hold left button
"left_mouse_up"       # Release left button
"scroll"              # Scroll in direction
"wait"                # Wait for specified duration
```

**Recommended Resolution**: XGA (1024x768) for best accuracy

**Pricing**: Same as base Claude model pricing
- Claude Sonnet 4: $3 input / $15 output per 1M tokens
- Claude Opus 4.5: $5 input / $25 output per 1M tokens

**Benchmark Performance**:
| Benchmark | Claude Computer Use | Human |
|-----------|---------------------|-------|
| OSWorld | 22% → 66.3% (Opus 4.5) | 72.4% |
| WebVoyager | 56% | ~95% |

**Strengths**:
- Most mature implementation (since Oct 2024)
- Excellent documentation and reference implementations
- Works for full desktop OS control, not just browsers
- Agent Skills integration for Office documents

**Limitations**:
- Still "slow and error-prone" per Anthropic
- "Flipbook" view misses transient UI states
- Cannot drag, zoom, or perform complex gestures yet

---

### 2. OpenAI Computer-Using Agent (CUA)

**Model**: `computer-use-preview` (Responses API only)

**How It Works**:
- Built on GPT-4o's vision capabilities with specialized training
- Processes raw pixel data to understand screen state
- Returns `computer_call` actions that you execute

**The CUA Loop**:
```
Screenshot → CUA Analysis → computer_call(action) → Execute → Return screenshot → Repeat
```

**Available Actions**:
```python
click(x, y)           # Click at coordinates
type(text)            # Type text string
scroll(direction)     # Scroll page
# Additional actions available but less documented
```

**Key Technical Details**:
- Requires `truncation: "auto"` parameter
- Returns `reasoning` items that must be included in subsequent requests
- Model never executes actions itself - you implement the execution layer

**Pricing**: $3 input / $12 output per 1M tokens (research preview)

**Benchmark Performance**:
| Benchmark | OpenAI CUA | Human |
|-----------|------------|-------|
| OSWorld | 38.1% | 72.4% |
| WebVoyager | 87% | ~95% |
| WebArena | 58.1% | - |

**Strengths**:
- Highest WebVoyager score (87%) - excellent for web tasks
- State-of-the-art on multi-step web workflows
- Now integrated into ChatGPT as "agent mode"

**Limitations**:
- Research preview - may have exploits
- Only available via Responses API (not Chat Completions)
- Limited to tiers 3-5 developers
- Discouraged for authenticated/high-stakes environments

---

### 3. Google Gemini 2.5 Computer Use

**Model**: `gemini-2.5-computer-use-preview-10-2025`

**How It Works**:
- Uses standardized 1000x1000 grid coordinate system
- Automatically scales to actual screen resolution
- Optimized for web browsers (also works for mobile)

**Available Actions**:
```python
open_web_browser      # Open browser to URL
navigate              # Navigate to URL
click_at(x, y)        # Click at normalized coordinates
type_text_at(text)    # Type text
scroll_document       # Scroll page
# Extensible - add custom actions
```

**API Configuration**:
```python
tools=[
    types.Tool(
        computer_use=types.ComputerUse(
            environment=types.Environment.ENVIRONMENT_BROWSER,
        )
    )
],
```

**Recommended Resolution**: 1440x900 for best results

**Pricing**: Uses Gemini 2.5 Pro SKU (~$1.25 input / $10 output per 1M tokens)

**Benchmark Performance**:
| Metric | Gemini 2.5 CU |
|--------|---------------|
| Accuracy | >70% |
| Latency | ~225ms per action |
| WebVoyager-like | 83.5% (Project Mariner) |

**Strengths**:
- **Cheapest option** (~60% less than Claude/OpenAI)
- **Fastest latency** (225ms vs seconds for others)
- One-click Cloud Run deployment from AI Studio
- Normalized coordinate system simplifies implementation
- Can exclude specific actions via `excluded_predefined_functions`

**Limitations**:
- Primarily optimized for browsers, not full desktop
- Newer, less battle-tested
- Project Mariner (consumer product) separate from API

---

## Detailed Comparison

### Performance Benchmarks

| Benchmark | Claude CU | OpenAI CUA | Gemini CU | Human |
|-----------|-----------|------------|-----------|-------|
| **OSWorld** (Desktop) | 66.3% (Opus 4.5) | 38.1% | N/A | 72.4% |
| **WebVoyager** (Web) | 56% | **87%** | 83.5% | ~95% |
| **WebArena** (Web) | - | 58.1% | - | - |
| **Latency** | ~1-3s | ~1-2s | **~225ms** | - |

### Pricing Comparison (per 1M tokens)

| Provider | Model | Input | Output | Notes |
|----------|-------|-------|--------|-------|
| **Google** | Gemini 2.5 CU | $1.25 | $10 | Cheapest |
| **OpenAI** | CUA Preview | $3 | $12 | Research preview |
| **Anthropic** | Claude Sonnet 4 | $3 | $15 | Most mature |
| **Anthropic** | Claude Opus 4.5 | $5 | $25 | Best OSWorld score |

**Cost Example** (10-step web task, ~5K tokens per step):
- Gemini: ~$0.56
- OpenAI CUA: ~$0.75
- Claude Sonnet: ~$0.90
- Claude Opus: ~$1.50

### Feature Matrix

| Feature | Claude CU | OpenAI CUA | Gemini CU | Our Playwright Design |
|---------|-----------|------------|-----------|----------------------|
| Desktop OS Control | ✅ | ✅ | ❌ | ❌ |
| Web Browser Control | ✅ | ✅ | ✅ | ✅ |
| Mobile UI | ⚠️ Limited | ⚠️ Limited | ✅ | ❌ |
| Coordinate-based | ✅ | ✅ | ✅ | ❌ (Selectors) |
| No DOM Required | ✅ | ✅ | ✅ | ❌ |
| Works on Canvas/Images | ✅ | ✅ | ✅ | ❌ |
| Native MCP Support | ❌ | ❌ | ❌ | ✅ |
| Selector Stability | N/A | N/A | N/A | ❌ Fragile |
| Multi-tab Support | ⚠️ Manual | ⚠️ Manual | ⚠️ Manual | ✅ Native |
| File Upload/Download | ⚠️ Complex | ⚠️ Complex | ⚠️ Complex | ✅ Native |

---

## How Computer Use Models Improve Our Design

### 1. Eliminates Selector Fragility

**Current Problem**:
```typescript
// This breaks when the site updates their CSS classes
await page.click('button.btn-primary.signup-cta');
// Or when they change the DOM structure
await page.click('#root > div > main > form > button');
```

**Computer Use Solution**:
```typescript
// Model sees "Sign Up" button and clicks it regardless of implementation
const action = await computerUseModel.getAction(screenshot, "Click the Sign Up button");
// Returns: { action: "click", x: 850, y: 120 }
await page.mouse.click(850, 120);
```

### 2. Simplifies Architecture

**Current Design** (Complex):
```
OllieBot → MCP Server → Playwright → Browser
                ↓
          Vision Model (separate call)
                ↓
          Text parsing → Selector extraction
```

**Computer Use Design** (Simpler):
```
OllieBot → Computer Use Model → Raw coordinates → Browser
```

### 3. Unified Visual Understanding

**Current**: Two separate models
- General LLM for reasoning
- Vision model for screenshot analysis
- Manual coordination between them

**Computer Use**: Single model
- Sees screenshot
- Reasons about task
- Outputs action
- All in one API call

### 4. Works on Non-DOM Interfaces

Computer use models can interact with:
- Canvas-based applications (Figma, Google Docs)
- Image-heavy UIs (social media feeds)
- Desktop applications (not just web)
- Mobile app emulators
- Legacy systems (Flash, Java applets)

Our Playwright approach is limited to DOM-based web pages.

---

## Recommended Hybrid Architecture

Given the trade-offs, here's an optimized design that combines the best of both approaches:

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           OllieBot                                   │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│  │   Supervisor    │───▶│  Browser Agent  │───▶│   ToolRunner    │ │
│  └─────────────────┘    └─────────────────┘    └────────┬────────┘ │
└──────────────────────────────────────────────────────────┼──────────┘
                                                           │
           ┌───────────────────────────────────────────────┼────────┐
           │                                               │        │
           ▼                                               ▼        ▼
┌─────────────────────┐                    ┌─────────────────────────┐
│  Computer Use API   │                    │   Playwright (Fallback) │
│  ┌───────────────┐  │                    │   ┌──────────────────┐  │
│  │ Claude CU     │  │                    │   │ DOM selectors    │  │
│  │ OpenAI CUA    │  │  ←── Primary ──→   │   │ for known sites  │  │
│  │ Gemini CU     │  │                    │   │ File operations  │  │
│  └───────────────┘  │                    │   │ Multi-tab        │  │
└─────────────────────┘                    └─────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Browser Environment                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │           Headless Chrome (shared by both approaches)        │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Tool Design

```typescript
// Primary: Computer Use tool
{
  name: "browser__computer_use",
  description: "Use computer use model to interact with browser visually",
  inputSchema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "What action to take (e.g., 'Click the blue Sign Up button')"
      },
      provider: {
        type: "string",
        enum: ["anthropic", "openai", "google"],
        default: "google"  // Cheapest + fastest
      }
    },
    required: ["instruction"]
  }
}

// Fallback: Selector-based for specific operations
{
  name: "browser__selector_action",
  description: "Use Playwright selectors for precise DOM operations",
  inputSchema: {
    type: "object",
    properties: {
      action: { enum: ["click", "type", "select", "upload", "download"] },
      selector: { type: "string" },
      value: { type: "string" }
    }
  }
}
```

### When to Use Each Approach

| Scenario | Recommended Approach | Reason |
|----------|---------------------|--------|
| Unknown websites | Computer Use | No selectors needed |
| Form filling | Computer Use | Visual identification |
| File upload/download | Playwright | Native API support |
| Multi-tab operations | Playwright | Better tab management |
| High-volume automation | Playwright | More deterministic |
| Canvas/non-DOM UIs | Computer Use | Only option |
| Known internal tools | Playwright | Stable selectors |

---

## Provider Selection Strategy

### Recommendation by Use Case

| Use Case | Best Provider | Reason |
|----------|--------------|--------|
| **General web tasks** | OpenAI CUA | 87% WebVoyager, best web accuracy |
| **Cost-sensitive** | Gemini 2.5 CU | 60% cheaper than alternatives |
| **Low latency needed** | Gemini 2.5 CU | 225ms vs 1-3s |
| **Desktop automation** | Claude Opus 4.5 | Only provider with strong desktop (66% OSWorld) |
| **Complex reasoning** | Claude | Best overall reasoning |
| **Production stability** | Claude | Most mature, best docs |

### Multi-Provider Strategy

```typescript
const PROVIDER_STRATEGY = {
  // Fast, cheap tasks → Gemini
  quick_web_tasks: {
    provider: 'google',
    model: 'gemini-2.5-computer-use-preview-10-2025',
    maxSteps: 5
  },

  // Complex web navigation → OpenAI
  complex_web_flows: {
    provider: 'openai',
    model: 'computer-use-preview',
    maxSteps: 20
  },

  // Desktop or mission-critical → Claude
  desktop_or_critical: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    computerUseTool: 'computer_20250124'
  }
};
```

---

## Implementation Considerations

### 1. Environment Setup

All computer use models need:
- Screenshot capture capability
- Mouse/keyboard input simulation
- Sandboxed execution environment

```typescript
// Shared browser setup for computer use
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox']
});

const context = await browser.newContext({
  viewport: { width: 1024, height: 768 },  // Anthropic recommended
  // OR
  viewport: { width: 1440, height: 900 },  // Google recommended
});

const page = await context.newPage();

// Screenshot function for computer use loop
async function captureForComputerUse(): Promise<string> {
  const buffer = await page.screenshot({ type: 'png' });
  return buffer.toString('base64');
}

// Action executor
async function executeAction(action: ComputerAction) {
  switch (action.type) {
    case 'click':
      await page.mouse.click(action.x, action.y);
      break;
    case 'type':
      await page.keyboard.type(action.text);
      break;
    case 'scroll':
      await page.mouse.wheel(0, action.deltaY);
      break;
  }
}
```

### 2. The Computer Use Loop

```typescript
async function computerUseLoop(task: string, maxSteps = 10) {
  let completed = false;
  let step = 0;

  while (!completed && step < maxSteps) {
    // 1. Capture current state
    const screenshot = await captureForComputerUse();

    // 2. Get action from computer use model
    const response = await getComputerUseAction({
      screenshot,
      task,
      history: actionHistory
    });

    // 3. Check if task is complete
    if (response.status === 'complete') {
      completed = true;
      break;
    }

    // 4. Execute the action
    await executeAction(response.action);

    // 5. Wait for UI to settle
    await page.waitForTimeout(500);

    step++;
  }

  return { completed, steps: step };
}
```

### 3. Error Handling

```typescript
const COMPUTER_USE_ERRORS = {
  // Model couldn't find target element
  'element_not_found': async (ctx) => {
    // Try scrolling to reveal element
    await ctx.page.mouse.wheel(0, 300);
    return 'retry';
  },

  // Click missed the target
  'action_failed': async (ctx) => {
    // Take new screenshot and retry
    return 'retry';
  },

  // Model is stuck in a loop
  'repetitive_actions': async (ctx) => {
    // Inject human feedback or abort
    return 'escalate';
  },

  // Unexpected page state
  'unexpected_state': async (ctx) => {
    // Let model reassess
    return 'reassess';
  }
};
```

---

## Upsides Summary

### Faster

| Metric | Our Current Design | Computer Use Models |
|--------|-------------------|---------------------|
| API calls per action | 2 (vision + reasoning) | 1 (unified) |
| Latency per step | 2-5 seconds | 225ms-3s |
| Time to complete 10-step task | 30-60 seconds | 5-30 seconds |

**Winner**: Gemini 2.5 Computer Use (225ms latency)

### Cheaper

| Approach | Cost per 10-step task |
|----------|----------------------|
| Our Design (Claude Sonnet vision + reasoning) | ~$1.20 |
| Claude Computer Use | ~$0.90 |
| OpenAI CUA | ~$0.75 |
| **Gemini Computer Use** | **~$0.56** |

**Winner**: Gemini 2.5 Computer Use (53% cheaper than our design)

### More Accurate

| Benchmark | Our Design (estimated) | Best Computer Use |
|-----------|----------------------|-------------------|
| Simple web forms | ~60% | 87% (OpenAI CUA) |
| Complex web flows | ~40% | 87% (OpenAI CUA) |
| Desktop automation | N/A | 66% (Claude Opus) |

**Winner**: OpenAI CUA for web, Claude Opus for desktop

### Additional Benefits

1. **No selector maintenance**: Sites can update their CSS without breaking automation
2. **Universal UI support**: Works on Canvas, images, non-DOM interfaces
3. **Simpler codebase**: Less translation logic between vision and action
4. **Better error recovery**: Model can visually verify action results
5. **Desktop expansion**: Same approach extends to full OS automation

---

## Trade-offs and Limitations

### Current Limitations of Computer Use Models

1. **Still in beta/preview**: May have exploits, not recommended for authenticated environments
2. **Coordinate precision**: Can miss small UI elements at high resolutions
3. **No native file operations**: Upload/download requires additional handling
4. **Multi-tab complexity**: No built-in tab awareness
5. **Stateless**: Each call is independent, history management is your responsibility
6. **Rate limits**: Preview APIs may have restrictive limits

### When to Stick with Playwright Selectors

- High-volume, repetitive automation on known sites
- File upload/download operations
- Complex multi-tab workflows
- Deterministic test automation
- Sites with stable, semantic selectors (data-testid)

---

## Updated Implementation Phases

### Phase 1: Computer Use Integration (New)
- [ ] Add Gemini 2.5 Computer Use client (cheapest, fastest)
- [ ] Implement screenshot → action → execute loop
- [ ] Create `browser__computer_use` tool
- [ ] Test on simple web tasks

### Phase 2: Multi-Provider Support
- [ ] Add OpenAI CUA client (best web accuracy)
- [ ] Add Claude Computer Use client (best desktop)
- [ ] Implement provider selection logic
- [ ] Add fallback chain

### Phase 3: Hybrid Architecture
- [ ] Keep Playwright for specific operations (file, tabs)
- [ ] Router to choose best approach per task
- [ ] Unified error handling
- [ ] Cost optimization logic

### Phase 4: Production Hardening
- [ ] Sandboxing and security review
- [ ] Rate limiting and retries
- [ ] Monitoring and observability
- [ ] Performance optimization

---

## Conclusion

Specialized computer use models represent a significant improvement over our current screenshot + vision + selector approach:

| Dimension | Improvement |
|-----------|-------------|
| **Speed** | 2-10x faster (especially Gemini) |
| **Cost** | 30-50% cheaper |
| **Accuracy** | 40-80% → 70-87% success rate |
| **Maintenance** | No selector updates needed |
| **Scope** | Extends to desktop, mobile, Canvas UIs |

**Recommendation**: Adopt a **hybrid architecture** that uses computer use models as the primary approach (Gemini for speed/cost, OpenAI for accuracy), with Playwright as fallback for specific operations (file handling, multi-tab, known stable sites).

---

## Sources

- [Anthropic Computer Use Documentation](https://docs.anthropic.com/en/docs/build-with-claude/computer-use)
- [OpenAI Computer-Using Agent](https://openai.com/index/computer-using-agent/)
- [OpenAI Computer Use API Docs](https://platform.openai.com/docs/guides/tools-computer-use)
- [Google Gemini Computer Use Model](https://blog.google/technology/google-deepmind/gemini-computer-use-model/)
- [Gemini API Computer Use](https://ai.google.dev/gemini-api/docs/computer-use)
- [OSWorld Benchmark](https://os-world.github.io/)
- [Browser Use vs Computer Use vs Operator Comparison](https://www.helicone.ai/blog/browser-use-vs-computer-use-vs-operator)
- [LLM API Pricing Comparison 2025](https://intuitionlabs.ai/articles/llm-api-pricing-comparison-2025)

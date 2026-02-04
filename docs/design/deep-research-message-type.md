# Deep Research Message Type - Design Proposal

## Executive Summary

This document proposes a design for implementing a **Deep Research** message type in OllieBot, enabling multi-step, autonomous research capabilities similar to those offered by ChatGPT, Claude, and Gemini.

## Key Design Decisions

### 1. Activation via # Tag Menu
- Deep Research is activated by typing `#` and selecting "🔬 Deep Research" from the menu
- Consistent with existing `#Think` and `#Think+` reasoning mode selection
- Displays a chip showing the selected mode before sending

### 2. Agent Delegation Architecture
- **Configurable delegation**: Agents can optionally delegate to other agents (not default)
- **Deep Research Lead Agent**: Has delegation capability to invoke:
  - `research-worker` - For parallel subtopic exploration
  - `research-reviewer` - For quality review cycles
- **Workflow-restricted agents**: Worker and Reviewer agents can ONLY be invoked within the Deep Research workflow
  - Cannot be invoked by Supervisor directly
  - Prevents accidental invocation outside proper research flow

### 3. Dedicated Model Configuration
- `DEEP_RESEARCH_PROVIDER` - Provider for deep research (can differ from main chat)
- `DEEP_RESEARCH_MODEL` - Model for lead agent (recommend capable model)

### 4. Visible & Tunable Behavior Constants
All research parameters centralized in `src/deep-research/constants.ts`:
- `SUBTOPIC_COUNT` - How many sub-topics to break main topic into (default: 6)
- `SOURCES_PER_SUBTOPIC` - Data sources to gather per sub-topic (default: 20)
- `REVIEW_CYCLES` - Number of draft→review→revise cycles (default: 2)
- Plus min/max bounds, timeouts, and quality thresholds

## Industry Research

### How Major AI Providers Implement Deep Research

#### OpenAI ChatGPT Deep Research
- **Model**: Powered by o3 (optimized for web browsing) + o3-mini for summarization
- **Process**: User selects "deep research" in composer → sidebar shows research steps → 5-30 minutes to complete
- **Key Features**:
  - Proactive, iterative, multi-pass browsing (vs single-pass reactive)
  - Every claim is cited with sources
  - Can attach files/spreadsheets for context
  - Background execution with notifications
- **Benchmark**: 26.6% on "Humanity's Last Exam"
- **Source**: [OpenAI Deep Research](https://openai.com/index/introducing-deep-research/)

#### Anthropic Claude Research
- **Architecture**: Lead agent + parallel sub-agents (multi-agent system)
- **Process**: Lead agent analyzes query → spawns subagents for parallel exploration → subagents act as intelligent filters → lead compiles final answer
- **Key Findings**:
  - Multi-agent with Opus lead + Sonnet subagents outperformed single-agent Opus by **90.2%**
  - Critical: durable execution with checkpointing for long-running tasks
  - Model-based error handling (let agent know when tools fail, let it adapt)
- **Source**: [Anthropic Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system)

#### Google Gemini Deep Research
- **Model**: Gemini 3 Pro, optimized for research
- **Process**: Prompt → multi-point research plan → autonomous search/browse loop → reasoning over findings → multi-page report
- **Stats**: ~80 queries, ~250k input tokens for standard tasks; up to 160 queries, 900k tokens for complex
- **Benchmarks**: 46.4% on HLE, 66.1% on DeepSearchQA
- **Source**: [Gemini Deep Research Agent](https://ai.google.dev/gemini-api/docs/deep-research)

### Common Patterns Across Providers

1. **User-Initiated**: Explicit trigger (button/tag) - not automatic
2. **Optional Clarification**: May ask clarifying questions before starting
3. **Templated Research Process**:
   - Form multi-step research plan based on topic
   - Gather online sources, index, read for grounding
   - Draft response based on research plan
   - Internal drafting-reviewer debate cycle (sub-agent challenges assumptions)
   - Present final cited report
4. **Async Execution**: 5-30 minutes, background processing with progress updates
5. **Citations**: Every claim backed by sources

---

## Open Source Implementations & Libraries

### 1. LangChain Open Deep Research
- **Repo**: [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research)
- **Architecture**: LangGraph-based supervisor + sub-agents with isolated context windows
- **Features**:
  - 4 configurable LLM slots (summarization, research, compression, final report)
  - Tavily search (default), native Anthropic/OpenAI web search, MCP compatibility
  - Parallel sub-topic research
- **Score**: 0.4344 on Deep Research Bench (ranked #6)
- **Recommendation**: **High value** - reference architecture for our implementation

### 2. GPT-Researcher
- **Repo**: [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher)
- **Architecture**: STORM paper-inspired multi-agent (Chief Editor, Researcher, Reviewer, Writer, Publisher)
- **Features**:
  - Tree-like exploration with configurable depth/breadth
  - 2000+ word reports from 20+ sources
  - PDF/Word/Markdown export
- **Recommendation**: **Reference for agent roles** and report structure

### 3. Claude MCP Deep Research Servers
Several MCP servers available:
- [mcherukara/Claude-Deep-Research](https://github.com/mcherukara/Claude-Deep-Research) - Web + academic search, content extraction, structured output
- [qpd-v/mcp-DEEPwebresearch](https://github.com/qpd-v/mcp-DEEPwebresearch) - Enhanced deep web research
- [Hajime-Y/deep-research-mcp](https://mcpservers.org/servers/Hajime-Y/deep-research-mcp) - HuggingFace smolagents-based

**Recommendation**: Consider integrating as MCP tools for search capability

---

## Proposed Architecture

### Design Principles

1. **Leverage Existing Patterns**: Build on OllieBot's existing delegation/specialist agent system
2. **Real-time Progress**: Stream research steps to UI (like tool events)
3. **Persistence**: Store research state for resume/replay
4. **Multi-Agent**: Lead researcher + specialized sub-agents for parallel exploration
5. **Quality Over Speed**: Emphasis on depth and accuracy with citations

### Message Type Definition

```typescript
// New event types for deep research
interface DeepResearchEvent {
  type: 'deep_research';
  subtype:
    | 'initiated'      // Research started
    | 'plan_created'   // Research plan generated
    | 'step_started'   // Research step beginning
    | 'step_completed' // Research step finished
    | 'source_found'   // New source discovered
    | 'draft_started'  // Report drafting began
    | 'review_cycle'   // Internal review iteration
    | 'completed'      // Final report ready
    | 'error';         // Research failed
}

// Message metadata for deep research
interface DeepResearchMetadata {
  type: 'deep_research';
  researchId: string;
  query: string;
  status: 'planning' | 'researching' | 'drafting' | 'reviewing' | 'completed' | 'error';

  // Research plan
  plan?: {
    objectives: string[];
    subtopics: Array<{
      id: string;
      topic: string;
      questions: string[];
      assignedAgent?: string;
      status: 'pending' | 'in_progress' | 'completed';
    }>;
  };

  // Sources collected
  sources?: Array<{
    id: string;
    url: string;
    title: string;
    snippet: string;
    relevance: number;
    citedIn?: string[]; // Which sections cite this
  }>;

  // Research steps/progress
  steps?: Array<{
    id: string;
    stage: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'error';
    startedAt?: string;
    completedAt?: string;
    output?: string;
  }>;

  // Review cycles
  reviewCycles?: Array<{
    iteration: number;
    feedback: string;
    changes: string[];
    timestamp: string;
  }>;

  // Timing
  startedAt: string;
  completedAt?: string;
  estimatedDuration?: number; // ms
}
```

### Research Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INPUT                               │
│  User types # → selects "🔬 Deep Research" from menu            │
│  Message: "Compare React vs Vue for enterprise apps"            │
│  Chip shows: [🔬 Deep Research]                                  │
│                                                                  │
│  Sent with: { messageType: 'deep_research', content: '...' }    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 1: CLARIFICATION (Optional)            │
│  Lead Agent may ask clarifying questions:                       │
│  - "What scale of enterprise? (100 vs 10000 developers)"        │
│  - "Any specific concerns? (performance, learning curve, etc)"  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 2: PLANNING                            │
│  Lead Agent creates research plan:                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Research Plan:                                           │   │
│  │ 1. Framework architecture & design philosophy            │   │
│  │ 2. Enterprise adoption & case studies                    │   │
│  │ 3. Performance benchmarks                                │   │
│  │ 4. Developer experience & learning curve                 │   │
│  │ 5. Ecosystem & tooling maturity                          │   │
│  │ 6. Long-term maintainability                             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 3: PARALLEL RESEARCH                   │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │SubAgent 1│  │SubAgent 2│  │SubAgent 3│  │SubAgent 4│       │
│  │Framework │  │Enterprise│  │Performanc│  │DX & Learn│       │
│  │Design    │  │Adoption  │  │Benchmarks│  │ing Curve │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │             │             │             │              │
│       │    [Web Search + Content Extraction]    │              │
│       │             │             │             │              │
│       ▼             ▼             ▼             ▼              │
│  ┌──────────────────────────────────────────────────────┐     │
│  │              Source Collection & Indexing             │     │
│  │  - 20-50+ sources per subtopic                       │     │
│  │  - Relevance scoring                                  │     │
│  │  - Content summarization                              │     │
│  └──────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 4: SYNTHESIS & DRAFTING                │
│                                                                  │
│  Lead Agent compiles findings into structured report:           │
│  - Executive summary                                            │
│  - Section-by-section analysis                                  │
│  - Comparative tables                                           │
│  - Recommendations                                              │
│  - Full citations                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 5: REVIEW & REFINEMENT                 │
│                                                                  │
│  ┌─────────────┐         ┌─────────────┐                       │
│  │   Reviewer  │◄───────►│    Draft    │                       │
│  │   Agent     │         │   Report    │                       │
│  └─────────────┘         └─────────────┘                       │
│                                                                  │
│  Reviewer challenges:                                           │
│  - "Source [3] is from 2022, is there newer data?"             │
│  - "Performance claim needs benchmark citation"                 │
│  - "Missing Vue 3 composition API comparison"                   │
│                                                                  │
│  → Iterate 1-3 times until quality threshold met               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 6: FINAL REPORT                        │
│                                                                  │
│  📊 React vs Vue for Enterprise Applications                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                     │
│  [Full report with citations, tables, recommendations]          │
│                                                                  │
│  Sources: [1] [2] [3] ... [47]                                 │
│  Research Duration: 8m 23s                                      │
│  Sources Analyzed: 47                                           │
└─────────────────────────────────────────────────────────────────┘
```

### Agent Delegation Architecture

Deep Research requires a hierarchical agent system where the Lead Agent can delegate to specialized Worker and Reviewer agents. This introduces a new pattern: **configurable agent delegation**.

#### Delegation Capability Model

```typescript
/**
 * Agent delegation configuration.
 * Controls which agents can invoke which other agents.
 */
interface AgentDelegationConfig {
  /**
   * Whether this agent can delegate to other agents.
   * Default: false (agents cannot delegate by default)
   */
  canDelegate: boolean;

  /**
   * List of agent IDs this agent is allowed to invoke.
   * Only checked if canDelegate is true.
   * Empty array = can delegate to any agent (not recommended).
   */
  allowedDelegates: string[];

  /**
   * Workflow scope restriction.
   * If set, this agent can ONLY be invoked within the specified workflow.
   * null = can be invoked from anywhere (supervisor, other agents).
   */
  restrictedToWorkflow: string | null;

  /**
   * Whether supervisor can directly invoke this agent.
   * Default: true
   * Set to false for agents that should only be used as sub-agents.
   */
  supervisorCanInvoke: boolean;
}
```

#### Agent Hierarchy for Deep Research

```
┌─────────────────────────────────────────────────────────────────┐
│                         SUPERVISOR                               │
│  (Main orchestrator - handles normal chat)                      │
│                                                                  │
│  canDelegate: true                                               │
│  allowedDelegates: ['specialist-*', 'deep-research-lead']       │
│  restrictedToWorkflow: null                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Can invoke for #Deep Research messages
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DEEP RESEARCH LEAD AGENT                       │
│  (Orchestrates research workflow)                                │
│                                                                  │
│  canDelegate: true                    ◄── Key: can delegate     │
│  allowedDelegates: [                                             │
│    'research-worker',                                            │
│    'research-reviewer'                                           │
│  ]                                                               │
│  restrictedToWorkflow: null           ◄── Can be invoked by     │
│  supervisorCanInvoke: true               supervisor             │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          │                                       │
          ▼                                       ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│   RESEARCH WORKER       │         │   RESEARCH REVIEWER     │
│                         │         │                         │
│ canDelegate: false      │         │ canDelegate: false      │
│ allowedDelegates: []    │         │ allowedDelegates: []    │
│ restrictedToWorkflow:   │         │ restrictedToWorkflow:   │
│   'deep-research'  ◄────┼─────────┼── RESTRICTED: Only      │
│ supervisorCanInvoke:    │         │   invocable within      │
│   false            ◄────┼─────────┼── deep-research workflow│
└─────────────────────────┘         └─────────────────────────┘
```

#### Why Restrict Certain Agents?

**Research Worker** and **Research Reviewer** are specialized for the Deep Research workflow:

1. **Context Requirements**: They expect specific input format (subtopics, sources, drafts) that only the Lead Agent provides
2. **Cost Control**: Prevents accidental invocation that could run up API costs
3. **Security**: Restricts tool access - workers have web search, reviewers don't
4. **Quality**: Ensures the proper orchestration flow is followed

#### Implementation in Agent Definitions

**File: `src/agents/agent-registry.ts`**

```typescript
const AGENT_REGISTRY: Record<string, AgentDefinition> = {
  // Normal specialist agents (can be invoked by supervisor)
  'specialist-code': {
    id: 'specialist-code',
    promptFile: 'specialist-code.md',
    delegation: {
      canDelegate: false,
      allowedDelegates: [],
      restrictedToWorkflow: null,
      supervisorCanInvoke: true,
    },
  },

  // Deep Research Lead (can delegate, invocable by supervisor)
  'deep-research-lead': {
    id: 'deep-research-lead',
    promptFile: 'deep-researcher.md',
    delegation: {
      canDelegate: true,                              // ◄ Can delegate
      allowedDelegates: ['research-worker', 'research-reviewer'],
      restrictedToWorkflow: null,
      supervisorCanInvoke: true,
    },
  },

  // Research Worker (RESTRICTED - only within deep-research)
  'research-worker': {
    id: 'research-worker',
    promptFile: 'research-worker.md',
    delegation: {
      canDelegate: false,
      allowedDelegates: [],
      restrictedToWorkflow: 'deep-research',          // ◄ Restricted
      supervisorCanInvoke: false,                     // ◄ Supervisor blocked
    },
  },

  // Research Reviewer (RESTRICTED - only within deep-research)
  'research-reviewer': {
    id: 'research-reviewer',
    promptFile: 'research-reviewer.md',
    delegation: {
      canDelegate: false,
      allowedDelegates: [],
      restrictedToWorkflow: 'deep-research',          // ◄ Restricted
      supervisorCanInvoke: false,                     // ◄ Supervisor blocked
    },
  },
};
```

#### Delegation Enforcement

**File: `src/agents/delegation-guard.ts`**

```typescript
/**
 * Check if an agent can delegate to another agent.
 * @throws Error if delegation is not allowed
 */
export function canDelegate(
  sourceAgentId: string,
  targetAgentId: string,
  currentWorkflow: string | null
): boolean {
  const sourceAgent = AGENT_REGISTRY[sourceAgentId];
  const targetAgent = AGENT_REGISTRY[targetAgentId];

  if (!sourceAgent || !targetAgent) {
    throw new Error(`Unknown agent: ${sourceAgentId} or ${targetAgentId}`);
  }

  // Check if source can delegate at all
  if (!sourceAgent.delegation.canDelegate) {
    throw new Error(`Agent ${sourceAgentId} cannot delegate to other agents`);
  }

  // Check if source is allowed to delegate to target
  if (
    sourceAgent.delegation.allowedDelegates.length > 0 &&
    !sourceAgent.delegation.allowedDelegates.includes(targetAgentId)
  ) {
    throw new Error(
      `Agent ${sourceAgentId} is not allowed to delegate to ${targetAgentId}`
    );
  }

  // Check if target has workflow restrictions
  if (targetAgent.delegation.restrictedToWorkflow) {
    if (currentWorkflow !== targetAgent.delegation.restrictedToWorkflow) {
      throw new Error(
        `Agent ${targetAgentId} can only be invoked within ` +
        `'${targetAgent.delegation.restrictedToWorkflow}' workflow, ` +
        `current workflow: '${currentWorkflow || 'none'}'`
      );
    }
  }

  // Check if supervisor is trying to invoke a restricted agent
  if (sourceAgentId === 'supervisor' && !targetAgent.delegation.supervisorCanInvoke) {
    throw new Error(
      `Supervisor cannot directly invoke ${targetAgentId}. ` +
      `This agent is only accessible within its designated workflow.`
    );
  }

  return true;
}
```

#### Workflow Context Tracking

```typescript
/**
 * Track the current workflow context through the agent chain.
 */
interface WorkflowContext {
  workflowId: string;           // e.g., 'deep-research'
  workflowInstanceId: string;   // Unique ID for this research session
  parentAgentId: string;        // Who invoked this agent
  depth: number;                // Nesting level (for preventing infinite loops)
}

// Pass context when delegating
await delegateToAgent('research-worker', {
  workflowContext: {
    workflowId: 'deep-research',
    workflowInstanceId: researchId,
    parentAgentId: 'deep-research-lead',
    depth: 1,
  },
  // ... other params
});
```

---

### Agent Configuration

#### Lead Research Agent (`src/agents/deep-researcher.md`)

```markdown
# Deep Research Lead Agent

You are the Lead Research Agent, orchestrating comprehensive research tasks.

## Delegation Capabilities

You have the ability to delegate to specialized sub-agents:
- **research-worker**: For parallel exploration of subtopics
- **research-reviewer**: For quality review of drafted reports

Use the `delegate_to_agent` tool to spawn these agents.

## Responsibilities
1. Analyze user query and determine if clarification is needed
2. Break down research into independent subtopics (target: {{SUBTOPIC_COUNT}} subtopics)
3. Coordinate parallel research via sub-agents
4. Synthesize findings into a cohesive report
5. Ensure all claims are properly cited

## Research Process
1. **Plan**: Create a structured research plan with {{SUBTOPIC_COUNT_MIN}}-{{SUBTOPIC_COUNT_MAX}} subtopics
2. **Delegate**: Spawn research-worker agents for parallel exploration (max {{MAX_PARALLEL_WORKERS}} concurrent)
   - Each worker should gather ~{{SOURCES_PER_SUBTOPIC}} sources for their subtopic
3. **Collect**: Gather and deduplicate sources from sub-agents
4. **Synthesize**: Compile findings into structured report
5. **Review**: Delegate to research-reviewer for quality review (up to {{REVIEW_CYCLES}} cycles)
6. **Deliver**: Present final cited report

## Delegation Example

\`\`\`json
{
  "tool": "delegate_to_agent",
  "params": {
    "agentId": "research-worker",
    "task": {
      "subtopic": "Framework architecture & design philosophy",
      "questions": [
        "What is the core architecture of React?",
        "How does Vue's reactivity system work?"
      ],
      "targetSources": {{SOURCES_PER_SUBTOPIC}}
    }
  }
}
\`\`\`

## Output Format
Always structure reports with:
- Executive Summary (2-3 paragraphs)
- Key Findings (bulleted)
- Detailed Analysis (by subtopic)
- Comparative Tables (where applicable)
- Recommendations
- Sources (numbered citations)
```

#### Research Sub-Agent (`src/agents/research-worker.md`)

```markdown
# Research Worker Agent

You are a Research Worker, focused on deep exploration of a specific subtopic.

**IMPORTANT**: This agent can only be invoked by the Deep Research Lead Agent within a deep-research workflow. It cannot be invoked directly by the supervisor or other agents.

## Delegation Capabilities

This agent CANNOT delegate to other agents. You must complete your assigned subtopic research independently.

## Responsibilities
1. Take a subtopic and set of research questions from the Lead Agent
2. Conduct thorough web searches ({{SEARCHES_PER_SUBTOPIC}} queries per subtopic)
3. Extract and summarize relevant content
4. Score source relevance and credibility (threshold: {{SOURCE_RELEVANCE_THRESHOLD}})
5. Return structured findings to lead agent

## Search Strategy
- Start broad, then refine based on findings
- Look for primary sources (official docs, research papers)
- Cross-reference claims across multiple sources
- Note publication dates for recency
- Target {{SOURCES_PER_SUBTOPIC}} quality sources (min {{SOURCES_PER_SUBTOPIC_MIN}})

## Output Format
Return structured JSON with:
- findings: key insights discovered
- sources: array of {url, title, snippet, relevance, publishedDate}
- gaps: areas needing more research
- confidence: overall confidence in findings (0-1)
```

#### Review Agent (`src/agents/research-reviewer.md`)

```markdown
# Research Reviewer Agent

You are a critical reviewer ensuring research quality.

**IMPORTANT**: This agent can only be invoked by the Deep Research Lead Agent within a deep-research workflow. It cannot be invoked directly by the supervisor or other agents.

## Delegation Capabilities

This agent CANNOT delegate to other agents. You must complete your review independently.

## Review Checklist
1. **Accuracy**: Are claims properly supported by cited sources?
2. **Recency**: Are sources current (prefer <2 years old)?
3. **Balance**: Are multiple perspectives represented?
4. **Gaps**: What important aspects are missing?
5. **Clarity**: Is the report well-structured and readable?
6. **Word Count**: Is report within {{REPORT_MAX_WORDS}} word limit?

## Feedback Format
Provide specific, actionable feedback as JSON:
\`\`\`json
{
  "approved": false,
  "issues": [
    {
      "severity": "high",
      "section": "Performance Comparison",
      "issue": "Performance claim lacks citation",
      "suggestion": "Add benchmark source for '40% faster' claim"
    },
    {
      "severity": "medium",
      "section": "Ecosystem",
      "issue": "Source [3] is from 2022",
      "suggestion": "Find 2024+ alternative for npm stats"
    }
  ],
  "strengths": [
    "Comprehensive coverage of core features",
    "Good balance of perspectives"
  ]
}
\`\`\`

## Approval Criteria
Approve the report when:
- All high-severity issues are resolved
- At least 80% of claims have citations
- Sources are predominantly recent (<2 years)
- Report is well-structured and readable
```

### UI Component Design

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔬 Deep Research: React vs Vue for Enterprise                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Status: Researching ████████░░░░░░░░░░░░ 42%                   │
│                                                                  │
│ ┌─ Research Progress ──────────────────────────────────────────┐│
│ │ ✓ Planning                               2s                  ││
│ │ ✓ Framework Architecture                 45s   [12 sources]  ││
│ │ ◐ Enterprise Adoption                    32s   [8 sources]   ││
│ │ ○ Performance Benchmarks                 -                   ││
│ │ ○ Developer Experience                   -                   ││
│ │ ○ Drafting Report                        -                   ││
│ │ ○ Review & Refinement                    -                   ││
│ └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│ 📚 Sources Found: 20                                            │
│ ⏱️  Elapsed: 1m 19s | Est. Remaining: ~3m                       │
│                                                                  │
│ [Show Details ▼]                                                │
└─────────────────────────────────────────────────────────────────┘
```

Expanded view shows:
- Current step's activity log
- List of sources found with relevance scores
- Sub-agent delegation status
- Ability to pause/cancel research

### WebSocket Events

```typescript
// Event types broadcast to UI
type DeepResearchUIEvent =
  | { type: 'deep_research_started'; researchId: string; query: string; }
  | { type: 'deep_research_plan'; researchId: string; plan: ResearchPlan; }
  | { type: 'deep_research_step'; researchId: string; step: ResearchStep; }
  | { type: 'deep_research_source'; researchId: string; source: Source; }
  | { type: 'deep_research_progress'; researchId: string; percent: number; }
  | { type: 'deep_research_draft'; researchId: string; section: string; }
  | { type: 'deep_research_review'; researchId: string; feedback: string[]; }
  | { type: 'deep_research_completed'; researchId: string; report: string; }
  | { type: 'deep_research_error'; researchId: string; error: string; };
```

### Implementation Plan

#### Phase 1: Core Infrastructure
1. **Environment & Configuration**
   - Add `DEEP_RESEARCH_PROVIDER` and `DEEP_RESEARCH_MODEL` to `.env.example`
   - Create `src/deep-research/constants.ts` with all tunable parameters
   - Add env var loading in `src/config.ts`

2. **Types & Events**
   - Define `DeepResearchMetadata` types in `src/deep-research/types.ts`
   - Define `AgentDelegationConfig` in `src/agents/types.ts`
   - Add WebSocket event types for research progress

3. **UI: # Tag Integration**
   - Add "Deep Research" option to hashtag menu in `App.jsx`
   - Add `messageType` state (separate from `reasoningMode`)
   - Display `🔬 Deep Research` chip when selected
   - Send `messageType: 'deep_research'` with message

#### Phase 2: Agent Delegation System
1. **Agent Registry**
   - Create `src/agents/agent-registry.ts` with delegation configs
   - Define which agents can delegate and to whom
   - Mark `research-worker` and `research-reviewer` as workflow-restricted

2. **Delegation Guard**
   - Create `src/agents/delegation-guard.ts`
   - Implement `canDelegate()` validation function
   - Track workflow context through agent chains

3. **Delegate Tool**
   - Create `delegate_to_agent` tool for Lead Agent
   - Enforce delegation rules via guard
   - Pass workflow context to child agents

#### Phase 3: Agent Prompts
1. Create `src/agents/deep-researcher.md` (Lead Agent)
   - Include delegation instructions and examples
   - Reference constants via template variables
2. Create `src/agents/research-worker.md` (Worker Agent)
   - Mark as delegation-restricted
   - Define search and extraction workflow
3. Create `src/agents/research-reviewer.md` (Reviewer Agent)
   - Mark as delegation-restricted
   - Define review checklist and approval criteria

#### Phase 4: Search & Content
1. Integrate web search tool (Tavily API or MCP server)
2. Implement content extraction and summarization
3. Add source deduplication and relevance scoring
4. Implement citation generation

#### Phase 5: Report Generation
1. Implement report synthesis from collected findings
2. Add review cycle with reviewer agent
3. Implement report formatting with citations
4. Add export options (Markdown, PDF)

#### Phase 6: UI & Polish
1. Create research progress component
2. Add real-time WebSocket updates
3. Error handling and recovery
4. End-to-end testing

---

## Tools & Libraries to Leverage

### Required New Tools

| Tool | Purpose | Options |
|------|---------|---------|
| Web Search | Query-based search | Tavily API, Brave Search API, DuckDuckGo |
| Content Extraction | Get full page content | Jina Reader, Playwright, BeautifulSoup |
| Academic Search | Papers & citations | Semantic Scholar API, arXiv API |

### Existing OllieBot Capabilities to Leverage

| Capability | Location | How to Use |
|------------|----------|------------|
| **# Tag Menu System** | `web/src/App.jsx:1208-1287` | Add "Deep Research" as new option |
| Specialist Agents | `src/agents/` | Base for research agents |
| Delegation Pattern | `supervisor.ts:368-448` | Spawn research sub-agents |
| Tool Events | `src/tools/types.ts` | Pattern for research events |
| RAG System | `src/rag/` | Store/retrieve research findings |
| WebSocket Broadcasting | `src/channels/web.ts` | Real-time progress updates |
| MCP Integration | `src/mcp/` | Add research MCP servers |

### Recommended MCP Servers to Integrate

1. **[mcherukara/Claude-Deep-Research](https://github.com/mcherukara/Claude-Deep-Research)**
   - Web search via DuckDuckGo
   - Academic search via Semantic Scholar
   - Content extraction with BeautifulSoup

2. **[mzxrai/mcp-webresearch](https://github.com/mzxrai/mcp-webresearch)**
   - Intelligent search queuing
   - Screenshot capture for visual content

3. **Tavily Search API** (via MCP or direct integration)
   - AI-optimized search results
   - Used by LangChain Open Deep Research

---

## Environment Variables

Add the following to `.env` for Deep Research configuration:

```bash
# Deep Research Model Configuration
# Provider for deep research (openai, anthropic, google, ollama)
DEEP_RESEARCH_PROVIDER=anthropic

# Model to use for deep research lead agent
# Recommended: Use a capable model (opus, gpt-4, gemini-pro)
DEEP_RESEARCH_MODEL=claude-sonnet-4-5-20250514
```

These allow running Deep Research on a different provider/model than the main chat, useful for:
- Using a more capable model for research orchestration
- Cost optimization (use cheaper model for chat, premium for research)
- Provider-specific features (e.g., Claude's extended thinking for analysis)

---

## Behavior Constants

All tunable Deep Research parameters are centralized in a single constants file for easy visibility and modification:

**File: `src/deep-research/constants.ts`**

```typescript
/**
 * Deep Research Behavior Constants
 *
 * These constants control the behavior of the deep research system.
 * Modify these values to tune research depth, breadth, and quality.
 */

// ============================================================
// RESEARCH SCOPE PARAMETERS
// ============================================================

/**
 * Number of sub-topics to break the main research topic into.
 * Higher = more comprehensive but slower and more expensive.
 * Recommended: 4-8
 */
export const SUBTOPIC_COUNT = 6;

/**
 * Minimum number of sub-topics (even for simple queries).
 */
export const SUBTOPIC_COUNT_MIN = 3;

/**
 * Maximum number of sub-topics (for complex queries).
 */
export const SUBTOPIC_COUNT_MAX = 10;

// ============================================================
// DATA GATHERING PARAMETERS
// ============================================================

/**
 * Number of data sources to gather for EACH sub-topic.
 * Higher = more thorough research but slower.
 * Recommended: 10-30
 */
export const SOURCES_PER_SUBTOPIC = 20;

/**
 * Minimum sources per sub-topic before moving on.
 */
export const SOURCES_PER_SUBTOPIC_MIN = 5;

/**
 * Maximum sources per sub-topic (diminishing returns beyond this).
 */
export const SOURCES_PER_SUBTOPIC_MAX = 50;

/**
 * Number of search queries to run per sub-topic.
 * More queries = broader coverage of the topic.
 */
export const SEARCHES_PER_SUBTOPIC = 5;

// ============================================================
// QUALITY CONTROL PARAMETERS
// ============================================================

/**
 * Number of review cycles (draft → review → revise).
 * Higher = better quality but slower.
 * Recommended: 1-3
 */
export const REVIEW_CYCLES = 2;

/**
 * Maximum review cycles before finalizing (prevents infinite loops).
 */
export const REVIEW_CYCLES_MAX = 5;

/**
 * Minimum relevance score (0-1) for a source to be included.
 */
export const SOURCE_RELEVANCE_THRESHOLD = 0.6;

/**
 * Maximum age of sources in days (0 = no limit).
 * Set to limit research to recent sources only.
 */
export const SOURCE_MAX_AGE_DAYS = 0;

// ============================================================
// OUTPUT PARAMETERS
// ============================================================

/**
 * Maximum word count for the final report.
 */
export const REPORT_MAX_WORDS = 3000;

/**
 * Whether to always ask clarifying questions before starting.
 */
export const REQUIRE_CLARIFICATION = false;

/**
 * Whether to include academic sources (papers, journals).
 */
export const INCLUDE_ACADEMIC_SOURCES = true;

// ============================================================
// PERFORMANCE PARAMETERS
// ============================================================

/**
 * Maximum concurrent sub-agents running in parallel.
 * Higher = faster but more API calls at once.
 */
export const MAX_PARALLEL_WORKERS = 4;

/**
 * Timeout for each research step in milliseconds.
 */
export const STEP_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Total timeout for entire research task in milliseconds.
 */
export const TOTAL_TIMEOUT_MS = 1_800_000; // 30 minutes
```

---

## Configuration Options

```typescript
interface DeepResearchConfig {
  // Behavior (see constants.ts for defaults)
  requireClarification: boolean;
  maxSubtopics: number;
  maxSourcesPerTopic: number;
  maxReviewCycles: number;

  // Models - can override env vars per-request
  provider?: string;              // Override DEEP_RESEARCH_PROVIDER
  model?: string;                 // Override DEEP_RESEARCH_MODEL
  workerModel?: string;           // Model for worker agents (default: same as lead)
  reviewerModel?: string;         // Model for reviewer agent (default: same as lead)

  // Search
  searchProvider: 'tavily' | 'brave' | 'duckduckgo' | 'mcp';
  includeAcademic: boolean;

  // Output
  reportFormat: 'markdown' | 'html';
  includeSources: boolean;
  maxReportLength: number;
}

// Default configuration (values from constants.ts)
const DEFAULT_DEEP_RESEARCH_CONFIG: DeepResearchConfig = {
  requireClarification: REQUIRE_CLARIFICATION,
  maxSubtopics: SUBTOPIC_COUNT,
  maxSourcesPerTopic: SOURCES_PER_SUBTOPIC,
  maxReviewCycles: REVIEW_CYCLES,
  // provider/model from env vars: DEEP_RESEARCH_PROVIDER, DEEP_RESEARCH_MODEL
  searchProvider: 'tavily',
  includeAcademic: INCLUDE_ACADEMIC_SOURCES,
  reportFormat: 'markdown',
  includeSources: true,
  maxReportLength: REPORT_MAX_WORDS,
};
```

---

## User Interaction Flow

### Initiating Deep Research

**Primary Method: # Tag Menu**

Deep Research is activated via the existing # tag system in the message composer. When user types `#`, a menu appears with available options:

```
┌─────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────┐ │
│ │ Compare React vs Vue for enterprise...  │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─ # Menu ─────────────────────────────────┐│
│ │ 🔬 Deep Research                         ││
│ │    Comprehensive multi-source research   ││
│ │ ─────────────────────────────────────── ││
│ │ 🧠 Think                                 ││
│ │    High effort reasoning                 ││
│ │ 🧠 Think+                                ││
│ │    Maximum effort reasoning              ││
│ └──────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

When "Deep Research" is selected:
- A chip appears showing `🔬 Deep Research`
- Message is sent with `messageType: 'deep_research'`
- Backend routes to Deep Research Lead Agent instead of normal chat flow

**Secondary Method: Slash command**
```
/research Compare React vs Vue for enterprise applications
```

**Implementation in App.jsx:**

```javascript
// Add to hashtag menu options (alongside Think/Think+)
const hashtagOptions = [
  {
    id: 'deep_research',
    icon: '🔬',
    label: 'Deep Research',
    description: 'Comprehensive multi-source research',
  },
  // ... existing Think/Think+ options
];

// When selected, set messageType instead of reasoningMode
const [messageType, setMessageType] = useState(null); // null | 'deep_research'
```

### During Research

- Show progress widget (collapsible)
- Allow user to continue chatting in same conversation
- Notification when complete
- Option to pause/cancel

### After Research

- Report appears as expandable message
- "Sources" section with clickable links
- Option to export as PDF/Markdown
- Option to "dig deeper" on specific section

---

## Quality & Safety Considerations

### Source Quality
- Prefer official documentation, research papers, reputable news
- Flag potentially unreliable sources
- Cross-reference claims across multiple sources
- Note publication dates prominently

### Hallucination Prevention
- Every factual claim must have a citation
- Reviewer agent specifically checks for unsupported claims
- "Confidence" indicators for contested claims
- Clear distinction between facts and analysis/opinion

### Error Handling
- Checkpoint state for long-running research
- Graceful degradation if search fails
- Model-based recovery (tell agent about failures)
- Option to retry specific steps

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Research Quality | Comparable to Claude/ChatGPT | User satisfaction surveys |
| Sources per Report | 20-50 | Automatic counting |
| Citation Accuracy | >95% valid links | Automated validation |
| Time to Complete | 5-15 minutes | Automatic timing |
| User Engagement | >70% read full report | Scroll tracking |

---

## Appendix: Competitive Comparison

| Feature | ChatGPT | Claude | Gemini | OllieBot (Proposed) |
|---------|---------|--------|--------|---------------------|
| Multi-agent | Yes (o3 variants) | Yes (Lead + Subagents) | Yes | Yes |
| Parallel search | Yes | Yes | Yes | Yes |
| Progress tracking | Sidebar | ? | Activity log | Real-time widget |
| Citations | Inline | Inline | Inline | Inline + Sources section |
| Review cycle | Internal | Internal | Internal | Configurable |
| Export options | Copy | Copy | PDF/Docs | Markdown/PDF |
| Background execution | Yes | Yes | Yes | Yes |
| Time estimate | 5-30 min | Similar | 5-10 min | 5-15 min |

---

## References

- [OpenAI Deep Research](https://openai.com/index/introducing-deep-research/)
- [OpenAI Deep Research System Card](https://cdn.openai.com/deep-research-system-card.pdf)
- [Anthropic Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Gemini Deep Research Agent](https://ai.google.dev/gemini-api/docs/deep-research)
- [LangChain Open Deep Research](https://github.com/langchain-ai/open_deep_research)
- [GPT-Researcher](https://github.com/assafelovic/gpt-researcher)
- [Claude Deep Research MCP Server](https://github.com/mcherukara/Claude-Deep-Research)
- [STORM Paper](https://arxiv.org/abs/2402.14207) (Stanford research on topic synthesis)

# Deep Research Message Type - Design Proposal

## Executive Summary

This document proposes a design for implementing a **Deep Research** message type in OllieBot, enabling multi-step, autonomous research capabilities similar to those offered by ChatGPT, Claude, and Gemini.

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
│  [🔬 Deep Research] "Compare React vs Vue for enterprise apps"  │
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

### Agent Configuration

#### Lead Research Agent (`src/agents/deep-researcher.md`)

```markdown
# Deep Research Lead Agent

You are the Lead Research Agent, orchestrating comprehensive research tasks.

## Responsibilities
1. Analyze user query and determine if clarification is needed
2. Break down research into independent subtopics
3. Coordinate parallel research via sub-agents
4. Synthesize findings into a cohesive report
5. Ensure all claims are properly cited

## Research Process
1. **Plan**: Create a structured research plan with 4-8 subtopics
2. **Delegate**: Spawn researcher sub-agents for parallel exploration
3. **Collect**: Gather and deduplicate sources from sub-agents
4. **Synthesize**: Compile findings into structured report
5. **Review**: Run internal quality review cycle
6. **Deliver**: Present final cited report

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

## Responsibilities
1. Take a subtopic and set of research questions
2. Conduct thorough web searches (10-20 queries)
3. Extract and summarize relevant content
4. Score source relevance and credibility
5. Return structured findings to lead agent

## Search Strategy
- Start broad, then refine based on findings
- Look for primary sources (official docs, research papers)
- Cross-reference claims across multiple sources
- Note publication dates for recency

## Output Format
Return structured JSON with:
- findings: key insights discovered
- sources: array of {url, title, snippet, relevance}
- gaps: areas needing more research
```

#### Review Agent (`src/agents/research-reviewer.md`)

```markdown
# Research Reviewer Agent

You are a critical reviewer ensuring research quality.

## Review Checklist
1. **Accuracy**: Are claims properly supported by cited sources?
2. **Recency**: Are sources current (prefer <2 years old)?
3. **Balance**: Are multiple perspectives represented?
4. **Gaps**: What important aspects are missing?
5. **Clarity**: Is the report well-structured and readable?

## Feedback Format
Provide specific, actionable feedback:
- "[Section X] needs citation for performance claim"
- "[Source 3] is outdated, find 2024+ alternative"
- "Missing comparison of [specific aspect]"
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

#### Phase 1: Core Infrastructure (Week 1)
1. Define `DeepResearchMetadata` types in `src/agents/types.ts`
2. Add `saveDeepResearchEvent()` to Supervisor
3. Add WebSocket event broadcasting for research events
4. Create basic UI component for research progress

#### Phase 2: Agent System (Week 2)
1. Create `deep-researcher.md` lead agent prompt
2. Create `research-worker.md` sub-agent prompt
3. Create `research-reviewer.md` reviewer prompt
4. Implement research orchestration in Supervisor

#### Phase 3: Search & Content (Week 3)
1. Integrate web search tool (Tavily API or MCP server)
2. Implement content extraction and summarization
3. Add source deduplication and relevance scoring
4. Implement citation generation

#### Phase 4: Report Generation (Week 4)
1. Implement report synthesis from collected findings
2. Add review cycle with reviewer agent
3. Implement report formatting with citations
4. Add export options (Markdown, PDF)

#### Phase 5: Polish & Testing (Week 5)
1. UI polish and animations
2. Error handling and recovery
3. Performance optimization
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

## Configuration Options

```typescript
interface DeepResearchConfig {
  // Behavior
  requireClarification: boolean;  // Always ask clarifying questions?
  maxSubtopics: number;           // Max parallel research branches (4-8)
  maxSourcesPerTopic: number;     // Sources to collect per subtopic (10-30)
  maxReviewCycles: number;        // Internal review iterations (1-3)

  // Models (leverage existing OllieBot model config)
  leadModel: 'main' | 'fast';     // Lead agent model
  workerModel: 'main' | 'fast';   // Worker agent model
  reviewerModel: 'main' | 'fast'; // Reviewer agent model

  // Search
  searchProvider: 'tavily' | 'brave' | 'duckduckgo' | 'mcp';
  includeAcademic: boolean;       // Search academic sources?

  // Output
  reportFormat: 'markdown' | 'html';
  includeSources: boolean;
  maxReportLength: number;        // Max words in final report
}

// Default configuration
const DEFAULT_DEEP_RESEARCH_CONFIG: DeepResearchConfig = {
  requireClarification: false,
  maxSubtopics: 6,
  maxSourcesPerTopic: 20,
  maxReviewCycles: 2,
  leadModel: 'main',
  workerModel: 'fast',
  reviewerModel: 'main',
  searchProvider: 'tavily',
  includeAcademic: true,
  reportFormat: 'markdown',
  includeSources: true,
  maxReportLength: 3000,
};
```

---

## User Interaction Flow

### Initiating Deep Research

Option A: Button in message composer
```
┌─────────────────────────────────────────────┐
│ [📎] [🔬 Deep Research] [Send]              │
│ ┌─────────────────────────────────────────┐ │
│ │ Your message here...                    │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

Option B: Slash command
```
/research Compare React vs Vue for enterprise applications
```

Option C: Tag in message
```
@deep-research Compare React vs Vue for enterprise applications
```

**Recommendation**: Implement Option A (button) as primary, Option B (slash command) as secondary.

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

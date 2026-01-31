# OllieBot

Personal support agent that runs continuously to respond to triggers and perform automated tasks.

## Features

- **Natural Language Configuration**: Define tasks in `.md` files, automatically converted to structured JSON
- **Multi-Channel Communication**: Web UI, Console CLI, Microsoft Teams
- **Dual LLM Strategy**: Main (Claude/Gemini) for complex tasks, Fast (Gemini Flash) for summarization
- **MCP Integration**: Connect to Model Context Protocol servers for external tools
- **SKILL.md Workflows**: Pre-packaged automation workflows
- **A2UI Human-in-the-Loop**: Request user input during automated workflows
- **RAG System**: Automatic chunking and retrieval for large documents
- **Git Versioning**: All config changes tracked in local git

## Quick Start

### Prerequisites
- Node.js 20+
- npm or pnpm

### Setup

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Add your API keys to `.env`:
```env
ANTHROPIC_API_KEY=your-anthropic-key
GOOGLE_API_KEY=your-google-key  # Optional, for Gemini + embeddings
```

4. Start the server:
```bash
npm run dev:server
```

5. Start the web UI (in another terminal):
```bash
npm run dev:web
```

6. Open http://localhost:5173 in your browser

### Console Mode

For CLI-only interaction:
```bash
npm run dev:server console
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Required |
| `GOOGLE_API_KEY` | Google API key (for Gemini + embeddings) | Optional |
| `MAIN_PROVIDER` | Main LLM provider (`anthropic` or `google`) | `anthropic` |
| `MAIN_MODEL` | Main LLM model | `claude-sonnet-4-20250514` |
| `FAST_PROVIDER` | Fast LLM provider | `google` |
| `FAST_MODEL` | Fast LLM model | `gemini-2.5-flash-lite` |
| `PORT` | Server port | `3000` |
| `MCP_SERVERS` | JSON array of MCP server configs | `[]` |

### Task Configuration

Create task definitions as `.md` files in `user/agent/`. The bot will:
1. Watch for changes to these files
2. Parse them into structured `.json` configs using LLM
3. Version both files with git
4. Schedule and execute tasks accordingly

Example (`user/agent/daily-summary.md`):
```markdown
# Daily Summary Task

Every morning at 9 AM, I want OllieBot to:
1. Check my calendar for today's events
2. Summarize important emails
3. Give me a weather forecast

Send the summary through the web chat.
```

### Skills

Create SKILL.md files in `user/skills/` for reusable workflows:
```markdown
# Summarize URL

## Inputs
| Name | Description | Type | Required |
|------|-------------|------|----------|
| url | URL to summarize | string | yes |

## Steps
1. Fetch URL content
2. Generate summary
```

## Project Structure

```
olliebot/
├── src/                  # Backend source code
│   ├── agent/           # Core agent logic
│   ├── a2ui/            # Human-in-the-loop interactions
│   ├── channels/        # Communication channels
│   ├── config/          # Config file watcher
│   ├── db/              # Database layer (Kysely + SQLite)
│   ├── llm/             # LLM providers (Anthropic, Google)
│   ├── mcp/             # MCP server client
│   ├── rag/             # RAG system
│   ├── server/          # HTTP/WebSocket server
│   └── skills/          # SKILL.md parser and executor
├── web/                  # React frontend
├── user/
│   ├── agent/           # Task configuration .md files
│   ├── data/            # SQLite database
│   └── skills/          # SKILL.md workflow files
├── turbo.json           # Turbo monorepo config
└── package.json         # Workspace root
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/state` | Get agent state |
| GET | `/api/messages` | Get chat history |
| POST | `/api/messages` | Send a message |
| GET | `/api/clients` | Get connected client count |

WebSocket available at `ws://localhost:3000` for real-time updates.

## Data Handling Strategy

| Data Size | Strategy |
|-----------|----------|
| < 3,000 chars | Direct consumption |
| 3,000 - 50,000 chars | Summarize with Fast LLM |
| > 50,000 chars | RAG (chunk, embed, retrieve) |

## See Also

- [SUGGESTION.md](./SUGGESTION.md) - Detailed suggestions and roadmap
- [Agents.md](./Agents.md) - Original specification

# OllieBot

Personal agent that runs continuously to respond to triggers and perform recurring tasks.

Why create this when "XYZ" exists (XYZ = whatever is trending this week)?
- This is a lab for agent feature set experiments. Because this is a single fully localized code base, it is easier to experiment with different ways that agents could work or even what an agent is.

## Features
- **Natural Language Configuration**: Define tasks in `.md` files, automatically converted to structured JSON
- **Customizable Sub-agent**: Can launch specialized sub-agent for sub-tasks and these specialized sub-agents have system prompts that are customizable.
- **MCP Integration**: Connect to Model Context Protocol servers for external tools
- **Agent Skills Workflows**: Pre-packaged workflows like those for Claude (open standard)
- **Git Versioning**: All config changes tracked in local git
- **Built-in Tools**: Web search, Wikipedia search, web scraping, image analysis, image generation, etc.
- **User-Defined Tools**: Write tool specs in natural language in `.md`, auto-generate `.js` and execute in sandboxed VM 
- **Browser Automation**: Computer Use models for visual browser automation with live preview. This feature is fairly limited to the ability of the underlying model - which is not great.
- **Multi-Channel Communication**: Web UI, Console CLI, TUI, TODO: Microsoft Teams (untested)

## Experimantal Features (not well tested)

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

2. Install Playwright browsers (required for Browser Automation):
```bash
npx playwright install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Add your API keys to `.env`:
```env
ANTHROPIC_API_KEY=your-anthropic-key
GOOGLE_API_KEY=your-google-key  # Optional, for Gemini + embeddings
```

5. Start the server:
```bash
npm run dev:server
```

6. Start the web UI (in another terminal):
```bash
npm run dev:web
```

7. Open http://localhost:5173 in your browser

### Console Mode

For CLI-only interaction:
```bash
npm run dev:server console
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Optional |
| `GOOGLE_API_KEY` | Gemini API key | Optional |
| `OPENAI_API_KEY` | OpenAI API key | Optional |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key | Optional |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint | - |
| `MAIN_PROVIDER` | Main LLM provider (`openai`, `azure_openai`, `anthropic`, `google` | `openai` |
| `MAIN_MODEL` | Main LLM model | `gpt-5.2` |
| `FAST_PROVIDER` | Fast LLM provider | `openai` |
| `FAST_MODEL` | Fast LLM model | `gpt-4.1-mini` |
| `IMAGE_GEN_PROVIDER` | Image gen provider | `openai` |
| `IMAGE_GEN_MODEL` | Image gen model | `dall-e-3` |
| `PORT` | Server port | `3000` |
| `MCP_SERVERS` | JSON array of MCP server configs | `[]` |
| `WEB_SEARCH_API_KEY` | API key for web search (Serper or Google CSE) | Optional |
| `WEB_SEARCH_PROVIDER` | Web search provider (`serper` or `google_custom_search`) | `serper` |

#### Browser Automation

| Variable | Description | Default |
|----------|-------------|---------|
| `BROWSER_PROVIDER` | Computer Use provider (`azure_openai`, `google`, `openai`, `anthropic`) | `azure_openai` |
| `BROWSER_MODEL` | Model for browser automation | `computer-use-preview` |
| `BROWSER_DEBUG_MODE` | Enable live preview in web UI | `false` |
| `OPENAI_BASE_URL` | Override OpenAI Responses API base URL | `https://api.openai.com/v1/responses` |

OpenAI Computer Use (Preview) quick setup:
```
BROWSER_PROVIDER=openai
BROWSER_MODEL=computer-use-preview
OPENAI_API_KEY=...
```

Note: Access to `computer-use-preview` is restricted. If you see a `model_not_found` error, your account likely doesn’t have access or the model name differs for you.

### Task Configuration

Create task definitions as `.md` files in `user/tasks/`. The bot will:
1. Watch for changes to these files
2. Parse them into structured `.json` configs using LLM
3. Version both files with git
4. Schedule and execute tasks accordingly

Example (`user/tasks/daily-summary.md`):
```markdown
# Daily Summary Task

Every morning at 9 AM, I want OllieBot to:
1. Check my calendar for today's events
2. Summarize important emails
3. Give me a weather forecast

Send the summary through the web chat.
```

### Skills

Create or download Agent Skills (SKILL.md) from various marketplace or collections and unzip them in `user/skills/`.
Skills are reusable workflows that can be part of a task like how to make a good PowerPoint deck.

### User-Defined Tools

Create `.md` files in `user/tools/` to define custom tools. The system automatically:
1. Watches for new/changed `.md` files
2. Generates JavaScript implementation using LLM
3. Executes in a secure VM sandbox with Zod validation

Example (`user/tools/calculate-age.md`):
```markdown
# Calculate Age

Calculate a person's age from their birth date.

## Inputs
| Name | Description | Type | Required |
|------|-------------|------|----------|
| birthDate | Birth date in YYYY-MM-DD format | string | yes |

## Output
Returns an object with `years`, `months`, and `days`.

## Example
Input: `{ "birthDate": "1990-05-15" }`
Output: `{ "years": 35, "months": 8, "days": 16 }`
```

The generated `.js` file is saved alongside the `.md` file and will be regenerated when:
- The `.md` file is modified
- The `.js` file is deleted

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
│   ├── tasks/           # Task configuration .md files
│   ├── sub-agents/      # Sub-agent prompt overrides
│   ├── tools/           # User-defined tool .md specs (auto-generates .js)
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

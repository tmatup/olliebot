# OllieBot

Personal assistant that runs continuously to respond to triggers and perform recurring tasks even without direct user input.

Why create this when "XYZ" exists (XYZ = whatever is trending this week)?
- This is a lab for agent / assistant feature experiments. Because this is a single self-contained code base, it is easier to experiment with different ways that agents could work, how they could be built/defined or even what an agent is.

## Novel Features
- **Integrated Eval**: Define evals in JSON, and test how well the system prompts for main agent and subagents work.
- **Natural Language Tasks**: Define recurring tasks in `.md` files, the system auto-generate a structured JSON for more predictable execution.
- **Natural Language Tools**: Add your own tool in natural language `.md`, the system auto-generate `.js` and execute in sandboxed VM 

## Commodity Features
- **Deep Research**: Use # to toggle Deep Research mode. It is not a particularly robust implementation, but it has the basic structure. This is mainly a proof of concept using our multi-agent execution system.
- **RAG**: You can create RAG projects, each containg related documents (TXT, PDF) to be indexed and allow Q&A (RAG).
- **Think mode**: Adjust reasoning efforts level using # in chat input to toggle Think or Think+ mode.
- **Customizable Sub-agent**: Can launch specialized sub-agent for sub-tasks and these specialized sub-agents have system prompts that are customizable.
- **MCP Integration**: Connect to Model Context Protocol servers for external tools
- **Agent Skills Workflows**: Pre-packaged workflows like those for Claude (open standard)
- **Git Versioning**: All config changes tracked in local git
- **Built-in Tools**: Web search, Wikipedia search, web scraping, image analysis, image generation, etc.
- **Browser Automation**: Computer Use models for visual browser automation with live preview. This feature is fairly limited to the ability of the underlying model - which is not great.
- **Multi-Channel Communication**: Web UI, Console CLI, TUI, TODO: Microsoft Teams (untested)

## 

## Untested / Undertested Features

- **RAG System**: Automatic chunking and retrieval for large documents
- **Git Versioning**: All config changes tracked in local git

## Quick Start

1. Install dependencies:

```bash
npm install
npx playwright install
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Add your API keys to `.env`, pick your providers. My example:
```env
AZURE_OPENAI_API_KEY=<YOURS: api key>
AZURE_OPENAI_ENDPOINT=https://jarvistest32747981598.cognitiveservices.azure.com
MAIN_PROVIDER=azure_openai
MAIN_MODEL=gpt-5.2
FAST_PROVIDER=azure_openai
FAST_MODEL=gpt-4.1-mini
IMAGE_GEN_PROVIDER=azure_openai
IMAGE_GEN_MODEL=dall-e-3
BROWSER_PROVIDER=azure_openai
BROWSER_MODEL=computer-use-preview 
WEB_SEARCH_PROVIDER=serper
WEB_SEARCH_API_KEY=<YOURS serper free API key>
# need to be in a single line, .env can't handle multi-line, remember to pur YOUR own PAT token
MCP_SERVERS={"mcpServers":{"github":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"],"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"ghp_..."}}}}
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

### Other Experimental Interface (Do not have feature parity!)

The shared server must be running (step 4 above)

For CLI:
```bash
npm run dev:console
```

For TUI (Terminal User Interface):
```bash
npm run dev:tui
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
| `WEB_SEARCH_PROVIDER` | Web search provider (`serper`, `tavily`, `google_custom_search`) | `tavily` |

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

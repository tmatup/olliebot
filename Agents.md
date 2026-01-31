# OllieBot - personal support

OllieBot is a personal support agent that runs continuously to respond and poll a set of pre-defined triggers (incoming messages, poll data sources, poll news, etc.) to perform appropriate actions as instructed by the user.

## Key design points:
- its config are in a folder as a collection of .md files containing natural language description of the tasks that user wants the bot to perform. These files are intentionally non-schematized so it's easy for user to write
- the robot would monitor for any changes to .md file, and have the ability to generate and re-generate a .json file from it. This is the actual schematized task definition that the robot formulate based on user's instruction in the .md file. 
- the robot would use git to locally version all its config files. The .md files and .json files are all committed into local git and any modifications are versioned. For .md file, once change is detected and new .json file is generated, the bot would create a commit for both files in the background. The bot should also be capable of using git history to understand the change history of its config should user asks.
- the robot communicate with user through a variety of channels, the code should provide an abstraction for capturing different communication channels. Start with the following ones:
  - via custom web UI resemble a chat application. This is our best UX, most flexible but other options are provided to have the ability to meet where user is and is likely to require some compromise in functionality and fidelity.
  - via console, CLI based input and output using inquery library
  - via 3rd party chat app - Microsoft Teams, a Teams app to allow input and output through Teams chat
- the robot supports MCP servers to provide with access to tools
- the robot supports Anthropic SKILL.md definitions to access pre-packaged workflows
- the robot uses A2UI standard to handle human in the middle interaction with user through the interaction channels
- the robot uses stylized markdown and inline html to express its ideas and complex information
- the core agent is a node.js javascript application, it exposes both REST and websocket interfaces. REST API for different clients (console, web UI, Teams app) to fetch bulk information like chat history and to send message to the bot. WebSocket for push events.
- the web frontend (custom web UI) is a React application, using javascript and vite + turbo. 
- the bot would use 2 LLMs, Main and Fast. Main is something smart like Claude Sonnet and Fast is something cheap and fast like Gemini 2.5 Flash Lite. They should be configurable by user.
- here is a general strategy to deal with the data either specificed by users or returned by MCP or other tools. 
  - if data is small, less than 3000 characters, consume directly from LLM context
  - if data is moderately large, between 3000 to 50K charactres, summarize using the "Fast" LLM to summarize into 3000 characters first before consume from Main LLM.
  - if data is larger than 50K characters, perform a standard RAG on it: chunk the data, add metadata to each chunk, use an online embedding model to compute embeddings for each chunk and store each chunk into local vector database, and then query it to retrieve relevant chunks to generate response
- store user data data in the top level of the repo, ie. there would be a /user folder parallel to /src folder, inside it would contain /data subfolder for database persistent data and /agent folder for the .md files and .json files
- use Sqlite (better-sqlite3) as DB engine, persist data as JSON under /data folder. 
- the code base should use Kysely library to interact with sqlite engine
- the MCP and Skills are global, the tasks can pick relevant ones to use. But in the task .json file maybe provide ability to whitelist or blacklist sepcific MCP or Skills to allow for some user control
- I want this service to have an explicit multi-agent architecture. That means that there isn't a single identity of "OllieBot", sure there is a master or supervisor agent, but there can also be sub-agent that with specific mission or for performing a scoped sub task, and these agents can be spun off by master agent to work on specific task. And these agents could speak in the communication channel without having to speak through the supervisor agent. 

## UI Design and Details
- On the left, there should be a collapsable area to show history of different conversations. 
- Main UI, on top, there should be a button to start a new conversation
- The chat messge pane shold have auto-scroll behavior where that it would keep scrolling down to show the most recent messages, but if user manually move up the scrolling position, it would anchor to where user has manually scrolled to and not move away but provide a hover button to "Scroll to bottom".
- should load past chat history from DB and populate in history side by, but as an async operation, not blocking startup, show skeleton while loading if > 0.5s
- the history side bar should be collapsable
- The UI should have a max width (say 1000px) so it doesn't look ridiculous in ultra wide monitor
- On the left pane, bottom half, should be a set of expandable Accordions for Agent tasks, Skills and MCPs
- Chat history item -> ... for actions, first action is delete, no confirmation, but soft delete only, intoduce soft delete semantic to DB layer

## Agent capability
- The Agent should have access to tools from MCP as well as skills, so it can choose to use these tools
- Agent can request to use tools - it needs to specify all the parameters needed, and the Agent runtime would honor the tool use requests by executing tool logic. The agent runtime would send real time tool use events to clients. Here are tool use related events:
  - Tool requested event - parameters include tool requested and parameters. 
  - Tool execution finishes - tool start time, tool end time, duration, results of the tool execution
- Agent can request tool use both concurrently and serially. If agent requests concurrent tools (for example, run several related web search in parallel), these tool will run concurrently.
- Create the follow native tools available to agents:
  - Web search - parameter = searchText
  - Take screenshot - no parameter
  - Analyze image - file path OR image dataURL (requires decoding)
  - Create image - parameter = description
  - Remember this - append new information to agent managed memory.json file under user folder
- memory - there are two memory file memory.md and memory.json that would be injected into every system prompt as context. user/memory.md is managed exclusively by the user. user/memory.json is managed exclusively by the agent. If the agent recieves very important information from user, it can decide to use "Remember this" tool to write into the agent managed long term memory. Write in the system prompt that be VERY selective about recording info into long term memory as it adds the context window consumption for all future calls.

## The agent's loop
- the agent sits in a loop that perform the following actions
  - check any of its config files (.md files) for modifications and if modification is detected, parse and generate corresponding .json config file that is a precise, schematized task config.
  - perform scheduled tasks at their pre-configured intervals (hourly, daily or any pre-defined timeline).  
  
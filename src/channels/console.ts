import { select, search } from '@inquirer/prompts';
import { v4 as uuid } from 'uuid';
import * as readline from 'readline';
import type { Channel, Message, SendOptions } from './types.js';

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  schedule: string | null;
  status: string;
  lastRun: string | null;
  nextRun: string | null;
}

export interface ToolInfo {
  name: string;
  description: string;
}

export interface ToolsData {
  builtin: ToolInfo[];
  user: ToolInfo[];
  mcp: Record<string, ToolInfo[]>;
}

export interface McpServer {
  id: string;
  name: string;
  enabled: boolean;
  transport: string;
  toolCount: number;
}

export interface ConversationProvider {
  listConversations: (limit?: number) => Conversation[];
  getMessages: (conversationId: string, limit?: number) => ConversationMessage[];
  getCurrentConversationId: () => string | null;
  setConversationId: (id: string | null) => void;
  startNewConversation: () => void;
}

export interface SystemProvider {
  getTasks: () => ScheduledTask[];
  getTools: () => ToolsData;
  getMcpServers: () => McpServer[];
}

interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  action: () => Promise<void> | void;
}

export class ConsoleChannel implements Channel {
  readonly id: string;
  readonly name = 'console';

  private messageHandler: ((message: Message) => Promise<void>) | null = null;
  private actionHandler: ((action: string, data: unknown) => Promise<void>) | null = null;
  private connected = false;
  private inputLoop: Promise<void> | null = null;
  private shouldStop = false;
  private activeStreams: Map<string, { agentName?: string; agentEmoji?: string }> = new Map();
  private conversationProvider: ConversationProvider | null = null;
  private systemProvider: SystemProvider | null = null;
  private slashCommands: SlashCommand[] = [];
  private rl: readline.Interface | null = null;

  constructor(id: string = 'console-default') {
    this.id = id;
    this.initSlashCommands();
  }

  private initSlashCommands(): void {
    this.slashCommands = [
      {
        name: 'switch',
        aliases: ['s'],
        description: 'Switch to another conversation',
        action: () => this.handleSwitchConversation(),
      },
      {
        name: 'new',
        aliases: ['n'],
        description: 'Start a new conversation',
        action: () => this.handleNewConversation(),
      },
      {
        name: 'list',
        aliases: ['l'],
        description: 'List recent conversations',
        action: () => this.handleListConversations(),
      },
      {
        name: 'tasks',
        aliases: ['t'],
        description: 'List scheduled tasks',
        action: () => this.handleListTasks(),
      },
      {
        name: 'tools',
        aliases: [],
        description: 'List available tools',
        action: () => this.handleListTools(),
      },
      {
        name: 'mcp',
        aliases: ['m'],
        description: 'List MCP servers',
        action: () => this.handleListMcp(),
      },
      {
        name: 'help',
        aliases: ['h', '?'],
        description: 'Show available commands',
        action: () => this.showHelp(),
      },
    ];
  }

  setConversationProvider(provider: ConversationProvider): void {
    this.conversationProvider = provider;
  }

  setSystemProvider(provider: SystemProvider): void {
    this.systemProvider = provider;
  }

  async init(): Promise<void> {
    this.connected = true;
    // Delay showing prompt and starting input loop to allow async initialization logs to complete
    // (e.g., ConfigWatcher ready event) - prevents console.log from corrupting inquirer prompt
    setTimeout(() => {
      console.log('\n🤖 OllieBot Console Interface');
      console.log('Type your message and press Enter. Type "exit" to quit.');
      console.log('Press / for commands\n');
      this.startInputLoop();
    }, 500);
  }

  private startInputLoop(): void {
    this.inputLoop = this.runInputLoop();
  }

  private getPromptPrefix(): string {
    if (!this.conversationProvider) {
      return 'You: ';
    }
    const convId = this.conversationProvider.getCurrentConversationId();
    if (!convId) {
      return '[New Chat] You: ';
    }
    const conversations = this.conversationProvider.listConversations(20);
    const current = conversations.find(c => c.id === convId);
    const title = current?.title || 'Untitled';
    // Truncate long titles
    const displayTitle = title.length > 20 ? title.slice(0, 17) + '...' : title;
    return `[${displayTitle}] You: `;
  }

  private async runInputLoop(): Promise<void> {
    while (!this.shouldStop && this.connected) {
      try {
        const userInput = await this.getInputWithSlashDetection();

        if (userInput === null) {
          // Ctrl+C or exit
          this.shouldStop = true;
          break;
        }

        if (userInput === '') {
          continue;
        }

        const trimmedInput = userInput.trim().toLowerCase();

        // Handle exit
        if (trimmedInput === 'exit') {
          console.log('\nGoodbye! 👋\n');
          this.shouldStop = true;
          break;
        }

        // Regular message
        if (userInput.trim() && this.messageHandler) {
          const message: Message = {
            id: uuid(),
            channel: this.id,
            role: 'user',
            content: userInput,
            createdAt: new Date(),
          };
          await this.messageHandler(message);
        }
      } catch (error) {
        // Handle Ctrl+C or other interrupts
        if ((error as Error).name === 'ExitPromptError') {
          this.shouldStop = true;
          break;
        }
        console.error('Input error:', error);
      }
    }
  }

  private getInputWithSlashDetection(): Promise<string | null> {
    return new Promise((resolve) => {
      const prompt = this.getPromptPrefix();
      process.stdout.write(prompt);

      let buffer = '';
      let cursorPos = 0;

      // Set raw mode for keypress detection
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const cleanup = () => {
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
      };

      const onData = async (data: Buffer) => {
        const key = data.toString();

        // Ctrl+C
        if (key === '\x03') {
          cleanup();
          console.log('\n');
          resolve(null);
          return;
        }

        // Enter
        if (key === '\r' || key === '\n') {
          cleanup();
          console.log('');
          resolve(buffer);
          return;
        }

        // Backspace
        if (key === '\x7f' || key === '\b') {
          if (cursorPos > 0) {
            buffer = buffer.slice(0, cursorPos - 1) + buffer.slice(cursorPos);
            cursorPos--;
            // Clear line and rewrite
            process.stdout.write('\r\x1b[K' + prompt + buffer);
            // Move cursor to position
            if (cursorPos < buffer.length) {
              process.stdout.write(`\x1b[${buffer.length - cursorPos}D`);
            }
          }
          return;
        }

        // Escape sequences (arrow keys, etc.)
        if (key.startsWith('\x1b')) {
          // Left arrow
          if (key === '\x1b[D' && cursorPos > 0) {
            cursorPos--;
            process.stdout.write(key);
          }
          // Right arrow
          if (key === '\x1b[C' && cursorPos < buffer.length) {
            cursorPos++;
            process.stdout.write(key);
          }
          return;
        }

        // Slash at the beginning triggers command menu
        if (key === '/' && buffer === '') {
          cleanup();
          // Clear the current prompt line before showing menu
          process.stdout.write('\r\x1b[K');

          try {
            const handled = await this.showSlashCommandMenu();
            if (handled) {
              resolve(''); // Command was handled, get new input
            } else {
              // User cancelled, return to normal input
              resolve('');
            }
          } catch {
            resolve('');
          }
          return;
        }

        // Regular character - insert at cursor position
        if (key.length === 1 && key >= ' ') {
          buffer = buffer.slice(0, cursorPos) + key + buffer.slice(cursorPos);
          cursorPos++;
          // Rewrite from cursor position
          process.stdout.write('\r\x1b[K' + prompt + buffer);
          if (cursorPos < buffer.length) {
            process.stdout.write(`\x1b[${buffer.length - cursorPos}D`);
          }
        }
      };

      process.stdin.on('data', onData);
    });
  }

  private async showSlashCommandMenu(): Promise<boolean> {
    try {
      const choices = this.slashCommands.map(cmd => ({
        name: `/${cmd.name} - ${cmd.description}`,
        value: cmd.name,
        description: cmd.description,
      }));

      // Create the search prompt (returns a cancelable promise)
      const searchPromise = search(
        {
          message: 'Command (ESC to cancel):',
          source: async (input) => {
            if (!input) return choices;
            const lower = input.toLowerCase();
            return choices.filter(c =>
              c.value.includes(lower) ||
              this.slashCommands.find(cmd => cmd.name === c.value)?.aliases.some(a => a.includes(lower))
            );
          },
        },
        {
          clearPromptOnDone: true,
        }
      );

      // Set up ESC key listener to cancel the prompt
      const escHandler = (data: Buffer) => {
        // ESC key is 0x1b (27)
        if (data[0] === 0x1b && data.length === 1) {
          searchPromise.cancel();
        }
      };

      // Listen for ESC in raw mode (inquirer already has raw mode enabled)
      process.stdin.on('data', escHandler);

      try {
        const selected = await searchPromise;

        const command = this.slashCommands.find(c => c.name === selected);
        if (command) {
          await command.action();
          return true;
        }
        return false;
      } finally {
        // Always clean up the ESC listener
        process.stdin.removeListener('data', escHandler);
      }
    } catch (error) {
      // User cancelled (Escape or Ctrl+C)
      const errorName = (error as Error).name;
      if (errorName === 'ExitPromptError' || errorName === 'AbortPromptError') {
        // Clear the menu from screen using ANSI escape codes
        // Lines: menu prompt(1) + choices(N) + empty(1) + description(1) + nav hint(1)
        const linesToClear = this.slashCommands.length + 4;
        process.stdout.write(`\x1b[${linesToClear}A\x1b[J`);
        return false;
      }
      throw error;
    }
  }

  private async handleSwitchConversation(): Promise<void> {
    if (!this.conversationProvider) {
      console.log('\n⚠️  Conversation switching not available\n');
      return;
    }

    const conversations = this.conversationProvider.listConversations(20);
    if (conversations.length === 0) {
      console.log('\n📭 No conversations yet. Start chatting to create one!\n');
      return;
    }

    const currentId = this.conversationProvider.getCurrentConversationId();

    try {
      const choices = conversations.map(conv => ({
        name: `${conv.id === currentId ? '● ' : '  '}${conv.title || 'Untitled'} (${this.formatDate(conv.updatedAt)})`,
        value: conv.id,
      }));

      // Add "New Chat" option at the top
      choices.unshift({
        name: '  ➕ New Chat',
        value: '__new__',
      });

      const selected = await select({
        message: 'Select conversation:',
        choices,
        loop: true,
      });

      if (selected === '__new__') {
        this.conversationProvider.startNewConversation();
        console.log('\n✨ Started new conversation\n');
      } else {
        this.conversationProvider.setConversationId(selected);
        const conv = conversations.find(c => c.id === selected);
        console.log(`\n📂 Switched to: ${conv?.title || 'Untitled'}`);

        // Display recent messages from the conversation
        this.displayConversationHistory(selected);
      }
    } catch (error) {
      // User cancelled (Ctrl+C or Escape)
      if ((error as Error).name === 'ExitPromptError') {
        console.log('\n');
        return;
      }
      throw error;
    }
  }

  private displayConversationHistory(conversationId: string): void {
    if (!this.conversationProvider) return;

    const messages = this.conversationProvider.getMessages(conversationId, 10);

    if (messages.length === 0) {
      console.log('  (No messages yet)\n');
      return;
    }

    console.log('\n--- Recent Messages ---');
    for (const msg of messages) {
      if (msg.role === 'user') {
        console.log(`\n👤 You: ${this.truncateMessage(msg.content)}`);
      } else if (msg.role === 'assistant') {
        console.log(`\n🤖 OllieBot: ${this.truncateMessage(msg.content)}`);
      }
      // Skip system and tool messages for cleaner display
    }
    console.log('\n-----------------------\n');
  }

  private truncateMessage(content: string, maxLength: number = 200): string {
    const stripped = this.stripMarkdown(content).replace(/\n/g, ' ').trim();
    if (stripped.length <= maxLength) return stripped;
    return stripped.slice(0, maxLength - 3) + '...';
  }

  private handleNewConversation(): void {
    if (!this.conversationProvider) {
      console.log('\n⚠️  Conversation management not available\n');
      return;
    }
    this.conversationProvider.startNewConversation();
    console.log('\n✨ Started new conversation\n');
  }

  private handleListConversations(): void {
    if (!this.conversationProvider) {
      console.log('\n⚠️  Conversation listing not available\n');
      return;
    }

    const conversations = this.conversationProvider.listConversations(10);
    const currentId = this.conversationProvider.getCurrentConversationId();

    if (conversations.length === 0) {
      console.log('\n📭 No conversations yet\n');
      return;
    }

    console.log('\n📋 Recent Conversations:');
    conversations.forEach((conv, i) => {
      const marker = conv.id === currentId ? '●' : ' ';
      const title = conv.title || 'Untitled';
      console.log(`  ${marker} ${i + 1}. ${title} (${this.formatDate(conv.updatedAt)})`);
    });
    console.log('\nPress / then select "switch" to change conversation\n');
  }

  private handleListTasks(): void {
    if (!this.systemProvider) {
      console.log('\n⚠️  Task listing not available\n');
      return;
    }

    const tasks = this.systemProvider.getTasks();

    if (tasks.length === 0) {
      console.log('\n📭 No scheduled tasks configured\n');
      return;
    }

    console.log('\n📋 Scheduled Tasks:');
    console.log('─'.repeat(60));

    for (const task of tasks) {
      const statusIcon = task.status === 'active' ? '🟢' : '⏸️';
      console.log(`\n${statusIcon} ${task.name}`);
      if (task.description) {
        console.log(`   ${task.description}`);
      }
      if (task.schedule) {
        console.log(`   📅 Schedule: ${task.schedule}`);
      }
      if (task.lastRun) {
        console.log(`   ⏱️  Last run: ${this.formatDate(task.lastRun)}`);
      }
      if (task.nextRun) {
        console.log(`   ⏭️  Next run: ${this.formatDate(task.nextRun)}`);
      }
    }
    console.log('\n' + '─'.repeat(60) + '\n');
  }

  private handleListTools(): void {
    if (!this.systemProvider) {
      console.log('\n⚠️  Tool listing not available\n');
      return;
    }

    const tools = this.systemProvider.getTools();
    const totalCount = tools.builtin.length + tools.user.length +
      Object.values(tools.mcp).reduce((sum, arr) => sum + arr.length, 0);

    console.log(`\n🔧 Available Tools (${totalCount} total):`);
    console.log('─'.repeat(60));

    // Built-in tools
    if (tools.builtin.length > 0) {
      console.log(`\n📦 Built-in (${tools.builtin.length}):`);
      for (const tool of tools.builtin) {
        console.log(`   • ${tool.name}`);
        if (tool.description) {
          const desc = tool.description.length > 50 ? tool.description.slice(0, 47) + '...' : tool.description;
          console.log(`     ${desc}`);
        }
      }
    }

    // User tools
    if (tools.user.length > 0) {
      console.log(`\n👤 User-defined (${tools.user.length}):`);
      for (const tool of tools.user) {
        console.log(`   • ${tool.name}`);
        if (tool.description) {
          const desc = tool.description.length > 50 ? tool.description.slice(0, 47) + '...' : tool.description;
          console.log(`     ${desc}`);
        }
      }
    }

    // MCP tools
    const mcpServers = Object.keys(tools.mcp);
    if (mcpServers.length > 0) {
      console.log(`\n🔌 MCP Tools:`);
      for (const serverName of mcpServers) {
        const serverTools = tools.mcp[serverName];
        console.log(`\n   ${serverName} (${serverTools.length} tools):`);
        for (const tool of serverTools.slice(0, 5)) {
          console.log(`     • ${tool.name}`);
        }
        if (serverTools.length > 5) {
          console.log(`     ... and ${serverTools.length - 5} more`);
        }
      }
    }

    console.log('\n' + '─'.repeat(60) + '\n');
  }

  private handleListMcp(): void {
    if (!this.systemProvider) {
      console.log('\n⚠️  MCP listing not available\n');
      return;
    }

    const servers = this.systemProvider.getMcpServers();

    if (servers.length === 0) {
      console.log('\n📭 No MCP servers configured\n');
      return;
    }

    console.log('\n🔌 MCP Servers:');
    console.log('─'.repeat(60));

    for (const server of servers) {
      const statusIcon = server.enabled ? '🟢' : '🔴';
      console.log(`\n${statusIcon} ${server.name}`);
      console.log(`   ID: ${server.id}`);
      console.log(`   Transport: ${server.transport}`);
      console.log(`   Tools: ${server.toolCount}`);
    }
    console.log('\n' + '─'.repeat(60) + '\n');
  }

  private showHelp(): void {
    console.log('\n📖 Commands (press / to access):');
    this.slashCommands.forEach(cmd => {
      const aliases = cmd.aliases.length > 0 ? ` (${cmd.aliases.map(a => '/' + a).join(', ')})` : '';
      console.log(`  /${cmd.name}${aliases} - ${cmd.description}`);
    });
    console.log('  exit - Quit OllieBot\n');
  }

  private formatDate(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  async send(content: string, options?: SendOptions): Promise<void> {
    // Format output for console
    let output = content;

    // Simple markdown stripping for console (basic implementation)
    if (!options?.markdown) {
      output = this.stripMarkdown(output);
    }

    console.log(`\n🤖 OllieBot: ${output}\n`);

    // Show action buttons if provided
    if (options?.buttons && options.buttons.length > 0) {
      console.log('Actions:');
      options.buttons.forEach((btn, i) => {
        console.log(`  [${i + 1}] ${btn.label}`);
      });
      console.log('');
    }
  }

  async sendError(error: string, details?: string): Promise<void> {
    console.log(`\n❌ Error: ${error}`);
    if (details) {
      console.log(`   Details: ${details}`);
    }
    console.log('');
  }

  async sendAsAgent(
    content: string,
    options?: { markdown?: boolean; agentName?: string; agentEmoji?: string }
  ): Promise<void> {
    const agentLabel = options?.agentEmoji && options?.agentName
      ? `${options.agentEmoji} ${options.agentName}`
      : '🤖 OllieBot';

    let output = content;
    if (!options?.markdown) {
      output = this.stripMarkdown(output);
    }

    console.log(`\n${agentLabel}: ${output}\n`);
  }

  // Streaming support
  startStream(streamId: string, agentInfo?: { agentId?: string; agentName?: string; agentEmoji?: string }): void {
    const agentLabel = agentInfo?.agentEmoji && agentInfo?.agentName
      ? `${agentInfo.agentEmoji} ${agentInfo.agentName}`
      : '🤖 OllieBot';
    this.activeStreams.set(streamId, { agentName: agentInfo?.agentName, agentEmoji: agentInfo?.agentEmoji });
    process.stdout.write(`\n${agentLabel}: `);
  }

  sendStreamChunk(streamId: string, chunk: string): void {
    if (this.activeStreams.has(streamId)) {
      process.stdout.write(chunk);
    }
  }

  endStream(streamId: string): void {
    if (this.activeStreams.has(streamId)) {
      this.activeStreams.delete(streamId);
      process.stdout.write('\n\n');
    }
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1') // bold
      .replace(/\*(.*?)\*/g, '$1') // italic
      .replace(/`(.*?)`/g, '$1') // code
      .replace(/#{1,6}\s/g, '') // headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // links
  }

  onMessage(handler: (message: Message) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onAction(handler: (action: string, data: unknown) => Promise<void>): void {
    this.actionHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async close(): Promise<void> {
    this.shouldStop = true;
    this.connected = false;
    if (this.rl) {
      this.rl.close();
    }
  }
}

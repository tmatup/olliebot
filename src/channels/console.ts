import { input } from '@inquirer/prompts';
import { v4 as uuid } from 'uuid';
import type { Channel, Message, SendOptions } from './types.js';

export class ConsoleChannel implements Channel {
  readonly id: string;
  readonly name = 'console';

  private messageHandler: ((message: Message) => Promise<void>) | null = null;
  private actionHandler: ((action: string, data: unknown) => Promise<void>) | null = null;
  private connected = false;
  private inputLoop: Promise<void> | null = null;
  private shouldStop = false;

  constructor(id: string = 'console-default') {
    this.id = id;
  }

  async init(): Promise<void> {
    this.connected = true;
    console.log('\n🤖 OllieBot Console Interface');
    console.log('Type your message and press Enter. Type "exit" to quit.\n');
    this.startInputLoop();
  }

  private startInputLoop(): void {
    this.inputLoop = this.runInputLoop();
  }

  private async runInputLoop(): Promise<void> {
    while (!this.shouldStop && this.connected) {
      try {
        const userInput = await input({
          message: 'You:',
          theme: {
            prefix: '',
          },
        });

        if (userInput.toLowerCase() === 'exit') {
          console.log('\nGoodbye! 👋\n');
          this.shouldStop = true;
          break;
        }

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
  }
}

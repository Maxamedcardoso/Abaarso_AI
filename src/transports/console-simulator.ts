import readline from 'readline';
import { IMessagingTransport, IncomingMessage, OutgoingMessageOptions, OutgoingMedia } from './transport.interface.js';

export class ConsoleSimulatorTransport implements IMessagingTransport {
  public readonly name = 'console_simulator';
  private connected: boolean = false;
  private messageHandler: ((message: IncomingMessage) => Promise<void>) | null = null;
  private rl: readline.Interface | null = null;
  private simulatedChatId: string = 'student_direct_chat';
  private simulatedSenderId: string = '252610000001';
  private isSimulatedGroup: boolean = false;
  private lastActivityTimestamp: number | null = null;

  public get isConnected(): boolean {
    return this.connected;
  }

  public async start(): Promise<void> {
    this.connected = true;
    this.lastActivityTimestamp = Date.now();
    console.log(`\n======================================================`);
    console.log(`  CARDOSO AI — Interactive Console Simulator Ready     `);
    console.log(`======================================================`);
    console.log(`Type any question in Somali or English.`);
    console.log(`Commands available:`);
    console.log(`  /group  - Toggle between Group and 1-to-1 Private chat mode`);
    console.log(`  /user <phone> - Switch simulated student ID`);
    console.log(`  !tirtir - Test Right-to-be-Forgotten deletion`);
    console.log(`  /quit   - Exit simulator\n`);
  }

  public startInteractiveCLI(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `[${this.isSimulatedGroup ? 'GROUP CHAT' : 'PRIVATE CHAT'} | ${this.simulatedSenderId}] > `,
    });

    this.rl.prompt();

    this.rl.on('line', async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl?.prompt();
        return;
      }

      if (trimmed === '/quit' || trimmed === '/exit') {
        console.log('Exiting simulator...');
        await this.stop();
        process.exit(0);
      }

      if (trimmed === '/group') {
        this.isSimulatedGroup = !this.isSimulatedGroup;
        this.simulatedChatId = this.isSimulatedGroup ? 'somali_student_group@g.us' : 'student_direct_chat';
        console.log(`Switched to: ${this.isSimulatedGroup ? 'GROUP CHAT' : 'PRIVATE CHAT'}`);
        this.rl?.setPrompt(`[${this.isSimulatedGroup ? 'GROUP CHAT' : 'PRIVATE CHAT'} | ${this.simulatedSenderId}] > `);
        this.rl?.prompt();
        return;
      }

      if (trimmed.startsWith('/user ')) {
        const newUser = trimmed.split(' ')[1];
        if (newUser) {
          this.simulatedSenderId = newUser;
          console.log(`Switched student user to: ${newUser}`);
          this.rl?.setPrompt(`[${this.isSimulatedGroup ? 'GROUP CHAT' : 'PRIVATE CHAT'} | ${this.simulatedSenderId}] > `);
        }
        this.rl?.prompt();
        return;
      }

      if (this.messageHandler) {
        const incoming: IncomingMessage = {
          id: `sim_msg_${Date.now()}`,
          senderId: this.simulatedSenderId,
          senderName: 'Simulated Student',
          chatId: this.simulatedChatId,
          isGroup: this.isSimulatedGroup,
          content: trimmed,
          rawTimestamp: Date.now(),
          isMentioned: trimmed.toLowerCase().includes('@cardoso') || trimmed.startsWith('!'),
        };

        await this.messageHandler(incoming);
      }

      this.rl?.prompt();
    });
  }

  public async stop(): Promise<void> {
    this.connected = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  public async sendMessage(chatId: string, text: string, options?: OutgoingMessageOptions): Promise<boolean> {
    this.lastActivityTimestamp = Date.now();
    console.log(`\n🤖 CARDOSO AI:\n${text}\n`);
    return true;
  }

  public async sendMedia(chatId: string, media: OutgoingMedia, options?: OutgoingMessageOptions): Promise<boolean> {
    this.lastActivityTimestamp = Date.now();
    const label = media.type === 'image' ? '🖼️ [AI GENERATED IMAGE]' : '🎙️ [AI VOICE NOTE]';
    console.log(`\n🤖 CARDOSO AI ${label}: ${media.dataBuffer.length} bytes${media.caption ? `\nCaption: ${media.caption}` : ''}\n`);
    return true;
  }

  public onMessage(handler: (message: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Programmatic injection for automated tests.
   */
  public async simulateMessage(message: Partial<IncomingMessage>): Promise<void> {
    if (!this.messageHandler) throw new Error('No message handler registered');

    const fullMessage: IncomingMessage = {
      id: message.id || `sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      senderId: message.senderId || '252610000001',
      senderName: message.senderName || 'Test Student',
      chatId: message.chatId || 'direct_test_chat',
      isGroup: message.isGroup ?? false,
      content: message.content || '',
      rawTimestamp: message.rawTimestamp || Date.now(),
      isMentioned: message.isMentioned ?? false,
      replyToMessageId: message.replyToMessageId,
    };

    await this.messageHandler(fullMessage);
  }

  public getStatus() {
    return {
      name: this.name,
      connected: this.connected,
      activeChats: 1,
      lastActivity: this.lastActivityTimestamp,
    };
  }
}


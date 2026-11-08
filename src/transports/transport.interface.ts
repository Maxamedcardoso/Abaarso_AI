export interface MessageMedia {
  type: 'image' | 'audio' | 'document';
  mimeType: string;
  dataBase64: string;
  fileName?: string;
}

/**
 * Standard incoming message representation across all transports
 */
export interface IncomingMessage {
  id: string;                    // Unique message ID (e.g. wamid.xxx or console-uuid)
  senderId: string;              // Student WhatsApp number or console ID
  senderName?: string;           // Push name / nickname if available
  chatId: string;                // Group JID or 1-to-1 conversation JID
  isGroup: boolean;              // True if originating from a group
  content: string;               // Clean text of the message
  rawTimestamp: number;          // Epoch timestamp in milliseconds
  isMentioned: boolean;          // True if the bot was explicitly @mentioned
  replyToMessageId?: string;     // If message is a quoted reply
  media?: MessageMedia;          // Attached image, audio voice note, or PDF document
}

/**
 * Standard outgoing message options
 */
export interface OutgoingMessageOptions {
  replyToMessageId?: string;
  isEphemeral?: boolean;
}

/**
 * Pluggable Messaging Transport Interface.
 * Decouples WhatsApp from AI and Student Advisor modules.
 */
export interface IMessagingTransport {
  readonly name: string;
  readonly isConnected: boolean;

  /**
   * Initializes and starts the transport connection
   */
  start(): Promise<void>;

  /**
   * Gracefully stops the transport
   */
  stop(): Promise<void>;

  /**
   * Sends a text message to a specific chat (1-to-1 or group)
   */
  sendMessage(chatId: string, text: string, options?: OutgoingMessageOptions): Promise<boolean>;

  /**
   * Registers a callback for incoming messages
   */
  onMessage(handler: (message: IncomingMessage) => Promise<void>): void;

  /**
   * Returns current transport connection and operational status
   */
  getStatus(): {
    name: string;
    connected: boolean;
    activeChats: number;
    lastActivity: number | null;
  };
}


export interface MessageMedia {
  type: 'image' | 'audio' | 'document' | 'video';
  mimeType: string;
  dataBase64: string;
  fileName?: string;
  isViewOnce?: boolean;
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
  isFromMe?: boolean;            // True if sent directly from the connected host WhatsApp account
  replyToMessageId?: string;     // If message is a quoted reply
  quotedMessageId?: string;      // ID of the message quoted by this message (if any)
  quotedParticipant?: string;    // Sender of the message quoted by this message (if any)
  mentionedJids?: string[];      // JIDs of participants @mentioned in this message
  media?: MessageMedia;          // Attached image, audio voice note, or PDF document
}

/**
 * Standard outgoing message options
 */
export interface OutgoingMessageOptions {
  replyToMessageId?: string;
  isEphemeral?: boolean;
  mentions?: string[];          // Participants to explicitly @mention/tag in the message
}

export interface OutgoingMedia {
  type: 'image' | 'audio' | 'document';
  dataBuffer: Buffer;
  mimeType: string;
  caption?: string;
  ptt?: boolean; // When true, rendered as authentic WhatsApp Voice Note
  fileName?: string;
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
   * Sends a media message (image, voice note audio) to a specific chat
   */
  sendMedia?(chatId: string, media: OutgoingMedia, options?: OutgoingMessageOptions): Promise<boolean>;

  /**
   * Posts a status/story update to WhatsApp (status@broadcast)
   */
  postStatus?(content: { text?: string; media?: OutgoingMedia; backgroundColor?: string; font?: number }): Promise<boolean>;

  /**
   * Deletes a message for everyone (revoke)
   */
  deleteMessage?(chatId: string, messageId: string, participant?: string): Promise<boolean>;

  /**
   * Reacts to a message with an emoji
   */
  reactToMessage?(chatId: string, messageId: string, emoji: string, participant?: string): Promise<boolean>;

  /**
   * Returns underlying socket or client instance if supported
   */
  getSocket?(): any;

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


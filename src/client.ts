import { TelegramClient, Api, Rich, utils } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { CustomFile } from 'teleproto/client/uploads.js';
import { clientParams } from './client-options.js';
import { isStrictChatResolution } from './resolve-mode.js';
import { generateRandomLong } from 'teleproto/Helpers.js';
import { computeCheck } from 'teleproto/Password.js';
import { getCredentials, getSessionString, setSessionString, isConfigured, loadConfig } from './config.js';
import bigInt from 'big-integer';
import { existsSync, mkdirSync, statSync } from 'fs';
import { isMock } from './paths.js';
import { basename, join } from 'path';

let clientInstance: TelegramClient | null = null;

export async function getClient(): Promise<TelegramClient> {
  if (clientInstance?.connected) {
    return clientInstance;
  }

  if (isMock()) {
    // Imported on demand so a normal run never loads the mock
    const { createMockClient } = await import('./mock/client.js');
    clientInstance = createMockClient();
    return clientInstance;
  }

  if (!isConfigured()) {
    throw new Error('Not configured. Run "telegram onboard" (guided login in the browser) or "telegram auth --qr" in a terminal.');
  }

  const { apiId, apiHash } = getCredentials();
  const sessionString = getSessionString() || '';
  const session = new StringSession(sessionString);

  // Logs go to stderr at ERROR unless TG_LOG_LEVEL says otherwise, so --json stays parseable.
  clientInstance = new TelegramClient(session, apiId, apiHash, clientParams());

  await clientInstance.connect();

  if (!await clientInstance.isUserAuthorized()) {
    const invited = loadConfig(() => {}).credentialSource === 'invite';
    throw new Error(
      invited
        ? 'Session expired or was revoked. Log in again: telegram logout && telegram auth --invite'
        : 'Not authenticated. Run "telegram onboard" or "telegram auth --qr" to log in.'
    );
  }

  return clientInstance;
}

export async function createClient(apiId: number, apiHash: string): Promise<TelegramClient> {
  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, clientParams());
  await client.connect();
  return client;
}

export async function saveSession(client: TelegramClient): Promise<void> {
  const sessionString = (client.session as StringSession).save();
  setSessionString(sessionString);
}

export async function disconnectClient(): Promise<void> {
  if (clientInstance) {
    try {
      // destroy() closes main connection AND any borrowed senders (e.g. file-download DC).
      // disconnect() leaves the secondary download-loop alive, which then throws TIMEOUT.
      await clientInstance.destroy();
    } catch {
      // ignore teardown noise
    }
    clientInstance = null;
  }
  resolvedChatCache.clear();
  dialogsCache = null;
}

// Cache resolved chat entities by identifier (normalized) to avoid re-fetching
// getDialogs({limit: 500}) on every call, which triggers FLOOD_WAIT on messages.GetDialogs.
const resolvedChatCache = new Map<string, ResolvedEntity>();

// One dialogs snapshot per process: resolving many chats (e.g. sync over 100 chats)
// must not refetch the full dialog list for every chat.
let dialogsCache: ReturnType<TelegramClient['getDialogs']> | null = null;

function getDialogsCached(client: TelegramClient): ReturnType<TelegramClient['getDialogs']> {
  if (!dialogsCache) {
    dialogsCache = client.getDialogs({ limit: 500 });
    dialogsCache.catch(() => { dialogsCache = null; });
  }
  return dialogsCache;
}

function cacheKey(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export async function getMe(client: TelegramClient): Promise<Api.User> {
  const me = await client.getMe();
  if (!me || !(me instanceof Api.User)) {
    throw new Error('Failed to get user info');
  }
  return me;
}

export interface ChatInfo {
  id: string;
  title: string;
  type: 'user' | 'group' | 'supergroup' | 'channel';
  username?: string;
  unreadCount: number;
  lastMessage?: string;
  lastMessageDate?: Date;
  muted?: boolean;
  archived?: boolean;
}

export async function getDialogs(
  client: TelegramClient,
  limit = 100,
  options: { archived?: boolean } = {}
): Promise<ChatInfo[]> {
  const dialogs = await client.getDialogs({ limit, archived: options.archived });
  const now = Math.floor(Date.now() / 1000);
  const chats: ChatInfo[] = [];

  for (const dialog of dialogs) {
    let type: ChatInfo['type'] = 'user';
    let title = dialog.title || 'Unknown';
    let username: string | undefined;

    if (dialog.isUser) {
      type = 'user';
      const entity = dialog.entity as Api.User;
      username = entity.username ?? undefined;
    } else if (dialog.entity instanceof Api.Channel) {
      // Check Channel first: GramJS reports megagroups as isGroup too
      type = dialog.entity.megagroup ? 'supergroup' : 'channel';
      username = dialog.entity.username ?? undefined;
    } else if (dialog.isGroup) {
      type = 'group';
    }

    chats.push({
      id: dialog.id?.toString() || '',
      title,
      type,
      username,
      unreadCount: dialog.unreadCount,
      lastMessage: dialog.message instanceof Api.Message ? messageText(dialog.message) : undefined,
      lastMessageDate: dialog.message?.date ? new Date(dialog.message.date * 1000) : undefined,
      muted: (dialog.dialog?.notifySettings?.muteUntil ?? 0) > now || undefined,
      archived: dialog.archived || undefined,
    });
  }

  return chats;
}

export type MediaKind =
  | 'photo'
  | 'document'
  | 'video'
  | 'audio'
  | 'voice'
  | 'video_note'
  | 'sticker'
  | 'gif';

export interface MediaInfo {
  kind: MediaKind;
  fileName?: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  hasSpoiler?: boolean;
}

export type ButtonType =
  | 'callback'
  | 'url'
  | 'text'
  | 'switch_inline'
  | 'switch_inline_current'
  | 'webview'
  | 'url_auth'
  | 'game'
  | 'buy'
  | 'copy'
  | 'request_phone'
  | 'request_geo'
  | 'request_poll'
  | 'request_peer'
  | 'user_profile'
  | 'unknown';

export interface ButtonInfo {
  /** 1-based flat index across all rows (what the user passes to `tg click`). */
  index: number;
  row: number;
  col: number;
  text: string;
  type: ButtonType;
  /** URL for url/webview/url_auth buttons. */
  url?: string;
  /** Query string for switch_inline buttons. */
  query?: string;
  /** base64 of the raw callback payload (display only — never round-tripped back for clicking). */
  data?: string;
  /** Text a copy button places on the clipboard. */
  copyText?: string;
  /** Callback button that needs the account 2FA password to press. */
  requiresPassword?: boolean;
}

export interface ButtonLayout {
  /** true = inline keyboard attached under the message; false = custom reply keyboard. */
  isInline: boolean;
  rows: ButtonInfo[][];
}

export interface MessageInfo {
  id: number;
  date: Date;
  sender: string;
  senderId?: string;
  text: string;
  replyToMsgId?: number;
  isOutgoing: boolean;
  media?: MediaInfo;
  buttons?: ButtonLayout;
  /** Set on results that span several chats (global search). */
  chatId?: string;
  chatTitle?: string;
  /** Comment/reply count for channel posts and thread roots. */
  replies?: number;
}

type RawButton = Api.KeyboardButton | Api.KeyboardInlineButton;

/**
 * Layer 229 (teleproto) models a button as `{ text, type }` where `type` is a
 * `ButtonType*` (reply keyboard) or `InlineButtonType*` (inline keyboard)
 * object, instead of one TL constructor per button kind as in GramJS layer 198.
 */
function classifyButton(btn: RawButton, index: number, row: number, col: number): ButtonInfo {
  const base = { index, row, col, text: btn.text || '' };
  const t: Api.TypeButtonType | Api.TypeInlineButtonType = btn.type;

  if (t instanceof Api.InlineButtonTypeCallback) {
    return { ...base, type: 'callback', data: Buffer.from(t.data).toString('base64'), requiresPassword: t.requiresPassword || undefined };
  }
  if (t instanceof Api.InlineButtonTypeUrl) {
    return { ...base, type: 'url', url: t.url };
  }
  if (t instanceof Api.InlineButtonTypeUrlAuth || t instanceof Api.InputInlineButtonTypeUrlAuth) {
    return { ...base, type: 'url_auth', url: t.url };
  }
  if (t instanceof Api.InlineButtonTypeWebView || t instanceof Api.ButtonTypeSimpleWebView) {
    return { ...base, type: 'webview', url: t.url };
  }
  if (t instanceof Api.InlineButtonTypeSwitchInline) {
    return { ...base, type: t.samePeer ? 'switch_inline_current' : 'switch_inline', query: t.query };
  }
  if (t instanceof Api.InlineButtonTypeGame) {
    return { ...base, type: 'game' };
  }
  if (t instanceof Api.InlineButtonTypeBuy) {
    return { ...base, type: 'buy' };
  }
  if (t instanceof Api.InlineButtonTypeCopy) {
    return { ...base, type: 'copy', copyText: t.copyText };
  }
  if (t instanceof Api.ButtonTypeRequestPhone) {
    return { ...base, type: 'request_phone' };
  }
  if (t instanceof Api.ButtonTypeRequestGeoLocation) {
    return { ...base, type: 'request_geo' };
  }
  if (t instanceof Api.ButtonTypeRequestPoll) {
    return { ...base, type: 'request_poll' };
  }
  if (t instanceof Api.ButtonTypeRequestPeer || t instanceof Api.InputButtonTypeRequestPeer) {
    return { ...base, type: 'request_peer' };
  }
  if (t instanceof Api.InlineButtonTypeUserProfile || t instanceof Api.InputInlineButtonTypeUserProfile) {
    return { ...base, type: 'user_profile' };
  }
  if (t instanceof Api.ButtonTypeDefault) {
    // Plain reply-keyboard button: pressing it sends its text as a message.
    return { ...base, type: 'text' };
  }
  return { ...base, type: 'unknown' };
}


/**
 * Plain text of a message. Since layer 228 bots (and Telegram clients) can send
 * "rich messages": `message` is then empty and the content is a block tree in
 * `richMessage` (headings, bold, mentions, lists…). Render it to plain text so
 * `read`/`search`/`watch`/`click` show the actual reply instead of "(no text)".
 */
export function messageText(msg: Api.Message): string {
  if (msg.message) return msg.message;
  if (msg.richMessage) {
    try {
      return Rich.toPlainText(msg.richMessage).trim();
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Sender name/id without an extra round-trip: teleproto attaches the entities
 * returned with the message, so `msg.sender` is usually already resolved. In a
 * private chat an incoming message has no `fromId` (the peer is the sender),
 * which the old `fromId`-only lookup reported as "Unknown".
 */
async function resolveSender(client: TelegramClient, msg: Api.Message): Promise<{ sender: string; senderId?: string }> {
  let entity: unknown = msg.sender ?? undefined;
  if (!entity) {
    // Channel posts have no fromId: the channel itself is the sender
    const ref = msg.out ? undefined : (msg.fromId ?? (msg.peerId instanceof Api.PeerChat ? undefined : msg.peerId));
    if (ref) {
      try {
        entity = await client.getEntity(ref);
      } catch {
        // Ignore entity resolution errors
      }
    }
  }
  if (entity instanceof Api.User) {
    return { sender: entity.firstName || entity.username || 'Unknown', senderId: entity.id.toString() };
  }
  if (entity instanceof Api.Channel || entity instanceof Api.Chat) {
    return { sender: entity.title || 'Unknown', senderId: entity.id.toString() };
  }
  return { sender: msg.out ? 'You' : 'Unknown' };
}

/** Build a display-friendly button layout from a message's reply markup. */
export function extractButtons(msg: Api.Message): ButtonLayout | undefined {
  const markup = msg.replyMarkup;
  if (!(markup instanceof Api.ReplyInlineMarkup) && !(markup instanceof Api.ReplyKeyboardMarkup)) {
    return undefined;
  }

  const isInline = markup instanceof Api.ReplyInlineMarkup;
  const rows: ButtonInfo[][] = [];
  let flatIndex = 0;

  markup.rows.forEach((row, rowIdx) => {
    const parsedRow: ButtonInfo[] = [];
    row.buttons.forEach((btn, colIdx) => {
      flatIndex += 1;
      parsedRow.push(classifyButton(btn, flatIndex, rowIdx, colIdx));
    });
    rows.push(parsedRow);
  });

  return { isInline, rows };
}

function extractMediaInfo(msg: Api.Message): MediaInfo | undefined {
  const media = msg.media;
  if (!media) return undefined;

  if (media instanceof Api.MessageMediaPhoto) {
    const info: MediaInfo = { kind: 'photo' };
    if (media.spoiler) info.hasSpoiler = true;
    return info;
  }

  if (media instanceof Api.MessageMediaDocument) {
    const doc = media.document;
    if (!(doc instanceof Api.Document)) {
      return { kind: 'document' };
    }

    let kind: MediaKind = 'document';
    let fileName: string | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let duration: number | undefined;

    for (const attr of doc.attributes) {
      if (attr instanceof Api.DocumentAttributeFilename) {
        fileName = attr.fileName;
      } else if (attr instanceof Api.DocumentAttributeVideo) {
        kind = attr.roundMessage ? 'video_note' : 'video';
        width = attr.w;
        height = attr.h;
        duration = Math.round(attr.duration);
      } else if (attr instanceof Api.DocumentAttributeAudio) {
        kind = attr.voice ? 'voice' : 'audio';
        duration = attr.duration;
      } else if (attr instanceof Api.DocumentAttributeAnimated) {
        kind = 'gif';
      } else if (attr instanceof Api.DocumentAttributeSticker) {
        kind = 'sticker';
      }
    }

    // Document size is `long` (big-integer). Convert safely.
    let size: number | undefined;
    try {
      const sizeNum = typeof (doc.size as unknown as { toJSNumber?: () => number }).toJSNumber === 'function'
        ? (doc.size as unknown as { toJSNumber: () => number }).toJSNumber()
        : Number(doc.size as unknown as number);
      if (Number.isFinite(sizeNum)) size = sizeNum;
    } catch {
      // ignore
    }

    return {
      kind,
      fileName,
      mimeType: doc.mimeType || undefined,
      size,
      width,
      height,
      duration,
      hasSpoiler: media.spoiler ? true : undefined,
    };
  }

  return undefined;
}

export function parseTimeOffset(offset: string): Date {
  const now = new Date();
  const match = offset.match(/^(\d+)([mhdw])$/);
  if (!match) {
    // Absolute dates: "2026-09-01", "2026-09-01T12:00"
    const abs = Date.parse(offset);
    if (!Number.isNaN(abs)) return new Date(abs);
    throw new Error(`Invalid time: ${offset}. Use "30m", "1h", "7d", "2w" or a date like "2026-09-01"`);
  }
  const value = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case 'm': return new Date(now.getTime() - value * 60 * 1000);
    case 'h': return new Date(now.getTime() - value * 60 * 60 * 1000);
    case 'd': return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    case 'w': return new Date(now.getTime() - value * 7 * 24 * 60 * 60 * 1000);
    default: throw new Error(`Unknown time unit: ${unit}`);
  }
}

/** Convert a raw message into the CLI's MessageInfo shape. */
export async function toMessageInfo(client: TelegramClient, msg: Api.Message): Promise<MessageInfo> {
  const { sender, senderId } = await resolveSender(client, msg);
  return {
    id: msg.id,
    date: new Date(msg.date * 1000),
    sender,
    senderId,
    text: messageText(msg),
    replyToMsgId: msg.replyTo?.replyToMsgId,
    isOutgoing: msg.out ?? false,
    media: extractMediaInfo(msg),
    buttons: extractButtons(msg),
    replies: msg.replies?.replies || undefined,
  };
}

export interface GetMessagesOptions {
  limit?: number;
  /** Only messages older than this ID (exclusive). */
  offsetId?: number;
  /** Only messages newer than this ID (exclusive). */
  minId?: number;
  minDate?: Date;
  maxDate?: Date;
  /** Only messages sent by this user (@username, ID, or "me"). */
  from?: string;
  /** Read the replies thread of this message (channel post comments or a forum topic ID). */
  thread?: number;
}

export async function getMessages(
  client: TelegramClient,
  chatIdentifier: string,
  options: GetMessagesOptions = {}
): Promise<{ messages: MessageInfo[]; chatTitle: string; threadChatId?: string }> {
  const { limit = 50, offsetId, minDate, maxDate, minId, from, thread } = options;
  let threadChatId: string | undefined;

  // Find the chat by name or username
  const entity = await resolveChat(client, chatIdentifier);
  const chatTitle = getChatTitle(entity);
  const fromUser = from ? await resolveChat(client, from) : undefined;

  const messages: MessageInfo[] = [];
  const BATCH_SIZE = 100;

  let currentOffsetId = offsetId;
  let firstBatch = true;

  // Page backwards (newest first) until we have `limit` messages, cross minDate,
  // or run out of history.
  while (messages.length < limit) {
    const batchLimit = Math.min(BATCH_SIZE, limit - messages.length + 50);
    const offsetDate = !currentOffsetId && firstBatch && maxDate ? Math.floor(maxDate.getTime() / 1000) : undefined;

    let batch: Api.TypeMessage[];
    if (thread) {
      // teleproto's iterMessages has no replyTo, so page messages.GetReplies directly
      const res = await client.invoke(
        new Api.messages.GetReplies({
          peer: entity,
          msgId: thread,
          offsetId: currentOffsetId ?? 0,
          offsetDate: offsetDate ?? 0,
          addOffset: 0,
          limit: batchLimit,
          maxId: 0,
          minId: minId ?? 0,
          hash: bigInt(0),
        })
      );
      batch = 'messages' in res ? res.messages : [];
      // Channel comments live in the linked discussion group: report its ID so
      // callers can reply there
      const first = batch.find((m): m is Api.Message => m instanceof Api.Message);
      if (first && !threadChatId) {
        const peerId = utils.getPeerId(first.peerId).toString();
        if (peerId !== utils.getPeerId(entity).toString()) threadChatId = peerId;
      }
    } else {
      const params: { limit: number; offsetId?: number; offsetDate?: number; minId?: number; fromUser?: ResolvedEntity } = { limit: batchLimit };
      if (currentOffsetId) params.offsetId = currentOffsetId;
      else if (offsetDate) params.offsetDate = offsetDate;
      if (minId) params.minId = minId;
      if (fromUser) params.fromUser = fromUser;
      batch = await client.getMessages(entity, params);
    }
    firstBatch = false;
    if (batch.length === 0) break;

    let reachedMinDate = false;

    for (const msg of batch) {
      if (!(msg instanceof Api.Message)) continue;
      // GetReplies has no sender filter, so apply --from client-side for threads
      if (thread && fromUser && !(msg.fromId instanceof Api.PeerUser && msg.fromId.userId.equals(fromUser.id))) continue;

      const msgDate = new Date(msg.date * 1000);
      if (maxDate && msgDate > maxDate) continue;
      if (minDate && msgDate < minDate) {
        reachedMinDate = true;
        break;
      }
      if (messages.length >= limit) break;

      messages.push(await toMessageInfo(client, msg));
    }

    if (reachedMinDate) break;
    if (messages.length >= limit) break;

    // Page by the oldest Api.Message in the batch: Telegram mixes MessageService /
    // MessageEmpty items into raw batches, and paging by batch[batch.length - 1]
    // silently stops as soon as the oldest raw item is a service message.
    let oldestMessageInBatch: Api.Message | null = null;
    for (let i = batch.length - 1; i >= 0; i--) {
      const candidate = batch[i];
      if (candidate instanceof Api.Message) {
        oldestMessageInBatch = candidate;
        break;
      }
    }
    if (!oldestMessageInBatch) break; // batch was all service messages
    if (currentOffsetId === oldestMessageInBatch.id) break; // no progress
    currentOffsetId = oldestMessageInBatch.id;

    // If batch was smaller than requested, no more messages
    if (batch.length < batchLimit) break;
  }

  return { messages, chatTitle, threadChatId };
}

/** Fetch specific messages by ID (missing/deleted IDs are skipped). */
export async function getMessagesByIds(
  client: TelegramClient,
  chatIdentifier: string,
  ids: number[]
): Promise<{ messages: MessageInfo[]; chatTitle: string; missing: number[] }> {
  const entity = await resolveChat(client, chatIdentifier);
  const raw = await client.getMessages(entity, { ids });
  const messages: MessageInfo[] = [];
  const found = new Set<number>();
  for (const msg of raw) {
    if (msg instanceof Api.Message) {
      messages.push(await toMessageInfo(client, msg));
      found.add(msg.id);
    }
  }
  return { messages, chatTitle: getChatTitle(entity), missing: ids.filter(id => !found.has(id)) };
}

export async function downloadMessageMedia(
  client: TelegramClient,
  chatIdentifier: string,
  messageId: number,
  outputDir: string
): Promise<{ filePath: string; media: MediaInfo } | null> {
  const entity = await resolveChat(client, chatIdentifier);

  const msgs = await client.getMessages(entity, { ids: [messageId] });
  const msg = msgs[0];

  if (!(msg instanceof Api.Message) || !msg.media) {
    return null;
  }

  const mediaInfo = extractMediaInfo(msg);
  if (!mediaInfo) return null;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const fileName = buildMediaFilename(mediaInfo, msg.id);
  const filePath = join(outputDir, fileName);

  const result = await client.downloadMedia(msg, { outputFile: filePath });
  // downloadMedia returns the path/Buffer; when outputFile is a string, file is written there.
  const savedPath = typeof result === 'string' ? result : filePath;

  return { filePath: savedPath, media: mediaInfo };
}

export function buildMediaFilename(media: MediaInfo, messageId: number): string {
  if (media.fileName) {
    // Prefix with message ID to guarantee uniqueness across chat.
    return `${messageId}_${sanitizeFilename(media.fileName)}`;
  }

  const ext = guessExtension(media);
  return `${messageId}_${media.kind}${ext}`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>\x00-\x1f]/g, '_');
}

function guessExtension(media: MediaInfo): string {
  if (media.mimeType) {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'video/webm': '.webm',
      'audio/mpeg': '.mp3',
      'audio/ogg': '.ogg',
      'audio/mp4': '.m4a',
      'application/pdf': '.pdf',
      'application/zip': '.zip',
    };
    if (map[media.mimeType]) return map[media.mimeType];
    const match = media.mimeType.match(/\/([a-zA-Z0-9.+-]+)$/);
    if (match) return `.${match[1].replace(/\+.*$/, '')}`;
  }
  if (media.kind === 'photo') return '.jpg';
  if (media.kind === 'voice') return '.ogg';
  if (media.kind === 'video' || media.kind === 'video_note' || media.kind === 'gif') return '.mp4';
  if (media.kind === 'audio') return '.mp3';
  if (media.kind === 'sticker') return '.webp';
  return '.bin';
}

export async function sendFileMessage(
  client: TelegramClient,
  chatIdentifier: string,
  filePath: string,
  options: {
    caption?: string;
    asDocument?: boolean;
    replyToMsgId?: number;
    parseMode?: 'html' | 'md';
    silent?: boolean;
    topic?: number;
  } = {}
): Promise<Api.Message> {
  const entity = await resolveChat(client, chatIdentifier);

  const replyTo = options.topic
    ? new Api.InputReplyToMessage({ replyToMsgId: options.replyToMsgId ?? options.topic, topMsgId: options.topic })
    : options.replyToMsgId;

  const result = await client.sendFile(entity, {
    file: filePath,
    caption: options.caption,
    forceDocument: options.asDocument,
    replyTo,
    parseMode: options.parseMode,
    silent: options.silent,
  });

  return result;
}

const SEARCH_FILTERS: Record<string, () => Api.TypeMessagesFilter> = {
  photo: () => new Api.InputMessagesFilterPhotos(),
  video: () => new Api.InputMessagesFilterVideo(),
  media: () => new Api.InputMessagesFilterPhotoVideo(),
  document: () => new Api.InputMessagesFilterDocument(),
  url: () => new Api.InputMessagesFilterUrl(),
  voice: () => new Api.InputMessagesFilterVoice(),
  audio: () => new Api.InputMessagesFilterMusic(),
  gif: () => new Api.InputMessagesFilterGif(),
  round: () => new Api.InputMessagesFilterRoundVideo(),
  location: () => new Api.InputMessagesFilterGeo(),
  contact: () => new Api.InputMessagesFilterContacts(),
  pinned: () => new Api.InputMessagesFilterPinned(),
  mentions: () => new Api.InputMessagesFilterMyMentions(),
};

export const SEARCH_TYPES = Object.keys(SEARCH_FILTERS);

export interface SearchOptions {
  chat?: string;
  limit?: number;
  minDate?: Date;
  maxDate?: Date;
  /** Sender filter (@username, ID or "me"); requires `chat`. */
  from?: string;
  /** One of SEARCH_TYPES. */
  type?: string;
}

function peerTitle(peer: Api.TypePeer, chats: Api.TypeChat[], users: Api.TypeUser[]): string | undefined {
  if (peer instanceof Api.PeerUser) {
    const u = users.find((x): x is Api.User => x instanceof Api.User && x.id.equals(peer.userId));
    return u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || undefined : undefined;
  }
  const id = peer instanceof Api.PeerChat ? peer.chatId : peer instanceof Api.PeerChannel ? peer.channelId : undefined;
  const c = id ? chats.find(x => 'id' in x && x.id.equals(id)) : undefined;
  return c && 'title' in c ? c.title : undefined;
}

export async function searchMessages(
  client: TelegramClient,
  query: string,
  options: SearchOptions = {}
): Promise<{ messages: MessageInfo[]; chatTitle?: string }[]> {
  const { chat, limit = 50, minDate, maxDate, from, type } = options;
  if (type && !SEARCH_FILTERS[type]) {
    throw new Error(`Unknown --type "${type}". Use one of: ${SEARCH_TYPES.join(', ')}`);
  }
  if (from && !chat) {
    throw new Error('--from needs --chat (Telegram global search cannot filter by sender)');
  }
  const filter = type ? SEARCH_FILTERS[type]() : new Api.InputMessagesFilterEmpty();
  const minTs = minDate ? Math.floor(minDate.getTime() / 1000) : 0;
  const maxTs = maxDate ? Math.floor(maxDate.getTime() / 1000) : 0;

  if (chat) {
    const entity = await resolveChat(client, chat);
    const fromId = from ? await resolveChat(client, from) : undefined;

    const res = await client.invoke(
      new Api.messages.Search({
        peer: entity,
        q: query,
        fromId,
        filter,
        minDate: minTs,
        maxDate: maxTs,
        offsetId: 0,
        addOffset: 0,
        limit,
        maxId: 0,
        minId: 0,
        hash: bigInt(0),
      })
    );

    const messages: MessageInfo[] = [];
    if ('messages' in res) {
      for (const msg of res.messages) {
        if (msg instanceof Api.Message) messages.push(await toMessageInfo(client, msg));
      }
    }
    return [{ messages, chatTitle: getChatTitle(entity) }];
  }

  // Global search: results span chats, so tag each message with its chat
  const res = await client.invoke(
    new Api.messages.SearchGlobal({
      q: query,
      filter,
      minDate: minTs,
      maxDate: maxTs,
      offsetRate: 0,
      offsetPeer: new Api.InputPeerEmpty(),
      offsetId: 0,
      limit,
    })
  );

  const messages: MessageInfo[] = [];
  if ('messages' in res) {
    for (const msg of res.messages) {
      if (!(msg instanceof Api.Message)) continue;
      const info = await toMessageInfo(client, msg);
      info.chatId = utils.getPeerId(msg.peerId).toString();
      info.chatTitle = peerTitle(msg.peerId, res.chats, res.users);
      messages.push(info);
    }
  }
  return [{ messages }];
}

export async function sendMessage(
  client: TelegramClient,
  chatIdentifier: string,
  text: string,
  replyToMsgId?: number,
  options: { parseMode?: 'html' | 'md'; schedule?: number; silent?: boolean; topic?: number } = {}
): Promise<Api.Message> {
  const entity = await resolveChat(client, chatIdentifier);

  // Forum topics: the topic's root message is the thread; replies inside it keep topMsgId
  const replyTo = options.topic
    ? new Api.InputReplyToMessage({ replyToMsgId: replyToMsgId ?? options.topic, topMsgId: options.topic })
    : replyToMsgId;

  const result = await client.sendMessage(entity, {
    message: text,
    replyTo,
    parseMode: options.parseMode,
    schedule: options.schedule,
    silent: options.silent,
  });

  return result;
}

export async function getContactInfo(
  client: TelegramClient,
  identifier: string
): Promise<{
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
  bio?: string;
  isBot: boolean;
  isMutualContact: boolean;
}> {
  const entity = await client.getEntity(identifier);

  if (!(entity instanceof Api.User)) {
    throw new Error('Not a user');
  }

  let bio: string | undefined;
  try {
    const fullUser = await client.invoke(
      new Api.users.GetFullUser({ id: entity })
    );
    bio = fullUser.fullUser.about ?? undefined;
  } catch {
    // Ignore
  }

  return {
    id: entity.id.toString(),
    firstName: entity.firstName ?? undefined,
    lastName: entity.lastName ?? undefined,
    username: entity.username ?? undefined,
    phone: entity.phone ?? undefined,
    bio,
    isBot: entity.bot ?? false,
    isMutualContact: entity.mutualContact ?? false,
  };
}

export async function getChatMembers(
  client: TelegramClient,
  chatIdentifier: string,
  options: { adminsOnly?: boolean; limit?: number; query?: string } = {}
): Promise<{ id: string; name: string; username?: string; isAdmin: boolean }[]> {
  const { adminsOnly = false, limit = 200, query } = options;
  const all = await getChatMembersUnfiltered(client, chatIdentifier, { adminsOnly, limit, query });
  if (!query) return all;
  // Server-side search only covers supergroups; basic groups are filtered here
  const q = query.toLowerCase();
  return all.filter(m => m.name.toLowerCase().includes(q) || m.username?.toLowerCase().includes(q));
}

async function getChatMembersUnfiltered(
  client: TelegramClient,
  chatIdentifier: string,
  options: { adminsOnly: boolean; limit: number; query?: string }
): Promise<{ id: string; name: string; username?: string; isAdmin: boolean }[]> {
  const { adminsOnly, limit, query } = options;
  const entity = await resolveChat(client, chatIdentifier);

  if (entity instanceof Api.Channel) {
    const filter = adminsOnly
      ? new Api.ChannelParticipantsAdmins()
      : query
        ? new Api.ChannelParticipantsSearch({ q: query })
        : new Api.ChannelParticipantsRecent();

    const result = await client.invoke(
      new Api.channels.GetParticipants({
        channel: entity,
        filter,
        offset: 0,
        limit,
        hash: bigInt(0),
      })
    );

    if (!(result instanceof Api.channels.ChannelParticipants)) {
      return [];
    }

    const members: { id: string; name: string; username?: string; isAdmin: boolean }[] = [];

    for (const participant of result.participants) {
      const userId = 'userId' in participant ? participant.userId : null;
      if (!userId) continue;

      const user = result.users.find(
        (u): u is Api.User => u instanceof Api.User && u.id.equals(userId)
      );

      if (user) {
        const isAdmin = participant instanceof Api.ChannelParticipantAdmin ||
                       participant instanceof Api.ChannelParticipantCreator;

        members.push({
          id: user.id.toString(),
          name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Unknown',
          username: user.username ?? undefined,
          isAdmin,
        });
      }
    }

    return members;
  } else if (entity instanceof Api.Chat) {
    const fullChat = await client.invoke(
      new Api.messages.GetFullChat({ chatId: entity.id })
    );

    if (!('fullChat' in fullChat) || !(fullChat.fullChat instanceof Api.ChatFull)) {
      return [];
    }

    const members: { id: string; name: string; username?: string; isAdmin: boolean }[] = [];

    if (fullChat.fullChat.participants instanceof Api.ChatParticipants) {
      for (const participant of fullChat.fullChat.participants.participants) {
        const userId = participant.userId;
        const user = fullChat.users.find(
          (u): u is Api.User => u instanceof Api.User && u.id.equals(userId)
        );

        if (user) {
          const isAdmin = participant instanceof Api.ChatParticipantAdmin ||
                         participant instanceof Api.ChatParticipantCreator;

          if (!adminsOnly || isAdmin) {
            members.push({
              id: user.id.toString(),
              name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Unknown',
              username: user.username ?? undefined,
              isAdmin,
            });
          }
        }
      }
    }

    return members;
  }

  throw new Error('Not a group chat');
}

export async function getAdminGroups(client: TelegramClient): Promise<ChatInfo[]> {
  const dialogs = await getDialogsCached(client);
  const adminGroups: ChatInfo[] = [];

  for (const dialog of dialogs) {
    if (dialog.isGroup || dialog.isChannel) {
      const entity = dialog.entity;

      if (entity instanceof Api.Channel) {
        if (entity.adminRights || entity.creator) {
          adminGroups.push({
            id: dialog.id?.toString() || '',
            title: dialog.title || 'Unknown',
            type: entity.megagroup ? 'supergroup' : 'channel',
            username: entity.username ?? undefined,
            unreadCount: dialog.unreadCount,
          });
        }
      } else if (entity instanceof Api.Chat) {
        // For regular groups, we need to check participants
        try {
          const fullChat = await client.invoke(
            new Api.messages.GetFullChat({ chatId: entity.id })
          );

          const me = await client.getMe() as Api.User;

          if ('fullChat' in fullChat && fullChat.fullChat instanceof Api.ChatFull) {
            if (fullChat.fullChat.participants instanceof Api.ChatParticipants) {
              const myParticipant = fullChat.fullChat.participants.participants.find(
                p => p.userId.equals(me.id)
              );

              if (myParticipant instanceof Api.ChatParticipantAdmin ||
                  myParticipant instanceof Api.ChatParticipantCreator) {
                adminGroups.push({
                  id: dialog.id?.toString() || '',
                  title: dialog.title || 'Unknown',
                  type: 'group',
                  unreadCount: dialog.unreadCount,
                });
              }
            }
          }
        } catch {
          // Skip if we can't get chat info
        }
      }
    }
  }

  return adminGroups;
}

export type ResolvedEntity = Api.User | Api.Chat | Api.Channel;

export async function resolveChat(client: TelegramClient, identifier: string): Promise<ResolvedEntity> {
  const key = `${isStrictChatResolution() ? 'strict:' : ''}${cacheKey(identifier)}`;
  const cached = resolvedChatCache.get(key);
  if (cached) return cached;

  const entity = await resolveChatUncached(client, identifier);
  resolvedChatCache.set(key, entity);
  return entity;
}

const SELF_ALIASES = new Set(['me', 'self', 'saved', 'saved messages', 'избранное']);

async function resolveChatUncached(client: TelegramClient, identifier: string): Promise<ResolvedEntity> {
  // Saved Messages: resolve to our own user before any title matching, otherwise
  // "me" substring-matches arbitrary chat titles ("Game", "Meetup", ...).
  if (SELF_ALIASES.has(identifier.trim().toLowerCase())) {
    return await client.getMe();
  }

  // Check if it's a username (starts with @)
  if (identifier.startsWith('@')) {
    const entity = await client.getEntity(identifier);
    if (entity instanceof Api.User || entity instanceof Api.Chat || entity instanceof Api.Channel) {
      return entity;
    }
    throw new Error(`Invalid entity type for: ${identifier}`);
  }

  const dialogs = await getDialogsCached(client);
  const isNumericId = /^-?\d+$/.test(identifier);

  let dialog;
  if (isNumericId) {
    // Numeric IDs are matched against dialog peer IDs, never against titles
    dialog = dialogs.find(d => d.id?.toString() === identifier);
  } else {
    const needle = identifier.trim().toLowerCase();
    const exact = dialogs.filter(d => d.title?.trim().toLowerCase() === needle);
    if (isStrictChatResolution()) {
      // Writes: exactly one exact title, or refuse with the candidates
      if (exact.length > 1) {
        throw new Error(`"${identifier}" matches ${exact.length} chats; use an ID:\n${describeCandidates(exact)}`);
      }
      dialog = exact[0];
      if (!dialog) {
        const partial = dialogs.filter(d => d.title?.toLowerCase().includes(needle));
        if (partial.length) {
          throw new Error(
            `No chat is titled exactly "${identifier}". Writes need an ID, @username or the exact title. Did you mean:\n${describeCandidates(partial)}`,
          );
        }
      }
    } else {
      // Reads: exact title first, then partial match
      dialog = exact[0] ?? dialogs.find(d => d.title?.toLowerCase().includes(needle));
    }
  }

  if (dialog && dialog.entity) {
    const entity = dialog.entity;
    if (entity instanceof Api.User || entity instanceof Api.Chat || entity instanceof Api.Channel) {
      return entity;
    }
  }

  // Try as a direct entity identifier
  try {
    const entity = await client.getEntity(isNumericId ? bigInt(identifier) : identifier);
    if (entity instanceof Api.User || entity instanceof Api.Chat || entity instanceof Api.Channel) {
      return entity;
    }
    throw new Error(`Invalid entity type for: ${identifier}`);
  } catch {
    throw new Error(`Chat not found: ${identifier}`);
  }
}

function describeCandidates(dialogs: Awaited<ReturnType<TelegramClient['getDialogs']>>): string {
  const lines = dialogs.slice(0, 5).map(d => {
    const kind = d.isUser ? 'user' : d.isChannel ? ((d.entity as Api.Channel)?.megagroup ? 'supergroup' : 'channel') : 'group';
    const username = (d.entity as { username?: string } | undefined)?.username;
    return `  ${d.id} ${kind} ${d.title}${username ? ` @${username}` : ''}`;
  });
  if (dialogs.length > 5) lines.push(`  … and ${dialogs.length - 5} more`);
  return lines.join('\n');
}

function getChatTitle(entity: ResolvedEntity): string {
  if (entity instanceof Api.User) {
    return entity.firstName || entity.username || 'Unknown';
  }
  if (entity instanceof Api.Chat || entity instanceof Api.Channel) {
    return entity.title;
  }
  return 'Unknown';
}

// --- Mute/Unmute Functions ---

const MAX_INT32 = 2147483647;

export function parseDuration(duration: string): { seconds: number; isForever: boolean } {
  if (duration === 'forever') {
    return { seconds: 0, isForever: true };
  }

  const match = duration.match(/^(\d+)(m|h|d|w)$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use formats like 1h, 8h, 1d, 1w, or "forever"`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  let seconds: number;
  switch (unit) {
    case 'm': seconds = value * 60; break;
    case 'h': seconds = value * 3600; break;
    case 'd': seconds = value * 86400; break;
    case 'w': seconds = value * 604800; break;
    default: throw new Error(`Unknown duration unit: ${unit}`);
  }

  return { seconds, isForever: false };
}

// Keep for backward compatibility
export function parseDurationToSeconds(duration: string): number {
  if (duration === 'forever') {
    return MAX_INT32;
  }
  return parseDuration(duration).seconds;
}

export async function muteChat(
  client: TelegramClient,
  chatIdentifier: string,
  duration: string = 'forever'
): Promise<{ success: boolean; message: string }> {
  const chat = await resolveChat(client, chatIdentifier);
  const chatTitle = getChatTitle(chat);

  let inputPeer: Api.TypeInputNotifyPeer;
  if (chat instanceof Api.User) {
    inputPeer = new Api.InputNotifyPeer({
      peer: new Api.InputPeerUser({ userId: chat.id, accessHash: chat.accessHash || bigInt(0) })
    });
  } else if (chat instanceof Api.Chat) {
    inputPeer = new Api.InputNotifyPeer({
      peer: new Api.InputPeerChat({ chatId: chat.id })
    });
  } else if (chat instanceof Api.Channel) {
    inputPeer = new Api.InputNotifyPeer({
      peer: new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash || bigInt(0) })
    });
  } else {
    return { success: false, message: 'Unknown chat type' };
  }

  try {
    const parsed = parseDuration(duration);
    // For "forever", use MAX_INT32 directly; otherwise add seconds to current time
    const muteUntil = parsed.isForever
      ? MAX_INT32
      : Math.floor(Date.now() / 1000) + parsed.seconds;

    await client.invoke(
      new Api.account.UpdateNotifySettings({
        // teleproto types this as EntityLike; its resolver passes a ready InputNotifyPeer through unchanged.
        peer: inputPeer as unknown as Api.TypeEntityLike,
        settings: new Api.InputPeerNotifySettings({
          muteUntil,
        }),
      })
    );

    const durationText = duration === 'forever' ? 'forever' : `for ${duration}`;
    return { success: true, message: `Muted "${chatTitle}" ${durationText}` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, message: msg };
  }
}

export async function unmuteChat(
  client: TelegramClient,
  chatIdentifier: string
): Promise<{ success: boolean; message: string }> {
  const chat = await resolveChat(client, chatIdentifier);
  const chatTitle = getChatTitle(chat);

  let inputPeer: Api.TypeInputNotifyPeer;
  if (chat instanceof Api.User) {
    inputPeer = new Api.InputNotifyPeer({
      peer: new Api.InputPeerUser({ userId: chat.id, accessHash: chat.accessHash || bigInt(0) })
    });
  } else if (chat instanceof Api.Chat) {
    inputPeer = new Api.InputNotifyPeer({
      peer: new Api.InputPeerChat({ chatId: chat.id })
    });
  } else if (chat instanceof Api.Channel) {
    inputPeer = new Api.InputNotifyPeer({
      peer: new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash || bigInt(0) })
    });
  } else {
    return { success: false, message: 'Unknown chat type' };
  }

  try {
    await client.invoke(
      new Api.account.UpdateNotifySettings({
        // teleproto types this as EntityLike; its resolver passes a ready InputNotifyPeer through unchanged.
        peer: inputPeer as unknown as Api.TypeEntityLike,
        settings: new Api.InputPeerNotifySettings({
          muteUntil: 0,
        }),
      })
    );

    return { success: true, message: `Unmuted "${chatTitle}"` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, message: msg };
  }
}

// --- Folder Functions ---

export interface FolderInfo {
  id: number;
  title: string;
  includedChats: { id: string; title: string; type: string }[];
  excludedChats: { id: string; title: string; type: string }[];
  emoticon?: string;
}

export async function getFolders(client: TelegramClient): Promise<FolderInfo[]> {
  const result = await client.invoke(new Api.messages.GetDialogFilters());

  const folders: FolderInfo[] = [];

  for (const filter of result.filters) {
    if (filter instanceof Api.DialogFilter) {
      const includedChats: { id: string; title: string; type: string }[] = [];
      const excludedChats: { id: string; title: string; type: string }[] = [];

      // Resolve included peers
      for (const peer of filter.includePeers) {
        try {
          const entity = await client.getEntity(peer);
          if (entity instanceof Api.User || entity instanceof Api.Chat || entity instanceof Api.Channel) {
            includedChats.push({
              id: entity.id.toString(),
              title: getChatTitleFromEntity(entity),
              type: getEntityType(entity),
            });
          }
        } catch {
          // Skip unresolvable peers
        }
      }

      // Resolve excluded peers
      for (const peer of filter.excludePeers) {
        try {
          const entity = await client.getEntity(peer);
          if (entity instanceof Api.User || entity instanceof Api.Chat || entity instanceof Api.Channel) {
            excludedChats.push({
              id: entity.id.toString(),
              title: getChatTitleFromEntity(entity),
              type: getEntityType(entity),
            });
          }
        } catch {
          // Skip unresolvable peers
        }
      }

      // Handle title which can be string or TextWithEntities
      const titleStr = typeof filter.title === 'string' ? filter.title : (filter.title?.text ?? 'Untitled');

      folders.push({
        id: filter.id,
        title: titleStr,
        includedChats,
        excludedChats,
        emoticon: filter.emoticon ?? undefined,
      });
    }
  }

  return folders;
}

export async function getFolder(
  client: TelegramClient,
  folderName: string
): Promise<FolderInfo | null> {
  const folders = await getFolders(client);
  return folders.find(f => f.title.toLowerCase() === folderName.toLowerCase()) || null;
}

export async function addChatToFolder(
  client: TelegramClient,
  folderName: string,
  chatIdentifier: string
): Promise<{ success: boolean; message: string }> {
  const result = await client.invoke(new Api.messages.GetDialogFilters());

  let targetFilter: Api.DialogFilter | null = null;
  for (const filter of result.filters) {
    if (filter instanceof Api.DialogFilter) {
      const filterTitle = typeof filter.title === 'string' ? filter.title : (filter.title?.text ?? '');
      if (filterTitle.toLowerCase() === folderName.toLowerCase()) {
        targetFilter = filter;
        break;
      }
    }
  }

  if (!targetFilter) {
    return { success: false, message: `Folder not found: ${folderName}` };
  }

  const chat = await resolveChat(client, chatIdentifier);
  const chatTitle = getChatTitle(chat);
  const folderTitle = typeof targetFilter.title === 'string' ? targetFilter.title : (targetFilter.title?.text ?? 'Untitled');

  // Create the input peer for the chat
  let inputPeer: Api.TypeInputPeer;
  if (chat instanceof Api.User) {
    inputPeer = new Api.InputPeerUser({ userId: chat.id, accessHash: chat.accessHash || bigInt(0) });
  } else if (chat instanceof Api.Chat) {
    inputPeer = new Api.InputPeerChat({ chatId: chat.id });
  } else if (chat instanceof Api.Channel) {
    inputPeer = new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash || bigInt(0) });
  } else {
    return { success: false, message: 'Unknown chat type' };
  }

  // Check if already included
  for (const peer of targetFilter.includePeers) {
    try {
      const entity = await client.getEntity(peer);
      if (entity.id.equals(chat.id)) {
        return { success: false, message: `"${chatTitle}" is already in folder "${folderTitle}"` };
      }
    } catch {
      // Skip
    }
  }

  // Add to includePeers
  const newIncludePeers = [...targetFilter.includePeers, inputPeer];

  try {
    await client.invoke(
      new Api.messages.UpdateDialogFilter({
        id: targetFilter.id,
        filter: new Api.DialogFilter({
          id: targetFilter.id,
          title: targetFilter.title,
          pinnedPeers: targetFilter.pinnedPeers,
          includePeers: newIncludePeers,
          excludePeers: targetFilter.excludePeers,
          contacts: targetFilter.contacts,
          nonContacts: targetFilter.nonContacts,
          groups: targetFilter.groups,
          broadcasts: targetFilter.broadcasts,
          bots: targetFilter.bots,
          excludeMuted: targetFilter.excludeMuted,
          excludeRead: targetFilter.excludeRead,
          excludeArchived: targetFilter.excludeArchived,
          emoticon: targetFilter.emoticon,
        }),
      })
    );

    return { success: true, message: `Added "${chatTitle}" to folder "${folderTitle}"` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, message: msg };
  }
}

export async function removeChatFromFolder(
  client: TelegramClient,
  folderName: string,
  chatIdentifier: string
): Promise<{ success: boolean; message: string }> {
  const result = await client.invoke(new Api.messages.GetDialogFilters());

  let targetFilter: Api.DialogFilter | null = null;
  for (const filter of result.filters) {
    if (filter instanceof Api.DialogFilter) {
      const filterTitle = typeof filter.title === 'string' ? filter.title : (filter.title?.text ?? '');
      if (filterTitle.toLowerCase() === folderName.toLowerCase()) {
        targetFilter = filter;
        break;
      }
    }
  }

  if (!targetFilter) {
    return { success: false, message: `Folder not found: ${folderName}` };
  }

  const chat = await resolveChat(client, chatIdentifier);
  const chatTitle = getChatTitle(chat);
  const folderTitle = typeof targetFilter.title === 'string' ? targetFilter.title : (targetFilter.title?.text ?? 'Untitled');

  // Find and remove from includePeers
  let found = false;
  const newIncludePeers: Api.TypeInputPeer[] = [];

  for (const peer of targetFilter.includePeers) {
    try {
      const entity = await client.getEntity(peer);
      if (entity.id.equals(chat.id)) {
        found = true;
        continue; // Skip this peer (remove it)
      }
    } catch {
      // Keep unresolvable peers
    }
    newIncludePeers.push(peer);
  }

  if (!found) {
    return { success: false, message: `"${chatTitle}" is not in folder "${folderTitle}"` };
  }

  try {
    await client.invoke(
      new Api.messages.UpdateDialogFilter({
        id: targetFilter.id,
        filter: new Api.DialogFilter({
          id: targetFilter.id,
          title: targetFilter.title,
          pinnedPeers: targetFilter.pinnedPeers,
          includePeers: newIncludePeers,
          excludePeers: targetFilter.excludePeers,
          contacts: targetFilter.contacts,
          nonContacts: targetFilter.nonContacts,
          groups: targetFilter.groups,
          broadcasts: targetFilter.broadcasts,
          bots: targetFilter.bots,
          excludeMuted: targetFilter.excludeMuted,
          excludeRead: targetFilter.excludeRead,
          excludeArchived: targetFilter.excludeArchived,
          emoticon: targetFilter.emoticon,
        }),
      })
    );

    return { success: true, message: `Removed "${chatTitle}" from folder "${folderTitle}"` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, message: msg };
  }
}

function getChatTitleFromEntity(entity: Api.User | Api.Chat | Api.Channel | Api.ChatForbidden | Api.ChannelForbidden): string {
  if (entity instanceof Api.User) {
    return entity.firstName || entity.username || 'Unknown User';
  }
  if (entity instanceof Api.Chat || entity instanceof Api.Channel) {
    return entity.title;
  }
  if (entity instanceof Api.ChatForbidden || entity instanceof Api.ChannelForbidden) {
    return entity.title;
  }
  return 'Unknown';
}

function getEntityType(entity: Api.User | Api.Chat | Api.Channel | Api.ChatForbidden | Api.ChannelForbidden): string {
  if (entity instanceof Api.User) return 'user';
  if (entity instanceof Api.Chat) return 'group';
  if (entity instanceof Api.Channel) return entity.megagroup ? 'supergroup' : 'channel';
  return 'unknown';
}

// --- Kick Function ---

export async function kickUser(
  client: TelegramClient,
  chatIdentifier: string,
  userIdentifier: string
): Promise<{ success: boolean; message: string }> {
  const chat = await resolveChat(client, chatIdentifier);

  // Get the user to kick
  let user: Api.User;
  try {
    const entity = await client.getEntity(userIdentifier);
    if (!(entity instanceof Api.User)) {
      return { success: false, message: 'Target is not a user' };
    }
    user = entity;
  } catch (e) {
    return { success: false, message: `User not found: ${userIdentifier}` };
  }

  if (chat instanceof Api.Channel) {
    // For channels/supergroups, use EditBanned
    try {
      await client.invoke(
        new Api.channels.EditBanned({
          channel: chat,
          participant: user,
          bannedRights: new Api.ChatBannedRights({
            untilDate: 0, // Permanent
            viewMessages: true,
            sendMessages: true,
            sendMedia: true,
            sendStickers: true,
            sendGifs: true,
            sendGames: true,
            sendInline: true,
            embedLinks: true,
          }),
        })
      );
      return { success: true, message: `Kicked ${user.username || user.firstName} from ${chat.title}` };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('ADMIN') || msg.includes('RIGHT')) {
        return { success: false, message: 'Not admin or insufficient rights' };
      }
      if (msg.includes('USER_NOT_PARTICIPANT')) {
        return { success: false, message: 'User is not a member' };
      }
      return { success: false, message: msg };
    }
  } else if (chat instanceof Api.Chat) {
    // For regular groups, use DeleteChatUser
    try {
      await client.invoke(
        new Api.messages.DeleteChatUser({
          chatId: chat.id,
          userId: user,
          revokeHistory: false,
        })
      );
      return { success: true, message: `Kicked ${user.username || user.firstName} from ${chat.title}` };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('ADMIN') || msg.includes('RIGHT')) {
        return { success: false, message: 'Not admin or insufficient rights' };
      }
      if (msg.includes('USER_NOT_PARTICIPANT')) {
        return { success: false, message: 'User is not a member' };
      }
      return { success: false, message: msg };
    }
  }

  return { success: false, message: 'Not a group chat' };
}

// --- Reactions ---

export async function reactToMessage(
  client: TelegramClient,
  chatIdentifier: string,
  msgId: number,
  emoji: string | undefined,
  options: { big?: boolean; remove?: boolean } = {}
): Promise<{ chatTitle: string; emoji?: string; removed: boolean }> {
  const entity = await resolveChat(client, chatIdentifier);
  const chatTitle = getChatTitle(entity);
  const peer = await client.getInputEntity(entity);

  const removed = options.remove === true || !emoji;
  const reaction = removed ? [] : [new Api.ReactionEmoji({ emoticon: emoji! })];

  await client.invoke(
    new Api.messages.SendReaction({
      peer,
      msgId,
      reaction,
      big: options.big || undefined,
      addToRecent: true,
    })
  );

  return { chatTitle, emoji: removed ? undefined : emoji, removed };
}

// --- Forward ---

export async function forwardMessages(
  client: TelegramClient,
  fromChat: string,
  msgIds: number[],
  toChat: string,
  options: { silent?: boolean; dropAuthor?: boolean } = {}
): Promise<{ count: number; fromTitle: string; toTitle: string }> {
  const from = await resolveChat(client, fromChat);
  const to = await resolveChat(client, toChat);

  // forwardMessages throws if the forward fails; on success every requested id
  // was forwarded. The returned array under-reports (a GramJS quirk), so we
  // report the requested count instead.
  await client.forwardMessages(to, {
    messages: msgIds,
    fromPeer: from,
    silent: options.silent,
    dropAuthor: options.dropAuthor,
  });

  return {
    count: msgIds.length,
    fromTitle: getChatTitle(from),
    toTitle: getChatTitle(to),
  };
}

// --- Pin / Unpin ---

export async function pinChatMessage(
  client: TelegramClient,
  chatIdentifier: string,
  msgId: number,
  options: { notify?: boolean; pmOneSide?: boolean } = {}
): Promise<{ chatTitle: string }> {
  const entity = await resolveChat(client, chatIdentifier);
  await client.pinMessage(entity, msgId, {
    notify: options.notify,
    pmOneSide: options.pmOneSide,
  });
  return { chatTitle: getChatTitle(entity) };
}

export async function unpinChatMessage(
  client: TelegramClient,
  chatIdentifier: string,
  msgId?: number
): Promise<{ chatTitle: string; all: boolean }> {
  const entity = await resolveChat(client, chatIdentifier);
  if (msgId == null) {
    await client.unpinMessage(entity);
  } else {
    await client.unpinMessage(entity, msgId);
  }
  return { chatTitle: getChatTitle(entity), all: msgId == null };
}

// --- Button functions ---

async function fetchRawMessage(
  client: TelegramClient,
  entity: ResolvedEntity,
  msgId: number
): Promise<Api.Message | null> {
  const msgs = await client.getMessages(entity, { ids: [msgId] });
  const msg = msgs[0];
  return msg instanceof Api.Message ? msg : null;
}

export interface MessageButtonsResult {
  chatTitle: string;
  messageId: number;
  text: string;
  layout?: ButtonLayout;
}

export async function getMessageButtons(
  client: TelegramClient,
  chatIdentifier: string,
  msgId: number
): Promise<MessageButtonsResult> {
  const entity = await resolveChat(client, chatIdentifier);
  const chatTitle = getChatTitle(entity);
  const msg = await fetchRawMessage(client, entity, msgId);
  if (!msg) {
    throw new Error(`Message #${msgId} not found in "${chatTitle}"`);
  }
  return {
    chatTitle,
    messageId: msgId,
    text: messageText(msg),
    layout: extractButtons(msg),
  };
}

export interface ClickSelector {
  index?: number;       // 1-based flat index
  text?: string;        // match by button label
  dataBase64?: string;  // match a callback button by exact payload
}

export interface ClickOutcome {
  button: ButtonInfo;
  action: 'callback' | 'game' | 'sent_text' | 'url' | 'copy' | 'info' | 'refused';
  answerText?: string;   // toast / alert text returned by the bot
  isAlert?: boolean;     // true = shown as a blocking alert, false = transient toast
  url?: string;
  query?: string;
  copyText?: string;
  sentMessageId?: number;
  note?: string;
  /** The clicked message after the bot edited it (if it changed). */
  edited?: { id: number; text: string; layout?: ButtonLayout };
  /** New messages the bot sent in response, newer than the clicked one. */
  newMessages?: { id: number; sender: string; text: string; layout?: ButtonLayout }[];
}

function findRawButton(
  markup: Api.ReplyInlineMarkup | Api.ReplyKeyboardMarkup,
  layout: ButtonLayout,
  selector: ClickSelector
): { raw: RawButton; info: ButtonInfo } | null {
  const flatRaw: RawButton[] = [];
  for (const row of markup.rows) for (const b of row.buttons) flatRaw.push(b);
  const flatInfo = layout.rows.flat();

  let pos = -1;
  if (selector.index != null) {
    pos = selector.index - 1;
  } else if (selector.dataBase64 != null) {
    pos = flatInfo.findIndex((b) => b.type === 'callback' && b.data === selector.dataBase64);
  } else if (selector.text != null) {
    const needle = selector.text.trim().toLowerCase();
    pos = flatInfo.findIndex((b) => b.text.trim().toLowerCase() === needle);
    if (pos < 0) pos = flatInfo.findIndex((b) => b.text.trim().toLowerCase().includes(needle));
  }

  if (pos < 0 || pos >= flatRaw.length) return null;
  return { raw: flatRaw[pos], info: flatInfo[pos] };
}

function buttonSignature(layout?: ButtonLayout): string {
  if (!layout) return '';
  return layout.rows.flat().map((b) => `${b.type}:${b.text}:${b.data ?? b.url ?? ''}`).join('|');
}

/**
 * Press a button on a bot message and report what happened.
 *
 * Callback buttons are clicked with the button's raw callback bytes (never a
 * string round-trip) and the message is re-read afterwards so the caller sees
 * how the bot edited it — the whole point of "navigating" a bot's keyboard.
 */
export async function clickButton(
  client: TelegramClient,
  chatIdentifier: string,
  msgId: number,
  selector: ClickSelector,
  options: { password?: string; waitMs?: number } = {}
): Promise<ClickOutcome> {
  const { waitMs = 1500 } = options;
  const entity = await resolveChat(client, chatIdentifier);
  const msg = await fetchRawMessage(client, entity, msgId);
  if (!msg) throw new Error(`Message #${msgId} not found`);

  const markup = msg.replyMarkup;
  if (!(markup instanceof Api.ReplyInlineMarkup) && !(markup instanceof Api.ReplyKeyboardMarkup)) {
    throw new Error(`Message #${msgId} has no buttons`);
  }
  const layout = extractButtons(msg)!;
  const match = findRawButton(markup, layout, selector);
  if (!match) {
    const label = selector.index != null ? `#${selector.index}` : selector.dataBase64 != null ? `data ${selector.dataBase64}` : `"${selector.text}"`;
    throw new Error(`Button ${label} not found on message #${msgId}`);
  }

  const { raw, info } = match;
  const beforeText = messageText(msg);
  const beforeSig = buttonSignature(layout);

  // Non-server-side / non-clickable button types: report and stop.
  const kind: Api.TypeButtonType | Api.TypeInlineButtonType = raw.type;
  if (kind instanceof Api.InlineButtonTypeUrl || kind instanceof Api.InlineButtonTypeUrlAuth || kind instanceof Api.InputInlineButtonTypeUrlAuth) {
    return { button: info, action: 'url', url: kind.url, note: 'URL button — opening links is left to you (not opened automatically).' };
  }
  if (kind instanceof Api.InlineButtonTypeWebView || kind instanceof Api.ButtonTypeSimpleWebView) {
    return { button: info, action: 'url', url: kind.url, note: 'Web-app button — open this URL in a browser to interact.' };
  }
  if (kind instanceof Api.InlineButtonTypeCopy) {
    return { button: info, action: 'copy', copyText: kind.copyText, note: 'Copy button — no server call; this is the text it copies.' };
  }
  if (kind instanceof Api.InlineButtonTypeSwitchInline) {
    return { button: info, action: 'info', query: kind.query, note: `Switch-inline button — composes an inline query "${kind.query}" (not auto-sent).` };
  }
  if (kind instanceof Api.ButtonTypeRequestPhone || kind instanceof Api.ButtonTypeRequestGeoLocation || kind instanceof Api.ButtonTypeRequestPoll || kind instanceof Api.ButtonTypeRequestPeer || kind instanceof Api.InputButtonTypeRequestPeer) {
    return { button: info, action: 'refused', note: 'This button shares your phone / location / poll / a peer. Refused automatically — do this manually in a Telegram client if you intend to.' };
  }
  if (kind instanceof Api.InlineButtonTypeBuy) {
    return { button: info, action: 'refused', note: 'Payment button — opens a checkout flow that cannot be automated safely.' };
  }
  if (kind instanceof Api.InlineButtonTypeUserProfile || kind instanceof Api.InputInlineButtonTypeUserProfile) {
    return { button: info, action: 'info', note: `Opens a user profile (user id ${kind.userId.toString()}).` };
  }
  if (kind instanceof Api.InlineButtonTypeDisabled) {
    return { button: info, action: 'refused', note: 'This button is disabled by the bot.' };
  }

  // Plain reply-keyboard button: pressing it just sends its label as a message.
  if (kind instanceof Api.ButtonTypeDefault) {
    const sent = await sendMessage(client, chatIdentifier, raw.text);
    const outcome: ClickOutcome = { button: info, action: 'sent_text', sentMessageId: sent.id, note: `Reply-keyboard button — sent "${raw.text}" as a message.` };
    await collectBotResponse(client, entity, msgId, beforeText, beforeSig, waitMs, outcome);
    return outcome;
  }

  // Callback / game buttons: the real "press a bot button" path.
  const isGame = kind instanceof Api.InlineButtonTypeGame;
  const callback = kind instanceof Api.InlineButtonTypeCallback ? kind : undefined;
  if (!isGame && !callback) {
    return { button: info, action: 'refused', note: `Unsupported button type ${kind.className} — nothing was sent.` };
  }
  if (callback?.requiresPassword && !options.password) {
    throw new Error('This button requires your 2FA password. Re-run with --password <pw>.');
  }

  const peer = await client.getInputEntity(entity);
  const answer = await client.invoke(
    new Api.messages.GetBotCallbackAnswer({
      peer,
      msgId,
      game: isGame,
      // Raw callback bytes straight from the live message — no string round-trip.
      data: callback ? Buffer.from(callback.data) : undefined,
    })
  );

  const outcome: ClickOutcome = {
    button: info,
    action: isGame ? 'game' : 'callback',
    answerText: answer.message || undefined,
    isAlert: answer.message ? answer.alert : undefined,
    url: answer.url || undefined,
  };

  await collectBotResponse(client, entity, msgId, beforeText, beforeSig, waitMs, outcome);
  return outcome;
}

/** After a click, re-read the message (for edits) and pick up any new bot replies. */
async function collectBotResponse(
  client: TelegramClient,
  entity: ResolvedEntity,
  msgId: number,
  beforeText: string,
  beforeSig: string,
  waitMs: number,
  outcome: ClickOutcome
): Promise<void> {
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

  // 1) Did the bot edit the message in place?
  try {
    const after = await fetchRawMessage(client, entity, msgId);
    if (after) {
      const afterLayout = extractButtons(after);
      const changed = messageText(after) !== beforeText || buttonSignature(afterLayout) !== beforeSig;
      if (changed) {
        outcome.edited = { id: msgId, text: messageText(after), layout: afterLayout };
      }
    }
  } catch {
    // ignore
  }

  // 2) Did the bot send new messages after the clicked one?
  try {
    const newer = await client.getMessages(entity, { minId: msgId, limit: 5 });
    const collected: NonNullable<ClickOutcome['newMessages']> = [];
    for (const m of newer) {
      if (!(m instanceof Api.Message)) continue;
      if (m.id <= msgId || m.out) continue;
      collected.push({
        id: m.id,
        sender: getChatTitle(entity),
        text: messageText(m),
        layout: extractButtons(m),
      });
    }
    if (collected.length) {
      collected.sort((a, b) => a.id - b.id);
      outcome.newMessages = collected;
    }
  } catch {
    // ignore
  }
}

// --- Extended message operations ---

export async function editMessageText(
  client: TelegramClient,
  chatIdentifier: string,
  msgId: number,
  text: string,
  options: { parseMode?: 'html' | 'md' } = {}
): Promise<{ chatTitle: string; id: number }> {
  const entity = await resolveChat(client, chatIdentifier);
  const result = await client.editMessage(entity, {
    message: msgId,
    text,
    parseMode: options.parseMode,
  });
  return { chatTitle: getChatTitle(entity), id: result?.id ?? msgId };
}

export async function deleteChatMessages(
  client: TelegramClient,
  chatIdentifier: string,
  msgIds: number[],
  revoke: boolean
): Promise<{ chatTitle: string; count: number }> {
  const entity = await resolveChat(client, chatIdentifier);
  await client.deleteMessages(entity, msgIds, { revoke });
  return { chatTitle: getChatTitle(entity), count: msgIds.length };
}

export async function markChatRead(
  client: TelegramClient,
  chatIdentifier: string
): Promise<{ chatTitle: string }> {
  const entity = await resolveChat(client, chatIdentifier);
  await client.markAsRead(entity);
  return { chatTitle: getChatTitle(entity) };
}

export async function getPinnedMessages(
  client: TelegramClient,
  chatIdentifier: string,
  limit = 20
): Promise<{ chatTitle: string; messages: MessageInfo[] }> {
  const entity = await resolveChat(client, chatIdentifier);
  const result = await client.getMessages(entity, { limit, filter: new Api.InputMessagesFilterPinned() });
  const messages: MessageInfo[] = [];
  for (const msg of result) {
    if (msg instanceof Api.Message) {
      messages.push({
        id: msg.id,
        date: new Date(msg.date * 1000),
        sender: (await resolveSender(client, msg)).sender,
        text: messageText(msg),
        isOutgoing: msg.out ?? false,
        media: extractMediaInfo(msg),
        buttons: extractButtons(msg),
      });
    }
  }
  return { chatTitle: getChatTitle(entity), messages };
}

// --- Polls ---

export async function sendPoll(
  client: TelegramClient,
  chatIdentifier: string,
  question: string,
  answers: string[],
  options: { multiple?: boolean; quiz?: boolean; correct?: number; anonymous?: boolean } = {}
): Promise<{ chatTitle: string; id: number }> {
  const entity = await resolveChat(client, chatIdentifier);
  const peer = await client.getInputEntity(entity);

  // Layer 229: outgoing answers carry no option bytes — the server assigns them.
  const pollAnswers = answers.map((a) =>
    new Api.InputPollAnswer({
      text: new Api.TextWithEntities({ text: a, entities: [] }),
    })
  );

  const poll = new Api.Poll({
    id: bigInt(0),
    question: new Api.TextWithEntities({ text: question, entities: [] }),
    answers: pollAnswers,
    publicVoters: options.anonymous === false,
    multipleChoice: options.multiple || undefined,
    quiz: options.quiz || undefined,
    hash: bigInt(0),
  });

  const media = new Api.InputMediaPoll({
    poll,
    // Layer 229: correct answers are 0-based answer indexes, not option bytes.
    correctAnswers: options.quiz && options.correct != null ? [options.correct] : undefined,
  });

  const result = await client.invoke(
    new Api.messages.SendMedia({
      peer,
      media,
      message: '',
      randomId: generateRandomLong(),
    })
  );

  let id = 0;
  if (result instanceof Api.Updates) {
    for (const u of result.updates) {
      if (u instanceof Api.UpdateMessageID) id = u.id;
    }
  }
  return { chatTitle: getChatTitle(entity), id };
}

export async function votePoll(
  client: TelegramClient,
  chatIdentifier: string,
  msgId: number,
  optionIndexes: number[]
): Promise<{ chatTitle: string }> {
  const entity = await resolveChat(client, chatIdentifier);
  const peer = await client.getInputEntity(entity);

  const msg = await fetchRawMessage(client, entity, msgId);
  if (!msg || !(msg.media instanceof Api.MessageMediaPoll)) {
    throw new Error(`Message #${msgId} is not a poll`);
  }
  const pollAnswers = msg.media.poll.answers;
  const chosen: Buffer[] = [];
  for (const idx of optionIndexes) {
    const ans = pollAnswers[idx];
    if (!ans || !(ans instanceof Api.PollAnswer)) throw new Error(`Poll has no option #${idx + 1}`);
    chosen.push(Buffer.from(ans.option));
  }

  await client.invoke(new Api.messages.SendVote({ peer, msgId, options: chosen }));
  return { chatTitle: getChatTitle(entity) };
}

// --- Reaction list (who reacted) ---

export async function getReactionsList(
  client: TelegramClient,
  chatIdentifier: string,
  msgId: number,
  limit = 50
): Promise<{ chatTitle: string; reactions: { user: string; emoji: string }[] }> {
  const entity = await resolveChat(client, chatIdentifier);
  const peer = await client.getInputEntity(entity);
  const result = await client.invoke(
    new Api.messages.GetMessageReactionsList({ peer, id: msgId, limit })
  );

  const reactions: { user: string; emoji: string }[] = [];
  for (const r of result.reactions) {
    let emoji = '?';
    if (r.reaction instanceof Api.ReactionEmoji) emoji = r.reaction.emoticon;
    else if (r.reaction instanceof Api.ReactionCustomEmoji) emoji = `[custom:${r.reaction.documentId.toString()}]`;
    let user = 'Unknown';
    if (r.peerId instanceof Api.PeerUser) {
      const u = result.users.find((x): x is Api.User => x instanceof Api.User && x.id.equals((r.peerId as Api.PeerUser).userId));
      if (u) user = u.firstName || u.username || u.id.toString();
    }
    reactions.push({ user, emoji });
  }
  return { chatTitle: getChatTitle(entity), reactions };
}

// --- Block / contacts ---

export async function setBlocked(
  client: TelegramClient,
  userIdentifier: string,
  blocked: boolean
): Promise<{ name: string }> {
  const entity = await resolveChat(client, userIdentifier);
  const peer = await client.getInputEntity(entity);
  if (blocked) await client.invoke(new Api.contacts.Block({ id: peer }));
  else await client.invoke(new Api.contacts.Unblock({ id: peer }));
  return { name: getChatTitle(entity) };
}

export async function addContact(
  client: TelegramClient,
  userIdentifier: string,
  firstName: string,
  lastName = ''
): Promise<{ name: string }> {
  const entity = await resolveChat(client, userIdentifier);
  if (!(entity instanceof Api.User)) throw new Error('Not a user');
  await client.invoke(
    new Api.contacts.AddContact({
      id: entity,
      firstName,
      lastName,
      phone: entity.phone || '',
      addPhonePrivacyException: false,
    })
  );
  return { name: [firstName, lastName].filter(Boolean).join(' ') };
}

export async function deleteContact(
  client: TelegramClient,
  userIdentifier: string
): Promise<{ name: string }> {
  const entity = await resolveChat(client, userIdentifier);
  if (!(entity instanceof Api.User)) throw new Error('Not a user');
  await client.invoke(new Api.contacts.DeleteContacts({ id: [entity] }));
  return { name: getChatTitle(entity) };
}

// --- Chat membership / management ---

export async function joinChat(
  client: TelegramClient,
  target: string
): Promise<{ title: string }> {
  // Invite link (t.me/+hash or t.me/joinchat/hash) → ImportChatInvite; otherwise JoinChannel.
  const inviteMatch = target.match(/(?:t\.me\/(?:joinchat\/|\+)|^\+)([A-Za-z0-9_-]+)/);
  if (inviteMatch) {
    const res = await client.invoke(new Api.messages.ImportChatInvite({ hash: inviteMatch[1] }));
    let title = 'chat';
    if (res instanceof Api.messages.ChatInviteJoinResultOk && res.updates instanceof Api.Updates) {
      const chat = res.updates.chats[0];
      if (chat instanceof Api.Channel || chat instanceof Api.Chat) title = chat.title;
    }
    return { title };
  }
  const entity = await resolveChat(client, target);
  if (!(entity instanceof Api.Channel)) throw new Error('Can only join channels/supergroups by username');
  await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
  return { title: getChatTitle(entity) };
}

export async function leaveChat(
  client: TelegramClient,
  chatIdentifier: string
): Promise<{ title: string }> {
  const entity = await resolveChat(client, chatIdentifier);
  const title = getChatTitle(entity);
  if (entity instanceof Api.Channel) {
    await client.invoke(new Api.channels.LeaveChannel({ channel: entity }));
  } else if (entity instanceof Api.Chat) {
    const me = await getMe(client);
    await client.invoke(new Api.messages.DeleteChatUser({ chatId: entity.id, userId: me, revokeHistory: false }));
  } else {
    throw new Error('Not a group or channel');
  }
  return { title };
}

export async function exportInviteLink(
  client: TelegramClient,
  chatIdentifier: string
): Promise<{ title: string; link: string }> {
  const entity = await resolveChat(client, chatIdentifier);
  const peer = await client.getInputEntity(entity);
  const res = await client.invoke(new Api.messages.ExportChatInvite({ peer }));
  const link = res instanceof Api.ChatInviteExported ? res.link : '';
  return { title: getChatTitle(entity), link };
}

export async function setArchived(
  client: TelegramClient,
  chatIdentifier: string,
  archived: boolean
): Promise<{ title: string }> {
  const entity = await resolveChat(client, chatIdentifier);
  const peer = await client.getInputEntity(entity);
  await client.invoke(
    new Api.folders.EditPeerFolders({
      folderPeers: [new Api.InputFolderPeer({ peer, folderId: archived ? 1 : 0 })],
    })
  );
  return { title: getChatTitle(entity) };
}

export async function createGroup(
  client: TelegramClient,
  title: string,
  userIdentifiers: string[]
): Promise<{ title: string; id: string }> {
  const users: Api.TypeInputUser[] = [];
  for (const u of userIdentifiers) {
    const entity = await resolveChat(client, u);
    if (entity instanceof Api.User) {
      users.push(new Api.InputUser({ userId: entity.id, accessHash: entity.accessHash || bigInt(0) }));
    }
  }
  const res = await client.invoke(new Api.messages.CreateChat({ users, title }));
  let id = '';
  const updates = (res as { updates?: Api.Updates }).updates ?? res;
  if (updates instanceof Api.Updates) {
    const chat = updates.chats[0];
    if (chat) id = chat.id.toString();
  }
  return { title, id };
}

export async function createChannel(
  client: TelegramClient,
  title: string,
  about: string,
  options: { broadcast?: boolean } = {}
): Promise<{ title: string; id: string }> {
  const res = await client.invoke(
    new Api.channels.CreateChannel({
      title,
      about,
      broadcast: options.broadcast || undefined,
      megagroup: options.broadcast ? undefined : true,
    })
  );
  let id = '';
  if (res instanceof Api.Updates) {
    const chat = res.chats[0];
    if (chat) id = chat.id.toString();
  }
  return { title, id };
}

// --- Presence / typing ---

export async function sendTyping(
  client: TelegramClient,
  chatIdentifier: string,
  action: 'typing' | 'photo' | 'video' | 'audio' | 'document' | 'cancel' = 'typing'
): Promise<{ title: string }> {
  const entity = await resolveChat(client, chatIdentifier);
  const peer = await client.getInputEntity(entity);
  const actionMap: Record<string, Api.TypeSendMessageAction> = {
    typing: new Api.SendMessageTypingAction(),
    photo: new Api.SendMessageUploadPhotoAction({ progress: 0 }),
    video: new Api.SendMessageUploadVideoAction({ progress: 0 }),
    audio: new Api.SendMessageUploadAudioAction({ progress: 0 }),
    document: new Api.SendMessageUploadDocumentAction({ progress: 0 }),
    cancel: new Api.SendMessageCancelAction(),
  };
  await client.invoke(new Api.messages.SetTyping({ peer, action: actionMap[action] }));
  return { title: getChatTitle(entity) };
}

// --- Own profile ---

export async function updateProfile(
  client: TelegramClient,
  fields: { firstName?: string; lastName?: string; about?: string }
): Promise<void> {
  await client.invoke(new Api.account.UpdateProfile(fields));
}

export async function updateUsername(client: TelegramClient, username: string): Promise<void> {
  await client.invoke(new Api.account.UpdateUsername({ username }));
}

export async function setProfilePhoto(
  client: TelegramClient,
  filePath: string
): Promise<void> {
  const file = await client.uploadFile({
    file: new CustomFile(basename(filePath), statSync(filePath).size, filePath),
    workers: 1,
  });
  await client.invoke(new Api.photos.UploadProfilePhoto({ file }));
}

export async function downloadAvatar(
  client: TelegramClient,
  chatIdentifier: string,
  outputDir: string
): Promise<{ filePath: string | null; title: string }> {
  const entity = await resolveChat(client, chatIdentifier);
  const title = getChatTitle(entity);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const fileName = `avatar_${entity.id.toString()}.jpg`;
  const filePath = join(outputDir, fileName);
  const result = await client.downloadProfilePhoto(entity, { outputFile: filePath });
  if (!result) return { filePath: null, title };
  return { filePath: typeof result === 'string' ? result : filePath, title };
}

// --- Inline bot queries ---

export async function queryInlineBot(
  client: TelegramClient,
  botIdentifier: string,
  query: string,
  limit = 20
): Promise<{ results: { type: string; title: string; description?: string; id: string }[] }> {
  const bot = await resolveChat(client, botIdentifier);
  if (!(bot instanceof Api.User)) throw new Error('Inline queries can only target bots');
  const inputBot = new Api.InputUser({ userId: bot.id, accessHash: bot.accessHash || bigInt(0) });

  const res = await client.invoke(
    new Api.messages.GetInlineBotResults({
      bot: inputBot,
      peer: new Api.InputPeerSelf(),
      query,
      offset: '',
    })
  );

  const results: { type: string; title: string; description?: string; id: string }[] = [];
  for (const raw of res.results.slice(0, limit)) {
    if (raw instanceof Api.BotInlineResult || raw instanceof Api.BotInlineMediaResult) {
      results.push({
        type: raw.type,
        title: raw.title || '',
        description: raw.description || undefined,
        id: raw.id,
      });
    }
  }
  return { results };
}

// --- Stories ---

export async function getUserStories(
  client: TelegramClient,
  userIdentifier: string
): Promise<{ name: string; stories: { id: number; date: Date; caption: string }[] }> {
  const entity = await resolveChat(client, userIdentifier);
  const peer = await client.getInputEntity(entity);
  const res = await client.invoke(new Api.stories.GetPeerStories({ peer }));
  const stories: { id: number; date: Date; caption: string }[] = [];
  for (const s of res.stories.stories) {
    if (s instanceof Api.StoryItem) {
      stories.push({ id: s.id, date: new Date(s.date * 1000), caption: s.caption || '' });
    }
  }
  return { name: getChatTitle(entity), stories };
}

// --- Admin Management Functions ---

async function resolveUser(client: TelegramClient, userIdentifier: string): Promise<Api.User> {
  const entity = await client.getEntity(userIdentifier);
  if (!(entity instanceof Api.User)) {
    throw new Error('Target is not a user');
  }
  return entity;
}

function userLabel(user: Api.User): string {
  return user.username ? `@${user.username}` : (user.firstName || user.id.toString());
}

function friendlyAdminError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('USER_NOT_PARTICIPANT') || msg.includes('USER_NOT_MUTUAL_CONTACT')) {
    return 'The target must be a member of the group first.';
  }
  if (msg.includes('CHAT_ADMIN_REQUIRED') || msg.includes('ADMIN_RIGHT')) {
    return 'You lack the rights to add admins in this group.';
  }
  if (msg.includes('USER_PRIVACY_RESTRICTED')) {
    return "The target's privacy settings prevent this action.";
  }
  if (msg.includes('USER_CREATOR')) {
    return 'That user is the group creator and cannot be changed this way.';
  }
  if (msg.includes('USER_ADMIN_INVALID')) {
    return "You can't edit this user's admin status (they may have been promoted by someone else).";
  }
  if (msg.includes('RIGHT_FORBIDDEN')) {
    return 'One of the requested admin rights is not allowed in this group.';
  }
  if (msg.includes('ADMINS_TOO_MUCH')) {
    return 'This group already has the maximum number of admins.';
  }
  return msg;
}

function friendlyTransferError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('PASSWORD_HASH_INVALID')) {
    return 'Incorrect 2FA password.';
  }
  if (msg.includes('PASSWORD_MISSING')) {
    return 'No 2FA password is set on your account. Enable two-step verification first.';
  }
  if (msg.includes('SRP_PASSWORD_CHANGED') || msg.includes('SRP_ID_INVALID')) {
    return 'Your 2FA password state changed mid-request. Please try again.';
  }
  if (msg.includes('PASSWORD_TOO_FRESH')) {
    return 'Your 2FA password was set too recently. Telegram blocks ownership transfer for ~7 days after enabling or changing it.';
  }
  if (msg.includes('SESSION_TOO_FRESH') || msg.includes('FRESH_CHANGE_ADMINS_FORBIDDEN')) {
    return 'This login session is too new. Telegram blocks ownership transfer for ~24h after a new login.';
  }
  if (msg.includes('CHAT_ADMIN_REQUIRED') || msg.includes('CHANNEL_PRIVATE')) {
    return 'You must be the creator of this group to transfer ownership.';
  }
  if (msg.includes('USER_NOT_PARTICIPANT') || msg.includes('USER_NOT_MUTUAL_CONTACT')) {
    return 'The target must be a member of the group first.';
  }
  if (msg.includes('USER_PRIVACY_RESTRICTED')) {
    return "The target's privacy settings prevent the transfer. Ask them to adjust their privacy settings or add you as a contact.";
  }
  if (msg.includes('USER_CHANNELS_TOO_MUCH')) {
    return 'The target is in too many groups/channels and cannot receive ownership right now.';
  }
  if (msg.includes('CHANNELS_ADMIN_PUBLIC_TOO_MUCH')) {
    return 'The target already owns too many public groups/channels.';
  }
  return msg;
}

export async function promoteAdmin(
  client: TelegramClient,
  chatIdentifier: string,
  userIdentifier: string,
  options: { rank?: string; canAddAdmins?: boolean } = {}
): Promise<{ success: boolean; message: string }> {
  const chat = await resolveChat(client, chatIdentifier);

  let user: Api.User;
  try {
    user = await resolveUser(client, userIdentifier);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Target is not a user') {
      return { success: false, message: msg };
    }
    return { success: false, message: `User not found: ${userIdentifier}` };
  }

  if (chat instanceof Api.Channel) {
    try {
      await client.invoke(
        new Api.channels.EditAdmin({
          channel: chat,
          userId: user,
          adminRights: new Api.ChatAdminRights({
            changeInfo: true,
            postMessages: true,
            editMessages: true,
            deleteMessages: true,
            banUsers: true,
            inviteUsers: true,
            pinMessages: true,
            manageCall: true,
            other: true,
            addAdmins: options.canAddAdmins ?? false,
          }),
          rank: options.rank ?? '',
        })
      );
      return { success: true, message: `Promoted ${userLabel(user)} to admin in "${chat.title}"` };
    } catch (e: unknown) {
      return { success: false, message: friendlyAdminError(e) };
    }
  } else if (chat instanceof Api.Chat) {
    // Basic groups only support a single all-or-nothing admin toggle.
    try {
      await client.invoke(
        new Api.messages.EditChatAdmin({
          chatId: chat.id,
          userId: user,
          isAdmin: true,
        })
      );
      const ignoredNote = (options.rank || options.canAddAdmins)
        ? ' (basic groups grant full admin rights; --rank/--add-admins ignored)'
        : '';
      return { success: true, message: `Promoted ${userLabel(user)} to admin in "${chat.title}"${ignoredNote}` };
    } catch (e: unknown) {
      return { success: false, message: friendlyAdminError(e) };
    }
  }

  return { success: false, message: 'Not a group chat' };
}

export async function transferOwnership(
  client: TelegramClient,
  chatIdentifier: string,
  userIdentifier: string,
  password: string
): Promise<{ success: boolean; message: string }> {
  const chat = await resolveChat(client, chatIdentifier);

  if (!(chat instanceof Api.Channel)) {
    return {
      success: false,
      message: 'Ownership transfer is only supported for supergroups and channels. Convert a basic group to a supergroup first.',
    };
  }

  let user: Api.User;
  try {
    user = await resolveUser(client, userIdentifier);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Target is not a user') {
      return { success: false, message: msg };
    }
    return { success: false, message: `User not found: ${userIdentifier}` };
  }

  let passwordInfo: Api.account.Password;
  try {
    passwordInfo = await client.invoke(new Api.account.GetPassword());
  } catch (e: unknown) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }

  if (!passwordInfo.hasPassword) {
    return {
      success: false,
      message: 'Ownership transfer requires two-step verification (a cloud password) on your account. Enable it in Telegram > Settings > Privacy and Security first.',
    };
  }

  try {
    const srpCheck = await computeCheck(passwordInfo, password);
    await client.invoke(
      // Layer 229 replaced channels.editCreator with messages.editChatCreator
      new Api.messages.EditChatCreator({
        peer: chat,
        userId: user,
        password: srpCheck,
      })
    );
    return { success: true, message: `Transferred ownership of "${chat.title}" to ${userLabel(user)}` };
  } catch (e: unknown) {
    return { success: false, message: friendlyTransferError(e) };
  }
}

// --- Chat info, forum topics, message links ---

export interface ChatDetails {
  id: string;
  type: 'user' | 'bot' | 'group' | 'supergroup' | 'channel';
  title: string;
  username?: string;
  about?: string;
  members?: number;
  online?: number;
  admins?: number;
  unread?: number;
  linkedChatId?: string;
  forum?: boolean;
  slowmodeSeconds?: number;
  inviteLink?: string;
  phone?: string;
  commonChats?: number;
  blocked?: boolean;
  isSelf?: boolean;
}

/** Everything useful about a chat, user or channel in one call. */
export async function getChatInfo(client: TelegramClient, chatIdentifier: string): Promise<ChatDetails> {
  const entity = await resolveChat(client, chatIdentifier);
  const id = utils.getPeerId(entity).toString();

  if (entity instanceof Api.User) {
    const full = await client.invoke(new Api.users.GetFullUser({ id: entity }));
    return {
      id,
      type: entity.bot ? 'bot' : 'user',
      title: [entity.firstName, entity.lastName].filter(Boolean).join(' ') || entity.username || id,
      username: entity.username ?? undefined,
      about: full.fullUser.about ?? undefined,
      phone: entity.phone ?? undefined,
      commonChats: full.fullUser.commonChatsCount || undefined,
      blocked: full.fullUser.blocked || undefined,
      isSelf: entity.self || undefined,
    };
  }

  if (entity instanceof Api.Channel) {
    const res = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
    const full = res.fullChat as Api.ChannelFull;
    const linked = full.linkedChatId ? utils.getPeerId(new Api.PeerChannel({ channelId: full.linkedChatId })).toString() : undefined;
    return {
      id,
      type: entity.megagroup ? 'supergroup' : 'channel',
      title: entity.title,
      username: entity.username ?? undefined,
      about: full.about || undefined,
      members: full.participantsCount ?? entity.participantsCount ?? undefined,
      online: full.onlineCount || undefined,
      admins: full.adminsCount || undefined,
      unread: full.unreadCount || undefined,
      linkedChatId: linked,
      forum: entity.forum || undefined,
      slowmodeSeconds: full.slowmodeSeconds || undefined,
      inviteLink: full.exportedInvite instanceof Api.ChatInviteExported ? full.exportedInvite.link : undefined,
    };
  }

  const res = await client.invoke(new Api.messages.GetFullChat({ chatId: entity.id }));
  const full = res.fullChat as Api.ChatFull;
  return {
    id,
    type: 'group',
    title: entity.title,
    about: full.about || undefined,
    members: entity.participantsCount ?? undefined,
    inviteLink: full.exportedInvite instanceof Api.ChatInviteExported ? full.exportedInvite.link : undefined,
  };
}

export interface ForumTopicInfo {
  id: number;
  title: string;
  unread: number;
  topMessage: number;
  closed?: boolean;
  pinned?: boolean;
}

export async function getForumTopics(
  client: TelegramClient,
  chatIdentifier: string,
  options: { limit?: number; query?: string } = {}
): Promise<{ chatTitle: string; topics: ForumTopicInfo[] }> {
  const entity = await resolveChat(client, chatIdentifier);
  if (!(entity instanceof Api.Channel) || !entity.forum) {
    throw new Error(`"${getChatTitle(entity)}" is not a forum (topics are only in forum supergroups)`);
  }
  const res = await client.invoke(
    new Api.messages.GetForumTopics({
      peer: entity,
      q: options.query,
      offsetDate: 0,
      offsetId: 0,
      offsetTopic: 0,
      limit: options.limit ?? 100,
    })
  );
  const topics: ForumTopicInfo[] = [];
  for (const t of res.topics) {
    if (t instanceof Api.ForumTopic) {
      topics.push({
        id: t.id,
        title: t.title,
        unread: t.unreadCount,
        topMessage: t.topMessage,
        closed: t.closed || undefined,
        pinned: t.pinned || undefined,
      });
    }
  }
  return { chatTitle: entity.title, topics };
}

/** Public t.me link to a message (private chats/groups have no message links). */
export async function getMessageLink(
  client: TelegramClient,
  chatIdentifier: string,
  messageId: number,
  options: { thread?: boolean } = {}
): Promise<string> {
  const entity = await resolveChat(client, chatIdentifier);
  if (!(entity instanceof Api.Channel)) {
    throw new Error('Message links exist only for channels and supergroups');
  }
  const res = await client.invoke(
    new Api.channels.ExportMessageLink({ channel: entity, id: messageId, thread: options.thread })
  );
  return res.link;
}

/** Last read incoming message ID and unread count of a chat (from the dialog list). */
export async function getReadState(
  client: TelegramClient,
  chatIdentifier: string
): Promise<{ readInboxMaxId: number; unreadCount: number }> {
  const entity = await resolveChat(client, chatIdentifier);
  const peerId = utils.getPeerId(entity).toString();
  const dialog = (await getDialogsCached(client)).find(d => d.id?.toString() === peerId);
  if (!dialog || !(dialog.dialog instanceof Api.Dialog)) {
    throw new Error(`No dialog for "${chatIdentifier}" in your chat list, so its unread state is unknown`);
  }
  return { readInboxMaxId: dialog.dialog.readInboxMaxId, unreadCount: dialog.unreadCount };
}

export interface ContactInfoRow {
  id: string;
  name: string;
  username?: string;
  phone?: string;
  mutual?: boolean;
}

export async function listContacts(client: TelegramClient, query?: string): Promise<ContactInfoRow[]> {
  const res = await client.invoke(new Api.contacts.GetContacts({ hash: bigInt(0) }));
  if (!(res instanceof Api.contacts.Contacts)) return [];
  const q = query?.toLowerCase();
  const rows: ContactInfoRow[] = [];
  for (const u of res.users) {
    if (!(u instanceof Api.User)) continue;
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.id.toString();
    if (q && !(name.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q) || u.phone?.includes(q))) continue;
    rows.push({ id: u.id.toString(), name, username: u.username ?? undefined, phone: u.phone ?? undefined, mutual: u.mutualContact || undefined });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

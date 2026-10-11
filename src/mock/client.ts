import { Api, utils, type TelegramClient } from 'teleproto';
import { Dialog } from 'teleproto/tl/custom/dialog.js';
import bigInt from 'big-integer';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { loadWorld, mockStatePath, saveWorld, type MockButton, type MockChat, type MockMessage, type MockReply, type MockUser, type MockWorld } from './world.js';

type Entity = Api.User | Api.Chat | Api.Channel;
type Media = NonNullable<MockMessage['media']>;
/** Constructor arguments the CLI never reads are left out; TL classes only check them when serializing. */
const args = <T>(value: object): T => value as T;

const now = () => Math.floor(Date.now() / 1000);
const HASH = bigInt(1);

function notImplemented(what: string): never {
  throw new Error(`mock: ${what} is not implemented. Add it to src/mock/client.ts, or run without TG_MOCK against a dev profile.`);
}

/**
 * Stands in for TelegramClient when TG_MOCK is set: the same methods the CLI calls, answered from
 * a MockWorld with real `Api.*` objects, so everything above it (src/client.ts, formatters,
 * commands, MCP) runs for real. Nothing here opens a connection.
 */
export class MockClient {
  readonly connected = true;
  readonly session = { save: () => '' };

  constructor(readonly world: MockWorld, private readonly persist: (world: MockWorld) => void = () => {}) {}

  // --- entities ---

  private user(u: MockUser): Api.User {
    return new Api.User({
      id: bigInt(u.id),
      accessHash: HASH,
      firstName: u.firstName,
      lastName: u.lastName,
      username: u.username,
      phone: u.phone,
      bot: u.bot,
      contact: u.contact,
      mutualContact: u.mutual,
      self: u.id === this.world.me,
    });
  }

  private findUser(id: number): MockUser | undefined {
    return this.world.users.find(u => u.id === id);
  }

  private entityOf(chat: MockChat): Entity {
    if (chat.kind === 'user') {
      const u = this.findUser(chat.id);
      if (!u) throw new Error(`mock state: chat ${chat.id} is a private chat but there is no user ${chat.id}`);
      return this.user(u);
    }
    if (chat.kind === 'group') {
      return new Api.Chat(args({
        id: bigInt(chat.id),
        title: chat.title ?? 'Group',
        photo: new Api.ChatPhotoEmpty(),
        participantsCount: chat.membersCount ?? chat.members?.length ?? 0,
        date: 0,
        version: 1,
        creator: chat.role === 'creator',
      }));
    }
    return new Api.Channel(args({
      id: bigInt(chat.id),
      accessHash: HASH,
      title: chat.title ?? 'Channel',
      username: chat.username,
      photo: new Api.ChatPhotoEmpty(),
      date: 0,
      megagroup: chat.kind === 'supergroup',
      broadcast: chat.kind === 'channel',
      forum: chat.forum,
      creator: chat.role === 'creator',
      adminRights: chat.role ? new Api.ChatAdminRights({ changeInfo: true, deleteMessages: true, banUsers: true, inviteUsers: true, pinMessages: true }) : undefined,
      participantsCount: chat.membersCount ?? chat.members?.length,
    }));
  }

  private peerOf(chat: MockChat): Api.TypePeer {
    if (chat.kind === 'user') return new Api.PeerUser({ userId: bigInt(chat.id) });
    if (chat.kind === 'group') return new Api.PeerChat({ chatId: bigInt(chat.id) });
    return new Api.PeerChannel({ channelId: bigInt(chat.id) });
  }

  /** The chat a peer-like value points at, or undefined (a known user we have no dialog with). */
  private locate(like: unknown): { chat?: MockChat; user?: MockUser } {
    const users = this.world.users;
    const chats = this.world.chats;
    const byUser = (id: number) => ({ chat: chats.find(c => c.kind === 'user' && c.id === id), user: users.find(u => u.id === id) });
    const byGroup = (id: number) => ({ chat: chats.find(c => c.kind === 'group' && c.id === id) });
    const byChannel = (id: number) => ({ chat: chats.find(c => (c.kind === 'supergroup' || c.kind === 'channel') && c.id === id) });

    if (typeof like === 'string') {
      const text = like.trim();
      if (/^-?\d+$/.test(text)) return this.locate(bigInt(text));
      const name = text.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '').toLowerCase();
      if (['me', 'self'].includes(name)) return byUser(this.world.me);
      const u = users.find(x => x.username?.toLowerCase() === name || x.phone === name.replace(/^\+/, ''));
      if (u) return byUser(u.id);
      return { chat: chats.find(c => c.username?.toLowerCase() === name) };
    }
    if (typeof like === 'number') return this.locate(bigInt(like));
    if (bigInt.isInstance(like)) {
      const marked = like.toString();
      if (marked.startsWith('-100')) return byChannel(Number(marked.slice(4)));
      if (marked.startsWith('-')) return byGroup(Number(marked.slice(1)));
      const id = Number(marked);
      const found = byUser(id);
      return found.user ? found : byChannel(id).chat ? byChannel(id) : byGroup(id);
    }
    if (like && typeof like === 'object') {
      const o = like as { className?: string; id?: bigInt.BigInteger; userId?: bigInt.BigInteger; chatId?: bigInt.BigInteger; channelId?: bigInt.BigInteger; peer?: unknown };
      switch (o.className) {
        case 'User': return byUser(o.id!.toJSNumber());
        case 'Chat': return byGroup(o.id!.toJSNumber());
        case 'Channel': return byChannel(o.id!.toJSNumber());
        case 'PeerUser': case 'InputPeerUser': case 'InputUser': return byUser(o.userId!.toJSNumber());
        case 'PeerChat': case 'InputPeerChat': return byGroup(o.chatId!.toJSNumber());
        case 'PeerChannel': case 'InputPeerChannel': case 'InputChannel': return byChannel(o.channelId!.toJSNumber());
        case 'InputPeerSelf': case 'InputUserSelf': return byUser(this.world.me);
        case 'InputNotifyPeer': case 'InputDialogPeer': case 'InputFolderPeer': return this.locate(o.peer);
      }
    }
    return {};
  }

  /** The chat to act on; a private chat with a known user is opened on first use. */
  private chat(like: unknown, create = false): MockChat {
    const { chat, user } = this.locate(like);
    if (chat) return chat;
    if (user) {
      const opened: MockChat = { id: user.id, kind: 'user', messages: [] };
      if (create) this.world.chats.push(opened);
      return opened;
    }
    throw new Error(`Cannot find any entity corresponding to "${describe(like)}"`);
  }

  async getMe(): Promise<Api.User> {
    return this.user(this.findUser(this.world.me)!);
  }

  async getEntity(like: unknown): Promise<Entity> {
    const { chat, user } = this.locate(like);
    if (chat) return this.entityOf(chat);
    if (user) return this.user(user);
    throw new Error(`Cannot find any entity corresponding to "${describe(like)}"`);
  }

  async getInputEntity(like: unknown): Promise<Api.TypeInputPeer> {
    return utils.getInputPeer(await this.getEntity(like));
  }

  // --- messages ---

  private date(m: MockMessage): number {
    return m.date ?? now() - (m.ago ?? 0);
  }

  private senderId(chat: MockChat, m: MockMessage): number | undefined {
    if (m.from) return m.from;
    if (m.out) return this.world.me;
    return chat.kind === 'user' ? chat.id : undefined;
  }

  private markup(m: Pick<MockMessage, 'buttons' | 'keyboard'>): Api.TypeReplyMarkup | undefined {
    if (!m.buttons?.length) return undefined;
    if (m.keyboard) {
      return new Api.ReplyKeyboardMarkup({
        rows: m.buttons.map(row => new Api.KeyboardButtonRow({
          buttons: row.map(b => new Api.KeyboardButton({ text: b.text, type: new Api.ButtonTypeDefault() })),
        })),
      });
    }
    return new Api.ReplyInlineMarkup({
      rows: m.buttons.map(row => new Api.KeyboardInlineButtonRow({
        buttons: row.map(b => new Api.KeyboardInlineButton({
          text: b.text,
          type: b.url
            ? new Api.InlineButtonTypeUrl({ url: b.url })
            : new Api.InlineButtonTypeCallback({ data: Buffer.from(b.data ?? b.text) }),
        })),
      })),
    });
  }

  private media(m: MockMessage): Api.TypeMessageMedia | undefined {
    const media = m.media;
    if (!media) return undefined;
    if (media.kind === 'photo') return new Api.MessageMediaPhoto({ photo: new Api.PhotoEmpty({ id: bigInt(m.id) }) });
    const attributes: Api.TypeDocumentAttribute[] = [];
    if (media.fileName) attributes.push(new Api.DocumentAttributeFilename({ fileName: media.fileName }));
    if (media.kind === 'video') attributes.push(new Api.DocumentAttributeVideo({ duration: media.duration ?? 0, w: 1280, h: 720 }));
    if (media.kind === 'voice') attributes.push(new Api.DocumentAttributeAudio({ duration: media.duration ?? 0, voice: true }));
    return new Api.MessageMediaDocument({
      document: new Api.Document({
        id: bigInt(m.id),
        accessHash: HASH,
        fileReference: Buffer.alloc(0),
        date: this.date(m),
        mimeType: media.mimeType ?? 'application/octet-stream',
        size: bigInt(media.size ?? 0),
        dcId: 1,
        attributes,
      }),
    });
  }

  private message(chat: MockChat, m: MockMessage): Api.Message {
    const from = chat.kind === 'group' || chat.kind === 'supergroup' ? this.senderId(chat, m) : undefined;
    return new Api.Message(args({
      id: m.id,
      date: this.date(m),
      message: m.text,
      out: m.out,
      peerId: this.peerOf(chat),
      fromId: from ? new Api.PeerUser({ userId: bigInt(from) }) : undefined,
      replyTo: m.replyTo || m.thread
        ? new Api.MessageReplyHeader({ replyToMsgId: m.replyTo ?? m.thread, replyToTopId: m.thread, forumTopic: chat.forum && !!m.thread })
        : undefined,
      media: this.media(m),
      replyMarkup: this.markup(m),
      replies: m.replies === undefined ? undefined : new Api.MessageReplies({ replies: m.replies, repliesPts: 0 }),
      pinned: m.pinned,
      editDate: m.edited ? this.date(m) : undefined,
      fwdFrom: m.forwardedFrom ? new Api.MessageFwdHeader({ date: this.date(m), fromId: this.peerOf(this.chat(bigInt(m.forwardedFrom))) }) : undefined,
    }));
  }

  private newest(chat: MockChat): MockMessage[] {
    return [...chat.messages].sort((a, b) => b.id - a.id);
  }

  private nextId(chat: MockChat): number {
    return chat.messages.reduce((max, m) => Math.max(max, m.id), 0) + 1;
  }

  private save(): void {
    this.persist(this.world);
  }

  async getMessages(
    like: unknown,
    params: { limit?: number; offsetId?: number; offsetDate?: number; minId?: number; maxId?: number; ids?: number | number[]; fromUser?: unknown; filter?: { className?: string } } = {},
  ): Promise<(Api.Message | undefined)[]> {
    const chat = this.chat(like);
    if (params.ids !== undefined) {
      const ids = Array.isArray(params.ids) ? params.ids : [params.ids];
      return ids.map(id => {
        const m = chat.messages.find(x => x.id === id);
        return m ? this.message(chat, m) : undefined;
      });
    }
    let list = this.newest(chat);
    if (params.filter?.className === 'InputMessagesFilterPinned') list = list.filter(m => m.pinned);
    if (params.offsetId) list = list.filter(m => m.id < params.offsetId!);
    if (params.offsetDate) list = list.filter(m => this.date(m) < params.offsetDate!);
    if (params.minId) list = list.filter(m => m.id > params.minId!);
    if (params.maxId) list = list.filter(m => m.id < params.maxId!);
    if (params.fromUser) {
      const sender = this.locate(params.fromUser).user?.id;
      list = list.filter(m => this.senderId(chat, m) === sender);
    }
    return list.slice(0, params.limit ?? 100).map(m => this.message(chat, m));
  }

  async sendMessage(
    like: unknown,
    params: { message?: string; replyTo?: number | { replyToMsgId?: number; topMsgId?: number }; schedule?: number } = {},
  ): Promise<Api.Message> {
    const chat = this.chat(like, true);
    const reply = typeof params.replyTo === 'object' ? params.replyTo : { replyToMsgId: params.replyTo, topMsgId: undefined };
    const repliedTo = reply.replyToMsgId ? chat.messages.find(m => m.id === reply.replyToMsgId) : undefined;
    if (reply.replyToMsgId && !repliedTo) throw new Error('MSG_ID_INVALID: the message to reply to does not exist');
    const sent = this.append(chat, {
      out: true,
      text: params.message ?? '',
      replyTo: reply.replyToMsgId,
      // A reply inside a thread stays in it, as on Telegram
      thread: reply.topMsgId ?? repliedTo?.thread,
      date: params.schedule,
    });
    this.botAnswers(chat, sent.text);
    this.save();
    return this.message(chat, sent);
  }

  private append(chat: MockChat, m: Omit<MockMessage, 'id'>): MockMessage {
    const message: MockMessage = { ...m, id: this.nextId(chat), date: m.date ?? now() };
    for (const key of Object.keys(message) as (keyof MockMessage)[]) if (message[key] === undefined) delete message[key];
    chat.messages.push(message);
    return message;
  }

  /** A scripted bot answers a message whose text is one of its `commands`. */
  private botAnswers(chat: MockChat, text: string): void {
    const reply = chat.kind === 'user' ? this.findUser(chat.id)?.commands?.[text.trim()] : undefined;
    if (reply) this.append(chat, { text: reply.text, buttons: reply.buttons, keyboard: reply.keyboard });
  }

  async editMessage(like: unknown, params: { message: number; text?: string }): Promise<Api.Message> {
    const chat = this.chat(like);
    const m = chat.messages.find(x => x.id === params.message);
    if (!m) throw new Error('MESSAGE_ID_INVALID: no such message');
    if (!m.out) throw new Error("MESSAGE_AUTHOR_REQUIRED: you can't edit someone else's message");
    m.text = params.text ?? m.text;
    m.edited = true;
    this.save();
    return this.message(chat, m);
  }

  async deleteMessages(like: unknown, ids: number[]): Promise<unknown[]> {
    const chat = this.chat(like);
    chat.messages = chat.messages.filter(m => !ids.includes(m.id));
    this.save();
    return [];
  }

  async markAsRead(like: unknown): Promise<boolean> {
    const chat = this.chat(like);
    chat.unread = 0;
    chat.readInboxMaxId = this.newest(chat)[0]?.id ?? 0;
    this.save();
    return true;
  }

  async pinMessage(like: unknown, id: number): Promise<void> {
    const chat = this.chat(like);
    const m = chat.messages.find(x => x.id === id);
    if (!m) throw new Error('MESSAGE_ID_INVALID: no such message');
    m.pinned = true;
    this.save();
  }

  async unpinMessage(like: unknown, id?: number): Promise<void> {
    const chat = this.chat(like);
    for (const m of chat.messages) if (id === undefined || m.id === id) delete m.pinned;
    this.save();
  }

  async forwardMessages(like: unknown, params: { messages: number | number[]; fromPeer: unknown }): Promise<Api.Message[]> {
    const to = this.chat(like, true);
    const from = this.chat(params.fromPeer);
    const ids = Array.isArray(params.messages) ? params.messages : [params.messages];
    const sent = ids.map(id => {
      const m = from.messages.find(x => x.id === id);
      if (!m) throw new Error(`MESSAGE_ID_INVALID: no message ${id} to forward`);
      return this.append(to, { out: true, text: m.text, media: m.media, forwardedFrom: from.kind === 'user' ? undefined : from.id });
    });
    this.save();
    return sent.map(m => this.message(to, m));
  }

  async sendFile(
    like: unknown,
    params: { file: string; caption?: string; forceDocument?: boolean; replyTo?: number | { replyToMsgId?: number; topMsgId?: number } },
  ): Promise<Api.Message> {
    if (typeof params.file !== 'string' || !existsSync(params.file)) throw new Error(`File not found: ${String(params.file)}`);
    const chat = this.chat(like, true);
    const reply = typeof params.replyTo === 'object' ? params.replyTo : { replyToMsgId: params.replyTo, topMsgId: undefined };
    const ext = extname(params.file).toLowerCase();
    const kind: Media['kind'] = params.forceDocument
      ? 'document'
      : ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? 'photo'
        : ['.mp4', '.mov', '.webm'].includes(ext) ? 'video'
          : ['.ogg', '.oga'].includes(ext) ? 'voice' : 'document';
    const sent = this.append(chat, {
      out: true,
      text: params.caption ?? '',
      replyTo: reply.replyToMsgId,
      thread: reply.topMsgId,
      media: { kind, fileName: kind === 'photo' ? undefined : basename(params.file) },
    });
    this.save();
    return this.message(chat, sent);
  }

  /** Writes a placeholder: mock messages have no real file behind them. */
  async downloadMedia(message: Api.Message, params: { outputFile?: string } = {}): Promise<string | Buffer> {
    const content = Buffer.from(`mock media of message ${message.id}\n`);
    if (typeof params.outputFile !== 'string') return content;
    mkdirSync(dirname(params.outputFile), { recursive: true });
    writeFileSync(params.outputFile, content);
    return params.outputFile;
  }

  async downloadProfilePhoto(): Promise<undefined> {
    return undefined;
  }

  // --- dialogs ---

  async getDialogs(params: { limit?: number; archived?: boolean } = {}): Promise<Dialog[]> {
    const entities = new Map<string, Entity>();
    let chats = this.world.chats.filter(c => c.messages.length > 0 || c.kind !== 'user');
    if (params.archived !== undefined) chats = chats.filter(c => !!c.archived === params.archived);
    const rows = chats.map(chat => {
      const entity = this.entityOf(chat);
      entities.set(utils.getPeerId(entity).toString(), entity);
      const top = this.newest(chat)[0];
      return { chat, top, date: top ? this.date(top) : 0 };
    });
    rows.sort((a, b) => b.date - a.date);
    return rows.slice(0, params.limit ?? 100).map(({ chat, top }) => new Dialog(
      this as unknown as TelegramClient,
      new Api.Dialog(args({
        peer: this.peerOf(chat),
        topMessage: top?.id ?? 0,
        readInboxMaxId: chat.readInboxMaxId ?? top?.id ?? 0,
        readOutboxMaxId: 0,
        unreadCount: chat.unread ?? 0,
        unreadMentionsCount: 0,
        unreadReactionsCount: 0,
        notifySettings: new Api.PeerNotifySettings({ muteUntil: chat.mutedUntil }),
        folderId: chat.archived ? 1 : undefined,
      })),
      entities as never,
      top ? this.message(chat, top) : undefined,
    ));
  }

  // --- raw requests ---

  async invoke(request: { className: string } & Record<string, any>): Promise<any> {
    switch (request.className) {
      case 'messages.GetReplies': return this.getReplies(request);
      case 'messages.Search': return this.search([this.chat(request.peer)], request);
      case 'messages.SearchGlobal': return this.search(this.world.chats, request);
      case 'users.GetFullUser': {
        const user = this.locate(request.id).user;
        if (!user) throw new Error('USER_ID_INVALID');
        return { fullUser: { about: user.about, blocked: user.blocked, commonChatsCount: this.commonChats(user.id) }, users: [this.user(user)], chats: [] };
      }
      case 'channels.GetFullChannel': {
        const chat = this.chat(request.channel);
        return {
          fullChat: {
            about: chat.about ?? '',
            participantsCount: chat.membersCount ?? chat.members?.length,
            adminsCount: chat.members?.filter(m => m.role).length,
            unreadCount: chat.unread ?? 0,
            linkedChatId: chat.linkedChatId ? bigInt(chat.linkedChatId) : undefined,
          },
          chats: [this.entityOf(chat)],
          users: [],
        };
      }
      case 'messages.GetFullChat': return this.fullChat(this.chat(bigInt(`-${request.chatId.toString()}`)));
      case 'channels.GetParticipants': return this.participants(request);
      case 'messages.GetDialogFilters': return { filters: (this.world.folders ?? []).map(f => this.folder(f)) };
      case 'messages.UpdateDialogFilter': {
        const folders = (this.world.folders ??= []);
        const index = folders.findIndex(f => f.id === request.id);
        if (!request.filter) {
          if (index >= 0) folders.splice(index, 1);
        } else {
          const title = typeof request.filter.title === 'string' ? request.filter.title : request.filter.title?.text ?? 'Untitled';
          const ids = (peers: unknown[] = []) => peers.map(p => this.chat(p).id);
          const next = { id: request.id, title, emoticon: request.filter.emoticon, include: ids(request.filter.includePeers), exclude: ids(request.filter.excludePeers) };
          if (index >= 0) folders[index] = next;
          else folders.push(next);
        }
        this.save();
        return true;
      }
      case 'messages.GetForumTopics': {
        const chat = this.chat(request.peer);
        const q = request.q?.toLowerCase();
        const topics = (chat.topics ?? []).filter(t => !q || t.title.toLowerCase().includes(q)).slice(0, request.limit ?? 100);
        return {
          topics: topics.map(t => new Api.ForumTopic(args({
            id: t.id,
            date: 0,
            title: t.title,
            iconColor: 0,
            topMessage: chat.messages.filter(m => m.thread === t.id || m.id === t.id).reduce((max, m) => Math.max(max, m.id), t.id),
            readInboxMaxId: 0,
            readOutboxMaxId: 0,
            unreadCount: t.unread ?? 0,
            unreadMentionsCount: 0,
            unreadReactionsCount: 0,
            fromId: new Api.PeerUser({ userId: bigInt(this.world.me) }),
            notifySettings: new Api.PeerNotifySettings({}),
            closed: t.closed,
            pinned: t.pinned,
          }))),
          count: topics.length,
        };
      }
      case 'contacts.GetContacts': {
        const users = this.world.users.filter(u => u.contact).map(u => this.user(u));
        return new Api.contacts.Contacts({ contacts: [], savedCount: users.length, users });
      }
      case 'channels.ExportMessageLink': {
        const chat = this.chat(request.channel);
        if (!chat.messages.some(m => m.id === request.id)) throw new Error('MESSAGE_ID_INVALID: no such message');
        return { link: `https://t.me/${chat.username ?? `c/${chat.id}`}/${request.id}${request.thread ? '?thread=1' : ''}`, html: '' };
      }
      case 'messages.SendReaction': {
        const m = this.findMessage(request.peer, request.msgId);
        const others = (m.reactions ?? []).filter(r => r.userId !== this.world.me);
        const mine = (request.reaction ?? []).map((r: { emoticon?: string }) => ({ userId: this.world.me, emoji: r.emoticon ?? '?' }));
        m.reactions = [...others, ...mine];
        if (!m.reactions.length) delete m.reactions;
        this.save();
        return new Api.Updates(args({ updates: [], users: [], chats: [], date: now(), seq: 0 }));
      }
      case 'messages.GetMessageReactionsList': {
        const m = this.findMessage(request.peer, request.id);
        const reactions = (m.reactions ?? []).slice(0, request.limit ?? 50);
        return {
          count: reactions.length,
          reactions: reactions.map(r => new Api.MessagePeerReaction({
            peerId: new Api.PeerUser({ userId: bigInt(r.userId) }),
            date: now(),
            reaction: new Api.ReactionEmoji({ emoticon: r.emoji }),
          })),
          users: reactions.flatMap(r => { const u = this.findUser(r.userId); return u ? [this.user(u)] : []; }),
          chats: [],
        };
      }
      case 'messages.GetBotCallbackAnswer': return this.pressButton(request);
      case 'messages.SetTyping': return true;
      case 'account.UpdateNotifySettings': {
        const chat = this.chat(request.peer);
        const until = request.settings?.muteUntil ?? 0;
        if (until > now()) chat.mutedUntil = until;
        else delete chat.mutedUntil;
        this.save();
        return true;
      }
      case 'contacts.Block':
      case 'contacts.Unblock': {
        const user = this.locate(request.id).user;
        if (!user) throw new Error('CONTACT_ID_INVALID');
        user.blocked = request.className === 'contacts.Block' || undefined;
        this.save();
        return true;
      }
      case 'contacts.AddContact': {
        const user = this.locate(request.id).user;
        if (!user) throw new Error('CONTACT_ID_INVALID');
        user.contact = true;
        if (request.firstName) user.firstName = request.firstName;
        if (request.lastName) user.lastName = request.lastName;
        this.save();
        return new Api.Updates(args({ updates: [], users: [this.user(user)], chats: [], date: now(), seq: 0 }));
      }
      case 'contacts.DeleteContacts': {
        for (const id of request.id ?? []) {
          const user = this.locate(id).user;
          if (user) delete user.contact;
        }
        this.save();
        return new Api.Updates(args({ updates: [], users: [], chats: [], date: now(), seq: 0 }));
      }
      case 'folders.EditPeerFolders': {
        for (const item of request.folderPeers ?? []) {
          const chat = this.chat(item.peer);
          if (item.folderId === 1) chat.archived = true;
          else delete chat.archived;
        }
        this.save();
        return new Api.Updates(args({ updates: [], users: [], chats: [], date: now(), seq: 0 }));
      }
      default:
        return notImplemented(`the request ${request.className}`);
    }
  }

  private findMessage(peer: unknown, id: number): MockMessage {
    const m = this.chat(peer).messages.find(x => x.id === id);
    if (!m) throw new Error('MESSAGE_ID_INVALID: no such message');
    return m;
  }

  private commonChats(userId: number): number {
    return this.world.chats.filter(c => c.kind !== 'user' && c.members?.some(m => m.userId === userId)).length;
  }

  private getReplies(request: Record<string, any>) {
    let chat = this.chat(request.peer);
    let rootId: number = request.msgId;
    // Comments on a channel post live in the linked discussion group, under the forwarded copy
    if (chat.kind === 'channel' && chat.linkedChatId) {
      const post = chat.messages.find(m => m.id === rootId);
      const discussion = this.chat(bigInt(`-100${chat.linkedChatId}`));
      const copy = discussion.messages.find(m => m.forwardedFrom === chat.id && m.text === post?.text);
      if (!copy) return { messages: [], chats: [], users: [], count: 0 };
      chat = discussion;
      rootId = copy.id;
    }
    let list = this.newest(chat).filter(m => m.thread === rootId);
    if (request.offsetId) list = list.filter(m => m.id < request.offsetId);
    if (request.offsetDate) list = list.filter(m => this.date(m) < request.offsetDate);
    if (request.minId) list = list.filter(m => m.id > request.minId);
    return { messages: list.slice(0, request.limit ?? 100).map(m => this.message(chat, m)), chats: [], users: [], count: list.length };
  }

  private search(chats: MockChat[], request: Record<string, any>) {
    const q = String(request.q ?? '').toLowerCase();
    const from = request.fromId ? this.locate(request.fromId).user?.id : undefined;
    const filter: string = request.filter?.className ?? 'InputMessagesFilterEmpty';
    const kinds: Record<string, (m: MockMessage) => boolean> = {
      InputMessagesFilterEmpty: () => true,
      InputMessagesFilterPhotos: m => m.media?.kind === 'photo',
      InputMessagesFilterVideo: m => m.media?.kind === 'video',
      InputMessagesFilterPhotoVideo: m => m.media?.kind === 'photo' || m.media?.kind === 'video',
      InputMessagesFilterDocument: m => m.media?.kind === 'document',
      InputMessagesFilterVoice: m => m.media?.kind === 'voice',
      InputMessagesFilterUrl: m => /https?:\/\//.test(m.text),
    };
    const matchesKind = kinds[filter] ?? ((m: MockMessage) => !!m.media);
    const hits: { chat: MockChat; m: MockMessage }[] = [];
    for (const chat of chats) {
      for (const m of chat.messages) {
        if (q && !m.text.toLowerCase().includes(q)) continue;
        if (!matchesKind(m)) continue;
        if (from !== undefined && this.senderId(chat, m) !== from) continue;
        const date = this.date(m);
        if (request.minDate && date < request.minDate) continue;
        if (request.maxDate && date > request.maxDate) continue;
        hits.push({ chat, m });
      }
    }
    hits.sort((a, b) => this.date(b.m) - this.date(a.m));
    const shown = hits.slice(0, request.limit ?? 100);
    const entities = [...new Set(shown.map(h => h.chat))].map(c => this.entityOf(c));
    return {
      messages: shown.map(h => this.message(h.chat, h.m)),
      chats: entities.filter(e => !(e instanceof Api.User)),
      users: entities.filter(e => e instanceof Api.User),
      count: hits.length,
    };
  }

  private fullChat(chat: MockChat) {
    const members = chat.members ?? [];
    const participants = members.map(m => {
      const userId = bigInt(m.userId);
      if (m.role === 'creator') return new Api.ChatParticipantCreator({ userId });
      if (m.role === 'admin') return new Api.ChatParticipantAdmin({ userId, inviterId: userId, date: 0 });
      return new Api.ChatParticipant({ userId, inviterId: userId, date: 0 });
    });
    return {
      fullChat: new Api.ChatFull(args({
        id: bigInt(chat.id),
        about: chat.about ?? '',
        participants: new Api.ChatParticipants({ chatId: bigInt(chat.id), participants, version: 1 }),
        notifySettings: new Api.PeerNotifySettings({}),
      })),
      chats: [this.entityOf(chat)],
      users: members.flatMap(m => { const u = this.findUser(m.userId); return u ? [this.user(u)] : []; }),
    };
  }

  private participants(request: Record<string, any>) {
    const chat = this.chat(request.channel);
    const filter: string = request.filter?.className ?? 'ChannelParticipantsRecent';
    let members = chat.members ?? [];
    if (filter === 'ChannelParticipantsAdmins') members = members.filter(m => m.role);
    if (filter === 'ChannelParticipantsSearch' && request.filter.q) {
      const q = String(request.filter.q).toLowerCase();
      members = members.filter(m => {
        const u = this.findUser(m.userId);
        return !!u && (`${u.firstName} ${u.lastName ?? ''}`.toLowerCase().includes(q) || !!u.username?.toLowerCase().includes(q));
      });
    }
    members = members.slice(request.offset ?? 0, (request.offset ?? 0) + (request.limit ?? 200));
    const rights = new Api.ChatAdminRights({ changeInfo: true, deleteMessages: true, banUsers: true, inviteUsers: true, pinMessages: true });
    return new Api.channels.ChannelParticipants({
      count: members.length,
      participants: members.map(m => {
        const userId = bigInt(m.userId);
        if (m.role === 'creator') return new Api.ChannelParticipantCreator({ userId, adminRights: rights });
        if (m.role === 'admin') return new Api.ChannelParticipantAdmin({ userId, promotedBy: userId, date: 0, adminRights: rights });
        return new Api.ChannelParticipant({ userId, date: 0 });
      }),
      chats: [],
      users: members.flatMap(m => { const u = this.findUser(m.userId); return u ? [this.user(u)] : []; }),
    });
  }

  private folder(f: NonNullable<MockWorld['folders']>[number]): Api.DialogFilter {
    const peers = (ids: number[] = []) => ids.flatMap(id => {
      const chat = this.world.chats.find(c => c.id === id);
      return chat ? [utils.getInputPeer(this.entityOf(chat))] : [];
    });
    return new Api.DialogFilter(args({
      id: f.id,
      title: new Api.TextWithEntities({ text: f.title, entities: [] }),
      emoticon: f.emoticon,
      pinnedPeers: [],
      includePeers: peers(f.include),
      excludePeers: peers(f.exclude),
    }));
  }

  /** A callback button was pressed: the "bot" edits the message and/or answers, as scripted. */
  private pressButton(request: Record<string, any>) {
    const chat = this.chat(request.peer);
    const m = this.findMessage(request.peer, request.msgId);
    const data = request.data ? Buffer.from(request.data).toString() : undefined;
    const button = (m.buttons ?? []).flat().find((b: MockButton) => (b.data ?? b.text) === data);
    if (!button) throw new Error('DATA_INVALID: the message has no button with this payload');
    const apply = (target: MockMessage, reply: MockReply) => {
      target.text = reply.text;
      target.buttons = reply.buttons;
      target.keyboard = reply.keyboard;
      if (!target.buttons) delete target.buttons;
      if (!target.keyboard) delete target.keyboard;
    };
    const scripted = (value: MockReply | string): MockReply => {
      if (typeof value !== 'string') return value;
      const command = this.findUser(chat.id)?.commands?.[value];
      if (!command) throw new Error(`mock state: button "${button.text}" points at the command "${value}", which this bot does not have`);
      return command;
    };
    if (button.edit) apply(m, scripted(button.edit));
    if (button.reply) {
      const reply = scripted(button.reply);
      this.append(chat, { text: reply.text, buttons: reply.buttons, keyboard: reply.keyboard });
    }
    if (button.edit || button.reply) this.save();
    return { message: button.answer, alert: button.alert, url: undefined, cacheTime: 0 };
  }

  // --- lifecycle and everything else ---

  async connect(): Promise<boolean> { return true; }
  async isUserAuthorized(): Promise<boolean> { return true; }
  async disconnect(): Promise<void> {}
  async destroy(): Promise<void> {}
  removeEventHandler(): void {}

  addEventHandler(): never { return notImplemented('live updates (`watch`)'); }
  uploadFile(): never { return notImplemented('uploadFile (profile photos)'); }
}

function describe(like: unknown): string {
  if (typeof like === 'string') return like;
  if (bigInt.isInstance(like)) return like.toString();
  return (like as { className?: string })?.className ?? String(like);
}

let announced = false;

/** The client `getClient()` hands out under TG_MOCK. State is loaded per process and saved on every change. */
export function createMockClient(path = mockStatePath()): TelegramClient {
  if (!announced) {
    announced = true;
    process.stderr.write('MOCK MODE (TG_MOCK): fake account, nothing reaches Telegram\n');
  }
  return new MockClient(loadWorld(path), world => saveWorld(world, path)) as unknown as TelegramClient;
}

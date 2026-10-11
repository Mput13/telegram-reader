import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { configFile } from '../paths.js';

/**
 * The mock account as plain data: it is what TG_MOCK serves instead of Telegram, what the state
 * file stores between commands, and what a custom scenario file contains. `src/mock/client.ts`
 * turns it into real `Api.*` objects on every call, so the CLI's own code runs unchanged.
 */
export interface MockWorld {
  version: 1;
  /** `users[].id` of the logged-in account. */
  me: number;
  users: MockUser[];
  chats: MockChat[];
  folders?: MockFolder[];
}

export interface MockUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  phone?: string;
  bot?: boolean;
  contact?: boolean;
  mutual?: boolean;
  about?: string;
  blocked?: boolean;
  /** Bots only: what the bot answers to a message with exactly this text (e.g. "/start"). */
  commands?: Record<string, MockReply>;
}

export interface MockReply {
  text: string;
  buttons?: MockButton[][];
  /** `buttons` are a reply keyboard (pressing sends the label) instead of inline buttons. */
  keyboard?: boolean;
}

export interface MockButton {
  text: string;
  /** Callback button payload. Without `data` and `url` the button is a reply-keyboard button. */
  data?: string;
  url?: string;
  /** Toast the bot answers with when the button is pressed. */
  answer?: string;
  alert?: boolean;
  /** The bot edits the pressed message to this. A string names one of the bot's `commands`. */
  edit?: MockReply | string;
  /** The bot sends this as a new message. A string names one of the bot's `commands`. */
  reply?: MockReply | string;
}

export interface MockChat {
  /** Bare ID: the user ID for a private chat, otherwise the group/channel ID without -100. */
  id: number;
  kind: 'user' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  about?: string;
  forum?: boolean;
  /** Our role in a group/channel. */
  role?: 'creator' | 'admin';
  members?: { userId: number; role?: 'creator' | 'admin' }[];
  membersCount?: number;
  unread?: number;
  readInboxMaxId?: number;
  /** Unix time the chat is muted until. */
  mutedUntil?: number;
  archived?: boolean;
  topics?: { id: number; title: string; unread?: number; closed?: boolean; pinned?: boolean }[];
  /** Channel → its discussion group (bare ID), where post comments live. */
  linkedChatId?: number;
  messages: MockMessage[];
}

export interface MockMessage {
  id: number;
  /** Age in seconds, counted from now on every load, so the seed never goes stale. */
  ago?: number;
  /** Unix time; set on messages created while running (they do not age with the seed). */
  date?: number;
  /** Sender user ID. Missing: us when `out`, otherwise the chat itself (private chat peer, channel). */
  from?: number;
  out?: boolean;
  text: string;
  replyTo?: number;
  /** Forum topic or comment thread root this message belongs to. */
  thread?: number;
  media?: { kind: 'photo' | 'document' | 'video' | 'voice'; fileName?: string; mimeType?: string; size?: number; duration?: number };
  buttons?: MockButton[][];
  keyboard?: boolean;
  pinned?: boolean;
  edited?: boolean;
  reactions?: { userId: number; emoji: string }[];
  /** Comment count shown on a channel post or thread root. */
  replies?: number;
  forwardedFrom?: number;
}

export interface MockFolder {
  id: number;
  title: string;
  emoticon?: string;
  /** Bare chat IDs. */
  include: number[];
  exclude?: number[];
}

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

/** The demo bot's main menu: an edit-in-place flow, a toast, a URL button and an alert with a new message. */
const START_MENU: MockReply = {
  text: 'Welcome! Pick a section.',
  buttons: [
    [
      {
        text: 'Catalog',
        data: 'catalog',
        edit: { text: 'Catalog: 3 items', buttons: [[{ text: '« Back', data: 'back', edit: '/start' }]] },
      },
      { text: 'Status', data: 'status', answer: 'All systems normal' },
    ],
    [
      { text: 'Docs', url: 'https://example.com/docs' },
      { text: 'Order', data: 'order', answer: 'Order created', alert: true, reply: { text: 'Order #42 is confirmed.' } },
    ],
  ],
};

/** The built-in account: small, but with one of everything the commands distinguish. */
export function seedWorld(): MockWorld {
  return {
    version: 1,
    me: 1000,
    users: [
      { id: 1000, firstName: 'Mock', lastName: 'Owner', username: 'mock_owner', phone: '15550000000', about: 'The account TG_MOCK logs you in as' },
      { id: 1001, firstName: 'Alice', lastName: 'Example', username: 'alice_example', phone: '15550000001', contact: true, mutual: true, about: 'Designer. Replies slowly on Fridays.' },
      { id: 1002, firstName: 'Bob', lastName: 'Sample', username: 'bob_sample', contact: true },
      { id: 1003, firstName: 'Carol', phone: '15550000003', contact: true, mutual: true },
      {
        id: 2001,
        firstName: 'Demo Bot',
        username: 'demo_bot',
        bot: true,
        about: 'A scripted bot: /start, /menu, /keyboard',
        commands: {
          '/start': START_MENU,
          '/menu': { text: 'Menu', buttons: [[{ text: 'Status', data: 'status', answer: 'All systems normal' }]] },
          '/keyboard': { text: 'Choose an option', keyboard: true, buttons: [[{ text: 'Yes' }, { text: 'No' }]] },
          Yes: { text: 'You said yes.' },
          No: { text: 'You said no.' },
        },
      },
    ],
    chats: [
      {
        id: 1000,
        kind: 'user',
        messages: [
          { id: 1, ago: 6 * DAY, out: true, text: 'Note to self: renew the domain' },
          { id: 2, ago: 2 * DAY, out: true, text: 'Draft: https://example.com/draft', media: { kind: 'document', fileName: 'draft.pdf', mimeType: 'application/pdf', size: 48213 } },
        ],
      },
      {
        id: 1001,
        kind: 'user',
        unread: 2,
        readInboxMaxId: 3,
        messages: [
          { id: 1, ago: 3 * DAY, text: 'Hi! Did you get the mockups?' },
          { id: 2, ago: 3 * DAY - 5 * MIN, out: true, text: 'Yes, looking now', replyTo: 1 },
          { id: 3, ago: 1 * DAY, text: 'Here is the new header', media: { kind: 'photo' } },
          { id: 4, ago: 2 * HOUR, text: 'Can we talk about the deadline tomorrow?' },
          { id: 5, ago: 25 * MIN, text: 'Ping me when you are free', reactions: [{ userId: 1000, emoji: '👍' }] },
        ],
      },
      {
        id: 1002,
        kind: 'user',
        mutedUntil: 4102444800,
        unread: 1,
        readInboxMaxId: 1,
        messages: [
          { id: 1, ago: 9 * DAY, text: 'Voice note', media: { kind: 'voice', mimeType: 'audio/ogg', size: 20480, duration: 12 } },
          { id: 2, ago: 5 * HOUR, text: 'lol look at this' },
        ],
      },
      {
        id: 2001,
        kind: 'user',
        messages: [
          { id: 1, ago: 4 * DAY, out: true, text: '/start' },
          { id: 2, ago: 4 * DAY - 2, ...START_MENU },
        ],
      },
      {
        id: 3001,
        kind: 'group',
        title: 'Family',
        role: 'admin',
        about: 'Weekend plans',
        members: [{ userId: 1003, role: 'creator' }, { userId: 1000, role: 'admin' }, { userId: 1001 }],
        unread: 3,
        readInboxMaxId: 2,
        messages: [
          { id: 1, ago: 2 * DAY, from: 1003, text: 'Dinner on Saturday?' },
          { id: 2, ago: 2 * DAY - 10 * MIN, out: true, text: 'I am in' },
          { id: 3, ago: 3 * HOUR, from: 1001, text: 'Me too, 7pm works' },
          { id: 4, ago: 2 * HOUR, from: 1003, text: 'Booked a table', pinned: true },
          { id: 5, ago: 90 * MIN, from: 1003, text: 'Who is bringing dessert?' },
        ],
      },
      {
        id: 4001,
        kind: 'supergroup',
        title: 'Team',
        username: 'mock_team',
        role: 'creator',
        about: 'Work chat',
        membersCount: 4,
        members: [{ userId: 1000, role: 'creator' }, { userId: 1001, role: 'admin' }, { userId: 1002 }, { userId: 1003 }],
        unread: 1,
        readInboxMaxId: 2,
        messages: [
          { id: 1, ago: 5 * DAY, from: 1001, text: 'Release checklist is in the doc: https://example.com/checklist' },
          { id: 2, ago: 4 * DAY, out: true, text: 'Shipping on Thursday', pinned: true },
          { id: 3, ago: 40 * MIN, from: 1002, text: 'CI is green again' },
        ],
      },
      {
        id: 4002,
        kind: 'supergroup',
        title: 'Team Design',
        membersCount: 2,
        members: [{ userId: 1001, role: 'creator' }, { userId: 1000 }],
        messages: [{ id: 1, ago: 8 * DAY, from: 1001, text: 'New palette attached', media: { kind: 'document', fileName: 'palette.zip', mimeType: 'application/zip', size: 1048576 } }],
      },
      {
        id: 4003,
        kind: 'supergroup',
        title: 'Dev Forum',
        username: 'mock_forum',
        forum: true,
        membersCount: 120,
        members: [{ userId: 1002, role: 'creator' }, { userId: 1000 }, { userId: 1001 }],
        topics: [
          { id: 1, title: 'General', pinned: true },
          { id: 10, title: 'Bugs', unread: 2 },
          { id: 20, title: 'Ideas', closed: true },
        ],
        unread: 2,
        readInboxMaxId: 22,
        messages: [
          { id: 10, ago: 7 * DAY, from: 1002, text: 'Bugs' },
          { id: 20, ago: 7 * DAY - MIN, from: 1002, text: 'Ideas' },
          { id: 21, ago: 6 * DAY + 2 * HOUR, from: 1003, text: 'Dark theme for the dashboard', thread: 20, replyTo: 20 },
          { id: 22, ago: 6 * DAY, from: 1001, text: 'Login fails on the second device', thread: 10, replyTo: 10 },
          { id: 23, ago: 4 * HOUR, from: 1002, text: 'Reproduced, looking into it', thread: 10, replyTo: 22 },
          { id: 24, ago: 1 * HOUR, from: 1001, text: 'Thanks! Any ETA?', thread: 10, replyTo: 23 },
        ],
      },
      {
        id: 5001,
        kind: 'channel',
        title: 'Mock News',
        username: 'mock_news',
        about: 'Announcements',
        membersCount: 15230,
        linkedChatId: 5002,
        unread: 2,
        readInboxMaxId: 1,
        messages: [
          { id: 1, ago: 6 * DAY, text: 'Version 1.0 is out', replies: 2, pinned: true },
          { id: 2, ago: 1 * DAY, text: 'Maintenance window on Sunday', media: { kind: 'photo' }, replies: 0 },
          { id: 3, ago: 3 * HOUR, text: 'Weekly digest: three things shipped', media: { kind: 'video', fileName: 'digest.mp4', mimeType: 'video/mp4', size: 5242880, duration: 34 } },
        ],
      },
      {
        id: 5002,
        kind: 'supergroup',
        title: 'Mock News Chat',
        archived: true,
        membersCount: 310,
        members: [{ userId: 1002, role: 'creator' }, { userId: 1000 }],
        messages: [
          { id: 1, ago: 6 * DAY, text: 'Version 1.0 is out', forwardedFrom: 5001 },
          { id: 2, ago: 6 * DAY - HOUR, from: 1001, text: 'Congrats!', thread: 1, replyTo: 1 },
          { id: 3, ago: 5 * DAY, from: 1003, text: 'Finally', thread: 1, replyTo: 1 },
        ],
      },
    ],
    folders: [{ id: 2, title: 'Work', emoticon: '💼', include: [4001, 4002, 1001], exclude: [5002] }],
  };
}

/**
 * Where the mock account lives between commands. `TG_MOCK=1` keeps it in the mock profile's
 * config dir; any other value is a path to a state/scenario file (created from the seed if
 * missing). Delete the file to start over.
 */
export function mockStatePath(value = process.env.TG_MOCK ?? ''): string {
  return /^(1|true|yes|on)$/i.test(value) ? configFile('mock-state.json') : value;
}

export function loadWorld(path = mockStatePath()): MockWorld {
  if (existsSync(path)) {
    const world = JSON.parse(readFileSync(path, 'utf8')) as MockWorld;
    if (world?.version !== 1 || !Array.isArray(world.chats) || !Array.isArray(world.users)) {
      throw new Error(`${path} is not a mock state file (expected {"version":1,"me":…,"users":[…],"chats":[…]}). Delete it to start from the built-in account.`);
    }
    return world;
  }
  return seedWorld();
}

export function saveWorld(world: MockWorld, path = mockStatePath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(world, null, 1) + '\n', { encoding: 'utf8', mode: 0o600 });
}

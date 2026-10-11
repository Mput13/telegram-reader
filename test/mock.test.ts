import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TelegramClient } from 'teleproto';
import {
  clickButton, disconnectClient, getChatInfo, getChatMembers, getClient, getDialogs, getFolders, getForumTopics,
  getMessageButtons, getMessages, getReactionsList, getReadState, listContacts, markChatRead, reactToMessage,
  searchMessages, sendMessage,
} from '../src/client.js';
import { clientParams } from '../src/client-options.js';
import { assertWriteEnabled } from '../src/guard.js';
import { profile } from '../src/paths.js';
import { setStrictChatResolution } from '../src/resolve-mode.js';
import { MockClient } from '../src/mock/client.js';
import { loadWorld, mockStatePath, saveWorld, seedWorld, type MockWorld } from '../src/mock/world.js';

const mock = (world: MockWorld = seedWorld(), saved?: (world: MockWorld) => void) =>
  new MockClient(world, saved) as unknown as TelegramClient;

afterEach(async () => {
  await disconnectClient();
  setStrictChatResolution(false);
  delete process.env.TG_MOCK;
  delete process.env.TG_PROFILE;
});

describe('mock account: reads go through the real client code', () => {
  it('lists dialogs with types, unread counts, mute and archive flags', async () => {
    const chats = await getDialogs(mock(), 100);
    const byTitle = Object.fromEntries(chats.map(c => [c.title, c]));
    expect(byTitle['Alice Example']).toMatchObject({ id: '1001', type: 'user', username: 'alice_example', unreadCount: 2, lastMessage: 'Ping me when you are free' });
    expect(byTitle.Family).toMatchObject({ id: '-3001', type: 'group', unreadCount: 3 });
    expect(byTitle.Team).toMatchObject({ id: '-1004001', type: 'supergroup' });
    expect(byTitle['Mock News']).toMatchObject({ id: '-1005001', type: 'channel' });
    expect(byTitle['Bob Sample'].muted).toBe(true);
    expect(byTitle['Mock News Chat'].archived).toBe(true);
    // Newest chat first, as Telegram orders the list
    expect(chats[0].title).toBe('Alice Example');
  });

  it('reads history newest first with senders, replies and media', async () => {
    const { messages, chatTitle } = await getMessages(mock(), 'alice', { limit: 10 });
    expect(chatTitle).toBe('Alice');
    expect(messages.map(m => m.id)).toEqual([5, 4, 3, 2, 1]);
    expect(messages[2]).toMatchObject({ sender: 'Alice', text: 'Here is the new header', media: { kind: 'photo' } });
    expect(messages[3]).toMatchObject({ isOutgoing: true, sender: 'You', replyToMsgId: 1 });
  });

  it('pages with offsetId and minId like Telegram', async () => {
    const older = await getMessages(mock(), 'Family', { offsetId: 3 });
    expect(older.messages.map(m => m.id)).toEqual([2, 1]);
    const newer = await getMessages(mock(), 'Family', { minId: 3 });
    expect(newer.messages.map(m => m.id)).toEqual([5, 4]);
  });

  it('reads a forum topic and channel post comments from the discussion group', async () => {
    const topic = await getMessages(mock(), 'Dev Forum', { thread: 10 });
    expect(topic.messages.map(m => m.text)).toEqual(['Thanks! Any ETA?', 'Reproduced, looking into it', 'Login fails on the second device']);
    expect(topic.threadChatId).toBeUndefined();

    const comments = await getMessages(mock(), 'Mock News', { thread: 1 });
    expect(comments.messages.map(m => m.text)).toEqual(['Finally', 'Congrats!']);
    expect(comments.threadChatId).toBe('-1005002');
  });

  it('searches one chat and globally, with type and sender filters', async () => {
    const client = mock();
    const [global] = await searchMessages(client, 'deadline');
    expect(global.messages).toHaveLength(1);
    expect(global.messages[0]).toMatchObject({ chatId: '1001', text: 'Can we talk about the deadline tomorrow?' });

    const [photos] = await searchMessages(client, '', { type: 'photo' });
    expect(photos.messages.map(m => m.chatTitle).sort()).toEqual(['Alice Example', 'Mock News']);

    const [fromBob] = await searchMessages(client, '', { chat: 'Team', from: '@bob_sample' });
    expect(fromBob.messages.map(m => m.text)).toEqual(['CI is green again']);
  });

  it('answers info, members, topics, folders, contacts and read state', async () => {
    const client = mock();
    expect(await getChatInfo(client, 'Mock News')).toMatchObject({ type: 'channel', members: 15230, linkedChatId: '-1005002' });
    expect(await getChatInfo(client, '@demo_bot')).toMatchObject({ type: 'bot', about: expect.stringContaining('/start') });
    expect(await getChatInfo(client, 'Family')).toMatchObject({ type: 'group', about: 'Weekend plans' });

    const admins = await getChatMembers(client, 'Team', { adminsOnly: true });
    expect(admins.map(m => m.name)).toEqual(['Mock Owner', 'Alice Example']);
    const family = await getChatMembers(client, 'Family');
    expect(family.find(m => m.name === 'Carol')?.isAdmin).toBe(true);

    const { topics } = await getForumTopics(client, 'Dev Forum');
    expect(topics.map(t => [t.id, t.title, t.unread])).toEqual([[1, 'General', 0], [10, 'Bugs', 2], [20, 'Ideas', 0]]);
    await expect(getForumTopics(client, 'Team')).rejects.toThrow(/not a forum/);

    const [work] = await getFolders(client);
    expect(work).toMatchObject({ title: 'Work', emoticon: '💼' });
    expect(work.includedChats.map(c => c.title)).toEqual(['Team', 'Team Design', 'Alice']);

    expect((await listContacts(client)).map(c => c.name)).toEqual(['Alice Example', 'Bob Sample', 'Carol']);
    expect(await getReadState(client, 'alice')).toEqual({ readInboxMaxId: 3, unreadCount: 2 });
  });

  it('keeps the strict chat matching that guards real writes', async () => {
    setStrictChatResolution(true);
    await expect(sendMessage(mock(), 'Tea', 'x')).rejects.toThrow(/Did you mean:\n.*Team @mock_team\n.*Team Design/s);
  });
});

describe('mock account: writes change the world and are saved', () => {
  it('sends, replies, reacts and marks as read', async () => {
    const world = seedWorld();
    let saves = 0;
    const client = mock(world, () => { saves += 1; });

    const sent = await sendMessage(client, '@alice_example', 'On my way', 4);
    expect(sent.id).toBe(6);
    const { messages } = await getMessages(client, '@alice_example', { limit: 1 });
    expect(messages[0]).toMatchObject({ id: 6, text: 'On my way', isOutgoing: true, replyToMsgId: 4 });

    await reactToMessage(client, '@alice_example', 4, '🔥');
    expect((await getReactionsList(client, '@alice_example', 4)).reactions).toEqual([{ user: 'Mock', emoji: '🔥' }]);
    await reactToMessage(client, '@alice_example', 4, undefined, { remove: true });
    expect((await getReactionsList(client, '@alice_example', 4)).reactions).toEqual([]);

    await markChatRead(client, '@alice_example');
    await disconnectClient(); // drop the cached dialog list
    expect(await getReadState(client, '@alice_example')).toEqual({ readInboxMaxId: 6, unreadCount: 0 });
    expect(saves).toBe(4);
    await expect(sendMessage(client, '@alice_example', 'x', 99)).rejects.toThrow(/MSG_ID_INVALID/);
  });

  it('plays a scripted bot: commands, edit-in-place, alerts, new messages, URL and reply keyboards', async () => {
    const client = mock();
    const start = await sendMessage(client, '@demo_bot', '/start');
    const menuId = start.id + 1;
    const menu = await getMessageButtons(client, '@demo_bot', menuId);
    expect(menu.layout?.rows.flat().map(b => `${b.text}:${b.type}`)).toEqual(['Catalog:callback', 'Status:callback', 'Docs:url', 'Order:callback']);

    const catalog = await clickButton(client, '@demo_bot', menuId, { text: 'Catalog' }, { waitMs: 0 });
    expect(catalog.edited).toMatchObject({ text: 'Catalog: 3 items' });
    const back = await clickButton(client, '@demo_bot', menuId, { index: 1 }, { waitMs: 0 });
    expect(back.edited?.text).toBe('Welcome! Pick a section.');

    const status = await clickButton(client, '@demo_bot', menuId, { text: 'Status' }, { waitMs: 0 });
    expect(status).toMatchObject({ action: 'callback', answerText: 'All systems normal', isAlert: undefined });
    expect(status.edited).toBeUndefined();

    const order = await clickButton(client, '@demo_bot', menuId, { text: 'Order' }, { waitMs: 0 });
    expect(order).toMatchObject({ answerText: 'Order created', isAlert: true });
    expect(order.newMessages?.map(m => m.text)).toEqual(['Order #42 is confirmed.']);

    expect(await clickButton(client, '@demo_bot', menuId, { text: 'Docs' }, { waitMs: 0 })).toMatchObject({ action: 'url', url: 'https://example.com/docs' });

    const keyboard = await sendMessage(client, '@demo_bot', '/keyboard');
    const yes = await clickButton(client, '@demo_bot', keyboard.id + 1, { text: 'Yes' }, { waitMs: 0 });
    expect(yes.action).toBe('sent_text');
    expect(yes.newMessages?.at(-1)?.text).toBe('You said yes.');
  });

  it('says what is missing instead of failing somewhere deeper', async () => {
    const client = mock() as unknown as MockClient;
    await expect(client.invoke({ className: 'stories.GetPeerStories' })).rejects.toThrow('mock: the request stories.GetPeerStories is not implemented');
    expect(() => client.addEventHandler()).toThrow(/live updates/);
  });

  it('round-trips through the state file, and the seed ages with the clock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-mock-'));
    const file = join(dir, 'state.json');
    try {
      expect(loadWorld(file)).toEqual(seedWorld());
      const world = seedWorld();
      world.chats[1].messages.push({ id: 6, date: 1700000000, out: true, text: 'saved' });
      saveWorld(world, file);
      expect(loadWorld(file).chats[1].messages.at(-1)).toEqual({ id: 6, date: 1700000000, out: true, text: 'saved' });
      writeFileSync(file, '{"chats":[]}');
      expect(() => loadWorld(file)).toThrow(/not a mock state file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TG_MOCK wiring', () => {
  it('getClient() hands out the mock without touching config, and no real client can be built', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-mock-'));
    process.env.TG_MOCK = join(dir, 'state.json');
    try {
      const client = await getClient();
      expect(client).toBeInstanceOf(MockClient);
      expect((await client.getMe()).username).toBe('mock_owner');
      // Every `new TelegramClient(...)` in src/ takes clientParams(), so this is the choke point
      expect(() => clientParams()).toThrow(/mock mode/);
      expect(() => clientParams(true)).toThrow(/mock mode/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('forces a mock profile, so real profiles never see mock audit logs or state', () => {
    process.env.TG_MOCK = '1';
    expect(profile()).toBe('mock');
    process.env.TG_PROFILE = 'dev';
    expect(profile()).toBe('mock');
    process.env.TG_PROFILE = 'mock-ci';
    expect(profile()).toBe('mock-ci');
    expect(mockStatePath()).toMatch(/tg-mock-ci[\\/]mock-state\.json$/);
    expect(mockStatePath(join('scenarios', 'a.json'))).toBe(join('scenarios', 'a.json'));
    delete process.env.TG_MOCK;
    expect(profile()).toBe('mock-ci');
  });

  it('lets mock writes through the write guard (there is nothing real to approve)', () => {
    process.env.TG_MOCK = '1';
    expect(() => assertWriteEnabled()).not.toThrow();
    setStrictChatResolution(false);
  });
});

describe('CLI in mock mode (from src/)', () => {
  const home = mkdtempSync(join(tmpdir(), 'tg-mock-home-'));
  const state = join(home, 'state.json');
  // Same rule as configDir() in src/paths.ts: %APPDATA% on Windows, ~/.config elsewhere
  const configDir = (name: string) => (process.platform === 'win32' ? join(home, 'AppData', name) : join(home, '.config', name));
  const run = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData'), TG_MOCK: state, TG_NO_UPDATE_CHECK: '1', TG_PROFILE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  it('a write is visible to the next command and nothing real is touched', () => {
    try {
      const inbox = JSON.parse(run('inbox', '--json'));
      expect(inbox).toMatchObject({ totalUnread: 11, chatsWithUnread: 6 });

      const sent = JSON.parse(run('send', '-1004001', 'ship it', '--json'));
      expect(sent).toMatchObject({ id: 4, text: 'ship it' });
      const read = JSON.parse(run('read', 'Team', '-n', '1', '--json'));
      expect(read.messages[0]).toMatchObject({ id: 4, text: 'ship it', isOutgoing: true });

      expect(existsSync(state)).toBe(true);
      expect(readFileSync(join(configDir('tg-mock'), 'audit.jsonl'), 'utf8')).toContain('"command":"send"');
      expect(existsSync(configDir('tg'))).toBe(false);

      let refused = '';
      try { run('auth'); } catch (error) { refused = String((error as { stderr?: string }).stderr); }
      expect(refused).toMatch(/does nothing in mock mode/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});

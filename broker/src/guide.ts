/**
 * Install guide on the signup page: common steps (CLI, login), then one tab per agent (Claude Code, Codex, Cursor, Claude Desktop) with
 * its own steps and a drawn "screenshot" of what the person will see. The screens are HTML mockups,
 * not captures: crisp on any display, no personal data, nothing extra to host.
 */

import type { Dict } from './i18n';

export const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const CURSOR_INSTALL = 'https://cursor.com/en/install-mcp?name=telegram&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImJldHRlci10Zy1jbGlAbGF0ZXN0IiwibWNwIl19';
const MCPB = 'https://github.com/TheVilfer/better-tg-cli/releases/latest/download/better-tg-cli.mcpb';

/** A copyable command or text block; the button label comes from the page language. */
export const code = (text: string, copy: string, wrap = false) =>
  `<div class="box"><pre${wrap ? ' class="wrap"' : ''}>${escape(text)}</pre><button type="button" data-copy>${escape(copy)}</button></div>`;

// ---- drawn screens -----------------------------------------------------------------------------

export const d = (t: string) => `<span class="s-dim">${t}</span>`;
export const a = (t: string) => `<span class="s-acc">${t}</span>`;
const g = (t: string) => `<span class="s-ok">${t}</span>`;
export const b = (t: string) => `<b>${t}</b>`;

export function terminal(title: string, lines: string[]): string {
  return `<figure class="screen term" aria-hidden="true"><div class="s-bar"><i></i><i></i><i></i><span>${title}</span></div>
<div class="s-body">${lines.join('<br>')}</div></figure>`;
}

function screens(t: Dict): Record<AgentId, string> {
  const s = t.guide.screens;
  return {
    'claude-code': terminal('claude', [
      `${d('&gt;')} /plugin install better-tg-cli@better-tg-cli`,
      `  ${d('⎿')} ${g('✓ Installed better-tg-cli')} ${d('(skill + MCP server)')}`,
      '',
      `${d('&gt;')} ${escape(s.claudeAsk)}`,
      '',
      `${a('⏺')} ${b('telegram_read')}${d('(inbox -n 5)')}`,
      `  ${d('⎿')} ${d('12 unread in 4 chats')}`,
      `${a('⏺')} ${escape(s.claudeAnswer[0])}`,
      `  ${escape(s.claudeAnswer[1])}`,
    ]),
    codex: terminal('codex', [
      `${d('&gt;_')} ${b('OpenAI Codex')}`,
      '',
      `${d('›')} ${escape(s.codexAsk)}`,
      '',
      `${d('•')} ${b('Ran')} ${a('telegram read @alice -n 5')}`,
      `  ${d('└')} ${d('5 messages')}`,
      '',
      `${d('•')} ${escape(s.codexAnswer[0])}`,
      `  ${escape(s.codexAnswer[1])}`,
    ]),
    cursor: `<figure class="screen app" aria-hidden="true"><div class="s-bar"><i></i><i></i><i></i><span>Cursor</span></div>
<div class="s-dialog"><div class="s-title">Install MCP Server?</div>
<div class="s-row"><span class="s-dim">Name</span><span>telegram</span></div>
<div class="s-row"><span class="s-dim">Command</span><span class="s-mono">npx -y better-tg-cli@latest mcp</span></div>
<div class="s-actions"><span class="s-btn ghost">Cancel</span><span class="s-btn">Install</span></div></div></figure>`,
    'claude-desktop': `<figure class="screen app" aria-hidden="true"><div class="s-bar"><i></i><i></i><i></i><span>Claude</span></div>
<div class="s-dialog"><div class="s-ext"><div class="s-logo"><svg viewBox="0 0 12 12" shape-rendering="crispEdges"><rect x="2" y="2" width="2" height="8" fill="#fff"/><rect x="4" y="5" width="2" height="2" fill="#fff"/><rect x="6" y="8" width="4" height="2" fill="#0b0b0b"/></svg></div><div><div class="s-title">Telegram (better-tg-cli)</div>
<div class="s-dim">Sergei Polin · MCP server</div></div></div>
<div class="s-row"><span class="s-dim">Tools</span><span class="s-mono">telegram_help, telegram_read, telegram_write</span></div>
<div class="s-row"><span class="s-dim">Profile</span><span class="s-mono">default</span></div>
<div class="s-actions"><span class="s-btn ghost">Cancel</span><span class="s-btn">Install</span></div></div></figure>`,
  };
}

// ---- tabs --------------------------------------------------------------------------------------

type AgentId = keyof Dict['guide']['tabs'];
const AGENTS: { id: AgentId; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
];

const step = (title: string, body: string) => `<li><h4>${escape(title)}</h4>${body}</li>`;
const p = (text: string) => `<p>${escape(text)}</p>`;

/** Commands and buttons per agent; the words around them come from the dictionary. */
function agentSteps(id: AgentId, t: Dict): string {
  const [[t1, x1], [t2, x2]] = t.guide.tabs[id];
  const c = (cmd: string) => code(cmd, t.client.copy);
  switch (id) {
    case 'claude-code':
      return step(t1, p(x1) + c('/plugin marketplace add TheVilfer/better-tg-cli') + c('/plugin install better-tg-cli@better-tg-cli')) + step(t2, p(x2));
    case 'codex':
      return step(t1, p(x1) + c('codex plugin marketplace add TheVilfer/better-tg-cli') + c('codex plugin add better-tg-cli@better-tg-cli')) + step(t2, p(x2));
    case 'cursor':
      return step(t1, `<p><a class="btn" href="${CURSOR_INSTALL}">${escape(t.guide.cursorButton)}</a></p>` + p(x1))
        + step(t2, p(x2) + c('npx skills add TheVilfer/better-tg-cli -g -a cursor -y'));
    case 'claude-desktop':
      return step(t1, `<p><a class="btn" href="${MCPB}">${escape(t.guide.mcpbButton)}</a></p>` + p(x1)) + step(t2, p(x2));
  }
}

/** Auto mode: one prompt that has the agent do the setup; the person only logs in. */
export const autoPrompt = (t: Dict) => t.guide.prompt.join('\n');

function autoScreen(t: Dict): string {
  const s = t.guide.screens;
  return terminal(escape(s.agent), [
    `${d('&gt;')} ${escape(s.promptEcho)}`,
    '',
    `${a('⏺')} ${b('Bash')}${d('(brew install thevilfer/tap/better-tg-cli)')}`,
    `  ${d('⎿')} ${g('✓')} ${d('better-tg-cli installed')}`,
    `${a('⏺')} ${b('Bash')}${d('(telegram onboard --json)')}`,
    `  ${d('⎿')} ${d('waiting_scan … need_password …')} ${g('done')}`,
    `${a('⏺')} ${b('Bash')}${d('(telegram skill install)')}`,
    `  ${d('⎿')} ${g('✓')} ${d('Claude Code installed')}`,
    `${a('⏺')} ${escape(s.autoDone)}`,
  ]);
}

function tablist(label: string, items: { id: string; label: string; body: string }[], cls: string): string {
  const tabs = items.map((x, i) =>
    `<button type="button" role="tab" id="tab-${x.id}" aria-controls="panel-${x.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${x.label}</button>`).join('');
  const panels = items.map((x, i) =>
    `<div role="tabpanel" id="panel-${x.id}" aria-labelledby="tab-${x.id}"${i === 0 ? '' : ' hidden'}>${x.body}</div>`).join('');
  return `<div class="${cls}" role="tablist" aria-label="${escape(label)}">${tabs}</div>${panels}`;
}

function autoHtml(t: Dict): string {
  const x = t.guide;
  return `<ol class="steps">
<li><h3>${escape(x.autoPasteTitle)}</h3>
  ${p(x.autoPasteText)}${code(autoPrompt(t), t.client.copy, true)}
  ${autoScreen(t)}</li>
<li><h3>${escape(x.autoLoginTitle)}</h3>
  ${p(x.autoLoginText)}</li>
<li><h3>${escape(x.doneTitle)}</h3>
  <p>${x.autoDoneHtml}</p>
  <p class="note">${escape(x.autoDesktopNote)}</p></li>
</ol>`;
}

function proHtml(t: Dict): string {
  const x = t.guide;
  const shots = screens(t);
  const agents = tablist(x.agentLabel, AGENTS.map(ag => ({ id: ag.id, label: ag.label, body: `<ol class="sub">${agentSteps(ag.id, t)}</ol>${shots[ag.id]}` })), 'tabs');
  return `<ol class="steps">
<li><h3>${escape(x.installTitle)}</h3>
  ${p(x.installText)}${code('brew install thevilfer/tap/better-tg-cli', t.client.copy)}
  <p class="note">${x.installNoteHtml}</p></li>
<li><h3>${escape(x.loginTitle)}</h3>
  ${p(x.loginText)}${code('telegram auth --login-key --qr', t.client.copy)}<p class="note">${x.loginNoteHtml}</p></li>
<li><h3>${escape(x.connectTitle)}</h3>${agents}</li>
<li><h3>${escape(x.doneTitle)}</h3>
  ${p(x.proDoneText)}${code('telegram write-access on --for 1h', t.client.copy)}</li>
</ol>`;
}

export function guideHtml(t: Dict): string {
  const x = t.guide;
  const modes = tablist(x.modeLabel, [
    { id: 'auto', label: `${escape(x.autoLabel)} <small>${escape(x.autoSmall)}</small>`, body: autoHtml(t) },
    { id: 'pro', label: `${escape(x.proLabel)} <small>${escape(x.proSmall)}</small>`, body: proHtml(t) },
  ], 'modes');
  return `<section class="guide" id="guide">
<h2>${escape(x.title)}</h2>
${modes}
</section>`;
}

/** The drawn terminal window, also used on the landing page. */
export const SCREEN_CSS = `.screen{margin:0;border:1px solid #2a2a2a;border-radius:12px;background:#0b0b0b;color:#ececec;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.18)}
.s-bar{height:32px;display:flex;align-items:center;gap:6px;padding:0 12px;border-bottom:1px solid #222;background:#111}
.s-bar i{width:10px;height:10px;border-radius:50%;background:#333}
.s-bar span{margin:0 auto;transform:translateX(-24px);font:12px 'Geist Mono',ui-monospace,monospace;color:#8a8a8a}
.s-body{padding:14px 16px 16px;font:13px/1.65 'Geist Mono',ui-monospace,monospace;overflow-x:auto;white-space:nowrap}
.s-dim{color:#7d7d7d}.s-acc{color:#2AABEE}.s-ok{color:#3fb950}`;

export const GUIDE_CSS = `
.guide{margin-top:64px;padding-top:40px;border-top:1px solid var(--line)}
.guide h2{font-size:26px;letter-spacing:-.5px;margin:0 0 24px}
.steps{list-style:none;counter-reset:s;padding:0;margin:0}
.steps>li{counter-increment:s;position:relative;padding-left:44px;margin-bottom:36px}
.steps>li::before{content:counter(s);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;font-size:14px;font-weight:500;color:var(--dim)}
.steps h3{font-size:18px;margin:2px 0 8px}
.steps p{margin:0 0 10px;color:var(--dim)}
.steps .box{margin-bottom:10px}
.note{font-size:14px}
.modes{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border:1px solid var(--line);border-radius:12px;background:var(--panel);margin:0 0 28px}
.modes button{font-size:15px;font-weight:600;padding:10px 8px;border-radius:9px;border:0;background:transparent;color:var(--dim);display:flex;flex-direction:column;align-items:center;gap:1px}
.modes button small{font-size:12px;font-weight:400;opacity:.8}
.modes button[aria-selected="true"]{background:var(--bg);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.steps .screen{margin-top:14px}
.tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:14px 0 18px;padding-bottom:2px}
.tabs::-webkit-scrollbar{display:none}
.tabs button{flex:none;font-size:14px;font-weight:500;padding:8px 13px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--dim)}
.tabs button[aria-selected="true"]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.sub{padding-left:20px;margin:0 0 16px}
.sub li{margin-bottom:14px;color:var(--dim)}
.sub h4{font-size:15px;color:var(--fg);margin:0 0 6px;font-weight:600}
.btn{display:inline-block;text-decoration:none;font-weight:500;padding:10px 16px;border-radius:10px;background:var(--fg);color:var(--bg)!important}
${SCREEN_CSS}
.s-dialog{margin:22px auto;max-width:400px;border:1px solid #2a2a2a;border-radius:12px;background:#151515;padding:18px;font-size:14px}
.s-title{font-weight:600;font-size:15px;margin-bottom:12px}
.s-row{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-top:1px solid #232323}
.s-row span:last-child{text-align:right;min-width:0;overflow-wrap:anywhere}
.s-mono{font:12.5px 'Geist Mono',ui-monospace,monospace}
.s-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.s-btn{padding:7px 14px;border-radius:8px;background:#ececec;color:#0b0b0b;font-weight:500;font-size:13px}
.s-btn.ghost{background:transparent;color:#bbb;border:1px solid #333}
.s-ext{display:flex;gap:12px;align-items:center;margin-bottom:12px}
.s-ext .s-title{margin:0}
.s-logo{width:40px;height:40px;border-radius:10px;background:#2AABEE;flex:none;padding:6px}
.s-logo svg{width:100%;height:100%}
.box pre{white-space:pre;word-break:normal;overflow-x:auto;scrollbar-width:thin}
.box pre.wrap{white-space:pre-wrap;overflow-wrap:anywhere}
`;

/** Tab switching with arrow keys; ?agent=<id> preselects a tab. */
export const GUIDE_JS = `
(() => {
  const lists = [...document.querySelectorAll('[role="tablist"]')];
  const select = t => {
    for (const x of t.parentElement.querySelectorAll('[role="tab"]')) {
      const on = x === t;
      x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
    }
  };
  for (const list of lists) {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    for (const t of tabs) {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', e => {
        const i = tabs.indexOf(t), n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (n) { const next = tabs[(i + n + tabs.length) % tabs.length]; select(next); next.focus(); }
      });
    }
  }
  // ?mode=pro and/or ?agent=<id> (an agent implies PRO)
  const q = new URLSearchParams(location.search);
  const agent = q.get('agent') && document.getElementById('tab-' + q.get('agent'));
  const mode = document.getElementById('tab-' + (agent ? 'pro' : q.get('mode')));
  if (mode) select(mode);
  if (agent) select(agent);
})();
`;

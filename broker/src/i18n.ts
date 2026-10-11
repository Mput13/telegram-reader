/**
 * Strings for the signup page, its install guide and the code email, in English (default),
 * Spanish and Russian. `en` defines the shape; the others are typed against it, so a missing key
 * fails the typecheck. Values ending in `Html` are trusted markup; everything else is plain text.
 */

export const LANGS = ['en', 'es', 'ru'] as const;
export type Lang = (typeof LANGS)[number];

const isLang = (x: string): x is Lang => (LANGS as readonly string[]).includes(x);

/** ?lang= wins, then the first Accept-Language tag we support, then English. */
export function pickLang(query: string | null, acceptLanguage: string | null): Lang {
  if (query && isLang(query.toLowerCase())) return query.toLowerCase() as Lang;
  const tags = (acceptLanguage ?? '')
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
      return { base: tag.toLowerCase().split('-')[0], q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter(t => t.base && t.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const t of tags) if (isLang(t.base)) return t.base;
  return 'en';
}

/** Only these three reach the mail template; anything else is English. */
export const asLang = (x: unknown): Lang => (typeof x === 'string' && isLang(x) ? x : 'en');

const en = {
  langName: 'English',
  page: {
    title: 'Better-TG-CLI: Telegram for your terminal and AI agents',
    description: 'Open-source Telegram client for Claude Code, Codex, Cursor and the command line. Read-only until you allow writes. Get a free invite, no API keys needed.',
    ogLocale: 'en_US',
    h1: 'Invite to log in to Better-TG-CLI',
    leadHtml: 'An invite lets you log in to your Telegram account through the CLI without creating your own API keys on my.telegram.org. Confirm your email with a code: one email, one invite, and asking again replaces it. Your messages and session stay on your computer only.\nAlready have your own keys? <a href="#guide">Skip to installation</a>.',
    cliBannerHtml: 'You came from <span class="mono">telegram onboard</span>. Once your email is confirmed, the invite goes back to the CLI by itself, so there is nothing to copy.',
    emailLabel: 'Email',
    emailHint: 'Only for notices: important updates and revoked keys. Never shared, no newsletters.',
    getCode: 'Email me a code',
    codeLabel: 'Code from the email',
    codeHintBefore: 'We sent 6 digits to',
    codeHintAfter: 'Check your spam folder if it does not arrive.',
    getInvite: 'Get the invite',
    changeEmail: 'Change the email or resend',
    closedHtml: '<b>Signups are closed right now.</b> You can log in with your own keys: create an app on <a href="https://my.telegram.org/apps">my.telegram.org</a> and run <code>telegram auth</code>. See the <a href="https://github.com/TheVilfer/better-tg-cli#log-in">README</a>.',
    doneTitle: 'Your invite',
    doneText: 'Shown only once. Save it and do not send it to an agent or anyone else: you will need it at the login step.',
    backCli: 'Passing the invite to the CLI… If the CLI page did not open, copy the invite and paste it there.',
    nextInstall: 'Next: installation ↓',
    footerSource: 'Open source',
    footerPrivacy: 'Privacy',
    language: 'Language',
  },
  client: {
    errors: {
      bad_email: 'Check the email address.',
      captcha_failed: 'The check did not pass. Reload the page and try again.',
      email_used: 'The invite for this email was revoked. Reach out on GitHub.',
      rate_limited: 'Too many attempts. Try again later.',
      daily_limit: 'No more invites today. Come back tomorrow.',
      signups_closed: 'Signups are closed right now.',
      resend_wait: 'A code was just sent. You can request a new one in a minute.',
      mail_failed: 'Could not send the email. Check the address or try again later.',
      bad_code: 'That code did not work. Check the digits in the email.',
      code_expired: 'The code expired. Request a new one.',
      too_many_attempts: 'Too many wrong attempts. Request a new code.',
    },
    generic: 'Something went wrong. Try again.',
    waitCaptcha: 'Wait for the “I am not a robot” check.',
    copy: 'Copy',
    copied: 'Copied',
    copyManual: 'Select it manually',
  },
  guide: {
    title: 'How to install',
    modeLabel: 'Mode',
    agentLabel: 'Agent',
    autoLabel: 'Auto',
    autoSmall: 'a prompt for your agent',
    proLabel: 'PRO',
    proSmall: 'commands by hand',
    autoPasteTitle: 'Paste the prompt into your agent',
    autoPasteText: 'Claude Code, Codex, Cursor or any other agent with a terminal. It installs the CLI and the skill and opens the login page.',
    autoLoginTitle: 'Go through the login page',
    autoLoginText: 'The agent opens it in the browser on your computer. There you get an invite (your email is confirmed with a code and the invite comes back by itself), scan the QR code in Telegram (Settings → Devices → Link Desktop Device) and enter your cloud password if you have one. The agent sees none of it.',
    doneTitle: 'Done',
    autoDoneHtml: 'Ask your agent, for example: “what’s unread in my Telegram?” It can write on your behalf only after you allow it: <span class="mono">telegram write-access on --for 1h</span>.',
    autoDesktopNote: 'Claude Desktop has no terminal, so it can’t do this. Use PRO mode for it.',
    installTitle: 'Install the CLI',
    installText: 'macOS or Linux, in a terminal:',
    installNoteHtml: 'No Homebrew? <span class="mono">npm install -g better-tg-cli</span> (Node 20+). On Windows: <span class="mono">scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket</span>, then <span class="mono">scoop install better-tg-cli</span>.',
    loginTitle: 'Log in to Telegram yourself',
    loginText: 'Login is interactive, so you do it, not the agent:',
    loginNoteHtml: 'Paste the invite from this page and scan the QR code in Telegram: Settings → Devices → Link Desktop Device. With your own keys from my.telegram.org: <span class="mono">telegram auth --qr</span>.',
    connectTitle: 'Connect your agent',
    proDoneText: 'By default the agent only reads. It can write on your behalf once you allow it:',
    tabs: {
      'claude-code': [
        ['Install the plugin', 'In Claude Code, type these one by one. The plugin is the skill and the MCP server in one.'],
        ['Restart Claude Code', 'Then ask, for example: “what’s unread in my Telegram?”'],
      ],
      codex: [
        ['Install the plugin', 'In a regular terminal:'],
        ['Open Codex again', 'The skill and the MCP server load by themselves. Ask: “what did Alice write?”'],
      ],
      cursor: [
        ['Install the MCP server', 'Cursor asks for confirmation: click Install.'],
        ['Add the skill (optional)', 'It teaches the agent to work with Telegram carefully:'],
      ],
      'claude-desktop': [
        ['Download the extension', 'Double-click the file: Claude shows a card, click Install. The extension needs neither Node nor brew.'],
        ['Ask in the chat', 'For example: “summarize what’s unread in Telegram”.'],
      ],
    },
    cursorButton: 'Install in Cursor',
    mcpbButton: 'Download better-tg-cli.mcpb',
    prompt: [
      'Connect my Telegram through Better-TG-CLI (https://github.com/TheVilfer/better-tg-cli):',
      '1. Install the CLI: `brew install thevilfer/tap/better-tg-cli`. Without Homebrew: `npm install -g better-tg-cli` (needs Node 20+). On Windows: `scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket` and `scoop install better-tg-cli`.',
      '2. Run `telegram onboard --json` (in the background if your timeout is shorter than 15 minutes). A page opens where I get an invite, scan a QR code and enter my password myself. Wait for the `done` event. Don’t ask me for codes, passwords or the invite, and don’t fill in the page yourself.',
      '3. Install the skill for yourself: `telegram skill install`.',
      '4. Check the login with `telegram whoami` and briefly tell me what you can now do in Telegram.',
    ],
    screens: {
      agent: 'agent',
      promptEcho: 'Connect my Telegram through Better-TG-CLI…',
      autoDone: 'Done: you are logged in as Alice (@alice).',
      claudeAsk: 'what’s unread in my Telegram?',
      claudeAnswer: ['Most of it is in “Rust Seattle” (41). Alice', 'asks if the 7 pm meetup is still on.'],
      codexAsk: 'what did Alice write?',
      codexAnswer: ['Alice asks if the 7 pm meetup is still on', 'and asks you to bring a laptop.'],
    },
  },
  mail: {
    subject: (code: string) => `Your Better-TG-CLI invite code: ${code}`,
    intro: 'Your code for a <b>Better-TG-CLI</b> invite:',
    textIntro: (code: string) => `Your code: ${code}`,
    enter: 'Enter it on the invite page. The code is valid for 15 minutes.',
    ignore: 'If you did not ask for a Better-TG-CLI invite, just delete this email.',
  },
};

export type Dict = typeof en;

const es: Dict = {
  langName: 'Español',
  page: {
    title: 'Better-TG-CLI: Telegram para tu terminal y tus agentes de IA',
    description: 'Cliente de Telegram de código abierto para Claude Code, Codex, Cursor y la línea de comandos. Solo lectura hasta que permitas escribir. Consigue una invitación gratis, sin claves de API.',
    ogLocale: 'es_ES',
    h1: 'Invitación para entrar en Better-TG-CLI',
    leadHtml: 'Con una invitación entras en tu cuenta de Telegram desde la CLI sin crear tus propias claves de API en my.telegram.org. Confirma tu correo con un código: un correo, una invitación, y si la pides otra vez, la nueva sustituye a la anterior. Tus mensajes y tu sesión se quedan solo en tu equipo.\n¿Ya tienes tus propias claves? <a href="#guide">Ir a la instalación</a>.',
    cliBannerHtml: 'Vienes de <span class="mono">telegram onboard</span>. Cuando confirmes tu correo, la invitación volverá sola a la CLI: no tienes que copiar nada.',
    emailLabel: 'Correo electrónico',
    emailHint: 'Solo para avisos: actualizaciones importantes y claves revocadas. No lo compartimos ni enviamos boletines.',
    getCode: 'Enviarme un código',
    codeLabel: 'Código del correo',
    codeHintBefore: 'Enviamos 6 dígitos a',
    codeHintAfter: 'Si no llega, revisa la carpeta de spam.',
    getInvite: 'Obtener la invitación',
    changeEmail: 'Cambiar el correo o reenviar',
    closedHtml: '<b>El registro está cerrado ahora mismo.</b> Puedes entrar con tus propias claves: crea una aplicación en <a href="https://my.telegram.org/apps">my.telegram.org</a> y ejecuta <code>telegram auth</code>. Consulta el <a href="https://github.com/TheVilfer/better-tg-cli#log-in">README</a>.',
    doneTitle: 'Tu invitación',
    doneText: 'Solo se muestra una vez. Guárdala y no se la envíes a un agente ni a nadie: la necesitarás al iniciar sesión.',
    backCli: 'Pasando la invitación a la CLI… Si la página de la CLI no se abrió, copia la invitación y pégala allí.',
    nextInstall: 'Siguiente: instalación ↓',
    footerSource: 'Código abierto',
    footerPrivacy: 'Privacidad',
    language: 'Idioma',
  },
  client: {
    errors: {
      bad_email: 'Revisa la dirección de correo.',
      captcha_failed: 'La verificación no pasó. Recarga la página e inténtalo de nuevo.',
      email_used: 'La invitación de este correo fue revocada. Escríbenos en GitHub.',
      rate_limited: 'Demasiados intentos. Inténtalo más tarde.',
      daily_limit: 'Por hoy no quedan invitaciones. Vuelve mañana.',
      signups_closed: 'El registro está cerrado ahora mismo.',
      resend_wait: 'Acabamos de enviar un código. Podrás pedir otro en un minuto.',
      mail_failed: 'No pudimos enviar el correo. Revisa la dirección o inténtalo más tarde.',
      bad_code: 'El código no es válido. Revisa los dígitos del correo.',
      code_expired: 'El código caducó. Pide uno nuevo.',
      too_many_attempts: 'Demasiados intentos fallidos. Pide un código nuevo.',
    },
    generic: 'Algo salió mal. Inténtalo de nuevo.',
    waitCaptcha: 'Espera a la verificación «No soy un robot».',
    copy: 'Copiar',
    copied: 'Copiado',
    copyManual: 'Selecciónalo a mano',
  },
  guide: {
    title: 'Cómo instalarlo',
    modeLabel: 'Modo',
    agentLabel: 'Agente',
    autoLabel: 'Auto',
    autoSmall: 'un prompt para tu agente',
    proLabel: 'PRO',
    proSmall: 'comandos a mano',
    autoPasteTitle: 'Pega el prompt en tu agente',
    autoPasteText: 'Claude Code, Codex, Cursor o cualquier otro agente con terminal. Instalará la CLI y la skill y abrirá la página de inicio de sesión.',
    autoLoginTitle: 'Completa la página de inicio de sesión',
    autoLoginText: 'El agente la abre en el navegador de tu equipo. Allí obtienes una invitación (tu correo se confirma con un código y la invitación vuelve sola), escaneas el código QR en Telegram (Ajustes → Dispositivos → Vincular dispositivo de escritorio) e introduces tu contraseña en la nube si la tienes. El agente no ve nada de esto.',
    doneTitle: 'Listo',
    autoDoneHtml: 'Pregúntale a tu agente, por ejemplo: «¿qué tengo sin leer en Telegram?». Solo podrá escribir en tu nombre cuando lo permitas: <span class="mono">telegram write-access on --for 1h</span>.',
    autoDesktopNote: 'Claude Desktop no tiene terminal, así que no puede hacerlo. Para él, usa el modo PRO.',
    installTitle: 'Instala la CLI',
    installText: 'macOS o Linux, en una terminal:',
    installNoteHtml: '¿Sin Homebrew? <span class="mono">npm install -g better-tg-cli</span> (Node 20+). En Windows: <span class="mono">scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket</span> y después <span class="mono">scoop install better-tg-cli</span>.',
    loginTitle: 'Inicia sesión en Telegram tú mismo',
    loginText: 'El inicio de sesión es interactivo, así que lo haces tú y no el agente:',
    loginNoteHtml: 'Pega la invitación de esta página y escanea el código QR en Telegram: Ajustes → Dispositivos → Vincular dispositivo de escritorio. Con tus propias claves de my.telegram.org: <span class="mono">telegram auth --qr</span>.',
    connectTitle: 'Conecta tu agente',
    proDoneText: 'Por defecto el agente solo lee. Podrá escribir en tu nombre cuando lo permitas:',
    tabs: {
      'claude-code': [
        ['Instala el plugin', 'En Claude Code, escribe estos comandos uno a uno. El plugin incluye la skill y el servidor MCP.'],
        ['Reinicia Claude Code', 'Y pregunta, por ejemplo: «¿qué tengo sin leer en Telegram?»'],
      ],
      codex: [
        ['Instala el plugin', 'En una terminal normal:'],
        ['Vuelve a abrir Codex', 'La skill y el servidor MCP se cargan solos. Pregunta: «¿qué escribió Alice?»'],
      ],
      cursor: [
        ['Instala el servidor MCP', 'Cursor pedirá confirmación: pulsa Install.'],
        ['Añade la skill (opcional)', 'Enseña al agente a trabajar con Telegram con cuidado:'],
      ],
      'claude-desktop': [
        ['Descarga la extensión', 'Abre el archivo con doble clic: Claude mostrará una tarjeta, pulsa Install. La extensión no necesita Node ni brew.'],
        ['Pregunta en el chat', 'Por ejemplo: «resume lo que tengo sin leer en Telegram».'],
      ],
    },
    cursorButton: 'Instalar en Cursor',
    mcpbButton: 'Descargar better-tg-cli.mcpb',
    prompt: [
      'Conecta mi Telegram con Better-TG-CLI (https://github.com/TheVilfer/better-tg-cli):',
      '1. Instala la CLI: `brew install thevilfer/tap/better-tg-cli`. Sin Homebrew: `npm install -g better-tg-cli` (necesita Node 20+). En Windows: `scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket` y `scoop install better-tg-cli`.',
      '2. Ejecuta `telegram onboard --json` (en segundo plano si tu tiempo límite es menor de 15 minutos). Se abrirá una página donde yo mismo obtengo la invitación, escaneo el código QR e introduzco mi contraseña. Espera al evento `done`. No me pidas códigos, contraseñas ni la invitación, y no rellenes la página tú.',
      '3. Instálate la skill: `telegram skill install`.',
      '4. Comprueba el inicio de sesión con `telegram whoami` y cuéntame brevemente qué puedes hacer ahora en Telegram.',
    ],
    screens: {
      agent: 'agente',
      promptEcho: 'Conecta mi Telegram con Better-TG-CLI…',
      autoDone: 'Listo: has iniciado sesión como Alice (@alice).',
      claudeAsk: '¿qué tengo sin leer en Telegram?',
      claudeAnswer: ['Lo más en «Rust Seattle» (41). Alice', 'pregunta si sigue en pie la quedada de las 7.'],
      codexAsk: '¿qué escribió Alice?',
      codexAnswer: ['Alice pregunta si sigue en pie la quedada de las 7', 'y te pide que lleves el portátil.'],
    },
  },
  mail: {
    subject: (code: string) => `Tu código de invitación a Better-TG-CLI: ${code}`,
    intro: 'Tu código para la invitación a <b>Better-TG-CLI</b>:',
    textIntro: (code: string) => `Tu código: ${code}`,
    enter: 'Introdúcelo en la página de la invitación. El código es válido durante 15 minutos.',
    ignore: 'Si no pediste una invitación a Better-TG-CLI, simplemente borra este correo.',
  },
};

const ru: Dict = {
  langName: 'Русский',
  page: {
    title: 'Better-TG-CLI: Telegram для терминала и AI-агентов',
    description: 'Open-source клиент Telegram для Claude Code, Codex, Cursor и командной строки. Только чтение, пока вы не разрешите запись. Бесплатный инвайт, без своих API-ключей.',
    ogLocale: 'ru_RU',
    h1: 'Инвайт для входа в Better-TG-CLI',
    leadHtml: 'Инвайт позволяет войти в свой Telegram через CLI без своих API-ключей с my.telegram.org. Подтвердите почту кодом из письма: одна почта — один инвайт, повторный запрос заменяет прежний. Сообщения и сессия остаются только на вашем компьютере.\nУже есть свои ключи? <a href="#guide">Сразу к установке</a>.',
    cliBannerHtml: 'Вас прислал <span class="mono">telegram onboard</span>. После подтверждения почты инвайт сам вернётся в CLI — копировать ничего не нужно.',
    emailLabel: 'Почта',
    emailHint: 'Только для оповещений: важные обновления и отзыв ключей. Никому не передаём, рассылок не шлём.',
    getCode: 'Получить код на почту',
    codeLabel: 'Код из письма',
    codeHintBefore: 'Отправили 6 цифр на',
    codeHintAfter: 'Письмо может попасть в «Спам».',
    getInvite: 'Получить инвайт',
    changeEmail: 'Изменить почту или отправить ещё раз',
    closedHtml: '<b>Регистрация сейчас закрыта.</b> Можно войти со своими ключами: создайте приложение на <a href="https://my.telegram.org/apps">my.telegram.org</a> и запустите <code>telegram auth</code>. Инструкция — в <a href="https://github.com/TheVilfer/better-tg-cli#log-in">README</a>.',
    doneTitle: 'Ваш инвайт',
    doneText: 'Показываем один раз. Сохраните его и не отправляйте агенту или кому-то ещё — он понадобится на шаге входа.',
    backCli: 'Передаём инвайт в CLI… Если страница CLI не открылась, скопируйте инвайт и вставьте его там.',
    nextInstall: 'Дальше — установка ↓',
    footerSource: 'Открытый код',
    footerPrivacy: 'Приватность',
    language: 'Язык',
  },
  client: {
    errors: {
      bad_email: 'Проверьте адрес почты.',
      captcha_failed: 'Проверка не прошла. Обновите страницу и попробуйте ещё раз.',
      email_used: 'Инвайт для этой почты отозван. Напишите нам в GitHub.',
      rate_limited: 'Слишком много попыток. Попробуйте позже.',
      daily_limit: 'На сегодня инвайты закончились. Загляните завтра.',
      signups_closed: 'Регистрация сейчас закрыта.',
      resend_wait: 'Код уже отправлен. Новый можно запросить через минуту.',
      mail_failed: 'Не получилось отправить письмо. Проверьте адрес или попробуйте позже.',
      bad_code: 'Код не подошёл. Проверьте цифры из письма.',
      code_expired: 'Код истёк. Запросите новый.',
      too_many_attempts: 'Слишком много неверных попыток. Запросите новый код.',
    },
    generic: 'Что-то пошло не так. Попробуйте ещё раз.',
    waitCaptcha: 'Дождитесь проверки «Я не робот».',
    copy: 'Копировать',
    copied: 'Скопировано',
    copyManual: 'Выделите вручную',
  },
  guide: {
    title: 'Как установить',
    modeLabel: 'Режим',
    agentLabel: 'Агент',
    autoLabel: 'Auto',
    autoSmall: 'промпт для агента',
    proLabel: 'PRO',
    proSmall: 'команды вручную',
    autoPasteTitle: 'Вставьте промпт своему агенту',
    autoPasteText: 'Claude Code, Codex, Cursor или любой другой агент с терминалом. Он поставит CLI и скилл и откроет страницу входа.',
    autoLoginTitle: 'Пройдите страницу входа',
    autoLoginText: 'Агент откроет её в браузере на вашем компьютере. Там: «Получить инвайт» (почта подтверждается кодом, инвайт вернётся сам), QR в Telegram — Настройки → Устройства → Подключить устройство, и облачный пароль, если он есть. Агент ничего из этого не видит.',
    doneTitle: 'Готово',
    autoDoneHtml: 'Спросите агента, например: «что у меня непрочитанного в телеге?» Писать от вашего имени он сможет, только когда вы разрешите: <span class="mono">telegram write-access on --for 1h</span>.',
    autoDesktopNote: 'Claude Desktop без терминала так не умеет — для него режим PRO.',
    installTitle: 'Поставьте CLI',
    installText: 'macOS или Linux, в терминале:',
    installNoteHtml: 'Нет Homebrew — <span class="mono">npm install -g better-tg-cli</span> (Node 20+). На Windows: <span class="mono">scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket</span>, затем <span class="mono">scoop install better-tg-cli</span>.',
    loginTitle: 'Войдите в Telegram сами',
    loginText: 'Вход интерактивный, поэтому его делаете вы, а не агент:',
    loginNoteHtml: 'Вставьте инвайт с этой страницы и отсканируйте QR в Telegram: Настройки → Устройства → Подключить устройство. Со своими ключами с my.telegram.org — <span class="mono">telegram auth --qr</span>.',
    connectTitle: 'Подключите своего агента',
    proDoneText: 'По умолчанию агент только читает. Писать от вашего имени он сможет, когда вы разрешите:',
    tabs: {
      'claude-code': [
        ['Поставьте плагин', 'В Claude Code наберите по очереди. Плагин — это скилл и MCP-сервер сразу.'],
        ['Перезапустите Claude Code', 'И попросите, например: «что у меня непрочитанного в телеге?»'],
      ],
      codex: [
        ['Поставьте плагин', 'В обычном терминале:'],
        ['Откройте Codex заново', 'Скилл и MCP-сервер подхватятся сами. Спросите: «что пишет Алиса?»'],
      ],
      cursor: [
        ['Поставьте MCP-сервер', 'Cursor спросит подтверждение — нажмите Install.'],
        ['Добавьте скилл (по желанию)', 'Он учит агента аккуратной работе с Telegram:'],
      ],
      'claude-desktop': [
        ['Скачайте расширение', 'Откройте файл двойным кликом — Claude покажет карточку, нажмите Install. Node и brew для расширения не нужны.'],
        ['Спросите в чате', 'Например: «сделай сводку непрочитанного в Telegram».'],
      ],
    },
    cursorButton: 'Установить в Cursor',
    mcpbButton: 'Скачать better-tg-cli.mcpb',
    prompt: [
      'Подключи мне Telegram через Better-TG-CLI (https://github.com/TheVilfer/better-tg-cli):',
      '1. Установи CLI: `brew install thevilfer/tap/better-tg-cli`. Если Homebrew нет — `npm install -g better-tg-cli` (нужен Node 20+). На Windows — `scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket` и `scoop install better-tg-cli`.',
      '2. Запусти `telegram onboard --json` (в фоне, если твой таймаут короче 15 минут). Откроется страница, где я сам получу инвайт, отсканирую QR и введу пароль. Дождись события `done`. Не проси у меня коды, пароли и инвайт и не заполняй страницу сам.',
      '3. Установи себе скилл: `telegram skill install`.',
      '4. Проверь вход командой `telegram whoami` и коротко расскажи, что ты теперь умеешь в Telegram.',
    ],
    screens: {
      agent: 'агент',
      promptEcho: 'Подключи мне Telegram через Better-TG-CLI…',
      autoDone: 'Готово: вы вошли как Алиса (@alice).',
      claudeAsk: 'что у меня непрочитанного в телеге?',
      claudeAnswer: ['Больше всего в «Rust Seattle» (41). Алиса', 'спрашивает, в силе ли встреча в 7.'],
      codexAsk: 'что пишет Алиса?',
      codexAnswer: ['Алиса спрашивает, в силе ли встреча в 7,', 'и просит взять ноутбук.'],
    },
  },
  mail: {
    subject: (code: string) => `Код для инвайта Better-TG-CLI: ${code}`,
    intro: 'Ваш код для инвайта в <b>Better-TG-CLI</b>:',
    textIntro: (code: string) => `Ваш код: ${code}`,
    enter: 'Введите его на странице инвайта. Код действует 15 минут.',
    ignore: 'Если вы не запрашивали инвайт в Better-TG-CLI, просто удалите это письмо.',
  },
};

export const DICT: Record<Lang, Dict> = { en, es, ru };

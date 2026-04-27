/* ═══════════════════════════════════════════════════════════════
   BURRINHO PROJETOS — app.js (refatorado)
   Arquitetura: Models → Services → Controllers → UI
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   MODELS — Estruturas de dados e tipos
   (Preparados para futura integração com banco de dados)
───────────────────────────────────────────────────────────── */

/**
 * Modelo de tarefa geral (Dashboard)
 * @typedef {{ id: number, titulo: string, responsavel: string, prazo: string, status: string, prioridade: string, assinadaPor?: string, assinadaEm?: string }} Task
 */

/**
 * Modelo de tarefa operacional (Rompimentos / Troca de Poste)
 * @typedef {{ id: number, titulo: string, responsavel: string, responsavelChatId?: string, categoria: string, prazo: string, prioridade: string, descricao: string, status: OpStatus, historico: HistoryEntry[], criadaEm: string, assinadaPor?: string, assinadaEm?: string, protocolo?: string, dataEntrada?: string, subProcesso?: string, dataInstalacao?: string, ordemServico?: string, nomeCliente?: string }} OpTask
 * @typedef {'Criada'|'Backlog'|'A iniciar'|'Em andamento'|'Concluída'|'Finalizada'|'Cancelada'|'Validação'|'Envio pendente'|'Necessário adequação'|'Finalizado'} OpStatus
 * @typedef {{ status: OpStatus, timestamp: string, autor: string }} HistoryEntry
 */

/**
 * Configuração do Webhook
 * @typedef {{ url: string, urlsByRegion?: Record<string,string>, events: { andamento: boolean, concluida: boolean, finalizada: boolean } }} WebhookConfig
 */

/**
 * Estado de configuração do planner
 * @typedef {{ webhookConfig: WebhookConfig, note: string }} PlannerConfig
 */

/**
 * URL inicial do webhook somente se definida em `window.APP_CONFIG.defaultWebhookUrl`.
 * Nunca commitar tokens reais no código: use config local (ver `src/js/config.example.js`).
 */
function resolveDefaultWebhookUrlFromConfig() {
  const raw = window.APP_CONFIG && window.APP_CONFIG.defaultWebhookUrl;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

function resolveDefaultWebhookUrlsByRegionFromConfig() {
  const raw = window.APP_CONFIG && window.APP_CONFIG.defaultWebhookUrlsByRegion;
  if (!raw || typeof raw !== 'object') return {};
  /** @type {Record<string,string>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.trim()) out[String(k)] = v.trim();
  }
  return out;
}

function normalizeTechName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getTechDirectory(regionKey = '') {
  const cfg = window.APP_CONFIG || {};
  const byRegion = cfg.techsByRegion && typeof cfg.techsByRegion === 'object' ? cfg.techsByRegion : {};
  const flat = Array.isArray(cfg.techs) ? cfg.techs : [];

  const fromRegion =
    regionKey && Array.isArray(byRegion[regionKey])
      ? byRegion[regionKey]
      : [];

  const merged = [...fromRegion, ...flat];
  return merged
    .filter(t => t && typeof t.name === 'string' && t.name.trim() && typeof t.chatUserId === 'string' && t.chatUserId.trim())
    .map(t => ({ name: t.name.trim(), chatUserId: t.chatUserId.trim(), key: normalizeTechName(t.name) }));
}

function getSignedUserName() {
  try {
    const raw = localStorage.getItem('planner.session.displayName.v1');
    const name = String(raw || '').trim();
    return name || 'Usuário';
  } catch {
    return 'Usuário';
  }
}

const SESSION_USER_KEY = 'planner.session.userKey.v1';
/** Última página do menu (sessionStorage) — após F5 ou novo login volta ao chat etc. */
const NAV_LAST_PAGE_KEY = 'planner.nav.lastPage.v1';
const CHAT_LAST_SEEN_ID_KEY = 'planner.chat.lastSeenId.v1';
const CHAT_MENTION_INBOX_KEY = 'planner.chat.mentionInbox.v1';
const CHAT_MENTION_HANDLED_IDS_KEY = 'planner.chat.mentionHandledIds.v1';
const TOPBAR_NOTIF_INBOX_KEY = 'planner.topbar.notifs.v2';
const TOPBAR_NOTIF_LAST_SEEN_KEY = 'planner.topbar.notifs.lastSeenId.v2';

function isAuthenticatedSession() {
  try {
    return localStorage.getItem('planner.session.v1') === '1';
  } catch {
    return false;
  }
}

function getSessionUserKey() {
  try {
    return String(localStorage.getItem(SESSION_USER_KEY) || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

/** Sincronizado com `APP_CONFIG.appBuild` em `config.js`. A cada deploy novo, limpa caches do app. */
const CLIENT_BUNDLE_STORAGE_KEY = 'planner.clientBundle.v1';
const DEPLOY_CACHE_KEEP_KEYS = new Set([
  'planner.session.v1',
  'planner.session.displayName.v1',
  'planner.session.userKey.v1',
  'planner.theme.v1',
]);

function applyDeployCacheReset() {
  const build = String((window.APP_CONFIG && window.APP_CONFIG.appBuild) || '').trim();
  if (!build || build === '0') return;
  try {
    let prev = '';
    try {
      prev = String(localStorage.getItem(CLIENT_BUNDLE_STORAGE_KEY) || '');
    } catch {}
    if (prev === build) return;
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('planner.') && !DEPLOY_CACHE_KEEP_KEYS.has(k)) drop.push(k);
    }
    drop.forEach(k => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });
    try {
      sessionStorage.clear();
    } catch {}
    try {
      localStorage.setItem(CLIENT_BUNDLE_STORAGE_KEY, build);
    } catch {}
  } catch {
    /* ignore */
  }
}

applyDeployCacheReset();

/* ─────────────────────────────────────────────────────────────
   STATE STORE — Fonte única da verdade
   Futura integração: substituir por chamadas à API/banco
───────────────────────────────────────────────────────────── */
const Store = (() => {
  const APP_CONFIG = window.APP_CONFIG || {};
  const STORAGE_KEYS = {
    tasks: 'planner.tasks.v2',
    opTasks: 'planner.opTasks.v2',
    webhook: 'planner.webhook.v1',
    note: 'planner.note.v2',
    activity: 'planner.activity.v1',
  };

  /** Campos ATD / thread: o servidor pode devolver vazio ou prazo 0000-00-00; não sobrescrever valor bom do cliente. */
  const OP_TASK_REMOTE_EMPTY_MERGE_FIELDS = [
    'chatThreadKey',
    'chatThreadWebhookUrl',
    'nomeCliente',
    'protocolo',
    'dataEntrada',
    'dataInstalacao',
    'subProcesso',
    'ordemServico',
    'assinadaPor',
    'assinadaEm',
    'prazo',
  ];

  const isBlankOpTaskMergeValue = (field, v) => {
    if (v === undefined || v === null) return true;
    const s = String(v).trim();
    if (!s) return true;
    if (field === 'prazo' || field === 'dataEntrada' || field === 'dataInstalacao') {
      if (s === '0000-00-00' || s.startsWith('0000-00-00')) return true;
    }
    return false;
  };

  const mergeLocalOpTaskIntoIncomingPatch = (localTask, incomingPatch) => {
    if (!localTask || !incomingPatch) return;
    for (const f of OP_TASK_REMOTE_EMPTY_MERGE_FIELDS) {
      if (!isBlankOpTaskMergeValue(f, incomingPatch[f])) continue;
      if (isBlankOpTaskMergeValue(f, localTask[f])) continue;
      incomingPatch[f] = localTask[f];
    }
  };

  /**
   * Base da API: `APP_CONFIG.apiBaseUrl` (string), ou origem + pasta do app + `/api`.
   * Ex.: `https://site.com/burrinho/index.html` → `https://site.com/burrinho/api` (comum na HostGator).
   * Em ambientes locais, também tenta auto-resolver para `/api` quando servido via http(s).
   */
  const resolveApiBaseUrl = () => {
    const raw = APP_CONFIG.apiBaseUrl;
    if (raw === false) return '';
    if (typeof raw === 'string') {
      const trimmed = raw.trim().replace(/\/$/, '');
      if (trimmed) return trimmed;
    }
    try {
      const { protocol, hostname, origin, pathname } = window.location;
      if (protocol !== 'http:' && protocol !== 'https:') return '';
      const path = String(pathname || '/');
      let p = path;
      if (p !== '/' && p.endsWith('/')) p = p.replace(/\/+$/, '');
      const segments = p.split('/').filter(Boolean);
      if (segments.length) {
        const last = segments[segments.length - 1];
        if (/\.[a-z0-9]{2,12}$/i.test(last)) segments.pop();
      }
      const folder = segments.length ? `/${segments.join('/')}` : '';
      const rel = folder ? `${folder}/api` : '/api';
      const u = new URL(rel, origin);
      return u.href.replace(/\/$/, '');
    } catch {
      /* ignore */
    }
    return '';
  };

  const ApiService = {
    baseUrl: resolveApiBaseUrl(),
    _disabledOnce: false,
    enabled() {
      return Boolean(this.baseUrl);
    },
    async request(path, options = {}) {
      if (!this.enabled()) {
        return { ok: false, error: 'api_disabled' };
      }
      try {
        const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 15000;
        const { timeoutMs: _omitTimeout, headers: optHeaders, ...rest } = options;
        const ctrl = new AbortController();
        const kill = setTimeout(() => {
          try {
            ctrl.abort();
          } catch {
            /* ignore */
          }
        }, timeoutMs);
        const method = String(rest.method || 'GET').toUpperCase();
        const hasJsonBody =
          rest.body != null && typeof rest.body === 'string' && method !== 'GET' && method !== 'HEAD';
        const headers = {
          ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
          ...(optHeaders && typeof optHeaders === 'object' ? optHeaders : {}),
        };
        const noCache = (method === 'GET' || method === 'HEAD') ? { cache: 'no-store' } : {};
        const response = await fetch(`${this.baseUrl}${path}`, {
          ...rest,
          signal: ctrl.signal,
          headers,
          ...noCache,
          credentials: 'same-origin',
        });
        clearTimeout(kill);
        const rawText = await response.text();
        const text = rawText.replace(/^\uFEFF/, '').trim();
        if (!text) return { ok: false, error: 'empty_response', status: response.status };
        const head = text.slice(0, 24).toLowerCase();
        if (head.startsWith('<!') || head.startsWith('<?') || head.startsWith('<htm') || head.startsWith('<html')) {
          // FIX: ambiente local via Live Server/estático (sem PHP) costuma devolver HTML + 404/405.
          // Nesses casos, desativa a API automaticamente para evitar spam de erros e manter o app funcional (modo localStorage).
          if (!this._disabledOnce && (response.status === 404 || response.status === 405 || response.status === 501)) {
            this._disabledOnce = true;
            this.baseUrl = '';
            try {
              ToastService.show('API PHP não está disponível nesse servidor (Live Server). Rodando em modo local (sem sincronizar).', 'warning');
            } catch {
              /* ignore */
            }
            return { ok: false, error: 'api_disabled', status: response.status };
          }
          return { ok: false, error: 'html_response', status: response.status };
        }
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          return { ok: false, error: 'invalid_json', status: response.status };
        }
        if (!response.ok) {
          if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed;
          return { ok: false, error: 'http_error', status: response.status };
        }
        return parsed;
      } catch {
        return { ok: false, error: 'network_error' };
      }
    },
    async requestAny(paths, options = {}) {
      const retryable = new Set([
        'network_error',
        'html_response',
        'empty_response',
        'invalid_json',
        'http_error',
      ]);
      let last = null;
      for (const path of paths) {
        const result = await this.request(path, options);
        last = result;
        if (result && typeof result === 'object' && result.ok === true) return result;
        if (result && typeof result === 'object' && result.error === 'api_disabled') return result;
        const err = result && typeof result === 'object' ? result.error : '';
        if (retryable.has(err)) continue;
        return result;
      }
      return last;
    },
    async getBootstrap() {
      const b = Date.now();
      return this.requestAny([`/bootstrap.php?_=${b}`, `/bootstrap?_=${b}`, '/bootstrap.php', '/bootstrap']);
    },
    async getChanges(since = 0) {
      const b = Date.now();
      const s = encodeURIComponent(String(Number(since) || 0));
      return this.requestAny([
        `/changes.php?since=${s}&_=${b}`,
        `/changes?since=${s}&_=${b}`,
        `/changes.php?since=${s}`,
        `/changes?since=${s}`,
      ]);
    },
    async login(username, password) {
      // Uma única rota: evita uma ida HTTP extra em hosts que não têm `/login`.
      return this.request('/login.php', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
        timeoutMs: 12000,
      });
    },
    async saveTask(task) {
      return this.requestAny(['/tasks.php', '/tasks'], { method: 'POST', body: JSON.stringify(task) });
    },
    async saveOpTask(task) {
      return this.requestAny(['/op_tasks.php', '/op-tasks'], { method: 'POST', body: JSON.stringify(task) });
    },
    async deleteOpTask(id, cascade = false) {
      return this.requestAny(['/op_tasks.php', '/op-tasks'], { method: 'DELETE', body: JSON.stringify({ id, cascade }) });
    },
    async saveConfig(payload) {
      return this.requestAny(['/config.php', '/config'], { method: 'POST', body: JSON.stringify(payload) });
    },
    /** Chat interno: `since=0` → últimas 100; `since>0` → apenas mensagens novas. `_` evita cache agressivo de proxies. */
    async getTeamChat() {
      // Chat interno desativado.
      return null;
    },
    async postTeamChat() {
      // Chat interno desativado.
      return null;
    },
    buildUrl(path) {
      const p = String(path || '');
      if (!p) return '';
      return `${this.baseUrl}${p.startsWith('/') ? '' : '/'}${p}`;
    },
  };

  const readLocal = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  const writeLocal = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  };

  /** @type {Task[]} — sem dados fictícios; preenchido pelo servidor (bootstrap) ou criado pelos usuários */
  const tasks = readLocal(STORAGE_KEYS.tasks, []);
  let nextTaskId = tasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;

  /** @type {OpTask[]} */
  const opTasks = readLocal(STORAGE_KEYS.opTasks, []);
  let nextOpTaskId = opTasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;

  /** @type {any[]} */
  const activityEvents = readLocal(STORAGE_KEYS.activity, []);

  const WEBHOOK_EVENTS_DEFAULT = { andamento: true, concluida: true, finalizada: true };
  /** @type {WebhookConfig} */
  const webhookConfig = {
    url: '',
    urlsByRegion: {},
    events: { ...WEBHOOK_EVENTS_DEFAULT },
    ...readLocal(STORAGE_KEYS.webhook, {}),
  };

  /** @type {PlannerConfig} */
  const plannerConfig = { note: '' };
  const localNote = readLocal(STORAGE_KEYS.note, '');
  if (typeof localNote === 'string') plannerConfig.note = localNote;

  const persistSnapshot = () => {
    writeLocal(STORAGE_KEYS.tasks, tasks);
    writeLocal(STORAGE_KEYS.opTasks, opTasks);
    writeLocal(STORAGE_KEYS.webhook, webhookConfig);
    writeLocal(STORAGE_KEYS.note, plannerConfig.note || '');
    writeLocal(STORAGE_KEYS.activity, activityEvents);
  };
  const syncUpTask = (task) => { ApiService.saveTask(task); };
  const syncUpOpTask = (task) => {
    if (!ApiService.enabled()) return;
    void ApiService.saveOpTask(task).then((resp) => {
      if (!resp || !resp.ok) {
        if (resp && typeof resp.error === 'string') {
          console.warn('[op_tasks] Falha ao sincronizar tarefa', task?.id, resp.error);
        }
        return;
      }
      if (typeof resp.descricao === 'string' && task && task.id) {
        const t = opTasks.find(x => Number(x.id) === Number(task.id));
        if (t) {
          t.descricao = resp.descricao;
          persistSnapshot();
        }
      }
    });
  };
  const syncDeleteOpTask = (id, cascade = false) => { ApiService.deleteOpTask(id, cascade); };
  const syncConfig = () =>
    ApiService.saveConfig({ webhookConfig: { ...webhookConfig }, plannerConfig: { ...plannerConfig } });

  const applyDefaultWebhookUrlIfNeeded = () => {
    if (!webhookConfig.events || typeof webhookConfig.events !== 'object') {
      webhookConfig.events = { ...WEBHOOK_EVENTS_DEFAULT };
    }
    for (const k of Object.keys(WEBHOOK_EVENTS_DEFAULT)) {
      if (typeof webhookConfig.events[k] !== 'boolean') {
        webhookConfig.events[k] = WEBHOOK_EVENTS_DEFAULT[k];
      }
    }
    const fallbackUrl = resolveDefaultWebhookUrlFromConfig();
    if (!String(webhookConfig.url || '').trim() && fallbackUrl) {
      webhookConfig.url = fallbackUrl;
    }

    if (!webhookConfig.urlsByRegion || typeof webhookConfig.urlsByRegion !== 'object') {
      webhookConfig.urlsByRegion = {};
    }
    const hasAnyRegionUrl =
      Object.values(webhookConfig.urlsByRegion).some(v => typeof v === 'string' && v.trim());
    if (!hasAnyRegionUrl) {
      const defaultsByRegion = resolveDefaultWebhookUrlsByRegionFromConfig();
      if (Object.keys(defaultsByRegion).length) webhookConfig.urlsByRegion = { ...defaultsByRegion };
    }

    // Compatibilidade: se não existir `url` padrão, usa a primeira URL regional como fallback.
    if (!String(webhookConfig.url || '').trim()) {
      const first = Object.values(webhookConfig.urlsByRegion).find(v => typeof v === 'string' && v.trim());
      if (first) webhookConfig.url = String(first).trim();
    }
  };

  applyDefaultWebhookUrlIfNeeded();
  persistSnapshot();
  if (ApiService.enabled()) {
    void syncConfig();
  }

  // UI state
  let currentPage = 'dashboard';
  let currentOpCategory = 'rompimentos';
  let dashboardFilter = 'all';
  let dashboardSearch = '';
  let opSearch = '';
  let opRegionSearch = '';
  let opTecnicoSearch = '';
  let opTaskIdSearch = '';
  let opDateSort = 'all';
  /** Filtros da página dedicada "Atendimento ao cliente" (independentes de Tarefas). */
  let atdOpSearch = '';
  let atdOpRegionSearch = '';
  let atdOpTecnicoSearch = '';
  let atdOpTaskIdSearch = '';
  let atdOpDateSort = 'all';
  let editingTaskId = null;
  let editingOpTaskId = null;
  let sidebarOpen = true;
  /** Usernames do painel (tabela usuario) para @menções; preenchido pelo GET chat.php quando since=0. */
  let teamChatRosterKeys = [];

  return {
    // API (cliente HTTP compartilhado pelo app)
    ApiService,

    // Tasks
    getTasks:        ()      => [...tasks],
    addTask:         (data)  => {
      const nowIso = new Date().toISOString();
      const signedBy = getSignedUserName();
      const t = {
        id: nextTaskId++,
        ...data,
        responsavel: (data && String(data.responsavel || '').trim()) ? data.responsavel : signedBy,
        assinadaPor: signedBy,
        assinadaEm: nowIso,
      };
      tasks.push(t);
      persistSnapshot();
      syncUpTask(t);
      return t;
    },
    updateTask:      (id, d) => {
      const i = tasks.findIndex(t => t.id === id);
      if (i !== -1) {
        Object.assign(tasks[i], d);
        persistSnapshot();
        syncUpTask(tasks[i]);
      }
      return tasks[i];
    },
    applyRemoteTasks(incoming) {
      if (!Array.isArray(incoming) || !incoming.length) return 0;
      let changed = 0;
      for (const inc of incoming) {
        const id = Number(inc?.id);
        if (!Number.isFinite(id)) continue;
        const i = tasks.findIndex(t => Number(t?.id) === id);
        if (i === -1) {
          tasks.push(inc);
          changed++;
        } else {
          Object.assign(tasks[i], inc);
          changed++;
        }
      }
      if (changed) {
        nextTaskId = tasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;
        persistSnapshot();
      }
      return changed;
    },
    findTask:        (id)    => tasks.find(t => t.id === id),

    // OpTasks
    getOpTasks:      ()           => [...opTasks],
    getOpTasksByCategory: (cat)   => opTasks.filter(t => t.categoria === cat),
    addOpTask:       (data)       => {
      const nowIso = new Date().toISOString();
      const signedBy = getSignedUserName();
      const t = {
        id: nextOpTaskId++,
        ...data,
        criadaEm: nowIso,
        assinadaPor: signedBy,
        assinadaEm: nowIso,
        historico: [{ status: data.status || 'Criada', timestamp: nowIso, autor: signedBy }],
      };
      opTasks.push(t);
      persistSnapshot();
      syncUpOpTask(t);
      return t;
    },
    updateOpTaskStatus: (id, newStatus, autor = 'Usuário') => {
      const task = opTasks.find(t => t.id === id);
      if (!task) return null;
      task.status = newStatus;
      task.historico.push({ status: newStatus, timestamp: new Date().toISOString(), autor });
      persistSnapshot();
      syncUpOpTask(task);
      return task;
    },
    updateOpTask: (id, data) => {
      const i = opTasks.findIndex(t => t.id === id);
      if (i !== -1) {
        Object.assign(opTasks[i], data);
        persistSnapshot();
        syncUpOpTask(opTasks[i]);
      }
      return opTasks[i];
    },
    applyRemoteOpTasks(incoming) {
      if (!Array.isArray(incoming) || !incoming.length) return 0;
      let changed = 0;
      for (const inc of incoming) {
        const id = Number(inc?.id);
        if (!Number.isFinite(id)) continue;
        const i = opTasks.findIndex(t => Number(t?.id) === id);
        if (i === -1) {
          opTasks.push(inc);
          changed++;
        } else {
          mergeLocalOpTaskIntoIncomingPatch(opTasks[i], inc);
          Object.assign(opTasks[i], inc);
          changed++;
        }
      }
      if (changed) {
        nextOpTaskId = opTasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;
        persistSnapshot();
      }
      return changed;
    },
    applyRemoteActivity(incoming) {
      if (!Array.isArray(incoming) || !incoming.length) return 0;
      let changed = 0;
      const byId = new Map(activityEvents.map((e) => [Number(e?.id) || 0, e]).filter(([id]) => id > 0));
      for (const inc of incoming) {
        const id = Number(inc?.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        if (!byId.has(id)) {
          activityEvents.push(inc);
          byId.set(id, inc);
          changed++;
        } else {
          Object.assign(byId.get(id), inc);
          changed++;
        }
      }
      if (changed) {
        activityEvents.sort((a, b) => (Number(a?.id) || 0) - (Number(b?.id) || 0));
        while (activityEvents.length > 60) activityEvents.shift();
        persistSnapshot();
      }
      return changed;
    },
    removeOpTask: (id, options = {}) => {
      const cascade = Boolean(options.cascade);
      const removeIds = cascade
        ? [id, ...opTasks.filter(t => Number(t.parentTaskId) === Number(id)).map(t => t.id)]
        : [id];
      let changed = false;
      for (const rid of removeIds) {
        const idx = opTasks.findIndex(t => t.id === rid);
        if (idx !== -1) {
          opTasks.splice(idx, 1);
          changed = true;
        }
      }
      if (changed) {
        persistSnapshot();
        syncDeleteOpTask(id, cascade);
      }
      return changed;
    },
    findOpTask: (id) => opTasks.find(t => t.id === id),
    getActivityEvents: () => [...activityEvents],

    // Webhook
    getWebhookConfig: ()     => ({ ...webhookConfig }),
    /** @returns {Promise<{ok?: boolean}|null>} */
    setWebhookConfig: async (data) => {
      Object.assign(webhookConfig, data);
      persistSnapshot();
      return syncConfig();
    },
    loginRemote: async (username, password) => ApiService.login(username, password),
    isRemoteApiEnabled: () => ApiService.enabled(),
    /** Base `.../api` usada nas requisições (útil para mensagens de erro no chat). */
    getApiBaseUrl: () => (ApiService.enabled() ? String(ApiService.baseUrl).replace(/\/$/, '') : ''),
    fetchTeamChat: async (since = 0) => ApiService.getTeamChat(since),
    sendTeamChat: async (payload) => ApiService.postTeamChat(payload),
    getTeamChatRosterKeys: () => [...teamChatRosterKeys],
    applyTeamChatRosterFromApi(roster) {
      if (!Array.isArray(roster)) return;
      const next = roster.map(x => String(x?.userKey || '').toLowerCase()).filter(Boolean);
      teamChatRosterKeys = [...new Set(next)].sort();
    },

    // Config
    getPlannerConfig: () => ({ ...plannerConfig }),
    setPlannerConfig: (data) => {
      Object.assign(plannerConfig, data);
      persistSnapshot();
      syncConfig();
    },

    bootstrapFromRemote: async () => {
      const payload = await ApiService.getBootstrap();
      if (payload && typeof payload === 'object' && payload.ok === false && payload.error === 'unauthorized') {
        // O usuário pode estar "logado" só no localStorage, mas sem sessão no PHP.
        // Nesse caso, força relogar para reestabelecer $_SESSION['planner_user'].
        try {
          if (typeof Controllers !== 'undefined' && Controllers?.auth?._isAuthenticated?.()) {
            ToastService.show('Sessão do servidor expirada. Faça login novamente.', 'warning');
            Controllers.auth.logout();
          }
        } catch {
          /* ignore */
        }
        return false;
      }
      if (!payload || !payload.ok) return false;

      // Preserva metadados locais que não existem no servidor (ex.: threadKey do Google Chat).
      const mergeLocalFieldsById = (localArr, incomingArr, fields) => {
        const map = new Map();
        for (const item of (Array.isArray(localArr) ? localArr : [])) {
          const id = Number(item?.id);
          if (!Number.isFinite(id)) continue;
          const snapshot = {};
          for (const f of fields) {
            const v = item?.[f];
            if (!isBlankOpTaskMergeValue(f, v)) snapshot[f] = v;
          }
          if (Object.keys(snapshot).length) map.set(id, snapshot);
        }
        for (const inc of (Array.isArray(incomingArr) ? incomingArr : [])) {
          const id = Number(inc?.id);
          if (!Number.isFinite(id) || !map.has(id)) continue;
          const snap = map.get(id);
          for (const f of Object.keys(snap)) {
            if (isBlankOpTaskMergeValue(f, inc[f])) inc[f] = snap[f];
          }
        }
      };

      if (Array.isArray(payload.tasks)) {
        mergeLocalFieldsById(tasks, payload.tasks, ['chatThreadKey']);
        tasks.splice(0, tasks.length, ...payload.tasks);
        nextTaskId = tasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;
      }
      if (Array.isArray(payload.opTasks)) {
        mergeLocalFieldsById(opTasks, payload.opTasks, OP_TASK_REMOTE_EMPTY_MERGE_FIELDS);
        opTasks.splice(0, opTasks.length, ...payload.opTasks);
        nextOpTaskId = opTasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;
      }
      if (payload.webhookConfig && typeof payload.webhookConfig === 'object') {
        Object.assign(webhookConfig, payload.webhookConfig);
      }
      if (payload.plannerConfig && typeof payload.plannerConfig === 'object') {
        Object.assign(plannerConfig, payload.plannerConfig);
      }
      if (Array.isArray(payload.notifications)) {
        ChatMentionNotifs.processIncomingTaskNotifications(payload.notifications);
      }
      if (Array.isArray(payload.activity)) {
        activityEvents.splice(0, activityEvents.length, ...payload.activity);
      }
      applyDefaultWebhookUrlIfNeeded();
      persistSnapshot();
      if (ApiService.enabled()) {
        void syncConfig();
      }
      return true;
    },

    // UI State
    get currentPage()       { return currentPage; },
    set currentPage(v)      { currentPage = v; },
    get currentOpCategory() { return currentOpCategory; },
    set currentOpCategory(v){ currentOpCategory = v; },
    get dashboardFilter()   { return dashboardFilter; },
    set dashboardFilter(v)  { dashboardFilter = v; },
    get dashboardSearch()   { return dashboardSearch; },
    set dashboardSearch(v)  { dashboardSearch = v; },
    get opSearch()          { return opSearch; },
    set opSearch(v)         { opSearch = v; },
    get opRegionSearch()   { return opRegionSearch; },
    set opRegionSearch(v)  { opRegionSearch = v; },
    get opTecnicoSearch()   { return opTecnicoSearch; },
    set opTecnicoSearch(v)  { opTecnicoSearch = v; },
    get opTaskIdSearch()   { return opTaskIdSearch; },
    set opTaskIdSearch(v)  { opTaskIdSearch = v; },
    get opDateSort()       { return opDateSort; },
    set opDateSort(v)      { opDateSort = v; },
    get atdOpSearch()       { return atdOpSearch; },
    set atdOpSearch(v)      { atdOpSearch = v; },
    get atdOpRegionSearch() { return atdOpRegionSearch; },
    set atdOpRegionSearch(v){ atdOpRegionSearch = v; },
    get atdOpTecnicoSearch(){ return atdOpTecnicoSearch; },
    set atdOpTecnicoSearch(v){ atdOpTecnicoSearch = v; },
    get atdOpTaskIdSearch() { return atdOpTaskIdSearch; },
    set atdOpTaskIdSearch(v){ atdOpTaskIdSearch = v; },
    get atdOpDateSort()     { return atdOpDateSort; },
    set atdOpDateSort(v)    { atdOpDateSort = v; },
    get editingTaskId()     { return editingTaskId; },
    set editingTaskId(v)    { editingTaskId = v; },
    get editingOpTaskId()   { return editingOpTaskId; },
    set editingOpTaskId(v)  { editingOpTaskId = v; },
    get sidebarOpen()       { return sidebarOpen; },
    set sidebarOpen(v)      { sidebarOpen = v; },
  };
})();

// Alias global: alguns módulos usam ApiService diretamente
// (o objeto real é mantido dentro do Store).
const ApiService = Store.ApiService;

// ─────────────────────────────────────────────────────────────
// Termômetro (componente) — manter lógica de posição da agulha
// ─────────────────────────────────────────────────────────────
const THERMO_CONFIG = {
  // Fonte única de verdade para faixas/limiares de atenuação.
  // p0 = crítico (mais negativo) → p3 = leve/estável (menos negativo).
  thresholds: { p0: -28.0, p1: -26.0, p2: -24.0, p3: -22.01 },
  // maxDbm (estável) = 0% esquerda | minDbm (crítico) = 100% direita
  get minDbm() { return this.thresholds.p0; },
  get maxDbm() { return this.thresholds.p3; },
};

function getAtenuacaoThresholds() {
  const t = THERMO_CONFIG?.thresholds || {};
  const p0 = Number(t.p0);
  const p1 = Number(t.p1);
  const p2 = Number(t.p2);
  const p3 = Number(t.p3);
  if ([p0, p1, p2, p3].every(Number.isFinite)) return { p0, p1, p2, p3 };
  return { p0: -28.0, p1: -26.0, p2: -24.0, p3: -22.01 };
}

function updateThermometer(dbm) {
  const { minDbm, maxDbm } = THERMO_CONFIG;
  const n = Number(dbm);
  if (!Number.isFinite(n)) return;
  const clamped = Math.min(Math.max(n, minDbm), maxDbm);
  const percent = ((maxDbm - clamped) / (maxDbm - minDbm)) * 100;
  const needle = document.getElementById('thermo-needle');
  if (needle) needle.style.left = `${percent.toFixed(1)}%`;
}

function updateStats(totalItems, criticalPercent, dbm) {
  const el = document.getElementById('thermo-stats');
  if (!el) return;
  el.textContent = `${Number(totalItems) || 0} itens · ${Number(criticalPercent) || 0}% crítico/alto · Indicador posicionado na média atual`;
}


/* ─────────────────────────────────────────────────────────────
   UTILITIES — Funções puras auxiliares
───────────────────────────────────────────────────────────── */
const Utils = {
  /** Converte Date para ISO local (YYYY-MM-DD, sem UTC) */
  toIsoLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /** Retorna a data atual em formato YYYY-MM-DD */
  todayIso() {
    return this.toIsoLocal(new Date());
  },

  /** Retorna ISO local para hoje + N dias */
  addDaysIso(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return this.toIsoLocal(d);
  },

  /** Semana civil: segunda a domingo (horário local), retorno em ISO YYYY-MM-DD */
  weekRangeIso(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    const offsetToMonday = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(d);
    monday.setDate(d.getDate() + offsetToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: this.toIsoLocal(monday), end: this.toIsoLocal(sunday) };
  },

  monthLabel(date) {
    return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  },

  prettyDate(isoDate) {
    const [year, month, day] = isoDate.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  },

  /** Formata ISO date para DD/MM/YYYY */
  formatDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  },

  escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  },

  /** Tempo relativo curto para mensagens do chat (tooltip: formatChatFullDateTime). */
  formatChatRelative(iso) {
    if (!iso) return '';
    try {
      const d = new Date(String(iso).replace(' ', 'T'));
      if (Number.isNaN(d.getTime())) return String(iso);
      const diff = Math.floor((Date.now() - d.getTime()) / 1000);
      if (diff < 45) return 'agora';
      if (diff < 3600) return `${Math.floor(diff / 60)} min`;
      if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
      if (diff < 172800) return 'ontem';
      return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(iso);
    }
  },

  formatChatFullDateTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(String(iso).replace(' ', 'T'));
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(iso);
    }
  },

  /**
   * Só http(s); texto escapado; links abrem em nova aba.
   * @param {string} raw
   */
  linkifyChatText(raw) {
    const t = String(raw ?? '');
    const re = /https?:\/\/[^\s<>"']+/gi;
    let html = '';
    let last = 0;
    let m;
    const rx = new RegExp(re.source, 'gi');
    while ((m = rx.exec(t)) !== null) {
      html += Utils.escapeHtml(t.slice(last, m.index));
      let u = m[0];
      while (u.length > 14 && /[),.;!?]$/.test(u)) u = u.slice(0, -1);
      const href = Utils.escapeHtml(u);
      const vis = Utils.escapeHtml(u);
      html += `<a href="${href}" class="team-chat-link" target="_blank" rel="noopener noreferrer">${vis}</a>`;
      last = m.index + m[0].length;
    }
    html += Utils.escapeHtml(t.slice(last));
    return html;
  },

  _formatChatSegmentWithMentions(segment, rosterSet) {
    const reMen = /@([a-z0-9._-]+)/gi;
    let html = '';
    let last = 0;
    const s = String(segment);
    let m;
    reMen.lastIndex = 0;
    while ((m = reMen.exec(s)) !== null) {
      html += Utils.escapeHtml(s.slice(last, m.index));
      const user = m[1];
      const low = user.toLowerCase();
      const safeU = Utils.escapeHtml(user);
      if (rosterSet.has(low)) {
        html += `<span class="team-chat-mention" data-user="${Utils.escapeHtml(low)}">@${safeU}</span>`;
      } else {
        html += Utils.escapeHtml(m[0]);
      }
      last = m.index + m[0].length;
    }
    html += Utils.escapeHtml(s.slice(last));
    return html;
  },

  /**
   * URLs clicáveis + @menções destacadas (usuários do roster do servidor).
   * @param {string} raw
   * @param {string[]} rosterKeys userKeys em minúsculas
   */
  formatChatBodyHtml(raw, rosterKeys) {
    const set = new Set((rosterKeys || []).map(k => String(k).toLowerCase()));
    const reUrl = /https?:\/\/[^\s<>"']+/gi;
    const t = String(raw ?? '');
    let html = '';
    let last = 0;
    let m;
    const rx = new RegExp(reUrl.source, 'gi');
    while ((m = rx.exec(t)) !== null) {
      html += Utils._formatChatSegmentWithMentions(t.slice(last, m.index), set);
      let u = m[0];
      while (u.length > 14 && /[),.;!?]$/.test(u)) u = u.slice(0, -1);
      const href = Utils.escapeHtml(u);
      const vis = Utils.escapeHtml(u);
      html += `<a href="${href}" class="team-chat-link" target="_blank" rel="noopener noreferrer">${vis}</a>`;
      last = m.index + m[0].length;
    }
    html += Utils._formatChatSegmentWithMentions(t.slice(last), set);
    return html;
  },

  /** True se `body` contém @userKey como menção (fim de token ou pontuação). */
  messageMentionsUser(body, userKey) {
    const u = String(userKey || '').toLowerCase();
    if (!u) return false;
    const k = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`@${k}(?![a-z0-9._-])`, 'i');
    return re.test(String(body || ''));
  },

  /** Extrai iniciais de um nome (até 2 letras) */
  getInitials(name) {
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  },

  /** Verifica se uma tarefa está atrasada */
  isLate(task) {
    return task.status !== 'Concluída' && task.prazo && task.prazo < this.todayIso();
  },

  /** Zero-pad */
  pad(n) { return String(n).padStart(2, '0'); },

  /** Gera cor de avatar por nome */
  _avatarMap: {},
  _avatarColors: ['#2dff6e','#42b8f5','#f5c842','#b8f542','#42f5c2','#f5a342'],
  getAvatarColor(name) {
    if (!this._avatarMap[name]) {
      this._avatarMap[name] = this._avatarColors[Object.keys(this._avatarMap).length % this._avatarColors.length];
    }
    return this._avatarMap[name];
  },

  /** Ícone “copiar” (duas folhas) — texto vem de `opTaskDisplayRef` (ID, taskCode ou protocolo conforme a categoria). */
  TASK_COPY_ID_SVG:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',

  escapeHtmlAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  },

  _opTaskRegionPrefix(regionRaw = '') {
    const norm = WebhookService._normalizeRegionKey(regionRaw);
    if (norm === 'GOVAL') return 'GV';
    if (norm === 'VALE_DO_ACO') return 'VL';
    if (norm === 'CARATINGA') return 'CA';
    return '';
  },

  /** Código sintético ROM-/ATD-/… quando ainda não há taskCode (mesma regra do modal). */
  syntheticOpTaskCode(task) {
    if (!task || typeof task !== 'object') return '';
    const prefixMap = {
      'rompimentos': 'ROM',
      'troca-poste': 'POS',
      'atendimento-cliente': 'ATD',
      'otimizacao-rede': 'NET',
      'certificacao-cemig': 'CEM',
      'correcao-atenuacao': 'ATN',
      'troca-etiqueta': 'ETQ',
      'qualidade-potencia': 'QDP',
      'manutencao-corretiva': 'MCR',
    };
    const prefix = prefixMap[task.categoria] || 'ROM';
    const regionPrefix = this._opTaskRegionPrefix(task.regiao);
    const id = Number(task.id);
    if (!Number.isFinite(id) || id <= 0) return '';
    const base = `${prefix}-${String(id).padStart(4, '0')}`;
    return regionPrefix ? `${regionPrefix}-${base}` : base;
  },

  /**
   * Texto a copiar / exibir como referência da tarefa operacional.
   * Atendimento ao cliente: taskCode ou código sintético (região + ATD + nº), não o protocolo do formulário.
   * Otimização de rede: taskCode (ex.: VL-NET-0001) ou código sintético com região + NET + nº — nunca protocolo nem só o ID do banco.
   * Demais categorias: protocolo do formulário, senão taskCode, senão código sintético.
   */
  opTaskDisplayRef(task) {
    if (!task || typeof task !== 'object') return '';
    const proto = String(task.protocolo || '').trim();
    const code = String(task.taskCode || '').trim();
    if (task.categoria === 'atendimento-cliente') {
      if (code) return code;
      const synthetic = this.syntheticOpTaskCode(task);
      if (synthetic) return synthetic;
      if (proto) return proto;
      return '';
    }
    if (task.categoria === 'otimizacao-rede') {
      if (code) return code;
      const synthetic = this.syntheticOpTaskCode(task);
      if (synthetic) return synthetic;
      return '';
    }
    if (proto) return proto;
    if (code) return code;
    if (task.categoria) return this.syntheticOpTaskCode(task);
    return '';
  },

  /** Tarefa na visão unificada (dashboard + operacional): só operacional tem protocolo/código copiável aqui. */
  unifiedTaskDisplayRef(task) {
    if (!task || typeof task !== 'object') return '';
    if (task.source === 'operacional' || task.categoria) return this.opTaskDisplayRef(task);
    return '';
  },

  taskCopyProtocolButtonHtml(displayRef, extraClass = '') {
    const code = String(displayRef ?? '').trim();
    if (!code) return '';
    const cls = ['task-copy-id-btn', extraClass].filter(Boolean).join(' ');
    const a = this.escapeHtmlAttr(code);
    return `<button type="button" class="${cls}" draggable="false" data-copy-protocol="${a}" title="Copiar identificador (${code})" aria-label="Copiar identificador ${code}">${this.TASK_COPY_ID_SVG}</button>`;
  },

  /** Ícone de lista — abre menu com todos os status da tarefa operacional. */
  OP_STATUS_PICKER_SVG:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" stroke-linecap="round"/></svg>',

  opTaskStatusPickerButtonHtml(opId, extraClass = '') {
    const id = Number(opId);
    if (!Number.isFinite(id) || id <= 0) return '';
    const cls = ['op-status-picker-btn', extraClass].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" draggable="false" data-op-status-picker="${id}" title="Alterar status" aria-label="Alterar status">${this.OP_STATUS_PICKER_SVG}</button>`;
  },

  async copyTextToClipboard(text) {
    const s = String(text ?? '').trim();
    if (!s) return false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(s);
        return true;
      }
    } catch {
      /* fallback */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  },

  async copyProtocolWithToast(text) {
    const s = String(text ?? '').trim();
    if (!s) return;
    const ok = await this.copyTextToClipboard(s);
    if (ok) ToastService.show(`Copiado: ${s}`, 'success');
    else ToastService.show('Não foi possível copiar', 'danger');
  },
};


/* ─────────────────────────────────────────────────────────────
   WEBHOOK SERVICE — Envio de notificações ao Google Chat
   Ponto de extensão para outros canais no futuro
───────────────────────────────────────────────────────────── */
const WebhookService = {
  /** Evita asteriscos nos dados que quebram o negrito do Chat */
  _chatSafe(s) {
    return String(s ?? '').replace(/\*/g, '·');
  },

  /** Coordenadas em formato lat,lon (Google Chat costuma tornar clicável). */
  _coordsClickableForChat(raw) {
    const coordsRaw = String(raw || '').trim();
    if (!coordsRaw) return '—';
    const normalized = coordsRaw.replace(/\s+/g, '');
    const parts = normalized.split(',');
    if (parts.length !== 2) return coordsRaw;
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return coordsRaw;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return coordsRaw;
    return `${lat},${lon}`;
  },

  _formatChatMention(chatUserIdRaw) {
    const raw = String(chatUserIdRaw || '').trim();
    if (!raw) return '';
    if (/^users\/\S+$/.test(raw)) return `<${raw}>`;
    if (/^\d+$/.test(raw)) return `<users/${raw}>`;
    // fallback: permite colar resource name completo ou outro formato suportado no futuro
    return `<${raw}>`;
  },

  _resolveTechnicianDisplay(task, options = {}) {
    const name = String(task?.responsavel || '').trim() || 'Não informado';
    if (options && options.mention === false) return name;

    const direct = String(task?.responsavelChatId || '').trim();
    const mention = this._formatChatMention(direct);
    if (mention) return mention;

    const key = normalizeTechName(name);
    const match = getTechDirectory(this._normalizeRegionKey(task?.regiao)).find(t => t.key === key);
    const mention2 = match ? this._formatChatMention(match.chatUserId) : '';
    return mention2 || name;
  },

  /** Cada linha não vazia em negrito (*sintaxe Google Chat*); linhas vazias mantidas. */
  _rompimentoBoldLines(lines) {
    return lines
      .map(line => {
        if (line === '' || line === null || line === undefined) return '';
        return `*${this._chatSafe(line)}*`;
      })
      .join('\n');
  },

  /** Remove tags HTML para trechos de descrição no Chat (ex.: rich editor). */
  _stripHtmlLite(raw) {
    return String(raw || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /** Linha 📝 Cemig: logradouro e bairro (sem região/município). */
  _formatCemigEnderecoLine(task) {
    const loc = String(task.localizacaoTexto || '').trim();

    if (loc && loc.includes(' - ')) {
      const idx = loc.indexOf(' - ');
      const rua = loc.slice(0, idx).trim();
      const bairro = loc.slice(idx + 3).trim();
      return `logradouro ${rua}, bairro ${bairro}`;
    }
    if (loc) {
      return `logradouro ${loc}`;
    }
    return 'logradouro —, bairro —';
  },

  /** Linha 🔔 protocolo / título / trecho da descrição (CRM, ER/EE, etc.). */
  _formatCemigNotificacaoLine(task) {
    const proto = String(task.protocolo || '').trim();
    let titulo = String(task.titulo || '').trim().replace(/^Cemig\s*[—–-]\s*/i, '').trim();
    const desc = this._stripHtmlLite(task.descricao || '').replace(/\s+/g, ' ').trim();
    const bits = [];
    if (proto) bits.push(proto);
    if (titulo && titulo !== proto) bits.push(titulo);
    let core = bits.join(' — ') || '—';
    if (
      desc.length > 0 &&
      !core.includes(desc.slice(0, Math.min(28, desc.length)))
    ) {
      const d = desc.length > 220 ? `${desc.slice(0, 217)}…` : desc;
      core = `${core} — ${d}`;
    }
    return `CEMIG - NOTIFICAÇÃO ${core}`;
  },

  /**
   * Google Chat — Certificação Cemig (layout tipo notificação ER/EE + endereço).
   * @param {'andamento'|'concluida'|'finalizada'} event
   */
  _buildCemigMessage(event, task) {
    const B = (lines) => this._rompimentoBoldLines(lines);
    const s = (x) => this._chatSafe(String(x ?? '').trim());
    const tecnico = this._resolveTechnicianDisplay(task, { mention: event === 'andamento' });
    const enviado = s(String(task?.assinadaPor || '').trim() || '—');
    const taskId = s(String(task.taskCode || `CEM-${String(task.id || '').padStart(4, '0')}`).trim());
    const addrLine = this._formatCemigEnderecoLine(task);
    const notifLine = this._formatCemigNotificacaoLine(task);
    const coords = s(String(task.coordenadas || '').trim() || '—');

    if (event === 'andamento') {
      return {
        text: B([
          '⚡ Certificação de Rede - CEMIG',
          '',
          `📝 ${s(addrLine)}`,
          '',
          `🔔 ${s(notifLine)}`,
          '',
          `🗺️ Coordenadas: ${coords}`,
          '',
          `🔧 Técnico: ${tecnico}`,
          `👤 Enviado por: ${enviado}`,
          `🆔 ID: ${taskId}`,
        ]),
      };
    }
    const sep = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';
    const proto = String(task.protocolo || '').trim();
    const tituloC = String(task.titulo || '').trim().replace(/^Cemig\s*[—–-]\s*/i, '').trim();
    const ref = proto || tituloC || 'Certificação Cemig';
    const elapsed =
      event === 'concluida' || event === 'finalizada'
        ? this._formatDurationFromStart(task)
        : '';
    const elapsedLine =
      elapsed && elapsed !== 'Não foi possível calcular'
        ? [`⏱️ TEMPO NO SERVIÇO · ${s(elapsed)}`]
        : [];
    const head =
      event === 'concluida'
        ? '✅ CERTIFICAÇÃO CEMIG — CONCLUÍDA'
        : '🏁 CERTIFICAÇÃO CEMIG — FINALIZADA';

    const enderecoC = s(String(task.localizacaoTexto || '').trim() || '—');

    return {
      text: B([
        head,
        sep,
        `🆔 ID · ${taskId}`,
        `📋 REFERÊNCIA · ${s(ref)}`,
        `🗺️ COORDENADAS · ${coords}`,
        `🏠 ENDEREÇO · ${enderecoC}`,
        ...elapsedLine,
      ]),
    };
  },

  /**
   * Google Chat — Otimização de Rede: mensagem “pai” em andamento; demais eventos como resposta no tópico.
   * Layout em blocos, linhas em negrito (sintaxe do Chat), separadores visuais e texto seguro.
   * @param {'andamento'|'concluida'|'finalizada'} event
   */
  _buildOtimRedeMessage(event, task) {
    const B = (lines) => this._rompimentoBoldLines(lines);
    const tecnico = this._resolveTechnicianDisplay(task, { mention: event === 'andamento' });
    const enviadoPor = String(task?.assinadaPor || '').trim() || '—';
    const code = String(task.taskCode || '').trim();
    const synthetic = Utils.syntheticOpTaskCode(task);
    const taskId = String(
      code || synthetic || `NET-${String(task.id || '').padStart(4, '0')}`,
    ).trim();
    const coords = String(task.coordenadas || '').trim() || '—';
    const endereco = String(task.localizacaoTexto || '').trim() || '—';
    const regiao = String(task.regiao || '').trim() || '—';
    const titulo = String(task.titulo || '').trim();
    const proto = String(task.protocolo || '').trim();
    const os = String(task.ordemServico || '').trim();
    const protoOs = [proto, os].filter(Boolean).join(' · ');
    const descPlain = this._stripHtmlLite(task.descricao || '');
    const principal = titulo || protoOs || '—';
    const descExtra =
      descPlain && descPlain !== titulo ? descPlain.slice(0, 560) : '';

    const wrapChatLines = (text, maxLen = 56) => {
      const words = String(text || '').split(/\s+/).filter(Boolean);
      const lines = [];
      let cur = '';
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (next.length > maxLen && cur) {
          lines.push(cur);
          cur = w;
        } else {
          cur = next;
        }
      }
      if (cur) lines.push(cur);
      return lines.slice(0, 14);
    };

    const sep = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

    if (event === 'andamento') {
      const header = B([
        '🌐 OTIMIZAÇÃO DE REDE',
        sep,
        '⚠️ NOVA TAREFA',
        '',
        '📝 RESUMO',
        principal,
      ]);

      const descLines = descExtra ? ['', '📄 DESCRIÇÃO / OBSERVAÇÕES', ...wrapChatLines(descExtra)] : [];
      const descBlock = descLines.length ? B(descLines) : '';

      const meta = B([
        '',
        sep,
        '📌 IDENTIFICAÇÃO',
        `🆔 ID DA TAREFA · ${this._chatSafe(taskId)}`,
        `🌎 REGIÃO · ${this._chatSafe(regiao)}`,
        '',
        '👷 RESPONSÁVEIS',
        `🔧 TÉCNICO · ${tecnico}`,
        `👤 ENVIADO POR · ${this._chatSafe(enviadoPor)}`,
        '',
        '📍 LOCALIZAÇÃO',
        `🗺️ COORDENADAS · ${this._chatSafe(coords)}`,
        `🏠 ENDEREÇO · ${this._chatSafe(endereco)}`,
      ]);

      const parts = [header, descBlock, meta].filter(Boolean);
      return { text: parts.join('\n\n') };
    }

    const head =
      event === 'concluida'
        ? '✅ OTIMIZAÇÃO DE REDE — CONCLUÍDA'
        : '🏁 OTIMIZAÇÃO DE REDE — FINALIZADA';
    const ref = titulo || protoOs || 'Otimização de rede';
    const elapsed = event === 'concluida' || event === 'finalizada' ? this._formatDurationFromStart(task) : '';
    const elapsedLine =
      elapsed && elapsed !== 'Não foi possível calcular'
        ? [`⏱️ TEMPO NO SERVIÇO · ${this._chatSafe(elapsed)}`]
        : [];

    return {
      text: B([
        head,
        sep,
        `🆔 ID · ${this._chatSafe(taskId)}`,
        `📋 REFERÊNCIA · ${this._chatSafe(ref)}`,
        `🗺️ COORDENADAS · ${this._chatSafe(coords)}`,
        `🏠 ENDEREÇO · ${this._chatSafe(endereco)}`,
        ...elapsedLine,
      ]),
    };
  },

  _trocaPosteTitleAsLocation(tituloRaw) {
    const t = String(tituloRaw || '').trim();
    if (!t) return { mode: 'empty', line: 'Não informado' };
    const normalized = t.replace(/\s+/g, '');
    const parts = normalized.split(',');
    if (parts.length === 2) {
      const lat = Number(parts[0]);
      const lon = Number(parts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { mode: 'coords', line: `${lat}, ${lon}` };
      }
    }
    return { mode: 'texto', line: this._chatSafe(t) };
  },

  /**
   * Mesmo layout do rompimento: blocos com linha em branco, coordenadas em linha solta.
   * @param {'andamento'|'concluida'|'finalizada'} event
   */
  _buildTrocaPosteMessage(event, task) {
    const tecnico = this._resolveTechnicianDisplay(task, { mention: event === 'andamento' });
    const regiao = (task.regiao || '').trim() || 'Não informada';
    const assinatura = String(task?.assinadaPor || '').trim();
    const titulo = (task.titulo || '').trim();
    const descExtra = (task.descricao || '').trim();
    const coordsSaved = String(task.coordenadas || '').trim();
    const enderecoSaved = String(task.localizacaoTexto || '').trim();
    const taskId = task.taskCode || `POS-${String(task.id || '').padStart(4, '0')}`;

    // Troca de poste (andamento): mensagem curta e objetiva (pedido do time).
    if (event === 'andamento') {
      const coordsLine = coordsSaved || (() => {
        const loc = this._trocaPosteTitleAsLocation(titulo);
        return loc.mode === 'coords' ? loc.line : '—';
      })();
      const enderecoLine = enderecoSaved || (() => {
        const loc = this._trocaPosteTitleAsLocation(titulo);
        return loc.mode === 'texto' ? loc.line : 'Não informado';
      })();
      const enviadoPor = assinatura || 'Não informado';

      return {
        text: [
          `*🔄 Troca de Poste - ${this._chatSafe(enderecoLine)}*`,
          '📍Coordenadas: ',
          this._chatSafe(coordsLine),
          '',
          `👨‍🔧 Técnico Responsável: ${this._chatSafe(tecnico)}`,
          `👤 Enviado por: ${this._chatSafe(enviadoPor)}`,
          `🆔: ${this._chatSafe(taskId)}`,
        ].join('\n'),
      };
    }

    const statusLine = {
      andamento: '⚠️ Troca de poste em andamento na rede.',
      concluida: '✅ Troca de poste concluída.',
      finalizada: '🏁 Troca de poste finalizada.',
    }[event] || '🔔 Atualização — troca de poste.';

    const head = this._rompimentoBoldLines([
      '🪵⚡🔧 TROCA DE POSTE',
      '',
      statusLine,
      '',
      `🌎 REGIÃO: ${regiao}`,
      `👷‍♂️ TÉCNICO RESPONSÁVEL: ${tecnico}`,
      assinatura ? `🖊️ ASSINATURA: ${assinatura}` : '',
    ]);

    let locationBlock;
    if (coordsSaved || enderecoSaved) {
      const cLine = coordsSaved || '—';
      const eLine = enderecoSaved || '—';
      locationBlock =
        `*${this._chatSafe('📍 COORDENADAS')}*\n${this._chatSafe(cLine)}\n\n` +
        `*${this._chatSafe('🏠 RUA / BAIRRO')}*\n${this._chatSafe(eLine)}`;
    } else {
      const loc = this._trocaPosteTitleAsLocation(titulo);
      const coordLabel = loc.mode === 'coords' ? '📍 COORDENADAS' : '📍 LOCAL / DESCRIÇÃO';
      locationBlock = `*${this._chatSafe(coordLabel)}*\n${this._chatSafe(loc.line)}`;
    }

    const sections = [
      head,
      locationBlock,
      this._rompimentoBoldLines([`🆔 ID DA TAREFA: ${taskId}`]),
    ];
    if (descExtra) {
      sections.push(this._rompimentoBoldLines([`📝 OBSERVAÇÃO: ${descExtra}`]));
    }
    if (event === 'concluida' || event === 'finalizada') {
      sections.push(
        this._rompimentoBoldLines([
          `⏱️ TEMPO NO SERVIÇO: ${this._formatDurationFromStart(task)}`,
        ]),
      );
    }

    return { text: sections.join('\n\n') };
  },

  /**
   * Google Chat — Troca de etiqueta: mensagem ao entrar em andamento (pedido do time).
   * Formato:
   * 🏷️TROCA DE ETIQUETA
   *
   * 📍Localizações:
   * (ELEMENTO 1)- (LOCALIZAÇÃO CLICÁVEL)
   *
   * 👨‍🔧 Técnico Responsável:
   * 👤 Enviado por:
   * 🆔 :
   * @param {'andamento'|'concluida'|'finalizada'} event
   */
  _buildTrocaEtiquetaMessage(event, task) {
    const tecnico = this._resolveTechnicianDisplay(task, { mention: event === 'andamento' });
    const enviadoPor = String(task?.assinadaPor || '').trim() || '—';
    const code = String(task?.taskCode || '').trim();
    const synthetic = (typeof Utils !== 'undefined' && typeof Utils.syntheticOpTaskCode === 'function')
      ? String(Utils.syntheticOpTaskCode(task) || '').trim()
      : '';
    const taskId = String(code || synthetic || `ETQ-${String(task?.id || '').padStart(4, '0')}`).trim();

    const ctoId = String(task?.ctoId || task?.titulo || '').trim() || `CTO-${String(Number(task?.id) || 0).padStart(2, '0')}`;
    const coordsClickable = this._coordsClickableForChat(task?.coordenadas);

    const title =
      event === 'concluida'
        ? '*✅ TROCA DE ETIQUETA — CONCLUÍDA*'
        : '*🏷️TROCA DE ETIQUETA*';

    return {
      text: [
        title,
        '',
        '📍Localizações:',
        `${this._chatSafe(ctoId)}: ${this._chatSafe(coordsClickable)}`,
        '',
        `👨‍🔧 Técnico Responsável: ${this._chatSafe(tecnico)}`,
        `👤 Enviado por: ${this._chatSafe(enviadoPor)}`,
        `🆔 : ${this._chatSafe(taskId)}`,
      ].join('\n'),
    };
  },

  /**
   * Google Chat — Correção de atenuação: mesmo layout da Troca de etiqueta.
   * Elemento = nome da CTO; localização = coordenadas (clicáveis quando lat,lon).
   * Lista: uma linha por tarefa; opcionalmente `task.atnLocalizacoes` ou `task.localizacoes`
   * como array de `{ cto?, ctoId?, titulo?, coordenadas? }` para N elementos.
   * @param {'andamento'|'concluida'|'finalizada'} event
   */
  _buildCorrecaoAtenuacaoMessage(event, task) {
    const tecnico = this._resolveTechnicianDisplay(task, { mention: event === 'andamento' });
    const enviadoPor = String(task?.assinadaPor || '').trim() || '—';
    const code = String(task?.taskCode || '').trim();
    const synthetic = (typeof Utils !== 'undefined' && typeof Utils.syntheticOpTaskCode === 'function')
      ? String(Utils.syntheticOpTaskCode(task) || '').trim()
      : '';
    const taskId = String(code || synthetic || `ATN-${String(task?.id || '').padStart(4, '0')}`).trim();

    const ctoFromTask = () => {
      const id = String(task?.ctoId || '').trim();
      if (id) return id;
      const t = String(task?.titulo || '').trim();
      if (t.includes('·')) return t.split('·')[0].trim();
      return t || `ATN-${String(Number(task?.id) || 0).padStart(4, '0')}`;
    };

    const rows = [];
    const list = Array.isArray(task?.atnLocalizacoes)
      ? task.atnLocalizacoes
      : Array.isArray(task?.localizacoes)
        ? task.localizacoes
        : null;
    if (list && list.length) {
      list.forEach((row, idx) => {
        const label = String(row?.cto || row?.ctoId || row?.titulo || `Elemento ${idx + 1}`).trim() || `Elemento ${idx + 1}`;
        rows.push({
          label,
          coords: this._coordsClickableForChat(row?.coordenadas),
        });
      });
    } else {
      rows.push({
        label: ctoFromTask(),
        coords: this._coordsClickableForChat(task?.coordenadas),
      });
    }

    const title =
      event === 'concluida' || event === 'finalizada'
        ? '*✅CORREÇÃO DE ATENUAÇÃO — CONCLUÍDA*'
        : '*📡CORREÇÃO DE ATENUAÇÃO*';

    const locLines = rows.map((r, i) =>
      `${this._chatSafe(r.label || `Elemento ${i + 1}`)}: ${this._chatSafe(r.coords)}`,
    );

    return {
      text: [
        title,
        '',
        '📍Localizações:',
        ...locLines,
        '',
        `👨‍🔧 Técnico Responsável: ${this._chatSafe(tecnico)}`,
        `👤 Enviado por: ${this._chatSafe(enviadoPor)}`,
        `🆔 : ${this._chatSafe(taskId)}`,
      ].join('\n'),
    };
  },

  /**
   * Google Chat — Qualidade de potência (QDP): mensagem completa e com menção ao técnico.
   * Usa `responsavelChatId` quando disponível (ou resolve via diretório por região).
   * @param {'andamento'|'concluida'|'finalizada'} event
   */
  _buildQualidadePotenciaMessage(event, task) {
    const B = (lines) => this._rompimentoBoldLines(lines);
    const s = (x) => this._chatSafe(String(x ?? '').trim());
    const tecnico = this._resolveTechnicianDisplay(task, { mention: event === 'andamento' });
    const enviadoPor = s(String(task?.assinadaPor || '').trim() || '—');
    const code = s(String(task?.taskCode || '').trim());
    const synthetic = (typeof Utils !== 'undefined' && typeof Utils.syntheticOpTaskCode === 'function')
      ? s(String(Utils.syntheticOpTaskCode(task) || '').trim())
      : '';
    const taskId = s(code || synthetic || `QDP-${String(task?.id || '').padStart(4, '0')}`);

    const cliente = s(String(task?.nomeCliente || '').trim() || '—');
    const os = s(String(task?.ordemServico || '').trim() || '—');
    const cto = s(String(task?.setor || '').trim() || '—');
    const regiao = s(String(task?.regiao || '').trim() || '—');
    const prioridade = s(String(task?.prioridade || '').trim() || '—');
    const prazoRaw = s(String(task?.prazo || '').trim());
    const prazo = prazoRaw ? s(Utils.formatDate(prazoRaw)) : '—';

    const coords = s(this._coordsClickableForChat(task?.coordenadas));
    const endereco = s(String(task?.localizacaoTexto || '').trim() || '—');

    if (event === 'andamento') {
      return {
        text: B([
          '⚡ QUALIDADE DE POTÊNCIA',
          '',
          `👤 Cliente: ${cliente}`,
          `🧾 Ordem de serviço: ${os}`,
          `🌎 Região: ${regiao}`,
          `🔧 Técnico: ${tecnico}`,
          `🏷️ CTO: ${cto}`,
          '',
          `🗺️ Coordenadas: ${coords}`,
          `🏠 Endereço: ${endereco}`,
          '',
          `📅 Vencimento: ${prazo}`,
          `⭐ Prioridade: ${prioridade}`,
          '',
          `👤 Enviado por: ${enviadoPor}`,
          `🆔 ID: ${taskId}`,
        ]),
      };
    }

    const sep = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';
    const head =
      event === 'concluida'
        ? '✅ QUALIDADE DE POTÊNCIA — CONCLUÍDA'
        : '🏁 QUALIDADE DE POTÊNCIA — FINALIZADA';
    const elapsed = this._formatDurationFromStart(task);
    const elapsedLine =
      elapsed && elapsed !== 'Não foi possível calcular'
        ? [`⏱️ TEMPO NO SERVIÇO · ${s(elapsed)}`]
        : [];

    return {
      text: B([
        head,
        sep,
        `🆔 ID · ${taskId}`,
        `👤 CLIENTE · ${cliente}`,
        `🧾 OS · ${os}`,
        `🌎 REGIÃO · ${regiao}`,
        `🔧 TÉCNICO · ${tecnico}`,
        `🏷️ CTO · ${cto}`,
        `🗺️ COORDENADAS · ${coords}`,
        `🏠 ENDEREÇO · ${endereco}`,
        `📅 VENCIMENTO · ${prazo}`,
        `⭐ PRIORIDADE · ${prioridade}`,
        ...elapsedLine,
      ]),
    };
  },

  /**
   * Google Chat — Manutenção corretiva: mensagem própria baseada nos campos do card/modal.
   * @param {'andamento'|'concluida'|'finalizada'} event
   */
  _buildManutencaoCorretivaMessage(event, task) {
    const B = (lines) => this._rompimentoBoldLines(lines);
    const s = (x) => this._chatSafe(String(x ?? '').trim());
    const tecnico = this._resolveTechnicianDisplay(task, { mention: event === 'andamento' });
    const enviadoPor = s(String(task?.assinadaPor || '').trim() || '—');
    const code = s(String(task?.taskCode || '').trim());
    const synthetic = (typeof Utils !== 'undefined' && typeof Utils.syntheticOpTaskCode === 'function')
      ? s(String(Utils.syntheticOpTaskCode(task) || '').trim())
      : '';
    const taskId = s(code || synthetic || `MCR-${String(task?.id || '').padStart(4, '0')}`);

    // Campos preenchidos no card/modal (no modal o label é "Manutenção", mas o campo persiste em `nomeCliente`)
    const manutencao = s(String(task?.nomeCliente || '').trim() || '—');
    const os = s(String(task?.ordemServico || '').trim() || '—');
    const cto = s(String(task?.setor || '').trim() || '—');
    const regiao = s(String(task?.regiao || '').trim() || '—');
    const prioridade = s(String(task?.prioridade || '').trim() || '—');
    const prazoRaw = s(String(task?.prazo || '').trim());
    const prazo = prazoRaw ? s(Utils.formatDate(prazoRaw)) : '—';

    const coords = s(this._coordsClickableForChat(task?.coordenadas));
    const endereco = s(String(task?.localizacaoTexto || '').trim() || '—');

    if (event === 'andamento') {
      return {
        text: B([
          '🛠️ MANUTENÇÃO CORRETIVA',
          '',
          `🧰 Manutenção: ${manutencao}`,
          `🧾 Ordem de serviço: ${os}`,
          `🌎 Região: ${regiao}`,
          `🔧 Técnico: ${tecnico}`,
          `🏷️ CTO: ${cto}`,
          '',
          `🗺️ Coordenadas: ${coords}`,
          `🏠 Endereço: ${endereco}`,
          '',
          `📅 Vencimento: ${prazo}`,
          `⭐ Prioridade: ${prioridade}`,
          '',
          `👤 Enviado por: ${enviadoPor}`,
          `🆔 ID: ${taskId}`,
        ]),
      };
    }

    const sep = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';
    const head =
      event === 'concluida'
        ? '✅ MANUTENÇÃO CORRETIVA — CONCLUÍDA'
        : '🏁 MANUTENÇÃO CORRETIVA — FINALIZADA';
    const elapsed = this._formatDurationFromStart(task);
    const elapsedLine =
      elapsed && elapsed !== 'Não foi possível calcular'
        ? [`⏱️ TEMPO NO SERVIÇO · ${s(elapsed)}`]
        : [];

    return {
      text: B([
        head,
        sep,
        `🆔 ID · ${taskId}`,
        `🧰 MANUTENÇÃO · ${manutencao}`,
        `🧾 OS · ${os}`,
        `🌎 REGIÃO · ${regiao}`,
        `🔧 TÉCNICO · ${tecnico}`,
        `🏷️ CTO · ${cto}`,
        `🗺️ COORDENADAS · ${coords}`,
        `🏠 ENDEREÇO · ${endereco}`,
        `📅 VENCIMENTO · ${prazo}`,
        `⭐ PRIORIDADE · ${prioridade}`,
        ...elapsedLine,
      ]),
    };
  },

  _formatDurationFromStart(task) {
    const history = Array.isArray(task?.historico) ? task.historico : [];
    if (!history.length) return 'Não foi possível calcular';

    const startEntry = history.find(h => h.status === 'Em andamento');
    if (!startEntry?.timestamp) return 'Não foi possível calcular';

    const endEntry =
      [...history].reverse().find(h => (h.status === 'Concluída' || h.status === 'Finalizada') && h.timestamp) ||
      history[history.length - 1];

    if (!endEntry?.timestamp) return 'Não foi possível calcular';

    const start = new Date(startEntry.timestamp);
    const end = new Date(endEntry.timestamp);
    const diffMs = Math.max(0, end.getTime() - start.getTime());
    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    parts.push(`${minutes}min`);
    return parts.join(' ');
  },

  _normalizeRegionKey(regionRaw) {
    const r = String(regionRaw || '').trim().toLowerCase();
    if (!r) return '';
    if (r === 'goval') return 'GOVAL';
    if (r === 'vale do aço' || r === 'vale do aco') return 'VALE_DO_ACO';
    if (r === 'caratinga') return 'CARATINGA';
    return r.toUpperCase().replace(/\s+/g, '_');
  },

  _resolveWebhookUrlForTask(task, config) {
    const isAtd = task?.categoria === 'atendimento-cliente';
    const isChild = isAtd && task?.parentTaskId;
    const rootTask = isChild ? Store.findOpTask(Number(task.parentTaskId)) : task;

    // Se já existe URL do tópico salva na tarefa raiz (pai), sempre reutiliza.
    const fixedThreadWebhook = String(rootTask?.chatThreadWebhookUrl || '').trim();
    if (fixedThreadWebhook) return fixedThreadWebhook;

    const byRegion = (config && config.urlsByRegion && typeof config.urlsByRegion === 'object')
      ? config.urlsByRegion
      : {};
    // Atendimento (pai/filha) usa a região da tarefa pai para não dividir tópico em canais distintos.
    let regionSource = isAtd ? (rootTask?.regiao || task?.regiao) : task?.regiao;

    const key = this._normalizeRegionKey(regionSource);
    // Atenuação: não permitir fallback silencioso para BACKUP quando a região não foi escolhida.
    // (o usuário escolhe a região no dropdown; sem região, não sabemos qual chat usar.)
    if (!key && String(task?.categoria || '').trim() === 'correcao-atenuacao') return '';
    const picked = key ? String(byRegion[key] || '').trim() : '';
    if (picked) return picked;
    // FIX: se a região não estiver mapeada, usa BACKUP (quando configurado) antes do default.
    const backup = String(byRegion.BACKUP || '').trim();
    if (backup) return backup;
    return String(config?.url || '').trim();
  },

  /**
   * Envia mensagem formatada ao canal configurado
   * @param {'andamento'|'concluida'|'finalizada'} event
   * @param {OpTask|Task} task
   * @param {'Rompimentos'|'Troca de Poste'|null} category
   */
  async send(event, task, category = null) {
    const config = Store.getWebhookConfig();
    const webhookUrl = this._resolveWebhookUrlForTask(task, config);
    if (config?.events && config.events[event] === false) {
      // FIX: feedback mínimo quando evento está desativado
      if (event === 'andamento') ToastService.show('Webhook de "Em andamento" está desativado nas integrações.', 'warning');
      return;
    }
    if (!webhookUrl) {
      // FIX: não falhar silenciosamente quando falta webhook da região
      const reg = String(task?.regiao || '').trim();
      const regLabel = reg || 'sem região';
      if (event === 'andamento') ToastService.show(`Sem webhook configurado para ${regLabel}.`, 'warning');
      return;
    }

    const message = this._buildMessage(event, task, category);

    const isAtdChild = task?.categoria === 'atendimento-cliente' && task?.parentTaskId;
    const threadRootTask = isAtdChild ? Store.findOpTask(Number(task.parentTaskId)) : task;
    if (!threadRootTask) return;

    // Google Chat threading (tópicos): cria no "andamento" e responde no mesmo thread nas demais.
    const threadKey = this._resolveThreadKey(event, threadRootTask);
    if (threadKey) {
      this._persistThreadMetaIfNeeded(threadRootTask, threadKey, webhookUrl);
      const url = this._buildThreadedWebhookUrl(webhookUrl, threadKey);
      const payload = { ...message, thread: { threadKey } };
      await this._post(url, payload);
      return;
    }

    await this._post(webhookUrl, message);
  },

  _resolveThreadKey(_event, task) {
    const existing = String(task?.chatThreadKey ?? '').trim();
    if (existing) return existing;

    // Sempre gera chave única por "instância da tarefa raiz", evitando cair em tópico antigo.
    const stableId = this._taskStableId(task);
    const createdAt = String(task?.criadaEm || '').trim();
    const createdStamp = createdAt ? String(new Date(createdAt).getTime()) : '';
    const unique = createdStamp || String(task?.id || '').trim() || String(Date.now());
    return `burrinho-${stableId}-${unique}`.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  },

  _taskStableId(task) {
    const cat = String(task?.categoria ?? task?.source ?? '').trim() || 'task';
    const code = String(task?.taskCode ?? '').trim();
    const id = String(task?.id ?? '').trim();
    return code || (id ? `${cat}-${id}` : `${cat}-unknown`);
  },

  _persistThreadMetaIfNeeded(task, threadKey, webhookUrl = '') {
    const current = String(task?.chatThreadKey ?? '').trim();
    const currentWebhook = String(task?.chatThreadWebhookUrl ?? '').trim();
    if (current && currentWebhook) return;

    const idNum = Number(task?.id);
    if (!Number.isFinite(idNum)) return;

    const patch = {};
    if (!current) patch.chatThreadKey = threadKey;
    if (!currentWebhook && webhookUrl) patch.chatThreadWebhookUrl = webhookUrl;
    if (!Object.keys(patch).length) return;

    try {
      // Compatível com o shape atual: dashboard → updateTask; operacional → updateOpTask
      if (task?.source === 'dashboard') Store.updateTask(idNum, patch);
      else Store.updateOpTask(idNum, patch);
    } catch {
      // não quebra o envio ao Chat se persistência falhar
    }
  },

  _buildThreadedWebhookUrl(webhookUrl, threadKey) {
    // Evita duplicar parâmetros e lida com URLs já com query.
    try {
      const u = new URL(String(webhookUrl));
      u.searchParams.set('threadKey', threadKey);
      u.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
      return u.toString();
    } catch {
      // Fallback simples (mantém compatibilidade).
      const base = String(webhookUrl || '');
      if (!base) return base;
      const sep = base.includes('?') ? '&' : '?';
      const tk = encodeURIComponent(threadKey);
      return `${base}${sep}threadKey=${tk}&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`;
    }
  },

  /** Monta o payload formatado */
  _buildMessage(event, task, category) {
    const opCat = String(task?.categoria ?? '').trim();

    if (opCat === 'qualidade-potencia') {
      return this._buildQualidadePotenciaMessage(event, task);
    }
    if (opCat === 'manutencao-corretiva') {
      return this._buildManutencaoCorretivaMessage(event, task);
    }

    if (opCat === 'otimizacao-rede') {
      return this._buildOtimRedeMessage(event, task);
    }

    if (opCat === 'certificacao-cemig') {
      return this._buildCemigMessage(event, task);
    }

    if (opCat === 'troca-poste') {
      return this._buildTrocaPosteMessage(event, task);
    }

    if (opCat === 'troca-etiqueta') {
      return this._buildTrocaEtiquetaMessage(event, task);
    }

    if (opCat === 'correcao-atenuacao' || opCat === 'correcao_atenuacao') {
      return this._buildCorrecaoAtenuacaoMessage(event, task);
    }

    // Template específico: Atendimento ao Cliente (Tarefa Pai) entrando em andamento.
    if (opCat === 'atendimento-cliente' && event === 'andamento' && task?.isParentTask) {
      const histAtd = Array.isArray(task?.historico) ? task.historico : [];
      const nomeCliente = String(task.nomeCliente || task.titulo || '').trim();
      const protocolo = String(task.protocolo || '').trim();
      const okYmd = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !d.startsWith('0000');
      const dataEntradaIso = String(task.dataEntrada || '').trim();
      const deDay = dataEntradaIso.slice(0, 10);
      const dataEntrada = (okYmd(deDay) ? Utils.formatDate(deDay) : '') ||
        (() => {
          const c = String(task.criadaEm || '').trim();
          const day = c.slice(0, 10);
          return okYmd(day) ? Utils.formatDate(day) : '';
        })();
      // “Data de saída” no formulário (op-atd-data-instalacao) → task.dataInstalacao; campo “prazo” costuma ficar vazio no pai ATD.
      const saidaIso = String(task.dataInstalacao || '').trim();
      const saidaDay = saidaIso.slice(0, 10);
      const prazoSaidaFmt = okYmd(saidaDay) ? Utils.formatDate(saidaDay) : '';
      const prazoRaw = String(task.prazo || '').trim();
      const prazoDay = prazoRaw.slice(0, 10);
      const prazoLegadoFmt = okYmd(prazoDay)
        ? Utils.formatDate(prazoDay)
        : (prazoRaw && !prazoRaw.startsWith('0000-00-00') ? String(prazoRaw).trim() : '');
      const prazoFinal = prazoSaidaFmt || prazoLegadoFmt;
      const enviadoPor =
        String(task.assinadaPor || '').trim() ||
        String(histAtd[0]?.autor || '').trim();
      const taskId = String(task.taskCode || `ATD-${String(task.id || '').padStart(4, '0')}`).trim();

      const subtasks = Store.getOpTasks()
        .filter(t => t && t.categoria === 'atendimento-cliente' && Number(t.parentTaskId) === Number(task.id))
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map(t => String(t.titulo || '').trim())
        .filter(Boolean);

      const listLines = subtasks.length
        ? subtasks.map((title, idx) => `${idx + 1}° - ${this._chatSafe(title)}`).join('\n')
        : '1° - ';

      return {
        text: [
          '*Atendimento ao Cliente*',
          `👤 ${this._chatSafe(nomeCliente)}`,
          `📄 Protocolo: ${this._chatSafe(protocolo)}`,
          `🗓️ Data de entrada: ${this._chatSafe(dataEntrada)}`,
          `⏰ Prazo de saída: ${this._chatSafe(prazoFinal)}`,
          '',
          listLines,
          '',
          `👤 Enviado por: ${this._chatSafe(enviadoPor)}`,
          `🆔: ${this._chatSafe(taskId)}`,
        ].join('\n'),
      };
    }

    // Atendimento ao Cliente (Tarefa Pai) finalizada: mensagem curta (pedido do time).
    if (opCat === 'atendimento-cliente' && event === 'finalizada' && task?.isParentTask) {
      const history = Array.isArray(task?.historico) ? task.historico : [];
      const lastAuthor = String(history[history.length - 1]?.autor || '').trim();
      const por = lastAuthor || String(task.assinadaPor || '').trim();
      return {
        text: [
          '🏁 Demanda finalizada',
          `👤 Por: ${this._chatSafe(por)}`,
        ].join('\n'),
      };
    }

    if (opCat === 'atendimento-cliente' && event === 'andamento' && task?.parentTaskId) {
      const parent = Store.findOpTask(Number(task.parentTaskId));
      const childCode = String(task.taskCode || `ATD-${String(task.id || '').padStart(4, '0')}`).trim();
      const tecnico = String(task.responsavel || 'Não informado').trim();
      const desc = String(task.descricao || '').trim();
      const atividade = String(task.titulo || '').trim();
      const cliente = String(parent?.nomeCliente || parent?.titulo || '').trim();

      const siblings = Store.getOpTasks()
        .filter(t => t && t.categoria === 'atendimento-cliente' && Number(t.parentTaskId) === Number(task.parentTaskId))
        .sort((a, b) => Number(a.id) - Number(b.id));
      const idx = siblings.findIndex(t => Number(t.id) === Number(task.id));
      const ordinal = (idx >= 0 ? idx + 1 : 1);

      return {
        text: [
          `${ordinal}°  Atividade: ${this._chatSafe(atividade)}`,
          `📝 Cliente: ${this._chatSafe(cliente)}`,
          `👨‍🔧 Técnico Responsável: ${this._chatSafe(tecnico)}`,
          `🆔: ${this._chatSafe(childCode)}`,
          '',
          this._chatSafe(desc),
        ].join('\n'),
      };
    }

    // Atendimento ao Cliente (OS / tarefa filho) concluída: mensagem curta (pedido do time).
    if (opCat === 'atendimento-cliente' && event === 'concluida' && task?.parentTaskId) {
      const parentId = Number(task.parentTaskId);
      const siblings = Store.getOpTasks()
        .filter(t => t && t.categoria === 'atendimento-cliente' && Number(t.parentTaskId) === parentId)
        .sort((a, b) => Number(a.id) - Number(b.id));
      const idx = siblings.findIndex(t => Number(t.id) === Number(task.id));
      const ordinal = (idx >= 0 ? idx + 1 : 1);

      const atividade = String(task.titulo || '').trim();
      const history = Array.isArray(task?.historico) ? task.historico : [];
      const lastAuthor = String(history[history.length - 1]?.autor || '').trim();
      const enviadoPor = lastAuthor || String(task.assinadaPor || '').trim();

      return {
        text: [
          `✅ ${ordinal}° Atividade Concluída`,
          `📌 ${this._chatSafe(atividade)}`,
          `👤 Enviado por: ${this._chatSafe(enviadoPor)}`,
        ].join('\n'),
      };
    }

    if (opCat === 'rompimentos' && event === 'andamento') {
      const cto = String(task.setor || '').trim() || 'Não informado';
      const tecnico = this._resolveTechnicianDisplay(task);
      const coordsRaw = String(task.coordenadas || '').trim();
      const endereco = String(task.localizacaoTexto || '').trim() || 'Não informado';
      const clientesAfetados = String(task.clientesAfetados || '').trim();
      const taskId = String(task.taskCode || `ROM-${String(task.id || '').padStart(4, '0')}`).trim();

      const coordsClickable = (() => {
        // Deixa apenas "lat,lon" (Google Chat costuma tornar clicável sem precisar link explícito).
        if (!coordsRaw) return '';
        const normalized = coordsRaw.replace(/\s+/g, '');
        const parts = normalized.split(',');
        if (parts.length !== 2) return coordsRaw;
        const lat = Number(parts[0]);
        const lon = Number(parts[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return coordsRaw;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return coordsRaw;
        return `${lat},${lon}`;
      })();

      return {
        text: [
          `*⚠️ ROMPIMENTO CTO - ${this._chatSafe(cto)}*`,
          '',
          `🗺️Endereço: ${this._chatSafe(endereco)}`,
          '',
          `📍 Localização inicial: ${this._chatSafe(coordsClickable)}`,
          `👨‍🔧 Técnico Responsável: ${this._chatSafe(tecnico)}`,
          '',
          `Clientes afetados: ${this._chatSafe(clientesAfetados)}`,
          `🆔: ${this._chatSafe(taskId)}`,
        ].join('\n'),
      };
    }

    if (opCat === 'rompimentos' && (event === 'concluida' || event === 'finalizada')) {
      const setor = task.setor || 'Não informado';
      const regiao = task.regiao || 'Não informada';
      const tecnico = this._resolveTechnicianDisplay(task, { mention: false });
      const assinatura = String(task?.assinadaPor || '').trim();
      const localizacao = task.coordenadas || 'Não informada';
      const endereco = task.localizacaoTexto || 'Não informado';
      const taskId = task.taskCode || `ROM-${String(task.id || '').padStart(4, '0')}`;
      const elapsed = this._formatDurationFromStart(task);
      const title = event === 'concluida'
        ? '✅ ROMPIMENTO CONCLUÍDO'
        : '🏁 ROMPIMENTO FINALIZADO';
      const head = this._rompimentoBoldLines([
        title,
        '',
        `📌 SETOR / CTO: ${setor}`,
        `🌎 REGIÃO: ${regiao}`,
        `👨‍🔧 TÉCNICO RESPONSÁVEL: ${tecnico}`,
        assinatura ? `🖊️ ASSINATURA: ${assinatura}` : '',
      ]);
      const coordBlock = `*${this._chatSafe('📍 COORDENADAS')}*\n${this._chatSafe(localizacao)}`;
      const tail = this._rompimentoBoldLines([
        '',
        `🏠 ENDEREÇO: ${endereco}`,
        '',
        `🆔 ID DA TAREFA: ${taskId}`,
        '',
        `⏱️ TEMPO DESDE O INÍCIO: ${elapsed}`,
      ]);
      return { text: `${head}\n\n${coordBlock}${tail}` };
    }

    const labels = {
      andamento:  '🔵 *Tarefa em Andamento*',
      concluida:  '✅ *Tarefa Concluída*',
      finalizada: '🏁 *Tarefa Finalizada*',
    };
    const categoryLine = category ? `\nCategoria: *${category}*` : '';
    const descLine = task.descricao ? `\nDescrição: ${task.descricao}` : '';
    const elapsedLine = (event === 'concluida' || event === 'finalizada')
      ? `\nTempo desde o início: ${this._formatDurationFromStart(task)}`
      : '';
    return {
      text: `${labels[event]}\n*${task.titulo}*\nResponsável: ${task.responsavel} | Prazo: ${Utils.formatDate(task.prazo)} | Prioridade: ${task.prioridade}${categoryLine}${descLine}${elapsedLine}`,
    };
  },

  /** Envia o payload HTTP */
  async _post(url, payload) {
    try {
      await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        mode:    'no-cors',
      });
      // Com `no-cors` não é possível validar status; feedback otimista, porém sem garantir entrega.
      ToastService.show('Mensagem enviada ao Google Chat', 'success');
    } catch {
      ToastService.show('Erro ao enviar para o Google Chat', 'danger');
    }
  },

  /** Envia mensagem de teste */
  async sendTest(url) {
    const payload = { text: '🔔 *Burrinho Projetos* — Conexão testada com sucesso!\nSeu webhook está funcionando corretamente.' };
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), mode: 'no-cors' });
      ToastService.show('Mensagem de teste enviada!', 'success');
    } catch {
      ToastService.show('Não foi possível enviar o teste', 'danger');
    }
  },
};


/* ─────────────────────────────────────────────────────────────
   TOAST SERVICE — Notificações visuais na interface
───────────────────────────────────────────────────────────── */
const ToastService = {
  _icons: {
    success: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    info:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    danger:  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  },

  show(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${this._icons[type] || this._icons.info}</span><span class="toast-msg">${Utils.escapeHtml(message)}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 220);
    }, 3500);
  },
};


/* ─────────────────────────────────────────────────────────────
   MODAL SERVICE — Abertura e fechamento de modais
───────────────────────────────────────────────────────────── */
const ModalService = {
  open(id)  { document.getElementById(id)?.classList.add('open'); },
  close(id) {
    if (id === 'opTaskModal' && typeof OpTaskService !== 'undefined' && OpTaskService._resetAtdChildrenListExpand) {
      OpTaskService._resetAtdChildrenListExpand();
    }
    document.getElementById(id)?.classList.remove('open');
  },
  closeAll() {
    const op = document.getElementById('opTaskModal');
    if (op?.classList.contains('open') && typeof OpTaskService !== 'undefined' && OpTaskService._resetAtdChildrenListExpand) {
      OpTaskService._resetAtdChildrenListExpand();
    }
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  },
};


/* ─────────────────────────────────────────────────────────────
   TASK SERVICE — Regras de negócio das tarefas gerais
───────────────────────────────────────────────────────────── */
const TaskService = {
  _opCategoryLabelMap: {
    'rompimentos': 'Rompimentos',
    'troca-poste': 'Troca de Poste',
    'atendimento-cliente': 'Atendimento ao Cliente',
    'otimizacao-rede': 'Otimização de Rede',
    'certificacao-cemig': 'Certificação Cemig',
    'correcao-atenuacao': 'Correção de atenuação',
    'troca-etiqueta': 'Troca de etiqueta',
    'qualidade-potencia': 'Qualidade de potência',
    'manutencao-corretiva': 'Manutenção corretiva',
  },

  _isDoneStatus(status) {
    return status === 'Concluída' || status === 'Finalizada' || status === 'Finalizado';
  },

  _isPendingStatus(status) {
    return status === 'Pendente' || status === 'Criada' || status === 'Backlog';
  },

  _isProgressStatus(status) {
    return status === 'Em andamento' || status === 'Validação' || status === 'Envio pendente' || status === 'Necessário adequação';
  },

  _isLateTask(task) {
    if (!task.prazo) return false;
    if (this._isDoneStatus(task.status) || task.status === 'Cancelada') return false;
    return task.prazo < Utils.todayIso();
  },

  _normalizeGeneralTask(task) {
    return {
      ...task,
      source: 'dashboard',
      sourceLabel: 'Dashboard',
      dashboardRowId: `dashboard-${task.id}`,
      effectiveStatus: task.status,
    };
  },

  _normalizeOpTask(task) {
    return {
      ...task,
      source: 'operacional',
      sourceLabel: this._opCategoryLabelMap[task.categoria] || 'Operacional',
      dashboardRowId: `operacional-${task.id}`,
      effectiveStatus: task.status,
    };
  },

  getAllDashboardTasks() {
    this.autoFlagLate();
    const general = Store.getTasks().map(t => this._normalizeGeneralTask(t));
    const op = Store.getOpTasks().map(t => this._normalizeOpTask(t));
    return [...general, ...op];
  },

  /** Marca tarefas com prazo vencido como Atrasadas */
  autoFlagLate() {
    Store.getTasks().forEach(t => {
      if (Utils.isLate(t) && t.status !== 'Atrasada') {
        Store.updateTask(t.id, { status: 'Atrasada' });
      }
    });
  },

  /** Retorna tarefas filtradas pelos critérios atuais */
  getFilteredTasks() {
    const tod = Utils.todayIso();
    const week = Utils.weekRangeIso();
    const filter = Store.dashboardFilter;
    const query  = Store.dashboardSearch;

    return this.getAllDashboardTasks().filter(t => {
      const monthStart = Utils.addDaysIso(-30);
      const matchFilter =
        filter === 'all' ||
        (filter === 'today' && t.prazo === tod) ||
        (filter === 'week' && t.prazo && t.prazo >= week.start && t.prazo <= week.end) ||
        (filter === 'month' && t.prazo && t.prazo >= monthStart && t.prazo <= tod);
      const matchSearch = !query ||
        t.titulo.toLowerCase().includes(query) ||
        t.responsavel.toLowerCase().includes(query) ||
        t.status.toLowerCase().includes(query) ||
        t.sourceLabel.toLowerCase().includes(query);
      return matchFilter && matchSearch;
    });
  },

  /** Retorna contagens por status */
  getCounts() {
    const tasks = this.getAllDashboardTasks();
    const counts = { pending: 0, progress: 0, done: 0, late: 0 };
    tasks.forEach(t => {
      if (this._isPendingStatus(t.effectiveStatus)) counts.pending++;
      else if (this._isProgressStatus(t.effectiveStatus)) counts.progress++;
      else if (this._isDoneStatus(t.effectiveStatus)) counts.done++;

      if (t.effectiveStatus === 'Atrasada' || this._isLateTask(t)) counts.late++;
    });
    return { ...counts, total: tasks.length };
  },
};


/* ─────────────────────────────────────────────────────────────
   OP TASK SERVICE — Regras de negócio das tarefas operacionais
───────────────────────────────────────────────────────────── */
const OpTaskService = {
  /** Mapeia status → evento webhook */
  _statusToEvent: {
    'Em andamento': 'andamento',
    'Concluída':    'concluida',
    'Finalizada':   'finalizada',
    'Finalizado':   'finalizada',
  },

  /** Mapeia categoria → label legível */
  _categoryLabels: {
    'rompimentos': 'Rompimentos',
    'troca-poste': 'Troca de Poste',
    'atendimento-cliente': 'Atendimento ao Cliente',
    'otimizacao-rede': 'Otimização de Rede',
    'certificacao-cemig': 'Certificação Cemig',
    'correcao-atenuacao': 'Correção de atenuação',
    'troca-etiqueta': 'Troca de etiqueta',
    'qualidade-potencia': 'Qualidade de potência',
  },

  /** Kanban Certificação Cemig — ordem do fluxo */
  _cemigColumns: [
    { status: 'Pendente', key: 'col-cemig-pendente', label: 'Pendentes' },
    { status: 'Em andamento', key: 'col-cemig-andamento', label: 'Em andamento' },
    { status: 'Validação', key: 'col-cemig-validacao', label: 'Validação' },
    { status: 'Necessário adequação', key: 'col-cemig-adequacao', label: 'Precisa de adequação' },
    { status: 'Concluída', key: 'col-cemig-concluida', label: 'Concluído' },
  ],
  _cemigNext: {
    'Pendente': ['Em andamento'],
    'Em andamento': ['Validação'],
    'Validação': ['Necessário adequação', 'Concluída'],
    'Necessário adequação': ['Validação', 'Concluída'],
    'Concluída': [],
  },
  _cemigActionLabels: {
    'Em andamento': 'Iniciar',
    'Validação': 'Em validação',
    'Necessário adequação': 'Adequação',
    'Concluída': 'Concluir',
  },

  /**
   * Altera o status de uma tarefa operacional e dispara webhook se necessário
   * @param {number} id
   * @param {OpStatus} newStatus
   */
  changeStatus(id, newStatus) {
    const task = Store.updateOpTaskStatus(id, newStatus);
    if (!task) return;

    // FIX: normalizar status (evita falhar por espaços/variações)
    const statusKey = String(newStatus || '').trim();
    const event = this._statusToEvent[statusKey];
    if (event) {
      const categoryLabel = this._categoryLabels[task.categoria] || task.categoria;
      WebhookService.send(event, task, categoryLabel);
    }
  },

  /** Status exibidos no menu «alterar status» (fora do fluxo Cemig). */
  _stdOpStatusPicklist() {
    return ['Criada', 'Em andamento', 'Concluída', 'Finalizada'];
  },

  /**
   * Lista ordenada de status que o usuário pode escolher para a tarefa operacional.
   * @param {object} task
   * @returns {string[]}
   */
  getStatusPicklist(task) {
    if (!task || typeof task !== 'object') return [];
    if (task.categoria === 'certificacao-cemig') {
      return this._cemigColumns.map(c => c.status);
    }
    if (task.categoria === 'correcao-atenuacao') {
      return ['Criada', 'Em andamento', 'Concluída'];
    }
    if (task.categoria === 'atendimento-cliente') {
      return ['Backlog', 'Em andamento', 'Concluída', 'Finalizada'];
    }
    return this._stdOpStatusPicklist();
  },

  /**
   * Retorna tarefas operacionais filtradas por categoria e busca.
   * @param {string} category
   * @param {{ filterNamespace?: 'op' | 'atd' }} [opts] — `atd`: usa filtros da página Atendimento (Store.atdOp*).
   */
  getFilteredByCategory(category, opts = {}) {
    const ns = opts.filterNamespace === 'atd' ? 'atd' : 'op';
    const query = (ns === 'atd' ? Store.atdOpSearch : Store.opSearch || '').toLowerCase();
    const regionQuery = (ns === 'atd' ? Store.atdOpRegionSearch : Store.opRegionSearch || '').toLowerCase();
    const techQuery = (ns === 'atd' ? Store.atdOpTecnicoSearch : Store.opTecnicoSearch || '').toLowerCase();
    const taskIdRaw = String((ns === 'atd' ? Store.atdOpTaskIdSearch : Store.opTaskIdSearch) || '').trim();
    const taskIdNum = taskIdRaw && /^\d+$/.test(taskIdRaw) ? Number(taskIdRaw) : null;
    const dateSort = String((ns === 'atd' ? Store.atdOpDateSort : Store.opDateSort) || 'all');

    const filtered = Store.getOpTasksByCategory(category).filter(t => {
      const matchSearch =
        !query ||
        String(t.titulo || '').toLowerCase().includes(query) ||
        String(t.responsavel || '').toLowerCase().includes(query) ||
        String(t.descricao || '').toLowerCase().includes(query);

      const matchRegion = !regionQuery || String(t.regiao || '').toLowerCase() === regionQuery;

      const matchTech = !techQuery || String(t.responsavel || '').toLowerCase().includes(techQuery);

      const matchTaskId =
        !taskIdRaw ||
        (taskIdNum !== null ? Number(t.id) === taskIdNum : false) ||
        String(t.taskCode || '').includes(taskIdRaw) ||
        String(t.id).includes(taskIdRaw);

      return matchSearch && matchRegion && matchTech && matchTaskId;
    });

    const toTime = (task) => {
      const d = String(task.dataEntrada || task.prazo || task.criadaEm || '').trim();
      const ts = d ? new Date(d).getTime() : Number.NaN;
      return Number.isFinite(ts) ? ts : 0;
    };

    if (dateSort === 'oldest') {
      return [...filtered].sort((a, b) => toTime(a) - toTime(b));
    }
    if (dateSort === 'newest') {
      return [...filtered].sort((a, b) => toTime(b) - toTime(a));
    }
    return filtered;
  },

  /** Retorna contagens por status para estatísticas */
  getStatusCounts() {
    const counts = { Criada: 0, 'Em andamento': 0, Concluída: 0, Finalizada: 0, Backlog: 0 };
    Store.getOpTasks().forEach(t => {
      // No "Atendimento ao Cliente", subtarefas não devem inflar contadores de tarefas.
      if (t.categoria === 'atendimento-cliente' && t.parentTaskId) return;
      if (t.categoria === 'certificacao-cemig') {
        const s = t.status;
        if (s === 'Backlog') counts.Criada++;
        else if (['Em andamento', 'Validação', 'Envio pendente', 'Necessário adequação'].includes(s)) counts['Em andamento']++;
        else if (s === 'Finalizado') counts.Finalizada++;
        return;
      }
      if (t.status === 'Backlog' || t.status === 'Criada' || t.status === 'A iniciar') {
        counts.Criada++;
        counts.Backlog++;
        return;
      }
      if (counts[t.status] !== undefined) counts[t.status]++;
    });
    return counts;
  },
};

/** Ordem dos itens do menu lateral (persistência local). */
const SIDEBAR_NAV_ORDER_KEY = 'planner.sidebar.navOrder.v1';

const SidebarNavOrder = {
  /** Evita `click` disparar navegação logo após um drop de reordenação. */
  lastDropAt: 0,

  mergeOrder(saved, domIds) {
    const domSet = new Set(domIds);
    const out = [];
    const used = new Set();
    if (Array.isArray(saved) && saved.length) {
      for (const id of saved) {
        if (typeof id === 'string' && domSet.has(id) && !used.has(id)) {
          out.push(id);
          used.add(id);
        }
      }
    }
    for (const id of domIds) {
      if (!used.has(id)) {
        out.push(id);
        used.add(id);
      }
    }
    return out;
  },

  persistFromDom(wrap) {
    const ids = [...wrap.querySelectorAll('.nav-item[data-page]')].map((b) => b.dataset.page).filter(Boolean);
    try {
      localStorage.setItem(SIDEBAR_NAV_ORDER_KEY, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  },

  apply() {
    const wrap = document.getElementById('sidebarNavPages');
    if (!wrap) return;
    let saved = null;
    try {
      const raw = localStorage.getItem(SIDEBAR_NAV_ORDER_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      saved = null;
    }
    const domIds = [...wrap.querySelectorAll('.nav-item[data-page]')].map((b) => b.dataset.page).filter(Boolean);
    const merged = this.mergeOrder(Array.isArray(saved) ? saved : null, domIds);
    const byId = new Map(
      [...wrap.querySelectorAll('.nav-item[data-page]')].map((btn) => [btn.dataset.page, btn]),
    );
    for (const id of merged) {
      const el = byId.get(id);
      if (el) wrap.appendChild(el);
    }
    this.persistFromDom(wrap);
  },

  /** Arrastar e soltar na própria barra lateral para reordenar (persiste em localStorage). */
  initDrag() {
    const wrap = document.getElementById('sidebarNavPages');
    if (!wrap || wrap.dataset.navDragBound === '1') return;
    wrap.dataset.navDragBound = '1';

    wrap.querySelectorAll('.nav-item[data-page]').forEach((btn) => {
      btn.setAttribute('draggable', 'true');
    });

    let dragged = null;

    wrap.addEventListener('dragstart', (e) => {
      const btn = e.target.closest?.('.nav-item[data-page]');
      if (!btn || !wrap.contains(btn)) return;
      dragged = btn;
      btn.classList.add('nav-item-dragging');
      try {
        e.dataTransfer.setData('text/plain', btn.dataset.page || '');
        e.dataTransfer.effectAllowed = 'move';
      } catch {
        /* ignore */
      }
    });

    wrap.addEventListener('dragend', (e) => {
      const btn = e.target.closest?.('.nav-item[data-page]');
      if (btn) btn.classList.remove('nav-item-dragging');
      dragged = null;
    });

    wrap.addEventListener('dragover', (e) => {
      if (!dragged) return;
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = 'move';
      } catch {
        /* ignore */
      }
    });

    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragged) return;
      const target = e.target.closest?.('.nav-item[data-page]');
      if (!target || !wrap.contains(target) || target === dragged) return;
      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) wrap.insertBefore(dragged, target);
      else wrap.insertBefore(dragged, target.nextSibling);
      SidebarNavOrder.persistFromDom(wrap);
      SidebarNavOrder.lastDropAt = Date.now();
    });
  },
};


/* ─────────────────────────────────────────────────────────────
   UI RENDERERS — Funções de renderização da interface
───────────────────────────────────────────────────────────── */

const UI = {
  _lastMovedOpTask: null,
  _atendimentoExpanded: {},
  _atendimentoGroupExpanded: {
    Backlog: true,
    'Em andamento': true,
    'Concluída': true,
    Finalizada: true,
  },
  _atdStatusOrder: ['Backlog', 'Em andamento', 'Concluída', 'Finalizada'],
  /** Após soltar um card na estante, evita abrir o modal no click fantasma. */
  _atdSuppressBookClickUntil: 0,
  _normalizeAtdStatus(status) {
    if (status === 'Criada' || status === 'A iniciar') return 'Backlog';
    return status;
  },

  /** Colunas do kanban recolhidas por chave `categoriaOuPagina|status` (persistido na aba). */
  _KANBAN_COLLAPSED_SS_KEY: 'planner.kanban.collapsedCols.v1',
  _kanbanCollapsedKeys: null,
  _ensureKanbanCollapsedKeys() {
    if (this._kanbanCollapsedKeys instanceof Set) return this._kanbanCollapsedKeys;
    try {
      const raw = sessionStorage.getItem(this._KANBAN_COLLAPSED_SS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      this._kanbanCollapsedKeys = new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
    } catch {
      this._kanbanCollapsedKeys = new Set();
    }
    return this._kanbanCollapsedKeys;
  },
  _persistKanbanCollapsedKeys() {
    try {
      sessionStorage.setItem(this._KANBAN_COLLAPSED_SS_KEY, JSON.stringify([...this._ensureKanbanCollapsedKeys()]));
    } catch {
      /* ignore */
    }
  },
  _isKanbanCollapsedKey(key) {
    return this._ensureKanbanCollapsedKeys().has(String(key || ''));
  },
  /** @returns {boolean} coluna ficou recolhida após o clique */
  _toggleKanbanCollapsedKey(key) {
    const k = String(key || '');
    if (!k) return false;
    const s = this._ensureKanbanCollapsedKeys();
    if (s.has(k)) s.delete(k);
    else s.add(k);
    this._persistKanbanCollapsedKeys();
    return s.has(k);
  },
  _applyKanbanColToggleUi(btn, nowCollapsed) {
    if (!btn) return;
    const colLabel = btn.getAttribute('data-kanban-col-label') || 'coluna';
    const col = btn.closest('.kanban-col');
    if (col) col.classList.toggle('kanban-col--collapsed', nowCollapsed);
    btn.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
    const verb = nowCollapsed ? 'Expandir' : 'Recolher';
    btn.title = `${verb} tarefas deste status`;
    btn.setAttribute('aria-label', `${verb} coluna ${colLabel}`);
  },
  /* ── Helpers de badge ───────────────────────────────────── */
  _statusBadgeMap: {
    'Backlog':      's-backlog',
    'A iniciar':    's-pendente',
    'Pendente':     's-pendente',
    'Em andamento': 's-andamento',
    'Concluída':    's-concluida',
    'Finalizada':   's-finalizada',
    'Finalizado':   's-finalizado',
    'Validação':    's-validacao',
    'Envio pendente': 's-envio-pendente',
    'Necessário adequação': 's-adequacao',
    'Atrasada':     's-atrasada',
    'Cancelada':    's-cancelada',
    'Criada':       's-criada',
    'Anotado':      's-note',
  },
  _priorityBadgeMap: { Alta: 'p-high', Média: 'p-med', Baixa: 'p-low' },

  _regionBadgeClass(regiao) {
    const key = WebhookService._normalizeRegionKey(regiao);
    if (key === 'GOVAL') return 'reg-goval';
    if (key === 'VALE_DO_ACO') return 'reg-vale';
    if (key === 'CARATINGA') return 'reg-caratinga';
    return '';
  },

  /** Badge de região (Goval / Vale do Aço / Caratinga) com cores do tema. */
  regionBadge(regiao) {
    const label = String(regiao || '').trim();
    if (!label) return '';
    const cls = this._regionBadgeClass(regiao) || 'reg-unknown';
    return `<span class="badge ${cls}">${label}</span>`;
  },

  /** Badge de subprocesso (Atendimento ao Cliente): cor fixa do tema. */
  subProcessoBadge(subProcesso) {
    const label = String(subProcesso || '').trim();
    if (!label) return '';
    return `<span class="badge sp-badge">${Utils.escapeHtml(label)}</span>`;
  },

  /** Classe da barra de relatório “rompimentos por região”. */
  _regionReportBarClass(label) {
    const key = WebhookService._normalizeRegionKey(label);
    if (key === 'GOVAL') return 'reg-bar-goval';
    if (key === 'VALE_DO_ACO') return 'reg-bar-vale';
    if (key === 'CARATINGA') return 'reg-bar-caratinga';
    return 'reg-bar-unknown';
  },

  statusBadge(status) {
    const cls = this._statusBadgeMap[status] || 's-pendente';
    return `<span class="badge ${cls}"><span class="badge-dot" aria-hidden="true"></span>${status}</span>`;
  },

  priorityBadge(priority) {
    const cls = this._priorityBadgeMap[priority] || 'p-med';
    return `<span class="badge ${cls}">${priority}</span>`;
  },

  checkSvg() {
    return `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
  },

  /* ── Dashboard Stats ────────────────────────────────────── */
  renderDashboardStats() {
    window.PlannerDashboard?.syncFromStore?.();
  },

  /* ── Dashboard Task Table ───────────────────────────────── */
  renderTaskTable() {
    const listRoot = document.getElementById('plannerDashTaskList');
    const list = TaskService.getFilteredTasks();
    const tod = Utils.todayIso();

    const plannerStatusKey = t => {
      const st = String(t.effectiveStatus || t.status || '');
      if (st === 'Atrasada' || (t.prazo && t.prazo < tod && !['Concluída', 'Finalizada', 'Finalizado'].includes(st))) return 'urgente';
      if (['Em andamento', 'Validação', 'Envio pendente', 'Necessário adequação'].some(x => st.includes(x))) return 'andamento';
      if (['Concluída', 'Finalizada', 'Finalizado'].includes(st)) return 'concluida';
      return 'pendente';
    };

    if (listRoot) {
      if (!list.length) {
        listRoot.innerHTML = `<li class="planner-task-item" style="cursor:default"><span></span><div class="planner-task-main"><div class="planner-task-name">Nenhuma tarefa no período</div></div></li>`;
        return;
      }
      const pillMap = {
        urgente: ['Urgente', 'planner-pill--urgente', 'planner-task-dot--urgente'],
        pendente: ['Pendente', 'planner-pill--pendente', 'planner-task-dot--pendente'],
        andamento: ['Andamento', 'planner-pill--andamento', 'planner-task-dot--andamento'],
        concluida: ['Concluída', 'planner-pill--concluida', 'planner-task-dot--concluida'],
      };
      listRoot.innerHTML = list.slice(0, 8).map(t => {
        const key = plannerStatusKey(t);
        const [plab, pcls, dcls] = pillMap[key] || pillMap.pendente;
        const isDone = key === 'concluida';
        const nameStyle = isDone ? 'text-decoration:line-through;opacity:0.45' : '';
        return `<li class="planner-task-item">
          <span class="planner-task-dot ${dcls}" aria-hidden="true"></span>
          <div class="planner-task-main">
            <div class="planner-task-name" style="${nameStyle}">${Utils.escapeHtml(t.titulo)}</div>
            <div class="planner-task-tech">${Utils.escapeHtml(t.responsavel || '—')}</div>
          </div>
          <span class="planner-pill ${pcls}">${plab}</span>
        </li>`;
      }).join('');
      return;
    }

    const tbody = document.getElementById('taskTableBody');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Nenhuma tarefa encontrada</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(t => {
      const isLate = t.effectiveStatus === 'Atrasada' || (t.prazo && t.prazo < tod && !['Concluída','Finalizada','Finalizado'].includes(t.status));
      const isDone = ['Concluída','Finalizada','Finalizado'].includes(t.effectiveStatus);
      const color  = Utils.getAvatarColor(t.responsavel);
      const titleStyle = isDone ? 'text-decoration:line-through;opacity:.45' : '';
      const assinatura = String(t.assinadaPor || '').trim();
      const sigHtml = assinatura
        ? `<div class="sig-mini">✍ ${Utils.escapeHtml(assinatura)}</div>`
        : '';

      return `
        <tr class="dashboard-row-readonly">
          <td>
            <div class="task-name-cell">
              ${Utils.taskCopyProtocolButtonHtml(Utils.unifiedTaskDisplayRef(t))}
              <span style="${titleStyle}">${Utils.escapeHtml(t.titulo)}</span>
            </div>
          </td>
          <td>
            <div class="assignee-wrap">
              <div class="assignee">
                <div class="av-sm" style="background:${color};color:#0a0c0a" aria-hidden="true">${Utils.getInitials(t.responsavel)}</div>
                ${Utils.escapeHtml(t.responsavel)}
              </div>
              ${sigHtml}
            </div>
          </td>
          <td class="date-cell ${isLate ? 'date-late' : ''}">${Utils.formatDate(t.prazo)}</td>
          <td><span class="dashboard-status-with-picker">${this.statusBadge(t.effectiveStatus)}${t.source === 'operacional' ? Utils.opTaskStatusPickerButtonHtml(t.id, 'op-status-picker-btn--sm') : ''}</span></td>
          <td><span class="dashboard-badges-cell">${[this.regionBadge(t.regiao), this.priorityBadge(t.prioridade || 'Média')].filter(Boolean).join('')}</span> <span style="margin-left:6px;color:var(--white4);font-size:10px;font-family:var(--font-mono)">· ${t.sourceLabel}</span></td>
        </tr>
      `;
    }).join('');
  },

  /* ── Op Stats ───────────────────────────────────────────── */
  renderOpStats() {
    const counts = OpTaskService.getStatusCounts();
    document.getElementById('op-count-criada').textContent    = counts['Criada'];
    document.getElementById('op-count-andamento').textContent = counts['Em andamento'];
    document.getElementById('op-count-concluida').textContent = counts['Concluída'];
    document.getElementById('op-count-finalizada').textContent= counts['Finalizada'];

    const allOpTasks = Store.getOpTasks();
    const rompimentosCount = allOpTasks.filter(t => t.categoria === 'rompimentos').length;
    const trocaPosteCount = allOpTasks.filter(t => t.categoria === 'troca-poste').length;
    const otimizacaoCount = allOpTasks.filter(t => t.categoria === 'otimizacao-rede').length;
    const certCemigCount = allOpTasks.filter(t => t.categoria === 'certificacao-cemig').length;
    const tabRompimentos = document.getElementById('tab-count-rompimentos');
    const tabTrocaPoste = document.getElementById('tab-count-troca-poste');
    const tabOtim = document.getElementById('tab-count-otimizacao-rede');
    const tabCertCemig = document.getElementById('tab-count-certificacao-cemig');
    if (tabRompimentos) tabRompimentos.textContent = String(rompimentosCount);
    if (tabTrocaPoste) tabTrocaPoste.textContent = String(trocaPosteCount);
    if (tabOtim) tabOtim.textContent = String(otimizacaoCount);
    if (tabCertCemig) tabCertCemig.textContent = String(certCemigCount);
  },

  /* ── Kanban Board ───────────────────────────────────────── */
  renderKanban() {
    const category = Store.currentOpCategory;
    const tasks    = OpTaskService.getFilteredByCategory(category);
    const tod      = Utils.todayIso();
    const board = document.getElementById('kanbanBoard');
    board?.classList.remove('atd-mode');
    const isAtendimento = false;

    const isCemig = category === 'certificacao-cemig';
    board?.classList.toggle('kanban-board--otim-scroll', category === 'otimizacao-rede');
    if (isCemig) board?.classList.add('kanban-board--cemig');
    else board?.classList.remove('kanban-board--cemig');

    const columns = isCemig
      ? OpTaskService._cemigColumns
      : [
        { status: 'Criada',       key: 'col-criada',     label: 'Criada'       },
        { status: 'Em andamento', key: 'col-andamento',  label: 'Em andamento' },
        { status: 'Concluída',    key: 'col-concluida',  label: 'Concluída'    },
        { status: 'Finalizada',   key: 'col-finalizada', label: 'Finalizada'   },
      ];

    const nextStatusMap = isCemig
      ? OpTaskService._cemigNext
      : {
        'Backlog':      ['Em andamento'],
        'A iniciar':    ['Em andamento'],
        'Criada':       ['Em andamento'],
        'Em andamento': ['Concluída'],
        'Concluída':    ['Finalizada'],
        'Finalizada':   [],
      };

    const statusLabels = isCemig
      ? OpTaskService._cemigActionLabels
      : {
        'Em andamento': 'Iniciar',
        'Concluída':    'Concluir',
        'Finalizada':   'Finalizar',
      };

    const statusActionClass = isCemig
      ? {
        'Pendente': 'cemig-advance',
        'Validação': 'cemig-advance',
        'Necessário adequação': 'cemig-advance',
        'Concluída': 'cemig-advance',
      }
      : {
        'Em andamento': 'to-andamento',
        'Concluída':    'to-concluida',
        'Finalizada':   'to-finalizada',
      };

    const doneForLate = isCemig ? ['Concluída'] : ['Concluída', 'Finalizada'];

    const kanbanColKey = (t) => {
      if (category === 'otimizacao-rede' && ['Backlog', 'A iniciar'].includes(t.status)) return 'Criada';
      if (isCemig) {
        // Normaliza para evitar espaços extras (ex.: " Agendado")
        const st = String(t.status || '').trim();
        // Compatibilidade com tarefas antigas: mapeia status descontinuados para as colunas novas.
        if (st === 'Backlog') return 'Pendente';
        // Status removido: manter compatibilidade (tarefas antigas) sem expor a coluna.
        if (st === 'Agendado') return 'Pendente';
        if (st === 'Envio pendente') return 'Validação';
        if (st === 'Finalizado') return 'Concluída';
        return st;
      }
      return t.status;
    };

    board.innerHTML = columns.map(col => {
      const colTasks = tasks.filter(t => kanbanColKey(t) === col.status);
      const collapseKey = `${category}|${col.status}`;
      const colCollapsed = this._isKanbanCollapsedKey(collapseKey);

      const cards = colTasks.length
        ? colTasks
          .filter(t => !(isAtendimento && t.parentTaskId))
          .map(t => {
            const isLate = t.prazo && t.prazo < tod && !doneForLate.includes(t.status);
            const childTasks = isAtendimento
              ? tasks.filter(c => Number(c.parentTaskId) === Number(t.id))
              : [];
            const parentTag = isAtendimento
              ? `<span class="badge s-info" style="margin-bottom:6px">LISTA</span>`
              : '';
            const nextStatuses = nextStatusMap[t.status] || [];
            const actionBtns = nextStatuses.map(ns =>
              `<button class="status-action-btn ${statusActionClass[ns] || 'cemig-advance'}" data-op-id="${Utils.escapeHtml(t.id)}" data-to-status="${Utils.escapeHtml(ns)}">${Utils.escapeHtml(statusLabels[ns])}</button>`
            ).join('');
            const statusPickerBtn = Utils.opTaskStatusPickerButtonHtml(t.id, 'op-status-picker-btn--sm');
            const assinatura = String(t.assinadaPor || '').trim();
            const sigHtml = assinatura ? `<div class="kanban-card-signature">✍ ${Utils.escapeHtml(assinatura)}</div>` : '';
            const badgeParts = [this.regionBadge(t.regiao), this.priorityBadge(t.prioridade || 'Média')].filter(Boolean);
            const badgesRow = badgeParts.length ? `<div class="kanban-card-badges">${badgeParts.join('')}</div>` : '';
            const childHtml = childTasks.length
              ? `<div class="subtask-list">${childTasks.map(c => `
                   <div class="subtask-item">
                     ${Utils.taskCopyProtocolButtonHtml(Utils.opTaskDisplayRef(c), 'task-copy-id-btn--sm')}
                     ${Utils.opTaskStatusPickerButtonHtml(c.id, 'op-status-picker-btn--sm')}
                     <span>${Utils.escapeHtml(c.taskCode || '')} · ${Utils.escapeHtml(c.titulo)}</span>
                     <button type="button" data-open-subtask="${Utils.escapeHtml(c.id)}">${Utils.escapeHtml(c.status)}</button>
                   </div>
                 `).join('')}</div>`
              : '';

            return `
              <article class="kanban-card ${this._lastMovedOpTask && this._lastMovedOpTask.id === t.id && this._lastMovedOpTask.status === t.status ? 'just-moved' : ''}" data-op-id="${Utils.escapeHtml(t.id)}" data-op-status="${Utils.escapeHtml(t.status)}" draggable="true" aria-label="${Utils.escapeHtml(t.titulo)}">
                ${parentTag}
                ${badgesRow}
                <div class="kanban-card-title-row">
                  ${Utils.taskCopyProtocolButtonHtml(Utils.opTaskDisplayRef(t))}
                  <div class="kanban-card-title">${Utils.escapeHtml(t.titulo)}</div>
                </div>
                <div class="kanban-card-date">${Utils.escapeHtml(t.taskCode || '')}</div>
                <div class="kanban-card-meta">
                  <div class="kanban-card-assignee">
                    <div class="av-sm" style="background:${Utils.getAvatarColor(t.responsavel)};color:#0a0c0a;width:20px;height:20px;font-size:8px" aria-hidden="true">${Utils.getInitials(t.responsavel)}</div>
                    ${Utils.escapeHtml(t.responsavel)}
                  </div>
                  <div class="kanban-card-date ${isLate ? 'late' : ''}">${Utils.formatDate(t.prazo)}</div>
                </div>
                ${sigHtml}
                <div class="kanban-card-actions">${actionBtns}${statusPickerBtn}</div>
                ${childHtml}
              </article>
            `;
          }).join('')
        : `<div class="kanban-empty">Nenhuma tarefa</div>`;

      return `
        <div class="kanban-col ${col.key}${colCollapsed ? ' kanban-col--collapsed' : ''}" role="group" aria-label="Coluna ${col.label}">
          <div class="kanban-col-header">
            <button type="button" class="kanban-col-toggle" data-kanban-collapse="${Utils.escapeHtmlAttr(collapseKey)}" data-kanban-col-label="${Utils.escapeHtmlAttr(col.label)}" aria-expanded="${colCollapsed ? 'false' : 'true'}" title="${colCollapsed ? 'Expandir' : 'Recolher'} tarefas deste status" aria-label="${colCollapsed ? 'Expandir' : 'Recolher'} coluna ${Utils.escapeHtmlAttr(col.label)}">
              <span class="kanban-col-toggle-chevron" aria-hidden="true"><svg class="kanban-col-toggle-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            </button>
            <span class="kanban-col-title">${col.label}</span>
            <span class="kanban-col-count">${colTasks.length}</span>
          </div>
          <div class="kanban-cards" data-col-status="${col.status}">${cards}</div>
          <button class="kanban-col-add" type="button" data-add-col="${col.status}" aria-label="Adicionar tarefa na coluna ${col.label}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Adicionar
          </button>
        </div>
      `;
    }).join('');

    // Eventos do kanban (delegados no container para não depender do re-render por card)
    board.onclick = (e) => {
      const target = e.target;
      if (!target) return;

      const colToggle = target.closest?.('.kanban-col-toggle');
      if (colToggle && board.contains(colToggle)) {
        e.preventDefault();
        e.stopPropagation();
        const key = colToggle.getAttribute('data-kanban-collapse') || '';
        const nowCollapsed = this._toggleKanbanCollapsedKey(key);
        this._applyKanbanColToggleUi(colToggle, nowCollapsed);
        return;
      }

      const statusBtn = target.closest?.('.status-action-btn');
      if (statusBtn && board.contains(statusBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const id = +statusBtn.dataset.opId;
        const toStatus = statusBtn.dataset.toStatus;
        const cur = Store.findOpTask(id);
        if (cur && cur.categoria === 'certificacao-cemig' && String(toStatus || '').trim() === 'Em andamento') {
          const reg = String(cur.regiao || '').trim();
          if (!reg) {
            ToastService.show('Selecione a região antes de colocar em andamento.', 'warning');
            return;
          }
        }
        this._lastMovedOpTask = { id, status: toStatus };
        OpTaskService.changeStatus(id, toStatus);
        this.renderOpPage();
        setTimeout(() => { this._lastMovedOpTask = null; }, 520);
              ToastService.show(`Tarefa movida para "${toStatus}"`, 'success');
        return;
      }

      const subtaskBtn = target.closest?.('[data-open-subtask]');
      if (subtaskBtn && board.contains(subtaskBtn)) {
        e.preventDefault();
        Controllers.opTask.openEditModal(+subtaskBtn.dataset.openSubtask);
        return;
      }

      const card = target.closest?.('.kanban-card');
      if (!card || !board.contains(card)) return;
      const id = +card.dataset.opId;
      Controllers.opTask.openEditModal(id);
    };

    // Drag and drop no Kanban (mantendo a opcao de clique)
    let draggedId = null;
    let draggedFromStatus = null;

    board.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('dragstart', e => {
        draggedId = +card.dataset.opId;
        draggedFromStatus = card.dataset.opStatus;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(draggedId));
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        board.querySelectorAll('.kanban-cards.drag-over').forEach(c => c.classList.remove('drag-over'));
      });
    });

    board.querySelectorAll('.kanban-cards').forEach(col => {
      col.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      });

      col.addEventListener('dragleave', e => {
        if (e.relatedTarget && col.contains(e.relatedTarget)) return;
        col.classList.remove('drag-over');
      });

      col.addEventListener('drop', e => {
        e.preventDefault();
        col.classList.remove('drag-over');
        col.classList.add('drop-flash');
        setTimeout(() => col.classList.remove('drop-flash'), 500);
        const targetStatus = col.dataset.colStatus;
        if (!draggedId || !targetStatus || targetStatus === draggedFromStatus) return;
        const cur = Store.findOpTask(draggedId);
        if (cur && cur.categoria === 'certificacao-cemig' && String(targetStatus || '').trim() === 'Em andamento') {
          const reg = String(cur.regiao || '').trim();
          if (!reg) {
            ToastService.show('Selecione a região antes de colocar em andamento.', 'warning');
            return;
          }
        }
        this._lastMovedOpTask = { id: draggedId, status: targetStatus };
        OpTaskService.changeStatus(draggedId, targetStatus);
        this.renderOpPage();
        setTimeout(() => { this._lastMovedOpTask = null; }, 520);
              ToastService.show(`Tarefa movida para "${targetStatus}"`, 'success');
      });
    });

    board.querySelectorAll('.kanban-col-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const colStatus = btn.getAttribute('data-add-col');
        Controllers.opTask.openNewModal(colStatus ? { status: colStatus } : {});
      });
    });
  },

  renderAtendimentoList(tasks, boardEl) {
    // Layout antigo substituído por renderização dedicada em renderAtendimentoPage.
    // Mantido apenas para compatibilidade com chamadas internas.
    this.renderAtendimentoPage();
  },

  /* ── Agenda ─────────────────────────────────────────────── */
  renderAgenda() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const weekDay = start.getDay(); // 0 dom ... 6 sab
    const diffToMonday = weekDay === 0 ? -6 : 1 - weekDay;
    start.setDate(start.getDate() + diffToMonday);

    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const startIso = Utils.toIsoLocal(start);
    const endIso = Utils.toIsoLocal(end);

    const taskItems = TaskService.getAllDashboardTasks()
      .filter(t => t.prazo && t.prazo >= startIso && t.prazo <= endIso)
      .map(t => ({
        date: t.prazo,
        text: t.titulo,
        source: t.sourceLabel,
        copyRef: Utils.unifiedTaskDisplayRef(t),
        kind: 'task',
        opId: t.source === 'operacional' ? t.id : null,
      }));

    const agenda = [...taskItems]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10)
      .map(item => {
        const [year, month, day] = item.date.split('-').map(Number);
        const d = new Date(year, month - 1, day);
        const dayLabel = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
        return {
          day: dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1, 3),
          text: item.text,
          time: `${Utils.formatDate(item.date)} · ${item.source}`,
          copyRef: item.copyRef,
          opId: item.opId || null,
        };
      });

    const list = document.getElementById('agendaList');
    if (!list) return;
    if (!agenda.length) {
      list.innerHTML = `<li class="agenda-item"><div><div class="agenda-desc">Nenhum item marcado para esta semana.</div><div class="agenda-time">Adicione tarefas com prazo para aparecerem aqui.</div></div></li>`;
      return;
    }

    list.innerHTML = agenda.map(a => `
      <li class="agenda-item">
        <div class="agenda-day">${a.day}</div>
        <div class="agenda-item-body">
          ${Utils.taskCopyProtocolButtonHtml(a.copyRef, 'task-copy-id-btn--sm')}
          ${a.opId ? Utils.opTaskStatusPickerButtonHtml(a.opId, 'op-status-picker-btn--sm') : ''}
          <div>
            <div class="agenda-desc">${a.text}</div>
            <div class="agenda-time">${a.time}</div>
          </div>
        </div>
      </li>
    `).join('');
  },

  /* ── Clock ──────────────────────────────────────────────── */
  updateClock() {
    const d    = new Date();
    const opts = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
    const date = d.toLocaleDateString('pt-BR', opts);
    const time = `${Utils.pad(d.getHours())}:${Utils.pad(d.getMinutes())}`;
    const dateEl = document.getElementById('topbarDate');
    if (dateEl) dateEl.textContent = `${date} — ${time}`;
  },

  /* ── Page navigation ────────────────────────────────────── */
  // Proteção por senha removida (telas sempre liberadas).
  _protectedPages: new Set([]),
  _protectedPassword: '',
  _protectedSessionKey(page) {
    return `planner.protected.${String(page || '').trim()}.unlocked.v1`;
  },
  _isProtectedUnlocked(page) {
    try {
      return sessionStorage.getItem(this._protectedSessionKey(page)) === '1';
    } catch {
      return false;
    }
  },
  _setProtectedUnlocked(page) {
    try {
      sessionStorage.setItem(this._protectedSessionKey(page), '1');
    } catch {
      /* ignore */
    }
  },
  _ensureProtectedAccess(page) {
    return true;
  },
  navigateTo(page) {
    const prevPage = Store.currentPage;
    if (!this._ensureProtectedAccess(page)) {
      // mantém a tela atual sem alterar navegação
      // (se não houver página atual válida, cai no dashboard)
      if (!prevPage || typeof prevPage !== 'string') return;
      return;
    }
    // Oculta todas as páginas
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    // Ativa a página alvo
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    // Atualiza nav items
    document.querySelectorAll('.nav-item[data-page]').forEach(b => {
      b.classList.toggle('active', b.dataset.page === page);
      b.setAttribute('aria-current', b.dataset.page === page ? 'page' : 'false');
    });

    // Atualiza topbar
    const titles = {
      dashboard: { title: 'Dashboard', crumb: 'Visão Geral' },
      rompimentos: { title: 'Rompimentos', crumb: 'Atividade de manutenção' },
      'troca-poste': { title: 'Troca de Poste', crumb: 'Atividade de manutenção' },
      'otimizacao-rede': { title: 'Otimização de Rede', crumb: 'Projetos de rede' },
      'certificacao-cemig': { title: 'Certificação Cemig', crumb: 'Projetos de rede' },
      atendimento: { title: 'Atendimento ao cliente', crumb: 'Central de atendimento' },
      'correcao-atenuacao': { title: 'Correção de atenuação', crumb: 'Atividade de manutenção' },
      'troca-etiqueta': { title: 'Troca de etiqueta', crumb: 'Atividade de manutenção' },
      'qualidade-potencia': { title: 'Qualidade de potência', crumb: 'Atividade de manutenção' },
      'manutencao-corretiva': { title: 'Manutenção corretiva', crumb: 'Atividade de manutenção' },
      config: { title: 'Configurações', crumb: 'Sistema' },
    };
    const meta = titles[page] || { title: page, crumb: '' };
    document.getElementById('pageTitle').textContent      = meta.title;
    document.getElementById('breadcrumbLeaf').textContent = meta.crumb;

    Store.currentPage = page;

    try {
      sessionStorage.setItem(NAV_LAST_PAGE_KEY, page);
    } catch {
      /* ignore */
    }

    if (window.PlannerDashboard && page !== 'dashboard') {
      window.PlannerDashboard._kpiAnimated = false;
    }

    // Re-renderiza página específica
    const opPages = new Set([
      'rompimentos',
      'troca-poste',
      'otimizacao-rede',
      'certificacao-cemig',
      'qualidade-potencia',
      'manutencao-corretiva',
    ]);
    if (opPages.has(page)) {
      Store.currentOpCategory = page;
      // Sempre usa o container de tarefas operacionais
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-tarefas')?.classList.add('active');
      this.renderOpPage();
    }
    if (page === 'correcao-atenuacao') this.renderAtenuacaoDashboardPage();
    if (page === 'troca-etiqueta') this.renderTrocaEtiquetaPage();
    if (page === 'atendimento') this.renderAtendimentoPage();
    if (page === 'dashboard') {
      this.renderDashboard();
      // Garante atualização imediata do ranking/atividade ao entrar no dashboard
      queueMicrotask(() => window.PlannerDashboard?.syncFromStore?.());
    }
  },

  /**
   * Restaura menu após recarregar a página ou logar (persistência por aba).
   * Assim o chat continua ativo e com polling após F5.
   */
  restoreLastPageIfAuthed() {
    if (!Controllers.auth._isAuthenticated()) return;
    let saved = '';
    try {
      saved = String(sessionStorage.getItem(NAV_LAST_PAGE_KEY) || '').trim();
    } catch {
      return;
    }
    const allowed = new Set([
      'dashboard',
      'rompimentos',
      'troca-poste',
      'otimizacao-rede',
      'certificacao-cemig',
      'atendimento',
      'correcao-atenuacao',
      'troca-etiqueta',
      'qualidade-potencia',
      'manutencao-corretiva',
      'config',
    ]);
    if (!saved || !allowed.has(saved)) return;
    if (!document.getElementById(`page-${saved}`)) return;
    this.navigateTo(saved);
  },

  clearTaskIdAutofillFilters(options = {}) {
    const force = Boolean(options.force);
    const fields = [
      { id: 'opTaskIdInput', storeKey: 'opTaskIdSearch', render: () => this.renderKanban() },
      { id: 'atdOpTaskIdInput', storeKey: 'atdOpTaskIdSearch', render: () => this.renderAtendimentoPage() },
    ];
    let shouldRenderOp = false;
    let shouldRenderAtd = false;

    const normalize = (value) => String(value || '').trim().toLowerCase();
    const sessionValues = new Set([
      normalize(getSignedUserName()),
      normalize(getSessionUserKey()),
      normalize(localStorage.getItem(SESSION_USER_KEY)),
    ].filter(Boolean));

    fields.forEach(({ id, storeKey }) => {
      const el = document.getElementById(id);
      const value = String(el?.value || '').trim();
      const storeValue = String(Store[storeKey] || '').trim();
      const looksLikeSessionUser = value && sessionValues.has(normalize(value));
      if (!force && !looksLikeSessionUser) return;

      if (el) el.value = '';
      if (Store[storeKey]) Store[storeKey] = '';

      if (value || storeValue) {
        if (storeKey === 'opTaskIdSearch') shouldRenderOp = true;
        if (storeKey === 'atdOpTaskIdSearch') shouldRenderAtd = true;
      }
    });

    if (shouldRenderOp && Store.currentPage !== 'atendimento') this.renderKanban();
    if (shouldRenderAtd && Store.currentPage === 'atendimento') this.renderAtendimentoPage();
  },

  scheduleTaskIdAutofillCleanup() {
    this.clearTaskIdAutofillFilters({ force: true });
    [80, 350, 900].forEach((delay) => {
      window.setTimeout(() => this.clearTaskIdAutofillFilters(), delay);
    });
  },

  /* ── Full dashboard render ─────────────────────────────── */
  renderDashboard() {
    this.renderAgenda();
    this.renderDashboardStats();
    this.renderTaskTable();
    // Atualiza widgets do dashboard (Equipe/Atividade) sem precisar de F5
    queueMicrotask(() => window.PlannerDashboard?.syncFromStore?.());
  },

  /* ── Página dedicada: Atendimento ao cliente (quadro estilo kanban) ───── */
  renderAtendimentoPage() {
    const root = document.getElementById('atendimentoBoard');
    if (!root) return;

    root.className = 'kanban-board atd-kanban-board';

    const atdParentKanbanColKey = (t) => {
      const s = String(t.status || '').trim();
      if (s === 'Finalizada') return 'Finalizada';
      if (s === 'Concluída') return 'Concluída';
      if (s === 'Em andamento') return 'Em andamento';
      if (s.toLowerCase().includes('retorno')) return 'Em andamento';
      return 'Criada';
    };

    const columns = [
      { status: 'Criada',       key: 'col-criada',     label: 'Criada'       },
      { status: 'Em andamento', key: 'col-andamento',  label: 'Em andamento' },
      { status: 'Concluída',    key: 'col-concluida',  label: 'Concluída'    },
      { status: 'Finalizada',   key: 'col-finalizada', label: 'Finalizada'   },
    ];

  const nextStatusMap = {
      'Backlog': ['Em andamento'],
      'A iniciar': ['Em andamento'],
      'Criada': ['Em andamento'],
      'Pendente': ['Em andamento'],
      'Em andamento': ['Concluída'],
      'Concluída': ['Finalizada'],
      'Finalizada': [],
    };

    const statusLabels = {
      'Em andamento': 'Iniciar',
      'Concluída': 'Concluir',
      'Finalizada': 'Finalizar',
    };

    const statusActionClass = {
      'Em andamento': 'to-andamento',
      'Concluída': 'to-concluida',
      'Finalizada': 'to-finalizada',
    };

    const doneForLate = ['Concluída', 'Finalizada'];
    const tod = Utils.todayIso();

    const all = OpTaskService.getFilteredByCategory('atendimento-cliente', { filterNamespace: 'atd' });
    const parents = all.filter(t => t.isParentTask || !t.parentTaskId);
    const children = all.filter(t => t.parentTaskId);
    const byParentId = new Map();
    children.forEach(c => {
      const pid = Number(c.parentTaskId || 0);
      if (!pid) return;
      if (!byParentId.has(pid)) byParentId.set(pid, []);
      byParentId.get(pid).push(c);
    });

    const boardHtml = columns.map((col) => {
      const colParents = parents.filter(p => atdParentKanbanColKey(p) === col.status);
      const collapseKey = `atendimento|${col.status}`;
      const colCollapsed = this._isKanbanCollapsedKey(collapseKey);
      const cards = colParents.length
        ? colParents.map((parent) => {
          const isLate = parent.prazo && parent.prazo < tod && !doneForLate.includes(parent.status);
          const kids = byParentId.get(Number(parent.id)) || [];
          const badgeParts = [
            this.regionBadge(parent.regiao),
            this.subProcessoBadge(parent.subProcesso),
          ].filter(Boolean);
          const badgesRow = badgeParts.length ? `<div class="kanban-card-badges">${badgeParts.join('')}</div>` : '';
          const nextStatuses = nextStatusMap[parent.status] || [];
          const actionBtns = nextStatuses.map((ns) =>
            `<button type="button" class="status-action-btn ${statusActionClass[ns] || 'to-andamento'}" data-op-id="${parent.id}" data-to-status="${Utils.escapeHtmlAttr(ns)}">${statusLabels[ns] || ns}</button>`,
          ).join('');
          const atdStatusPickerBtn = Utils.opTaskStatusPickerButtonHtml(parent.id, 'op-status-picker-btn--sm');
          const titleEsc = Utils.escapeHtml(parent.nomeCliente || parent.titulo || '(Sem título)');
          const subsCount = kids.length;
          const assinatura = String(parent.assinadaPor || '').trim();
          const sigHtml = assinatura ? `<div class="kanban-card-signature">✍ ${Utils.escapeHtml(assinatura)}</div>` : '';
          const copyBtnHtml = Utils.taskCopyProtocolButtonHtml(Utils.opTaskDisplayRef(parent));
          const dataEntrada = Utils.escapeHtml(String(parent.dataEntrada || '').trim() || '—');
          const prazoFinal = parent.prazo ? Utils.escapeHtml(Utils.formatDate(parent.prazo)) : '—';
          const doneCount = kids.filter(c => c.status === 'Concluída' || c.status === 'Finalizada' || c.status === 'Finalizado').length;
          const osCountsHtml = `
            <div class="atd-card-mid">
              <div class="atd-card-oscounts">
                <span>Demanda: <strong>${subsCount}</strong> O.S</span>
                <span>Finalizadas: <strong>${doneCount}</strong></span>
              </div>
            </div>
          `;
          const taskIdLabel = Utils.escapeHtml(Utils.opTaskDisplayRef(parent));
          return `
              <article class="kanban-card atd-kanban-parent-card ${this._lastMovedOpTask && this._lastMovedOpTask.id === parent.id && this._lastMovedOpTask.status === parent.status ? 'just-moved' : ''}" data-op-id="${parent.id}" draggable="true" aria-label="${titleEsc}">
                ${badgesRow}
                <div class="atd-card-toprow">
                  ${copyBtnHtml}
                  <div class="atd-card-client-next-copy">${titleEsc}</div>
                </div>
                <div class="atd-card-dates">
                  <div class="atd-card-datepair"><span class="atd-card-date-k">DATA DE ENTRADA:</span> <span class="atd-card-date-v">${dataEntrada}</span></div>
                  <div class="atd-card-datepair ${isLate ? 'late' : ''}"><span class="atd-card-date-k">PRAZO:</span> <span class="atd-card-date-v">${prazoFinal}</span></div>
                </div>
                ${osCountsHtml}
                ${sigHtml}
                <div class="kanban-card-actions">${actionBtns}${atdStatusPickerBtn}</div>
                <div class="atd-kanban-card-foot">
                  <button type="button" class="atd-book-ico" data-atd-add-os="${parent.id}" title="Adicionar ordem de serviço" aria-label="Adicionar ordem de serviço">+</button>
                  <button type="button" class="atd-book-ico" data-atd-edit-parent="${parent.id}" title="Editar protocolo" aria-label="Editar protocolo">✎</button>
                  <span class="atd-card-taskid">${taskIdLabel}</span>
                </div>
              </article>
            `;
        }).join('')
        : '<div class="kanban-empty">Nenhuma lista neste estágio</div>';

      return `
        <div class="kanban-col ${col.key}${colCollapsed ? ' kanban-col--collapsed' : ''}" role="group" aria-label="Coluna ${col.label}">
          <div class="kanban-col-header">
            <button type="button" class="kanban-col-toggle" data-kanban-collapse="${Utils.escapeHtmlAttr(collapseKey)}" data-kanban-col-label="${Utils.escapeHtmlAttr(col.label)}" aria-expanded="${colCollapsed ? 'false' : 'true'}" title="${colCollapsed ? 'Expandir' : 'Recolher'} tarefas deste status" aria-label="${colCollapsed ? 'Expandir' : 'Recolher'} coluna ${Utils.escapeHtmlAttr(col.label)}">
              <span class="kanban-col-toggle-chevron" aria-hidden="true"><svg class="kanban-col-toggle-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            </button>
            <span class="kanban-col-title">${col.label}</span>
            <span class="kanban-col-count">${colParents.length}</span>
          </div>
          <div class="kanban-cards" data-col-status="${Utils.escapeHtmlAttr(col.status)}">${cards}</div>
        </div>
      `;
    }).join('');

    root.innerHTML = boardHtml;

    root.onclick = (e) => {
      const target = e.target;
      if (!target) return;

      const colToggle = target.closest?.('.kanban-col-toggle');
      if (colToggle && root.contains(colToggle)) {
        e.preventDefault();
        e.stopPropagation();
        const key = colToggle.getAttribute('data-kanban-collapse') || '';
        const nowCollapsed = this._toggleKanbanCollapsedKey(key);
        this._applyKanbanColToggleUi(colToggle, nowCollapsed);
        return;
      }

      const statusBtn = target.closest?.('.status-action-btn');
      if (statusBtn && root.contains(statusBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const id = +statusBtn.dataset.opId;
        const toStatus = statusBtn.dataset.toStatus;
        if (!id || !toStatus) return;
        this._lastMovedOpTask = { id, status: toStatus };
        OpTaskService.changeStatus(id, toStatus);
        UI.refreshOperationalUi();
        setTimeout(() => { this._lastMovedOpTask = null; }, 520);
              ToastService.show(`Lista movida para "${toStatus}"`, 'success');
        return;
      }

      const addOs = target.closest?.('[data-atd-add-os]');
      if (addOs && root.contains(addOs)) {
        e.preventDefault();
        e.stopPropagation();
        const pid = Number(addOs.dataset.atdAddOs || 0);
        if (!pid) return;
        Controllers.opTask.openNewModal?.({
          category: 'atendimento-cliente',
          parentTaskId: pid,
          isParentTask: false,
          status: 'Backlog',
        });
        return;
      }

      const editBtn = target.closest?.('[data-atd-edit-parent]');
      if (editBtn && root.contains(editBtn)) {
        e.preventDefault();
        e.stopPropagation();
        Controllers.opTask.openEditModal(+editBtn.dataset.atdEditParent);
        return;
      }

      const card = target.closest?.('.kanban-card');
      if (!card || !root.contains(card)) return;
      if (target.closest?.('.status-action-btn') || target.closest?.('.task-copy-id-btn') || target.closest?.('.op-status-picker-btn')) return;
      if (target.closest?.('.atd-kanban-card-foot')) return;
      Controllers.opTask.openEditModal(+card.dataset.opId);
    };

    let draggedId = null;
    let draggedColKey = null;

    root.querySelectorAll('.kanban-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        draggedId = +card.dataset.opId;
        const t = Store.findOpTask(draggedId);
        draggedColKey = t ? atdParentKanbanColKey(t) : null;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(draggedId));
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        root.querySelectorAll('.kanban-cards.drag-over').forEach((c) => c.classList.remove('drag-over'));
      });
    });

    root.querySelectorAll('.kanban-cards').forEach((col) => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && col.contains(e.relatedTarget)) return;
        col.classList.remove('drag-over');
      });
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        col.classList.add('drop-flash');
        setTimeout(() => col.classList.remove('drop-flash'), 500);
        const targetStatus = col.dataset.colStatus;
        if (!draggedId || !targetStatus || targetStatus === draggedColKey) return;
        this._lastMovedOpTask = { id: draggedId, status: targetStatus };
        OpTaskService.changeStatus(draggedId, targetStatus);
        UI.refreshOperationalUi();
        setTimeout(() => { this._lastMovedOpTask = null; }, 520);
              ToastService.show(`Lista movida para "${targetStatus}"`, 'success');
      });
    });
  },

  /** Atualiza Kanban (Tarefas) ou painel de Atendimento conforme a página ativa. */
  refreshOperationalUi() {
    if (Store.currentPage === 'atendimento') this.renderAtendimentoPage();
    else if (Store.currentPage === 'correcao-atenuacao') {
      // Re-render completo com o modal aberto recria o DOM e derruba foco/seleção nos inputs.
      if (document.getElementById('atn2ActModal')?.classList?.contains('open')) return;
      this.renderAtenuacaoDashboardPage();
    }
    else this.renderOpPage();
  },

  /* ── Full op page render ────────────────────────────────── */
  renderOpPage() {
    this.renderOpStats();
    this.renderKanban();
  },

  /* ── Troca de etiqueta (delegado ao módulo TrocaEtiquetaPage) ─────────── */
  renderTrocaEtiquetaPage() { TrocaEtiquetaPage.render(); },

  /* ── Correção de Atenuação (Dashboard flat) ───────────────── */
  _atn2State: {
    items: [],
    lanes: [],
    activities: [],
  },

  _atn2Clamp(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, Math.min(max, x));
  },

  _atn2TechColor(tech = '') {
    const t = normalizeTechName(tech);
    if (!t) return 'gray';
    // hashing simples para cores estáveis entre sessões
    let h = 0;
    for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
    const idx = Math.abs(h) % 3;
    return idx === 0 ? 'teal' : idx === 1 ? 'amber' : 'blue';
  },

  _atn2PriorityFromBucket(bucket) {
    if (bucket === 'p0') return 'critica';
    if (bucket === 'p1') return 'alta';
    if (bucket === 'p2') return 'media';
    if (bucket === 'p3') return 'leve';
    if (bucket === 'mon') return 'leve';
    return 'nd';
  },

  _atn2PriorityFromDbm(dbm) {
    const n = Number(dbm);
    if (!Number.isFinite(n) || n === 0) return 'nd';
    const bucket = this._atnBucketForDb(n, this._atnThresholds());
    return this._atn2PriorityFromBucket(bucket);
  },

  _atn2NormalizeNegativeDbmInput(raw) {
    const s0 = String(raw ?? '').trim();
    if (!s0) return '';
    let s = s0.replace(/[^\d.,-]/g, '');
    if (s === '-') return s;
    s = s.replace(/-/g, '');
    s = s.replace(/,/g, '.');
    const parts = s.split('.');
    if (parts.length > 2) s = `${parts[0]}.${parts.slice(1).join('')}`;
    return `-${s}`;
  },

  _atn2ItemsFromStore() {
    // Fallback para eventuais categorias legadas (underscore)
    const tasks = [
      ...(Store.getOpTasksByCategory('correcao-atenuacao') || []),
      ...(Store.getOpTasksByCategory('correcao_atenuacao') || []),
    ];
    return tasks.map((t) => {
      const id = Number(t.id) || 0;
      const tech = String(t.responsavel || t.tecnico || '—').trim() || '—';
      const region = String(t.regiao || '').trim();
      const title = String(t.titulo || t.nome || t.name || `Correção #${id || '—'}`).trim();
      const dbm = this._atnDb(t);
      const priority = this._atn2PriorityFromDbm(dbm);
      const initials = Utils.getInitials(tech);
      const techColor = this._atn2TechColor(tech);
      const name = region ? `${title} · ${region}` : title;
      return {
        id,
        name,
        dbm: Number.isFinite(dbm) ? dbm : 0,
        priority,
        status: String(t.status || 'Criada'),
        tech,
        techInitials: initials,
        techColor,
      };
    });
  },

  _atn2ThermoPct(items) {
    return this._atn2ThermoStats(items).pct;
  },

  _atn2ThermoStats(items) {
    // 0% = bom (>= -22.01 dBm), 100% = crítico (< -28.00 dBm)
    const thresholds = this._atnThresholds();
    const worst = thresholds.p0; // -28
    const best = thresholds.p3; // -22.01
    let sum = 0;
    let count = 0;
    for (const it of items) {
      let db = Number(it?.dbm);
      if (!Number.isFinite(db) || db === 0) continue;
      if (db > 0) db = -db;
      sum += db;
      count++;
    }
    if (!count) return { count: 0, avgDbm: null, pct: 0 };
    const avgDbm = sum / count;
    const pct = this._atn2Clamp(((best - avgDbm) / (best - worst)) * 100, 0, 100);
    return { count, avgDbm, pct: Math.round(pct) };
  },

  _atn2ThermoAccent(pct) {
    const p = this._atn2Clamp(pct, 0, 100);
    // Degradê contínuo: 120° (verde) -> 0° (vermelho)
    const hue = Math.round(120 - (120 * (p / 100)));
    const dot = `hsl(${hue} 90% 55%)`;
    const glow = `hsla(${hue} 90% 55% / .35)`;
    return { dot, glow };
  },

  _atn2PriorityMeta(priority) {
    const p = String(priority || '').toLowerCase();
    if (p === 'critica') return { border: '#ef4444', value: 'var(--danger)', badgeBg: 'rgba(255,69,69,.12)', badgeText: 'var(--danger)', label: 'P0 Crítica' };
    if (p === 'alta') return { border: '#f59e0b', value: 'var(--warning)', badgeBg: 'rgba(245,200,66,.12)', badgeText: 'var(--warning)', label: 'P1 Alta' };
    if (p === 'media') return { border: '#2563eb', value: 'var(--info)', badgeBg: 'rgba(66,184,245,.12)', badgeText: 'var(--info)', label: 'P2 Média' };
    if (p === 'leve') return { border: '#22c55e', value: 'var(--green)', badgeBg: 'rgba(45,255,110,.10)', badgeText: 'var(--green)', label: 'P3 Leve' };
    return { border: 'rgba(255,255,255,.22)', value: 'var(--white3)', badgeBg: 'rgba(255,255,255,.06)', badgeText: 'var(--white3)', label: 'N/D' };
  },
  _atn2TechAvatarStyle(colorKey = '') {
    const k = String(colorKey || '').toLowerCase();
    if (k === 'teal') return 'background:#14b8a6';
    if (k === 'amber') return 'background:#f59e0b';
    if (k === 'blue') return 'background:#3b82f6';
    return 'background:#6b7280';
  },
  _atn2Escape(s) { return Utils.escapeHtml(String(s ?? '')); },
  _atn2FormatDbm(dbm) {
    const n = Number(dbm);
    if (!Number.isFinite(n) || n === 0) return 'N/D';
    const fixed = n.toFixed(1);
    return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
  },
  _atn2Counts(filtered) {
    let critAlta = 0, medio = 0, estavel = 0, nd = 0;
    filtered.forEach(it => {
      const p = String(it.priority || '').toLowerCase();
      if (p === 'critica' || p === 'alta') critAlta++;
      else if (p === 'media') medio++;
      else if (p === 'leve') estavel++;
      else if (p === 'nd') nd++;
    });
    const pctCritAlta = filtered.length ? Math.round((critAlta / filtered.length) * 100) : 0;
    const thermo = this._atn2ThermoStats(filtered);
    return { critAlta, medio, estavel, nd, total: filtered.length, pctCritAlta, thermoPct: thermo.pct, thermoAvgDbm: thermo.avgDbm, thermoDbmCount: thermo.count };
  },

  _atn2LaneDotColor(color) {
    const c = String(color || '').toLowerCase();
    if (c === 'red') return '#ef4444';
    if (c === 'amber') return '#f59e0b';
    if (c === 'blue') return '#2563eb';
    if (c === 'green') return '#22c55e';
    return 'rgba(255,255,255,.35)';
  },

  // Render do Dashboard "flat" (sem a caixa de pendências/lista).
  _atn2RenderSkeleton(root, st, counts) {
    const thermoLeft = this._atn2Clamp(counts.thermoPct, 0, 100);
    const accent = this._atn2ThermoAccent(thermoLeft);
    const avgTxt = Number.isFinite(Number(counts.thermoAvgDbm))
      ? `${this._atn2FormatDbm(counts.thermoAvgDbm)} dBm (média)`
      : 'Sem dBm';
    root.innerHTML = `
      <div class="atn2-metrics">
        <div class="atn2-card atn2-metric">
          <div class="atn2-metric-label">Crítico / Alto</div>
          <div class="atn2-metric-value" style="color:var(--danger)">${counts.critAlta}</div>
          <div class="atn2-metric-sub">P0 + P1</div>
        </div>
        <div class="atn2-card atn2-metric">
          <div class="atn2-metric-label">Médio</div>
          <div class="atn2-metric-value" style="color:var(--warning)">${counts.medio}</div>
          <div class="atn2-metric-sub">P2</div>
        </div>
        <div class="atn2-card atn2-metric">
          <div class="atn2-metric-label">Estável</div>
          <div class="atn2-metric-value" style="color:var(--green)">${counts.estavel}</div>
          <div class="atn2-metric-sub">P3</div>
        </div>
        <div class="atn2-card atn2-metric">
          <div class="atn2-metric-label">Sem leitura (N/D)</div>
          <div class="atn2-metric-value" style="color:var(--white2)">${counts.nd}</div>
          <div class="atn2-metric-sub">N/D</div>
        </div>
      </div>

      <div class="atn2-card atn2-thermo">
        <div class="thermo-header">
          <span class="thermo-title">Termômetro de atenuação</span>
          <span class="thermo-stats" id="thermo-stats">
            ${counts.total} itens · ${counts.pctCritAlta}% crítico/alto · Indicador posicionado na média atual
          </span>
        </div>

        <div class="thermo-bar-wrapper" aria-label="Termômetro de atenuação">
          <div class="thermo-needle" id="thermo-needle" style="left:${thermoLeft}%"></div>
        </div>

        <div class="thermo-labels">
          <span>Estável &lt;-22 dBm</span>
          <span class="hide-mobile">Leve -24–-22</span>
          <span class="hide-mobile">Média -26–-24</span>
          <span class="hide-mobile">Alta -28–-26</span>
          <span>Crítica &gt;-28 dBm</span>
        </div>
      </div>

      <div class="atn2-main">
        <div class="atn2-layout-3">
          <div class="atn2-card atn2-activities-card">
            <div class="atn2-panel-head">
              <div class="atn2-panel-title">Atividades de atenuação</div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end">
                <div class="atn2-filters" role="tablist" aria-label="Filtrar atividades de atenuação">
                  <button type="button" class="atn2-filter-btn" data-atn2-act-filter="all" role="tab" aria-selected="true">Todas</button>
                  <button type="button" class="atn2-filter-btn" data-atn2-act-filter="pending" role="tab" aria-selected="false">Pendentes</button>
                  <button type="button" class="atn2-filter-btn" data-atn2-act-filter="progress" role="tab" aria-selected="false">Em andamento</button>
                  <button type="button" class="atn2-filter-btn" data-atn2-act-filter="done" role="tab" aria-selected="false">Concluídas</button>
                </div>
                <button class="primary-btn atn2-primary atn2-primary--sm" id="atn2CreateActivityBtn" type="button">+ Criar atividade</button>
              </div>
            </div>
            <div class="atn2-side-body" id="atn2AttenuationActivities"></div>
          </div>

          <div class="atn2-side-stack">
            <div class="atn2-card atn2-sev-card" aria-label="Resumo de severidade">
              <div class="atn2-panel-head">
                <div class="atn2-panel-title">Resumo de atenuação</div>
                <span class="atn2-count">P0/P1/P2/P3</span>
              </div>
              <div class="atn2-side-body">
                <div class="atn2-sev-grid">
                  <div class="atn2-sev-row">
                    <span class="atn2-sev-dot atn2-sev-dot--crit"></span>
                    <span class="atn2-sev-label">Críticas</span>
                    <span class="atn2-sev-val" style="color:var(--danger)">${counts.critAlta}</span>
                  </div>
                  <div class="atn2-sev-row">
                    <span class="atn2-sev-dot atn2-sev-dot--med"></span>
                    <span class="atn2-sev-label">Médias</span>
                    <span class="atn2-sev-val" style="color:var(--warning)">${counts.medio}</span>
                  </div>
                  <div class="atn2-sev-row">
                    <span class="atn2-sev-dot atn2-sev-dot--lev"></span>
                    <span class="atn2-sev-label">Leves</span>
                    <span class="atn2-sev-val" style="color:var(--green)">${counts.estavel}</span>
                  </div>
                </div>
                <div class="atn2-sev-sub">P0+P1 = críticas · P2 = médias · P3 = leves</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="atn2-modal" id="atn2ActModal" aria-hidden="true">
        <div class="atn2-modal-panel" role="dialog" aria-modal="true" aria-label="Criar atividade de atenuação">
          <div class="atn2-modal-head">
            <div class="atn2-modal-title">Criar atividade de atenuação</div>
            <button class="atn2-btn" id="atn2ActCloseBtn" type="button">Fechar</button>
          </div>
          <div class="atn2-modal-body">
            <div class="form-group">
              <label for="atn2ActName">Nome da caixa</label>
              <input class="atn2-input" id="atn2ActName" type="text" placeholder="CTO-00 · Bairro · Região" />
              <div class="hint" id="atn2ActCtoHint" style="margin-top:6px"></div>
            </div>
            <div class="form-group">
              <label for="atn2ActRegion">Região</label>
              <select class="atn2-input" id="atn2ActRegion" aria-label="Região da atividade de atenuação">
                <option value="">—</option>
                <option value="Goval">Goval</option>
                <option value="Vale do Aço">Vale do Aço</option>
                <option value="Caratinga">Caratinga</option>
                <option value="Backup">Backup</option>
              </select>
            </div>
            <div class="form-group">
              <label for="atn2ActResponsavel">Técnico responsável</label>
              <input class="atn2-input" id="atn2ActResponsavel" type="text" placeholder="Selecione ou digite o técnico" autocomplete="off" list="atn2TecnicosList" />
              <input type="hidden" id="atn2ActResponsavelChatId" value="" />
              <datalist id="atn2TecnicosList"></datalist>
            </div>
            <div class="form-group">
              <label for="atn2ActStatus">Status</label>
              <select class="atn2-input" id="atn2ActStatus" aria-label="Status da atividade de atenuação">
                <option value="Criada">Pendente</option>
                <option value="Em andamento">Em andamento</option>
                <option value="Concluída">Concluída</option>
              </select>
            </div>
            <div class="form-group">
              <label for="atn2ActCoords">Coordenadas</label>
              <input class="atn2-input" id="atn2ActCoords" type="text" placeholder="Preenchidas ao digitar a CTO (ou edite manualmente)" autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="atn2ActAddress">Endereço (rua / bairro)</label>
              <input class="atn2-input" id="atn2ActAddress" type="text" readonly placeholder="Identificado automaticamente a partir das coordenadas" />
              <div class="hint" id="atn2ActAddressHint" style="margin-top:6px">Aguardando CTO ou coordenadas.</div>
            </div>
            <div class="form-group">
              <label for="atn2ActDbm">Faixa de atenuação (dBm)</label>
              <input class="atn2-input" id="atn2ActDbm" type="text" placeholder="-27.0" inputmode="decimal" />
            </div>
          </div>
          <div class="atn2-modal-foot">
            <button type="button" class="atn2-btn atn2-btn-danger" id="atn2ActDeleteBtn" hidden aria-hidden="true">Excluir</button>
            <div class="atn2-modal-foot-end">
              <button class="atn2-btn" id="atn2ActCancelBtn" type="button">Cancelar</button>
              <button class="atn2-primary" id="atn2ActSaveBtn" type="button">Salvar</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  _atn2RenderAttenuationActivities(root, acts) {
    if (!root) return;
    if (!acts.length) {
      root.innerHTML = `<div class="empty-state" style="padding:14px 10px;margin:0">Sem atividades de atenuação no momento.</div>`;
      return;
    }
    const dot = (c) => this._atn2LaneDotColor(c === 'red' ? 'red' : c === 'amber' ? 'amber' : c === 'blue' ? 'blue' : 'green');
    const statusClass = (status) => {
      const s = String(status || '').toLowerCase();
      if (s.includes('andamento')) return 'is-progress';
      if (s.includes('conclu')) return 'is-done';
      return 'is-created';
    };
    root.innerHTML = acts.map(a => `
      <div class="atn2-act-row" role="group" aria-label="Atividade de atenuação" style="--atn2-act-accent:${dot(a.color)}">
        <button type="button" class="atn2-act-open" data-atn2-act-open="${Number(a.id) || 0}" aria-label="Editar atividade">
          <span class="atn2-act-led" aria-hidden="true"></span>
          <span class="atn2-act-main">
            <span class="atn2-act-title-row">
              <span class="atn2-act-title">${this._atn2Escape(a.title || a.text)}</span>
              <span class="atn2-act-status ${statusClass(a.status)}">${this._atn2Escape(a.status || 'Criada')}</span>
            </span>
            <span class="atn2-act-sub">
              <span>${this._atn2Escape(a.time)}</span>
              <span>${this._atn2Escape(a.tech)}</span>
              ${a.meta ? `<span class="atn2-act-dbm">${this._atn2Escape(a.meta)}</span>` : ''}
            </span>
          </span>
          <span class="atn2-act-cta" aria-hidden="true">
            <span class="atn2-act-cta-arrow">›</span>
          </span>
        </button>
        <button
          type="button"
          class="atn2-edit-btn"
          data-atn2-edit-btn="${Number(a.id) || 0}"
          title="Editar"
          aria-label="Editar"
        >Editar</button>
        <button
          type="button"
          class="atn2-status-btn"
          data-atn2-status-btn="${Number(a.id) || 0}"
          title="Alterar status"
          aria-label="Alterar status"
          aria-haspopup="menu"
          aria-expanded="false"
        >●</button>
      </div>
    `).join('');
  },

  _atn2PaintActFilterChips(root, actFilter) {
    if (!root) return;
    root.querySelectorAll?.('[data-atn2-act-filter]')?.forEach?.((b) => {
      const k = String(b.getAttribute('data-atn2-act-filter') || '');
      const isOn = k === actFilter;
      b.classList.toggle('is-active', isOn);
      b.setAttribute('aria-selected', isOn ? 'true' : 'false');
    });
  },

  _atn2BuildAttenuationActivityFeed(actFilter) {
    const atnOpTasks = [
      ...(Store.getOpTasksByCategory('correcao-atenuacao') || []),
      ...(Store.getOpTasksByCategory('correcao_atenuacao') || []),
    ];
    const feed = [];
    const prioColor = (t) => {
      const p = String(t?.prioridade || '').trim().toLowerCase();
      if (p === 'critica') return 'red';
      if (p === 'alta') return 'amber';
      if (p === 'media') return 'blue';
      return 'green';
    };
    const f = String(actFilter || 'all');
    atnOpTasks.forEach((t) => {
      const hist = Array.isArray(t?.historico) ? t.historico : [];
      const last = hist.length ? hist[hist.length - 1] : null;
      const ts = String(last?.timestamp || t?.criadaEm || '').trim();
      if (!ts) return;
      const d = new Date(ts);
      const time = Number.isFinite(d.getTime())
        ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : ts.slice(0, 16).replace('T', ' ');
      const title = String(t?.titulo || t?.nome || 'Correção').trim() || 'Correção';
      const stt = String(last?.status || t?.status || '—').trim();
      const stLower = stt.toLowerCase();
      const showByFilter = f === 'all'
        ? true
        : f === 'pending'
          ? stLower === 'criada'
          : f === 'progress'
            ? stLower === 'em andamento'
            : f === 'done'
              ? stLower === 'concluída' || stLower === 'concluida'
              : true;
      if (!showByFilter) return;
      const who = String(last?.autor || t?.responsavel || '—').trim() || '—';
      const db = Number(t?.atenuacaoDb);
      const meta = Number.isFinite(db) && db !== 0 ? `${String(db)} dBm` : '';
      feed.push({
        color: prioColor(t),
        id: Number(t?.id) || 0,
        title,
        status: stt,
        text: `${title} — ${stt}`,
        time,
        tech: who,
        meta,
        ts,
      });
    });
    feed.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    return feed.slice(0, 20);
  },

  _atn2SyncActModalDeleteBtn() {
    const del = document.getElementById('atn2ActDeleteBtn');
    const m = document.getElementById('atn2ActModal');
    if (!del || !m) return;
    const id = Number(m.dataset?.editId || 0);
    const show = Number.isFinite(id) && id > 0;
    del.hidden = !show;
    del.setAttribute('aria-hidden', show ? 'false' : 'true');
  },

  /** Atualiza só filtros + lista de atividades (não recria o modal nem o skeleton). */
  _atn2RefreshAttenuationFeedOnly(root, preservedScroll) {
    if (!root) return;
    if (!root.dataset.atn2ActFilter) root.dataset.atn2ActFilter = 'all';
    const actFilter = String(root.dataset.atn2ActFilter || 'all');
    this._atn2PaintActFilterChips(root, actFilter);
    const feed = this._atn2BuildAttenuationActivityFeed(actFilter);
    const feedRoot = document.getElementById('atn2AttenuationActivities');
    const prevScrollTop = feedRoot ? feedRoot.scrollTop : 0;
    const prevClientH = feedRoot ? feedRoot.clientHeight : 0;
    const prevScrollH = feedRoot ? feedRoot.scrollHeight : 0;
    const prevNearBottom = feedRoot
      ? (prevScrollH - (prevScrollTop + prevClientH)) <= 14
      : false;
    const usePreserved = preservedScroll && typeof preservedScroll.scrollTop === 'number';
    const nearBottom = usePreserved ? !!preservedScroll.nearBottom : prevNearBottom;
    const scrollTop = usePreserved ? preservedScroll.scrollTop : prevScrollTop;
    this._atn2RenderAttenuationActivities(feedRoot, feed);
    if (feedRoot) {
      if (nearBottom) feedRoot.scrollTop = feedRoot.scrollHeight;
      else feedRoot.scrollTop = scrollTop;
    }
    if (feedRoot && !feedRoot.dataset.boundScrollFlag) {
      feedRoot.dataset.boundScrollFlag = '1';
      let t = null;
      const mark = () => {
        feedRoot.dataset.userScrolling = '1';
        clearTimeout(t);
        t = setTimeout(() => { feedRoot.dataset.userScrolling = '0'; }, 800);
      };
      feedRoot.addEventListener('wheel', mark, { passive: true });
      feedRoot.addEventListener('touchmove', mark, { passive: true });
      feedRoot.addEventListener('scroll', mark, { passive: true });
    }
  },

  renderAtenuacaoDashboardPage() {
    const root = document.getElementById('atn2Root');
    if (!root) return;
    const st = this._atn2State;

    const atn2DbgOn = (() => {
      try {
        const byLs = localStorage.getItem('planner.atn2.debug') === '1';
        const byQs = /\batn2debug=1\b/.test(String(location.search || ''));
        return byLs || byQs;
      } catch {
        return /\batn2debug=1\b/.test(String(location.search || ''));
      }
    })();
    const atn2Dbg = (msg, data) => {
      if (!atn2DbgOn) return;
      try { /* debug habilitado via LS/querystring */ } catch { /* ignore */ }
    };
    atn2Dbg('renderAtenuacaoDashboardPage()', { ts: Date.now() });

    // Preserva scroll do feed de atividades (evita “pular” com re-render em tempo real).
    const prevFeed = document.getElementById('atn2AttenuationActivities');
    const prevScrollTop = prevFeed ? prevFeed.scrollTop : 0;
    const prevClientH = prevFeed ? prevFeed.clientHeight : 0;
    const prevScrollH = prevFeed ? prevFeed.scrollHeight : 0;
    const prevNearBottom = prevFeed
      ? (prevScrollH - (prevScrollTop + prevClientH)) <= 14
      : false;

    // Preserva estado do modal (o skeleton recria o DOM a cada render).
    const prevModal = document.getElementById('atn2ActModal');
    const prevModalOpen = !!(prevModal && prevModal.classList.contains('open'));
    const prevEditId = prevModalOpen ? String(prevModal?.dataset?.editId || '') : '';
    const prevOpenedAt = prevModalOpen ? String(prevModal?.dataset?.openedAt || '') : '';
    const prevName = prevModalOpen ? String(document.getElementById('atn2ActName')?.value || '') : '';
    const prevRegion = prevModalOpen ? String(document.getElementById('atn2ActRegion')?.value || '') : '';
    const prevDbm = prevModalOpen ? String(document.getElementById('atn2ActDbm')?.value || '') : '';

    // Remove dados de demonstração antigos que já podem ter sido gravados no localStorage/servidor.
    try {
      const sampleTitles = new Set([
        'cto-01 · goval',
        'cto-02 · vale do aço',
        'cto-03 · caratinga',
        'cto-04 · backup',
        'cto-05 · goval',
        'cto-06 · vale do aço',
      ]);
      const sampleTasks = [
        ...(Store.getOpTasksByCategory('correcao-atenuacao') || []),
        ...(Store.getOpTasksByCategory('correcao_atenuacao') || []),
      ].filter((task) => {
        const title = String(task?.titulo || '').trim().toLowerCase();
        const description = String(task?.descricao || '').trim().toLowerCase();
        return sampleTitles.has(title) && description.startsWith('atenuação:');
      });
      for (const task of sampleTasks) {
        if (task?.id) Store.removeOpTask(Number(task.id), { cascade: true });
      }
    } catch {
      /* ignore */
    }

    // Atualiza dados em tempo real com base no Store
    st.items = this._atn2ItemsFromStore();

    const counts = this._atn2Counts(st.items);
    this._atn2RenderSkeleton(root, st, counts);

    // Restaura modal aberto (se estava aberto antes do re-render).
    if (prevModalOpen) {
      const m = document.getElementById('atn2ActModal');
      if (m) {
        if (prevEditId) m.dataset.editId = prevEditId;
        if (prevOpenedAt) m.dataset.openedAt = prevOpenedAt;
        m.classList.add('open');
        m.setAttribute('aria-hidden', 'false');
        const nameEl = document.getElementById('atn2ActName');
        const regionEl = document.getElementById('atn2ActRegion');
        const coordsEl = document.getElementById('atn2ActCoords');
        const addrEl = document.getElementById('atn2ActAddress');
        const dbmEl = document.getElementById('atn2ActDbm');
        if (nameEl) nameEl.value = prevName;
        if (regionEl) regionEl.value = prevRegion;
        if (dbmEl) dbmEl.value = prevDbm;
        // coordenadas/endereço ficam vazios quando o modal foi aberto e o usuário ainda não preencheu
        if (coordsEl && !coordsEl.value) coordsEl.value = '';
        if (addrEl && !addrEl.value) addrEl.value = '';
        this._atn2SyncActModalDeleteBtn();
      }
    }

    // Bind do modal de criação (uma vez por sessão do root)
    if (!root.dataset.atn2ActBound) {
      root.dataset.atn2ActBound = '1';

      const openModal = () => {
        const m = document.getElementById('atn2ActModal');
        if (!m) return;
        dismissAtn2StatusUi();
        // Marca abertura para evitar fechamento imediato por listeners globais.
        m.dataset.openedAt = String(Date.now());
        m.classList.add('open');
        m.setAttribute('aria-hidden', 'false');
        this._atn2SyncActModalDeleteBtn();
        document.getElementById('atn2ActName')?.focus?.();
        atn2Dbg('modal:open', { openedAt: m.dataset.openedAt, editId: m.dataset.editId || '' });
      };
      const closeModal = () => {
        const m = document.getElementById('atn2ActModal');
        if (!m) return;
        dismissAtn2StatusUi();
        m.classList.remove('open');
        m.setAttribute('aria-hidden', 'true');
        atn2Dbg('modal:close', { ts: Date.now(), editId: m.dataset.editId || '' });
        if (Store.currentPage === 'correcao-atenuacao') {
          queueMicrotask(() => { this.renderAtenuacaoDashboardPage(); });
        }
      };

      const normalizeAtenuacaoRegionLabel = (raw) => {
        const key = WebhookService?._normalizeRegionKey?.(raw);
        if (key === 'GOVAL') return 'Goval';
        if (key === 'VALE_DO_ACO') return 'Vale do Aço';
        if (key === 'CARATINGA') return 'Caratinga';
        if (key === 'BACKUP') return 'Backup';
        return '';
      };

      const parseCoords = (raw) => {
        if (!raw) return null;
        const normalized = String(raw).replace(/\s+/g, '');
        const parts = normalized.split(',');
        if (parts.length !== 2) return null;
        const lat = Number(parts[0]);
        const lon = Number(parts[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        return { lat, lon };
      };

      const syncAtenuacaoTecnicosDatalist = () => {
        const listEl = document.getElementById('atn2TecnicosList');
        if (!listEl) return;
        const regiaoRaw = document.getElementById('atn2ActRegion')?.value || '';
        const techs = getTechDirectory(WebhookService._normalizeRegionKey(regiaoRaw));
        listEl.innerHTML = techs.map(t => `<option value="${t.name}"></option>`).join('');
      };

      const syncAtenuacaoSelectedTecnicoChatId = () => {
        const input = document.getElementById('atn2ActResponsavel');
        const hidden = document.getElementById('atn2ActResponsavelChatId');
        if (!input || !hidden) return;
        const regiaoRaw = document.getElementById('atn2ActRegion')?.value || '';
        const key = normalizeTechName(input.value);
        const match = getTechDirectory(WebhookService._normalizeRegionKey(regiaoRaw)).find(t => t.key === key);
        hidden.value = match ? match.chatUserId : '';
      };

      const resolveCoordsToAddress = async (rawCoords) => {
        const coordsInput = document.getElementById('atn2ActCoords');
        const addressInput = document.getElementById('atn2ActAddress');
        const hint = document.getElementById('atn2ActAddressHint');
        if (!addressInput || !hint) return;
        const coords = parseCoords(rawCoords);
        if (!coords) {
          addressInput.value = '';
          hint.textContent = rawCoords ? 'Coordenadas inválidas. Use o formato: latitude, longitude.' : 'Aguardando CTO ou coordenadas.';
          return;
        }
        hint.textContent = 'Buscando endereço...';
        try {
          const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.lat}&lon=${coords.lon}&zoom=18&addressdetails=1`;
          const response = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!response.ok) throw new Error('Falha na consulta');
          const payload = await response.json();
          const addr = payload?.address || {};
          const rua = addr.road || addr.pedestrian || addr.residential || addr.path || '';
          const bairro = addr.suburb || addr.neighbourhood || addr.city_district || addr.quarter || '';
          const text = [rua, bairro].filter(Boolean).join(' - ');
          if (!text) {
            addressInput.value = '';
            hint.textContent = 'Não foi possível identificar rua e bairro para essas coordenadas.';
            return;
          }
          addressInput.value = text;
          hint.textContent = 'Localização identificada automaticamente.';
          if (coordsInput && coordsInput.value !== rawCoords) coordsInput.value = rawCoords;
        } catch {
          addressInput.value = '';
          hint.textContent = 'Não foi possível converter coordenadas em endereço agora.';
        }
      };

      const applyCtoLookupFromName = () => {
        const nameEl = document.getElementById('atn2ActName');
        const hintEl = document.getElementById('atn2ActCtoHint');
        const coordsEl = document.getElementById('atn2ActCoords');
        if (!nameEl) return;
        const q = String(nameEl.value || '').trim();
        if (!q) {
          if (hintEl) hintEl.textContent = '';
          if (coordsEl) coordsEl.value = '';
          resolveCoordsToAddress('');
          return;
        }
        if (typeof CtoLocationRegistry === 'undefined' || !CtoLocationRegistry) return;
        CtoLocationRegistry.load().then(async () => {
          const hit = CtoLocationRegistry.findByQuery(q);
          if (!hit) {
            if (hintEl && q.length >= 4) hintEl.textContent = 'CTO não encontrada na base — você pode preencher as coordenadas manualmente.';
            else if (hintEl) hintEl.textContent = '';
            return;
          }
          if (hintEl) hintEl.textContent = `Base: ${hit.nome} (ajuste as coordenadas se necessário).`;
          if (coordsEl) coordsEl.value = `${hit.lat}, ${hit.lng}`;
          await resolveCoordsToAddress(`${hit.lat}, ${hit.lng}`);
        });
      };

      // Dropdown simples (circular) para status na lista de atividades
      const ensureStatusDropdown = () => {
        let dd = document.getElementById('atn2StatusDropdown');
        if (dd) return dd;
        dd = document.createElement('div');
        dd.id = 'atn2StatusDropdown';
        dd.className = 'atn2-status-dropdown';
        dd.hidden = true;
        dd.innerHTML = `
          <div class="atn2-status-dropdown-panel" role="menu" aria-label="Alterar status">
            <button type="button" class="atn2-status-item" role="menuitem" data-atn2-pick-status="Criada">Pendente</button>
            <button type="button" class="atn2-status-item" role="menuitem" data-atn2-pick-status="Em andamento">Em andamento</button>
            <button type="button" class="atn2-status-item" role="menuitem" data-atn2-pick-status="Concluída">Concluído</button>
          </div>
        `;
        document.body.appendChild(dd);
        return dd;
      };

      const closeStatusDropdown = () => {
        const dd = document.getElementById('atn2StatusDropdown');
        if (!dd) return;
        dd.hidden = true;
        delete dd.dataset.opId;
      };

      const dismissAtn2StatusUi = () => {
        closeStatusDropdown();
        root.querySelectorAll?.('.atn2-status-btn[aria-expanded="true"]')?.forEach?.((b) => b.setAttribute('aria-expanded', 'false'));
      };

      const openStatusDropdown = (opId, anchorEl) => {
        const id = Number(opId) || 0;
        if (!id || !anchorEl) return;
        const task = Store.findOpTask(id);
        if (!task) return;
        const dd = ensureStatusDropdown();
        dd.dataset.opId = String(id);
        dd.hidden = false;

        const rect = anchorEl.getBoundingClientRect();
        const panel = dd.querySelector('.atn2-status-dropdown-panel');
        const panelW = panel?.offsetWidth || 220;
        const panelH = panel?.offsetHeight || 140;
        const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
        const vh = window.innerHeight || document.documentElement.clientHeight || 768;

        const left = Math.max(10, Math.min(vw - panelW - 10, rect.left - panelW + rect.width));
        const top = Math.max(10, Math.min(vh - panelH - 10, rect.bottom + 8));
        dd.style.left = `${Math.round(left)}px`;
        dd.style.top = `${Math.round(top)}px`;

        // marca item atual (sem depender de CSS externo)
        const cur = String(task.status || '').trim();
        dd.querySelectorAll('[data-atn2-pick-status]').forEach((btn) => {
          const st = String(btn.getAttribute('data-atn2-pick-status') || '').trim();
          const isCur = st === cur;
          btn.classList.toggle('is-current-atn2-status', isCur);
          btn.textContent = st === 'Criada'
            ? `Pendente${isCur ? ' ✓' : ''}`
            : st === 'Em andamento'
              ? `Em andamento${isCur ? ' ✓' : ''}`
              : `Concluído${isCur ? ' ✓' : ''}`;
        });

        // acessibilidade: foca primeiro item
        requestAnimationFrame(() => dd.querySelector('.atn2-status-item')?.focus?.());
      };

      const saveAtn2ActivityModal = () => {
        try {
          const m = document.getElementById('atn2ActModal');
          const editId = Number(m?.dataset?.editId || 0);
          const rawName = String(document.getElementById('atn2ActName')?.value || '').trim();
          const region = normalizeAtenuacaoRegionLabel(document.getElementById('atn2ActRegion')?.value);
          const status = String(document.getElementById('atn2ActStatus')?.value || 'Criada').trim() || 'Criada';
          const name = rawName || 'Atividade de atenuação';
          const title = region && name && !name.toLowerCase().includes(region.toLowerCase())
            ? `${name} · ${region}`
            : name;
          const dbmEl = document.getElementById('atn2ActDbm');
          const dbmNorm = this._atn2NormalizeNegativeDbmInput(dbmEl?.value);
          if (dbmEl && dbmNorm !== String(dbmEl.value || '')) dbmEl.value = dbmNorm;
          const dbm = Number(String(dbmNorm || '').replace(',', '.')) || 0;
          const atenuacaoDb = Number.isFinite(dbm) ? (dbm > 0 ? -dbm : dbm) : 0;
          const prio = this._atn2PriorityFromDbm(atenuacaoDb);
          const who = String(document.getElementById('atn2ActResponsavel')?.value || '').trim()
            || String(getSignedUserName?.() || '').trim()
            || '—';
          const responsavelChatId = String(document.getElementById('atn2ActResponsavelChatId')?.value || '').trim();
          const rawCoords = String(document.getElementById('atn2ActCoords')?.value || '').trim();
          const coords = parseCoords(rawCoords) ? rawCoords : '';
          const address = String(document.getElementById('atn2ActAddress')?.value || '').trim();
          const patch = {
            titulo: title,
            regiao: region,
            prioridade: prio,
            status,
            descricao: atenuacaoDb ? `Atenuação: ${atenuacaoDb} dBm` : 'Atenuação: N/D',
            atenuacaoDb,
            coordenadas: coords,
            localizacaoTexto: address,
            responsavel: who,
            responsavelChatId,
          };
          if (editId) {
            const before = Store.findOpTask?.(editId);
            const beforeStatus = String(before?.status || '').trim();
            Store.updateOpTask(editId, patch);
            const savedTask = Store.findOpTask?.(editId) || before;
            ToastService?.show?.('Atividade atualizada.', 'success');
            const event = OpTaskService?._statusToEvent?.[status];
            if (event && savedTask && beforeStatus !== status) {
              // Evita cair no BACKUP quando o usuário não escolheu região.
              if (!String(savedTask.regiao || '').trim()) {
                ToastService?.show?.('Selecione uma região para enviar ao chat.', 'warning');
              } else {
              const categoryLabel = OpTaskService?._categoryLabels?.[savedTask.categoria] || savedTask.categoria;
              WebhookService?.send?.(event, savedTask, categoryLabel);
              }
            }
          } else {
            const newId = Store.addOpTask({
              categoria: 'correcao-atenuacao',
              titulo: title,
              regiao: region,
              responsavel: who,
              responsavelChatId,
              prioridade: prio,
              status,
              descricao: atenuacaoDb ? `Atenuação: ${atenuacaoDb} dBm` : 'Atenuação: N/D',
              atenuacaoDb,
              coordenadas: coords,
              localizacaoTexto: address,
            });
            ToastService?.show?.('Atividade salva.', 'success');
            const savedTask = (typeof newId === 'number' && newId) ? Store.findOpTask?.(newId) : null;
            const event = OpTaskService?._statusToEvent?.[status];
            if (event && savedTask) {
              if (!String(savedTask.regiao || '').trim()) {
                ToastService?.show?.('Selecione uma região para enviar ao chat.', 'warning');
              } else {
              const categoryLabel = OpTaskService?._categoryLabels?.[savedTask.categoria] || savedTask.categoria;
              WebhookService?.send?.(event, savedTask, categoryLabel);
              }
            }
          }
        } catch {
          ToastService?.show?.('Não foi possível salvar a atividade.', 'danger');
        }
        closeModal();
      };

      // Salvar/Fechar/Cancelar: captura no document — não depende de bubble até #atn2Root.
      document.addEventListener('click', (e) => {
        const m = document.getElementById('atn2ActModal');
        if (!m?.classList.contains('open')) return;
        const raw = e.target;
        const t = raw && raw.nodeType === 3 ? raw.parentElement : raw;
        if (!t || !m.contains(t)) return;
        if (t.closest('#atn2ActCloseBtn') || t.closest('#atn2ActCancelBtn')) {
          e.preventDefault();
          e.stopPropagation();
          closeModal();
          return;
        }
        if (t.closest('#atn2ActSaveBtn')) {
          e.preventDefault();
          e.stopPropagation();
          saveAtn2ActivityModal();
          return;
        }
        if (t.closest('#atn2ActDeleteBtn')) {
          e.preventDefault();
          e.stopPropagation();
          const editId = Number(m?.dataset?.editId || 0);
          if (!editId) return;
          const task = Store.findOpTask(editId);
          if (!task) {
            ToastService?.show?.('Atividade não encontrada.', 'warning');
            closeModal();
            return;
          }
          const label = String(task.titulo || task.nome || 'esta atividade').trim().slice(0, 120);
          if (!window.confirm(`Excluir "${label}"? Esta ação não pode ser desfeita.`)) return;
          try {
            const removed = Store.removeOpTask(editId, { cascade: false });
            if (removed) ToastService?.show?.('Atividade excluída.', 'success');
            else ToastService?.show?.('Não foi possível excluir.', 'danger');
          } catch {
            ToastService?.show?.('Não foi possível excluir.', 'danger');
          }
          closeModal();
        }
      }, true);

      // "+ Criar atividade": usa pointerdown (captura) para ser mais confiável que click
      // em cenários com scroll/drag/overlays que impedem o click de disparar.
      root.addEventListener('pointerdown', (e) => {
        const t = (e.target && e.target.nodeType === 3) ? e.target.parentElement : e.target;
        if (!t?.closest?.('#atn2CreateActivityBtn')) return;
        e.preventDefault();
        e.stopPropagation();
        const m = document.getElementById('atn2ActModal');
        if (m) delete m.dataset.editId;
        const nameEl = document.getElementById('atn2ActName');
        const regionEl = document.getElementById('atn2ActRegion');
        const respEl = document.getElementById('atn2ActResponsavel');
        const respChatEl = document.getElementById('atn2ActResponsavelChatId');
        const statusEl = document.getElementById('atn2ActStatus');
        const coordsEl = document.getElementById('atn2ActCoords');
        const addrEl = document.getElementById('atn2ActAddress');
        const ctoHint = document.getElementById('atn2ActCtoHint');
        const addrHint = document.getElementById('atn2ActAddressHint');
        const dbmEl = document.getElementById('atn2ActDbm');
        if (nameEl) nameEl.value = '';
        if (regionEl) regionEl.value = '';
        if (respEl) respEl.value = '';
        if (respChatEl) respChatEl.value = '';
        if (statusEl) statusEl.value = 'Criada';
        if (coordsEl) coordsEl.value = '';
        if (addrEl) addrEl.value = '';
        if (ctoHint) ctoHint.textContent = '';
        if (addrHint) addrHint.textContent = 'Aguardando CTO ou coordenadas.';
        if (dbmEl) dbmEl.value = '';
        syncAtenuacaoTecnicosDatalist();
        openModal();
      }, true);

      root.addEventListener('click', (e) => {
        const t = (e.target && e.target.nodeType === 3) ? e.target.parentElement : e.target;
        const filterBtn = t?.closest?.('[data-atn2-act-filter]');
        if (filterBtn) {
          e.preventDefault();
          const k = String(filterBtn.getAttribute('data-atn2-act-filter') || '').trim();
          if (k) {
            root.dataset.atn2ActFilter = k;
            if (document.getElementById('atn2ActModal')?.classList?.contains('open')) {
              this._atn2RefreshAttenuationFeedOnly(root);
            } else {
              this.renderAtenuacaoDashboardPage();
            }
          }
          return;
        }
        const editBtn = t?.closest?.('[data-atn2-edit-btn]');
        if (editBtn) {
          e.preventDefault();
          try { e.stopImmediatePropagation(); } catch { /* ignore */ }
          const id = Number(editBtn.getAttribute('data-atn2-edit-btn') || 0);
          if (!id) return;
          const task = Store.findOpTask(id);
          if (!task) return;
          const m = document.getElementById('atn2ActModal');
          if (m) m.dataset.editId = String(id);
          const nameEl = document.getElementById('atn2ActName');
          const regionEl = document.getElementById('atn2ActRegion');
          const respEl = document.getElementById('atn2ActResponsavel');
          const respChatEl = document.getElementById('atn2ActResponsavelChatId');
          const statusEl = document.getElementById('atn2ActStatus');
          const coordsEl = document.getElementById('atn2ActCoords');
          const addrEl = document.getElementById('atn2ActAddress');
          const addrHint = document.getElementById('atn2ActAddressHint');
          const dbmEl = document.getElementById('atn2ActDbm');
          if (nameEl) nameEl.value = String(task.titulo || task.nome || '').trim();
          if (regionEl) regionEl.value = normalizeAtenuacaoRegionLabel(task.regiao);
          if (respEl) respEl.value = String(task.responsavel || '').trim();
          if (respChatEl) respChatEl.value = String(task.responsavelChatId || '').trim();
          if (statusEl) statusEl.value = String(task.status || 'Criada').trim() || 'Criada';
          const db = Number(task.atenuacaoDb);
          if (dbmEl) dbmEl.value = Number.isFinite(db) && db !== 0 ? String(db) : '';
          if (coordsEl) coordsEl.value = String(task.coordenadas || '').trim();
          if (addrEl) addrEl.value = String(task.localizacaoTexto || '').trim();
          if (addrHint) addrHint.textContent = coordsEl?.value ? 'Localização carregada.' : 'Aguardando CTO ou coordenadas.';
          syncAtenuacaoTecnicosDatalist();
          syncAtenuacaoSelectedTecnicoChatId();
          openModal();
          return;
        }
        if (t?.closest?.('#atn2CreateActivityBtn')) {
          e.preventDefault();
          const m = document.getElementById('atn2ActModal');
          if (m) delete m.dataset.editId;
          const nameEl = document.getElementById('atn2ActName');
          const regionEl = document.getElementById('atn2ActRegion');
          const respEl = document.getElementById('atn2ActResponsavel');
          const respChatEl = document.getElementById('atn2ActResponsavelChatId');
          const statusEl = document.getElementById('atn2ActStatus');
          const coordsEl = document.getElementById('atn2ActCoords');
          const addrEl = document.getElementById('atn2ActAddress');
          const ctoHint = document.getElementById('atn2ActCtoHint');
          const addrHint = document.getElementById('atn2ActAddressHint');
          const dbmEl = document.getElementById('atn2ActDbm');
          if (nameEl) nameEl.value = '';
          if (regionEl) regionEl.value = '';
          if (respEl) respEl.value = '';
          if (respChatEl) respChatEl.value = '';
          if (statusEl) statusEl.value = 'Criada';
          if (coordsEl) coordsEl.value = '';
          if (addrEl) addrEl.value = '';
          if (ctoHint) ctoHint.textContent = '';
          if (addrHint) addrHint.textContent = 'Aguardando CTO ou coordenadas.';
          if (dbmEl) dbmEl.value = '';
          syncAtenuacaoTecnicosDatalist();
          openModal();
          return;
        }
        const actRow = t?.closest?.('[data-atn2-act-open]');
        if (actRow) {
          const id = Number(actRow.getAttribute('data-atn2-act-open') || 0);
          if (!id) return;
          const task = Store.findOpTask(id);
          if (!task) return;
          e.preventDefault();
          // Garante que nenhum outro handler no mesmo evento feche o modal.
          try { e.stopImmediatePropagation(); } catch { /* ignore */ }
          atn2Dbg('click:editRow', { id, target: String(t?.className || ''), ts: Date.now() });
          const m = document.getElementById('atn2ActModal');
          if (m) m.dataset.editId = String(id);
          const nameEl = document.getElementById('atn2ActName');
          const regionEl = document.getElementById('atn2ActRegion');
          const respEl = document.getElementById('atn2ActResponsavel');
          const respChatEl = document.getElementById('atn2ActResponsavelChatId');
          const statusEl = document.getElementById('atn2ActStatus');
          const coordsEl = document.getElementById('atn2ActCoords');
          const addrEl = document.getElementById('atn2ActAddress');
          const addrHint = document.getElementById('atn2ActAddressHint');
          const dbmEl = document.getElementById('atn2ActDbm');
          if (nameEl) nameEl.value = String(task.titulo || task.nome || '').trim();
          if (regionEl) regionEl.value = normalizeAtenuacaoRegionLabel(task.regiao);
          if (respEl) respEl.value = String(task.responsavel || '').trim();
          if (respChatEl) respChatEl.value = String(task.responsavelChatId || '').trim();
          if (statusEl) statusEl.value = String(task.status || 'Criada').trim() || 'Criada';
          const db = Number(task.atenuacaoDb);
          if (dbmEl) dbmEl.value = Number.isFinite(db) && db !== 0 ? String(db) : '';
          if (coordsEl) coordsEl.value = String(task.coordenadas || '').trim();
          if (addrEl) addrEl.value = String(task.localizacaoTexto || '').trim();
          if (addrHint) addrHint.textContent = coordsEl?.value ? 'Localização carregada.' : 'Aguardando CTO ou coordenadas.';
          syncAtenuacaoTecnicosDatalist();
          syncAtenuacaoSelectedTecnicoChatId();
          openModal();
          return;
        }
      });

      // Abrir dropdown de status no pointerdown (mais confiável que click)
      root.addEventListener('pointerdown', (e) => {
        const t = (e.target && e.target.nodeType === 3) ? e.target.parentElement : e.target;
        const stBtn = t?.closest?.('[data-atn2-status-btn]');
        if (!stBtn) return;
        e.preventDefault();
        e.stopPropagation();
        const id = Number(stBtn.getAttribute('data-atn2-status-btn') || 0);
        const dd = document.getElementById('atn2StatusDropdown');
        if (dd && !dd.hidden && dd.dataset.opId === String(id)) {
          closeStatusDropdown();
          stBtn.setAttribute('aria-expanded', 'false');
          return;
        }
        closeStatusDropdown();
        root.querySelectorAll?.('.atn2-status-btn[aria-expanded="true"]')?.forEach?.(b => b.setAttribute('aria-expanded', 'false'));
        stBtn.setAttribute('aria-expanded', 'true');
        openStatusDropdown(id, stBtn);
      }, true);

      // Botão "Editar" em pointerdown (captura) — evita briga com click/re-render.
      root.addEventListener('pointerdown', (e) => {
        const t = (e.target && e.target.nodeType === 3) ? e.target.parentElement : e.target;
        const btn = t?.closest?.('[data-atn2-edit-btn]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const id = Number(btn.getAttribute('data-atn2-edit-btn') || 0);
        if (!id) return;
        const task = Store.findOpTask(id);
        if (!task) return;
        const m = document.getElementById('atn2ActModal');
        if (m) m.dataset.editId = String(id);
        const nameEl = document.getElementById('atn2ActName');
        const regionEl = document.getElementById('atn2ActRegion');
        const dbmEl = document.getElementById('atn2ActDbm');
        if (nameEl) nameEl.value = String(task.titulo || task.nome || '').trim();
        if (regionEl) regionEl.value = normalizeAtenuacaoRegionLabel(task.regiao);
        const db = Number(task.atenuacaoDb);
        if (dbmEl) dbmEl.value = Number.isFinite(db) && db !== 0 ? String(db) : '';
        openModal();
      }, true);

      // Fecha modal ao clicar fora do painel (listener global, evita corrida com click que abre).
      document.addEventListener('pointerdown', (e) => {
        const m = document.getElementById('atn2ActModal');
        if (!m || !m.classList.contains('open')) return;
        if (e.target !== m) return;
        const openedAt = Number(m.dataset.openedAt || 0);
        if (openedAt && Date.now() - openedAt < 450) return;
        atn2Dbg('modal:backdropPointerDown->close', { ts: Date.now(), openedAt, deltaMs: Date.now() - openedAt });
        closeModal();
      }, true);

      root.addEventListener('input', (e) => {
        const el = e.target;
        if (el?.id === 'atn2ActDbm') {
          const next = this._atn2NormalizeNegativeDbmInput(el.value);
          if (next !== el.value) {
            const pos = el.selectionStart;
            el.value = next;
            try { el.setSelectionRange(pos, pos); } catch {}
          }
        }
        if (el?.id === 'atn2ActRegion') {
          syncAtenuacaoTecnicosDatalist();
          syncAtenuacaoSelectedTecnicoChatId();
        }
        if (el?.id === 'atn2ActResponsavel') {
          syncAtenuacaoSelectedTecnicoChatId();
        }
        if (el?.id === 'atn2ActName') {
          // Sempre força o valor em maiúsculo (mantém a posição do cursor)
          const v0 = String(el.value || '');
          const v1 = v0.toUpperCase();
          if (v1 !== v0) {
            const start = el.selectionStart;
            const end = el.selectionEnd;
            el.value = v1;
            try { el.setSelectionRange(start, end); } catch { /* ignore */ }
          }
          applyCtoLookupFromName();
        }
        if (el?.id === 'atn2ActCoords') {
          const raw = String(el.value || '').trim();
          // Atualiza endereço ao digitar coordenadas manualmente
          resolveCoordsToAddress(raw);
        }
      });

      // Seleção de status no dropdown
      document.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('[data-atn2-pick-status]');
        if (!btn) return;
        const dd = document.getElementById('atn2StatusDropdown');
        if (!dd || dd.hidden) return;
        const id = Number(dd.dataset.opId || 0);
        if (!id) return;
        const next = String(btn.getAttribute('data-atn2-pick-status') || '').trim();
        if (!next) return;
        const before = Store.findOpTask(id);
        const beforeStatus = String(before?.status || '').trim();

        // Se for colocar em andamento, exige região e usa o fluxo oficial (que dispara webhook por região).
        if (beforeStatus !== next && next === 'Em andamento') {
          const fresh0 = Store.findOpTask(id);
          const region = normalizeAtenuacaoRegionLabel(fresh0?.regiao);
          if (!region) {
            ToastService?.show?.('Selecione uma região antes de colocar em andamento.', 'warning');
            closeStatusDropdown();
            root.querySelectorAll?.('.atn2-status-btn[aria-expanded="true"]')?.forEach?.(b => b.setAttribute('aria-expanded', 'false'));
            return;
          }
        }

        // Usa o serviço de negócio: atualiza status + histórico e dispara webhook quando aplicável.
        OpTaskService.changeStatus(id, next);

        closeStatusDropdown();
        root.querySelectorAll?.('.atn2-status-btn[aria-expanded="true"]')?.forEach?.(b => b.setAttribute('aria-expanded', 'false'));
        if (document.getElementById('atn2ActModal')?.classList?.contains('open')) {
          this._atn2RefreshAttenuationFeedOnly(root);
        } else {
          this.renderAtenuacaoDashboardPage();
        }
      }, true);

      // Clique fora fecha o dropdown de status (usa pointerdown pra ser mais confiável)
      document.addEventListener('pointerdown', (e) => {
        const dd = document.getElementById('atn2StatusDropdown');
        if (!dd || dd.hidden) return;
        if (dd.contains(e.target)) return;
        if (e.target?.closest?.('.atn2-status-btn')) return;
        closeStatusDropdown();
        root.querySelectorAll?.('.atn2-status-btn[aria-expanded="true"]')?.forEach?.(b => b.setAttribute('aria-expanded', 'false'));
      }, true);

      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const dd = document.getElementById('atn2StatusDropdown');
        if (!dd || dd.hidden) return;
        closeStatusDropdown();
        root.querySelectorAll?.('.atn2-status-btn[aria-expanded="true"]')?.forEach?.(b => b.setAttribute('aria-expanded', 'false'));
      });
    }

    // Integração do componente: agulha + stats (sem alterar a lógica do percent)
    updateThermometer(counts.thermoAvgDbm);
    updateStats(counts.total, counts.pctCritAlta, counts.thermoAvgDbm);

    this._atn2RefreshAttenuationFeedOnly(root, {
      scrollTop: prevScrollTop,
      nearBottom: prevNearBottom,
    });

    // Timer de "tempo real" (sem duplicar intervalos)
    if (!this._atn2LiveTimer) {
      this._atn2LiveTimer = setInterval(() => {
        if (Store.currentPage !== 'correcao-atenuacao') {
          clearInterval(this._atn2LiveTimer);
          this._atn2LiveTimer = null;
          return;
        }
        const ae = document.activeElement;
        const aeId = ae && typeof ae.id === 'string' ? ae.id : '';
        if (aeId && aeId.startsWith('atn2')) return;
        if (document.getElementById('atn2ActModal')?.classList?.contains('open')) return;
        // Se o usuário estiver com o mouse/scroll no feed, não re-renderiza.
        const feedEl = document.getElementById('atn2AttenuationActivities');
        if (feedEl && (feedEl.matches(':hover') || feedEl.dataset.userScrolling === '1')) return;
        this.renderAtenuacaoDashboardPage();
      }, 1000);
    }
  },

  // Atenuação em dBm (valores negativos): quanto MAIS negativo, mais crítico.
  // Faixas fornecidas: leve (-22.01..-24), média (-24.01..-26), alta (-26.01..-28), crítica (< -28).
  // Implementação usa pontos de corte:
  // p0 <= -28.00
  // p1 <= -26.00 (até -28.00)
  // p2 <= -24.00 (até -26.00)
  // p3 <= -22.01 (até -24.00)
  // mon > -22.01
  _atnThresholds() {
    return getAtenuacaoThresholds();
  },
  _atnParseDbFromText(text) {
    const s = String(text || '');
    if (!s) return null;
    // Aceita "-22.01 dBm" / "-28 dB" etc.
    const m = s.match(/(-?\d{1,3}(?:[.,]\d{1,2})?)\s*d\s*b\s*m?\b/i);
    if (!m) return null;
    const n = Number(String(m[1]).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  },
  _atnDb(task) {
    if (!task || typeof task !== 'object') return null;
    const direct =
      task.atenuacaoDb ??
      task.atenuacaoDB ??
      task.atenuacao ??
      task.db ??
      task.dB ??
      task.atnDb ??
      null;
    const n = Number(direct);
    if (Number.isFinite(n)) return n;
    // Fallback: tenta ler “xx dB” de campos comuns
    return (
      this._atnParseDbFromText(task.titulo) ??
      this._atnParseDbFromText(task.descricao) ??
      this._atnParseDbFromText(task.setor) ??
      this._atnParseDbFromText(task.localizacaoTexto) ??
      null
    );
  },
  _atnBucketForDb(db, thresholds = this._atnThresholds()) {
    if (!Number.isFinite(db)) return 'unknown';
    // Mais negativo = pior (P0 mais crítico)
    if (db <= thresholds.p0) return 'p0'; // crítico: pior que -28.00
    if (db <= thresholds.p1) return 'p1'; // alta: <= -26.00 e > -28.00
    if (db <= thresholds.p2) return 'p2'; // média: <= -24.00 e > -26.00
    if (db <= thresholds.p3) return 'p3'; // leve: <= -22.00 e > -24.00
    return 'mon';
  },
  _atnOverrideBucket(task) {
    const v = String(task?.atnBucketOverride || '').trim().toLowerCase();
    if (!v) return '';
    if (v === 'p0' || v === 'p1' || v === 'p2' || v === 'p3' || v === 'mon') return v;
    return '';
  },
  _atnBucketForTask(task, thresholds = this._atnThresholds()) {
    const override = this._atnOverrideBucket(task);
    if (override) return override;
    const db = this._atnDb(task);
    return this._atnBucketForDb(db, thresholds);
  },
  _bindAtenuacaoRadarEvents() {
    const page = document.getElementById('page-correcao-atenuacao');
    if (!page || page.dataset.boundAtenuacaoRadar) return;
    page.dataset.boundAtenuacaoRadar = '1';

    const rerender = () => this.renderAtenuacaoRadarPage();

    page.querySelector('#atnRefreshBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      rerender();
    });
    page.querySelector('#atnNewTaskBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      Controllers?.opTask?.openNewModal?.({ category: 'correcao-atenuacao' });
    });

    page.querySelector('#atnSearchInput')?.addEventListener('input', rerender);
    page.querySelector('#atnRegionSelect')?.addEventListener('change', rerender);
    page.querySelector('#atnTecnicoInput')?.addEventListener('input', rerender);

    page.querySelector('#atnRadarBoard')?.addEventListener('click', (e) => {
      const openBtn = e.target.closest?.('[data-atn-open-op]');
      if (openBtn) {
        e.preventDefault();
        const id = Number(openBtn.dataset.atnOpenOp || 0);
        if (id) Controllers?.opTask?.openEditModal?.(id);
        return;
      }
    });
  },

  renderAtenuacaoRadarPage() {
    this._bindAtenuacaoRadarEvents();

    const board = document.getElementById('atnRadarBoard');
    const createdList = document.getElementById('atnCreatedList');
    if (!board || !createdList) return;

    // Animação leve ao re-renderizar (melhora sensação de responsividade)
    board.classList.remove('atn-anim-refresh');
    createdList.classList.remove('atn-anim-refresh');
    void board.offsetWidth;
    board.classList.add('atn-anim-refresh');
    createdList.classList.add('atn-anim-refresh');

    const q = String(document.getElementById('atnSearchInput')?.value || '').trim().toLowerCase();
    const region = String(document.getElementById('atnRegionSelect')?.value || '').trim().toLowerCase();
    const tech = String(document.getElementById('atnTecnicoInput')?.value || '').trim().toLowerCase();

    const all = Store.getOpTasksByCategory('correcao-atenuacao') || [];
    const filtered = all.filter((t) => {
      const matchQ =
        !q ||
        String(t.titulo || '').toLowerCase().includes(q) ||
        String(t.setor || '').toLowerCase().includes(q) ||
        String(t.regiao || '').toLowerCase().includes(q) ||
        String(t.responsavel || '').toLowerCase().includes(q) ||
        String(t.descricao || '').toLowerCase().includes(q) ||
        String(t.localizacaoTexto || '').toLowerCase().includes(q);
      const matchRegion = !region || String(t.regiao || '').trim().toLowerCase() === region;
      const matchTech = !tech || String(t.responsavel || '').trim().toLowerCase().includes(tech);
      return matchQ && matchRegion && matchTech;
    });

    const thresholds = this._atnThresholds();
    // Filtra placeholders / itens incompletos (não entram na lista normal).
    const isGenericTestName = (raw) => {
      const n = String(raw || '').trim().toLowerCase();
      if (!n) return true;
      if (n === 'teste' || n === 'test' || n.startsWith('teste ') || n.startsWith('test ')) return true;
      return false;
    };
    const isPlaceholderNovaCaixa = (raw) => {
      const n = String(raw || '').trim().toLowerCase();
      return (n.includes('cto-00') || n.startsWith('cto-00')) && n.includes('nova caixa');
    };
    const hidden = [];
    const visible = [];
    filtered.forEach((t) => {
      const titleRaw = String(t.setor || t.titulo || '').trim();
      const db = this._atnDb(t);
      const hasDb = Number.isFinite(db);
      const pr = String(t.prioridade || '').trim();
      const hasPr = !!pr;
      const isBadName = isGenericTestName(titleRaw) || isPlaceholderNovaCaixa(titleRaw);
      const incomplete = !hasDb || !hasPr;
      if (isBadName || incomplete) hidden.push(t);
      else visible.push(t);
    });

    const createdStatuses = new Set(['Criada', 'Backlog', 'A iniciar', 'Pendente']);
    const createdTasks = [];
    const activeTasks = [];
    visible.forEach((t) => {
      const s = String(t.status || '').trim();
      if (createdStatuses.has(s)) createdTasks.push(t);
      else activeTasks.push(t);
    });

    const buckets = { p0: [], p1: [], p2: [], p3: [], mon: [], unknown: [] };
    activeTasks.forEach((t) => {
      const db = this._atnDb(t);
      const key = this._atnBucketForTask(t, thresholds);
      buckets[key].push({ ...t, _atnDb: db });
    });

    const sortWorstFirst = (a, b) => {
      const da = Number.isFinite(a._atnDb) ? a._atnDb : -1;
      const db = Number.isFinite(b._atnDb) ? b._atnDb : -1;
      // Ordena do mais crítico (mais negativo) para o menos crítico.
      if (da !== db) return da - db;
      return String(a.prazo || a.dataEntrada || a.criadaEm || '').localeCompare(String(b.prazo || b.dataEntrada || b.criadaEm || ''));
    };
    Object.keys(buckets).forEach((k) => buckets[k].sort(sortWorstFirst));

    const setText = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(v);
    };
    // Contadores no topo foram removidos do layout; as contagens aparecem nos títulos das colunas.

    const total = visible.length;
    const withDb = visible.filter((t) => Number.isFinite(this._atnDb(t))).length;
    const criticalLoad = Math.min(100, Math.round(((buckets.p0.length + buckets.p1.length) / Math.max(total, 1)) * 100));
    const thermoFill = document.getElementById('atnThermoFill');
    if (thermoFill) thermoFill.style.width = `${criticalLoad}%`;
    const thermoLabel = document.getElementById('atnThermoLabel');
    if (thermoLabel) {
      const hiddenCount = hidden.length;
      thermoLabel.textContent = `${total} item(ns) · ${withDb} com dB identificado · ${criticalLoad}% crítico/alto${hiddenCount ? ` · ${hiddenCount} oculto(s) (incompleto/teste)` : ''}`;
    }

    const fmtDb = (x) => {
      if (!Number.isFinite(x)) return '—';
      const v = Number(x);
      // Remove zeros à direita comuns (ex.: -22.00 -> -22)
      return String(v.toFixed(2)).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    };

    const createdCountEl = document.getElementById('atnCreatedCount');
    if (createdCountEl) createdCountEl.textContent = String(createdTasks.length);

    const createdSorted = [...createdTasks].map((t) => ({ ...t, _atnDb: this._atnDb(t) }));
    createdSorted.sort((a, b) => {
      const da = Number.isFinite(a._atnDb) ? a._atnDb : 999;
      const db = Number.isFinite(b._atnDb) ? b._atnDb : 999;
      // mais negativo (menor) primeiro
      if (da !== db) return da - db;
      return String(a.criadaEm || a.prazo || '').localeCompare(String(b.criadaEm || b.prazo || ''));
    });

    const renderCard = (t) => {
      const dbVal = Number.isFinite(t._atnDb) ? `${fmtDb(t._atnDb)} dBm` : '— dBm';
      const regionBadge = this.regionBadge(t.regiao);
      const sevKey = this._atnBucketForTask(t, thresholds);
      const prioBadge = (() => {
        const k = String(sevKey || '').toLowerCase();
        if (k === 'p0') return `<span class="badge p-high" title="Prioridade P0">P0 Crítica</span>`;
        if (k === 'p1') return `<span class="badge p-med" title="Prioridade P1">P1 Alta</span>`;
        if (k === 'p2') return `<span class="badge p-low" title="Prioridade P2">P2 Média</span>`;
        if (k === 'p3') return `<span class="badge p-low" title="Prioridade P3">P3 Leve</span>`;
        return `<span class="badge reg-unknown" title="Item incompleto">Incompleto</span>`;
      })();
      const status = this.statusBadge(t.status || 'Criada');
      const statusPickerBtn = Utils.opTaskStatusPickerButtonHtml(t.id, 'op-status-picker-btn--sm');
      const who = String(t.responsavel || '—').trim();
      const titleTextRaw = String(t.setor || t.titulo || 'CTO').trim() || 'CTO';
      const titleParts = titleTextRaw.split('·').map(s => s.trim()).filter(Boolean);
      const ctoName = titleParts[0] || titleTextRaw;
      const locFromTitle = titleParts.slice(1).join(' · ');
      const locText = String(t.localizacaoTexto || '').trim() || locFromTitle || String(t.regiao || '').trim();
      const sub = locText;
      const copyBtn = Utils.taskCopyProtocolButtonHtml(Utils.opTaskDisplayRef(t), 'task-copy-id-btn--sm');
      const override = this._atnOverrideBucket(t);
      const overrideBadge = override ? `<span class="badge reg-unknown" title="Movido manualmente por arrastar e soltar">Manual</span>` : '';
      const sevClass = `atn-sev-${sevKey === 'unknown' ? 'unknown' : sevKey}`;
      return `
        <div class="kanban-card atn-draggable-card ${sevClass}" draggable="true" data-atn-drag-id="${Number(t.id) || 0}" style="position:relative">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
            <div style="min-width:0">
              <div class="kanban-card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0">
                ${copyBtn}
                <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.escapeHtml(ctoName)}</span>
              </div>
              ${sub ? `<div class="kanban-card-sub" style="color:var(--white4);font-size:12px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.escapeHtml(sub)}</div>` : ''}
            </div>
            <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
              <div style="font-family:var(--font-mono);font-size:12px;color:var(--white2);padding:6px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03)" title="Atenuação identificada">
                ${dbVal}
              </div>
              <button type="button" class="sm-btn" data-atn-open-op="${Number(t.id) || 0}" aria-label="Abrir item">Abrir</button>
            </div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span class="dashboard-status-with-picker">${status}${statusPickerBtn}</span>
              ${regionBadge}
              ${prioBadge}
              ${overrideBadge}
            </div>
            <div style="color:var(--white4);font-size:12px;display:flex;align-items:center;gap:8px">
              <span style="display:inline-flex;align-items:center;gap:6px">
                <span class="av-sm" style="background:${Utils.getAvatarColor(who)};color:#0a0c0a" aria-hidden="true">${Utils.getInitials(who)}</span>
                ${Utils.escapeHtml(who)}
              </span>
            </div>
          </div>
        </div>
      `;
    };

    createdList.innerHTML = createdSorted.length
      ? createdSorted.map(renderCard).join('')
      : `<div class="empty-state" style="padding:14px 10px;margin:0;">Sem itens criados no momento.</div>`;

    const col = (key, title, hint, cls) => {
      const list = buckets[key] || [];
      const cards = list.length
        ? list.map((t) => renderCard(t)).join('')
        : `<div class="empty-state" style="padding:18px 10px;margin:0;">Sem itens nesta fila.</div>`;

      const collapseKey = `atn:${key}`;
      const colCollapsed = this._isKanbanCollapsedKey(collapseKey);

      const toggleTitle = colCollapsed ? 'Expandir' : 'Recolher';
      const toggleBtn = `
        <button type="button"
          class="kanban-col-toggle"
          data-kanban-collapse="${Utils.escapeHtmlAttr(collapseKey)}"
          data-kanban-col-label="${Utils.escapeHtmlAttr(title)}"
          aria-expanded="${colCollapsed ? 'false' : 'true'}"
          title="${toggleTitle} tarefas deste status"
          aria-label="${toggleTitle} coluna ${Utils.escapeHtmlAttr(title)}">
          <span class="kanban-col-toggle-chevron" aria-hidden="true">
            <svg class="kanban-col-toggle-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        </button>
      `;

      return `
        <div class="kanban-col atn-col atn-sev-${Utils.escapeHtmlAttr(key === 'unknown' ? 'unknown' : key)} ${cls || ''}${colCollapsed ? ' kanban-col--collapsed' : ''}">
          <div class="kanban-col-header">
            ${toggleBtn}
            <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;">
              <span class="kanban-col-title">${Utils.escapeHtml(title)}</span>
              <div class="kanban-col-sub" style="color:var(--white4);font-size:12px;">${Utils.escapeHtml(hint || '')}</div>
            </div>
            <span class="kanban-col-count">${list.length}</span>
          </div>
          <div class="kanban-cards atn-drop-zone" data-atn-drop="${Utils.escapeHtmlAttr(key)}" aria-label="Solte aqui para mudar a prioridade">
            ${cards}
          </div>
        </div>
      `;
    };

    board.innerHTML = [
      col('p0', 'P0 · Crítica', `Pior que ${fmtDb(thresholds.p0)} dBm`, ''),
      col('p1', 'P1 · Alta', `${fmtDb(thresholds.p0)}–${fmtDb(thresholds.p1)} dBm`, ''),
      col('p2', 'P2 · Média', `${fmtDb(thresholds.p1)}–${fmtDb(thresholds.p2)} dBm`, ''),
      col('p3', 'P3 · Leve', `${fmtDb(thresholds.p2)}–${fmtDb(thresholds.p3)} dBm`, ''),
      col('mon', 'Monitoramento', `Melhor que ${fmtDb(thresholds.p3)} dBm`, ''),
      buckets.unknown.length ? col('unknown', 'Sem dB', 'Item sem atenuação identificada nos campos/texto', '') : '',
    ].filter(Boolean).join('');

    // Colapsar colunas do radar (igual ao kanban padrão)
    board.onclick = (e) => {
      const target = e?.target;
      const toggle = target?.closest?.('.kanban-col-toggle');
      if (!toggle || !board.contains(toggle)) return;
      e.preventDefault();
      e.stopPropagation();
      const collapseKey = toggle.getAttribute('data-kanban-collapse') || '';
      if (!collapseKey) return;
      const nowCollapsed = this._toggleKanbanCollapsedKey(collapseKey);
      this._applyKanbanColToggleUi(toggle, nowCollapsed);
    };

    // Drag & drop: mover item entre filas (override manual de prioridade)
    const bindOnce = (el, key, fn) => {
      if (!el || !key) return;
      if (el.dataset[key]) return;
      el.dataset[key] = '1';
      fn();
    };

    const rootForDnD = document.getElementById('page-correcao-atenuacao');
    rootForDnD?.querySelectorAll('.atn-draggable-card[data-atn-drag-id]').forEach((card) => {
      bindOnce(card, 'atnDragBound', () => {
        card.addEventListener('dragstart', (e) => {
          const id = Number(card.dataset.atnDragId || 0);
          if (!id) return;
          card.classList.add('dragging');
          try {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(id));
          } catch {
            /* ignore */
          }
        });
        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
          rootForDnD?.querySelectorAll('.atn-drop-zone.drag-over').forEach((z) => z.classList.remove('drag-over'));
        });
      });
    });

    rootForDnD?.querySelectorAll('.atn-drop-zone[data-atn-drop]').forEach((zone) => {
      const targetBucket = String(zone.dataset.atnDrop || '').trim().toLowerCase();
      if (!targetBucket || targetBucket === 'unknown') return;
      bindOnce(zone, 'atnDropBound', () => {
        zone.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          try { e.dataTransfer.dropEffect = 'move'; } catch { /* ignore */ }
          zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', (e) => {
          if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
          zone.classList.remove('drag-over');
        });
        zone.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.remove('drag-over');
          let id = 0;
          try {
            id = Number(e.dataTransfer.getData('text/plain') || 0);
          } catch {
            id = 0;
          }
          if (!id) return;
          const task = Store.findOpTask?.(id);
          if (!task) return;
          zone.classList.add('atn-drop-flash');
          const isCreated = createdStatuses.has(String(task.status || '').trim());
          if (targetBucket === 'created') {
            // Volta para entrada
            Store.updateOpTask(id, { status: 'Criada', atnBucketOverride: '', atnBucketOverrideAt: '' });
            ToastService.show('Item movido para Entrada (Criadas).', 'success');
            setTimeout(() => this.renderAtenuacaoRadarPage(), 120);
            return;
          }
          // Organiza por faixa e tira da entrada
          Store.updateOpTask(id, {
            atnBucketOverride: targetBucket,
            atnBucketOverrideAt: new Date().toISOString(),
            ...(isCreated ? { status: 'Em andamento' } : {}),
          });
          setTimeout(() => this.renderAtenuacaoRadarPage(), 120);
          ToastService.show(isCreated ? 'Organizado e iniciado (Em andamento).' : 'Faixa ajustada (arrastar e soltar).', 'success');
        });
      });
    });
  },

  // Tela de relatório removida.
};

/* ─────────────────────────────────────────────────────────────
   TROCA DE ETIQUETA — Página reescrita (módulo isolado)
───────────────────────────────────────────────────────────── */
const TrocaEtiquetaPage = (() => {
  const COLLAPSE_NS = 'troca-etiqueta';
  const state = {
    filterPriority: 'todas', // todas|urgente|alto|medio|estavel
    filterTech: 'todos', // todos|<substring>
    drag: { id: 0 },
    suppressOpenUntil: 0,
    modal: { open: false, ctoDebounce: 0 },
  };

  function escapeHtml(s) { return Utils.escapeHtml(String(s ?? '')); }
  function initials(name) { return Utils.getInitials(String(name || '—')); }

  function statusKey(statusRaw) {
    const s = String(statusRaw || '').trim().toLowerCase();
    if (s.includes('and')) return 'andamento';
    if (s.includes('conc')) return 'concluida';
    return 'pendente';
  }
  function statusLabel(k) {
    if (k === 'andamento') return 'Em andamento';
    if (k === 'concluida') return 'Concluídas';
    return 'Pendentes';
  }
  function statusFromColKey(k) {
    if (k === 'andamento') return 'Em andamento';
    if (k === 'concluida') return 'Concluída';
    return 'Pendente';
  }

  function priorityKey(p) {
    const k = String(p || '').trim().toLowerCase();
    if (k === 'urgente') return 'urgente';
    if (k === 'alto') return 'alto';
    if (k === 'medio') return 'medio';
    if (k === 'estavel') return 'estavel';
    return 'alto';
  }

  function getAll() {
    const all = Store.getOpTasksByCategory('troca-etiqueta') || [];
    return all.map((t) => ({
      id: Number(t.id) || 0,
      ctoId: String(t.ctoId || t.titulo || '').trim() || `CTO-${String(Number(t.id) || 0).padStart(2, '0')}`,
      endereco: String(t.endereco || t.regiao || t.setor || '').trim() || '—',
      motivo: String(t.motivo || t.subProcesso || '').trim() || 'Padrão novo',
      tecnico: String(t.responsavel || t.tecnico || '').trim() || '—',
      prioridade: priorityKey(t.prioridade),
      status: String(t.status || 'Pendente'),
    }));
  }

  function applyFilters(items) {
    const techNeedle = String(state.filterTech || 'todos').toLowerCase();
    const prNeedle = String(state.filterPriority || 'todas').toLowerCase();
    return items.filter((it) => {
      const matchTech = techNeedle === 'todos' || String(it.tecnico || '').toLowerCase().includes(techNeedle);
      const matchPr = prNeedle === 'todas' || String(it.prioridade || '').toLowerCase() === prNeedle;
      return matchTech && matchPr;
    });
  }

  function countsByStatus(items) {
    const out = { total: items.length, pend: 0, and: 0, conc: 0 };
    items.forEach((it) => {
      const k = statusKey(it.status);
      if (k === 'andamento') out.and++;
      else if (k === 'concluida') out.conc++;
      else out.pend++;
    });
    return out;
  }

  function isColCollapsed(k) {
    return typeof UI._isKanbanCollapsedKey === 'function'
      ? UI._isKanbanCollapsedKey(`${COLLAPSE_NS}|${k}`)
      : false;
  }
  function toggleColCollapsed(k) {
    if (typeof UI._toggleKanbanCollapsedKey !== 'function') return false;
    return UI._toggleKanbanCollapsedKey(`${COLLAPSE_NS}|${k}`);
  }

  function rootEl() { return document.getElementById('teRoot'); }

  function ensureShell(root) {
    if (!root) return;
    if (root.dataset.teV2 === '1') return;
    root.dataset.teV2 = '1';
    root.innerHTML = `
      <div class="te2">
        <header class="te2__topbar" aria-label="Troca de etiqueta">
          <div class="te2__topbar-left">
            <div class="te2__title">Troca de etiqueta</div>
            <div class="te2__subtitle">Ordens e status no kanban</div>
          </div>
          <div class="te2__topbar-right">
            <div class="te2__filters" aria-label="Filtros">
              <div class="te2__filter-group" aria-label="Prioridade">
                <button type="button" class="te2__chip" data-te2-pr="todas">Todas</button>
                <button type="button" class="te2__chip" data-te2-pr="urgente">Urgente</button>
                <button type="button" class="te2__chip" data-te2-pr="alto">Alto</button>
                <button type="button" class="te2__chip" data-te2-pr="medio">Médio</button>
                <button type="button" class="te2__chip" data-te2-pr="estavel">Estável</button>
              </div>
              <div class="te2__filter-group" aria-label="Técnico">
                <button type="button" class="te2__chip" data-te2-tech="todos">Todos técnicos</button>
                <button type="button" class="te2__chip" data-te2-tech="prompt">Filtrar técnico…</button>
              </div>
            </div>
            <button type="button" class="primary-btn te2__primary" data-te2-action="new">+ Nova ordem</button>
          </div>
        </header>

        <section class="te2__metrics" aria-label="Resumo">
          <div class="te2__metric" data-te2-metric="total"><div class="te2__metric-label">Total</div><div class="te2__metric-value">0</div></div>
          <div class="te2__metric" data-te2-metric="pend"><div class="te2__metric-label">Pendentes</div><div class="te2__metric-value">0</div></div>
          <div class="te2__metric" data-te2-metric="and"><div class="te2__metric-label">Em andamento</div><div class="te2__metric-value">0</div></div>
          <div class="te2__metric" data-te2-metric="conc"><div class="te2__metric-label">Concluídas</div><div class="te2__metric-value">0</div></div>
        </section>

        <section class="te2__board" aria-label="Kanban" data-te2-board></section>
      </div>

      <div class="modal-overlay" id="te2Modal" role="dialog" aria-modal="true" aria-hidden="true" aria-label="Nova ordem troca de etiqueta">
        <div class="modal te2-modal" role="document">
          <div class="modal-head te2-modal__head">
            <span class="modal-title">Nova ordem</span>
            <button type="button" class="close-btn" data-te2-action="close" aria-label="Fechar modal">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body te2-modal__body">
            <div class="form-group">
              <label for="te2CtoId">ID da CTO</label>
              <input class="te2-input" id="te2CtoId" type="text" placeholder="CTO-07" autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="te2Endereco">Endereço</label>
              <input class="te2-input" id="te2Endereco" type="text" placeholder="Rua - Bairro" autocomplete="off" />
              <div class="hint" id="te2EnderecoHint" style="margin-top:6px"></div>
            </div>
            <div class="te2-row2">
              <div class="form-group">
                <label for="te2Motivo">Motivo</label>
                <select class="te2-input" id="te2Motivo">
                  <option value="Danificada">Danificada</option>
                  <option value="Desbotada">Desbotada</option>
                  <option value="Padrão novo" selected>Padrão novo</option>
                </select>
              </div>
              <div class="form-group">
                <label for="te2Tecnico">Técnico</label>
                <input class="te2-input" id="te2Tecnico" type="text" placeholder="Nome do técnico" autocomplete="off" />
              </div>
            </div>
            <div class="te2-row2">
              <div class="form-group">
                <label for="te2Regiao">Região</label>
                <select class="te2-input" id="te2Regiao">
                  <option value="">Selecione a região</option>
                  <option value="Goval">Goval</option>
                  <option value="Vale do Aço">Vale do Aço</option>
                  <option value="Caratinga">Caratinga</option>
                  <option value="Backup">Backup</option>
                </select>
              </div>
              <div class="form-group">
                <label for="te2Prioridade">Prioridade</label>
                <select class="te2-input" id="te2Prioridade">
                  <option value="urgente">Urgente</option>
                  <option value="alto" selected>Alto</option>
                  <option value="medio">Médio</option>
                  <option value="estavel">Estável</option>
                </select>
              </div>
            </div>
          </div>
          <div class="modal-footer te2-modal__foot">
            <button type="button" class="ghost-btn" data-te2-action="cancel">Cancelar</button>
            <button type="button" class="primary-btn" data-te2-action="save">Adicionar</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderMetrics(root, counts) {
    const set = (k, v) => {
      const card = root.querySelector(`[data-te2-metric="${k}"]`);
      const val = card?.querySelector?.('.te2__metric-value');
      if (val) val.textContent = String(v);
    };
    set('total', counts.total);
    set('pend', counts.pend);
    set('and', counts.and);
    set('conc', counts.conc);
  }

  function cardHtml(it) {
    const kStatus = statusKey(it.status);
    const pKey = priorityKey(it.prioridade);
    return `
      <article class="te2-card te2-card--${kStatus} te2-card--p-${pKey}" draggable="true" data-te2-id="${it.id}" aria-label="${escapeHtml(it.ctoId)}">
        <div class="te2-card__body">
          <div class="te2-card__top">
            <div class="te2-card__cto">${escapeHtml(it.ctoId)}</div>
            <span class="te2-badge te2-badge--status">${escapeHtml(statusFromColKey(kStatus))}</span>
          </div>
          <div class="te2-card__addr">${escapeHtml(it.endereco)}</div>
        </div>
        <div class="te2-card__foot">
          <div class="te2-card__tech">
            <span class="te2-av" aria-hidden="true">${escapeHtml(initials(it.tecnico))}</span>
            <span>${escapeHtml(it.tecnico)}</span>
          </div>
          <span class="te2-badge te2-badge--motivo">${escapeHtml(it.motivo)}</span>
        </div>
      </article>
    `;
  }

  function renderBoard(root, items) {
    const groups = {
      pendente: items.filter(it => statusKey(it.status) === 'pendente'),
      andamento: items.filter(it => statusKey(it.status) === 'andamento'),
      concluida: items.filter(it => statusKey(it.status) === 'concluida'),
    };
    const col = (k) => {
      const collapsed = isColCollapsed(k);
      const title = escapeHtml(statusLabel(k));
      const key = escapeHtml(k);
      const body = groups[k].length ? groups[k].map(cardHtml).join('') : `<div class="te2-empty">Sem ordens</div>`;
      return `
        <section class="te2-col te2-col--${key}" data-te2-col="${key}" aria-label="Coluna ${title}">
          <header class="te2-col__head">
            <button type="button"
              class="te2-col__toggle"
              data-te2-toggle="${key}"
              aria-expanded="${collapsed ? 'false' : 'true'}"
              title="${collapsed ? 'Expandir' : 'Recolher'}"
              aria-label="${collapsed ? 'Expandir' : 'Recolher'} coluna ${title}"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div class="te2-col__title">${title}</div>
            <div class="te2-col__count">${groups[k].length}</div>
          </header>
          <div class="te2-col__body${collapsed ? ' is-collapsed' : ''}" data-te2-drop="${key}">
            <div class="te2-col__body-inner">
              ${body}
            </div>
          </div>
        </section>
      `;
    };
    root.innerHTML = `<div class="te2-grid">${col('pendente')}${col('andamento')}${col('concluida')}</div>`;
  }

  function closeModal() {
    const m = document.getElementById('te2Modal');
    if (!m) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    state.modal.open = false;
  }

  function openModal() {
    // Garante hierarquia: fecha outros overlays do app antes
    ModalService?.closeAll?.();
    const m = document.getElementById('te2Modal');
    if (!m) return;
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    state.modal.open = true;
    const cto = document.getElementById('te2CtoId');
    if (cto) cto.focus();
  }

  async function reverseGeocode(lat, lng) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&zoom=18&addressdetails=1`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Falha na consulta');
    const payload = await response.json();
    const addr = payload?.address || {};
    const rua = addr.road || addr.pedestrian || addr.residential || addr.path || '';
    const bairro = addr.suburb || addr.neighbourhood || addr.city_district || addr.quarter || '';
    return [rua, bairro].filter(Boolean).join(' - ');
  }

  function scheduleCtoAutofill() {
    clearTimeout(state.modal.ctoDebounce);
    state.modal.ctoDebounce = setTimeout(applyCtoAutofill, 300);
  }

  function applyCtoAutofill() {
    const ctoEl = document.getElementById('te2CtoId');
    const endEl = document.getElementById('te2Endereco');
    const hintEl = document.getElementById('te2EnderecoHint');
    if (!ctoEl || !endEl) return;
    const q = String(ctoEl.value || '').trim();
    if (!q) return;
    if (endEl.dataset.te2Manual === '1') return;
    if (!CtoLocationRegistry) return;
    CtoLocationRegistry.load().then(async () => {
      const hit = CtoLocationRegistry.findByQuery(q);
      if (!hit) return;
      try {
        if (hintEl) hintEl.textContent = 'Buscando endereço...';
        const txt = await reverseGeocode(hit.lat, hit.lng);
        if (txt) {
          endEl.value = txt;
          endEl.dataset.te2Manual = '0';
          if (hintEl) hintEl.textContent = 'Localização preenchida automaticamente.';
        }
      } catch {
        if (hintEl) hintEl.textContent = '';
      }
    }).catch(() => {});
  }

  function readModalForm() {
    const ctoId = String(document.getElementById('te2CtoId')?.value || '').trim() || 'CTO-00';
    const endereco = String(document.getElementById('te2Endereco')?.value || '').trim() || '—';
    const motivo = String(document.getElementById('te2Motivo')?.value || 'Padrão novo').trim() || 'Padrão novo';
    const tecnico = String(document.getElementById('te2Tecnico')?.value || '').trim() || '—';
    const regiao = String(document.getElementById('te2Regiao')?.value || '').trim();
    const prioridade = priorityKey(document.getElementById('te2Prioridade')?.value || 'alto');
    return { ctoId, endereco, motivo, tecnico, regiao, prioridade };
  }

  function saveNew() {
    const v = readModalForm();
    Store.addOpTask({
      categoria: 'troca-etiqueta',
      ctoId: v.ctoId,
      titulo: v.ctoId,
      endereco: v.endereco,
      motivo: v.motivo,
      responsavel: v.tecnico,
      regiao: v.regiao,
      prioridade: v.prioridade,
      status: 'Pendente',
    });
    ToastService?.show?.('Ordem criada.', 'success');
    closeModal();
    render();
  }

  async function ensureCoordsForWebhook(taskId) {
    const fresh0 = Store.findOpTask(taskId);
    if (!fresh0) return null;
    const ctoId = String(fresh0?.ctoId || fresh0?.titulo || '').trim();
    if (ctoId && !fresh0?.ctoId) Store.updateOpTask(taskId, { ctoId });
    let coords = String(fresh0?.coordenadas || '').trim();
    if (coords || !ctoId || !CtoLocationRegistry) return Store.findOpTask(taskId);
    try { await CtoLocationRegistry.load(); } catch { return Store.findOpTask(taskId); }
    try {
      const hit = CtoLocationRegistry.findByQuery(ctoId);
      if (hit && Number.isFinite(Number(hit.lat)) && Number.isFinite(Number(hit.lng))) {
        coords = `${Number(hit.lat)},${Number(hit.lng)}`;
        Store.updateOpTask(taskId, { coordenadas: coords });
      }
    } catch { /* ignore */ }
    return Store.findOpTask(taskId);
  }

  function setStatusFromDrop(id, colKey) {
    const before = Store.findOpTask(id);
    if (!before) return;
    const beforeKey = statusKey(before.status);
    const nextStatus = statusFromColKey(colKey);
    Store.updateOpTask(id, { status: nextStatus });

    const after = Store.findOpTask(id);
    if (!after) return;
    const afterKey = statusKey(after.status);
    const shouldSendAndamento = beforeKey === 'pendente' && afterKey === 'andamento';
    const shouldSendConcluida = beforeKey !== 'concluida' && afterKey === 'concluida';
    if (!shouldSendAndamento && !shouldSendConcluida) return;

    (async () => {
      const fresh = await ensureCoordsForWebhook(id);
      if (!fresh) return;
      WebhookService.send(shouldSendConcluida ? 'concluida' : 'andamento', fresh, null);
    })();
  }

  function paintFilterChips(root) {
    root.querySelectorAll('[data-te2-pr]').forEach((b) => {
      const k = String(b.getAttribute('data-te2-pr') || '');
      b.classList.toggle('is-active', k === state.filterPriority);
    });
    root.querySelectorAll('[data-te2-tech]').forEach((b) => {
      const k = String(b.getAttribute('data-te2-tech') || '');
      b.classList.toggle('is-active', (k === 'todos' && state.filterTech === 'todos'));
    });
    const techPrompt = root.querySelector('[data-te2-tech="prompt"]');
    if (techPrompt) {
      const active = state.filterTech !== 'todos';
      techPrompt.classList.toggle('is-active', active);
      techPrompt.textContent = active ? `Técnico: ${state.filterTech}` : 'Filtrar técnico…';
    }
  }

  function bindOnce(root) {
    if (!root || root.dataset.te2Bound === '1') return;
    root.dataset.te2Bound = '1';

    root.addEventListener('click', (e) => {
      const raw = e.target;
      const t = (raw && raw.nodeType === 3) ? raw.parentElement : raw;

      const toggle = t?.closest?.('[data-te2-toggle]');
      if (toggle) {
        e.preventDefault();
        const k = String(toggle.getAttribute('data-te2-toggle') || '');
        const nowCollapsed = toggleColCollapsed(k);
        // Atualiza DOM sem depender do re-render completo (animação suave via max-height)
        const col = toggle.closest('.te2-col');
        const body = col?.querySelector?.('.te2-col__body');
        const inner = col?.querySelector?.('.te2-col__body-inner');
        if (body && inner) {
          // mede e seta altura alvo para animação
          const h = Math.max(0, Math.round(inner.scrollHeight || 0));
          body.style.setProperty('--te2-body-h', `${h}px`);
          body.classList.toggle('is-collapsed', nowCollapsed);
        } else if (body) {
          body.classList.toggle('is-collapsed', nowCollapsed);
        }
        toggle.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
        toggle.title = nowCollapsed ? 'Expandir' : 'Recolher';
        return;
      }

      const act = t?.closest?.('[data-te2-action]')?.getAttribute?.('data-te2-action');
      if (act === 'new') { e.preventDefault(); openModal(); return; }
      if (act === 'close' || act === 'cancel') { e.preventDefault(); closeModal(); return; }
      if (act === 'save') { e.preventDefault(); saveNew(); return; }

      const prBtn = t?.closest?.('[data-te2-pr]');
      if (prBtn) {
        e.preventDefault();
        state.filterPriority = String(prBtn.getAttribute('data-te2-pr') || 'todas');
        render();
        return;
      }

      const techBtn = t?.closest?.('[data-te2-tech]');
      if (techBtn) {
        e.preventDefault();
        const k = String(techBtn.getAttribute('data-te2-tech') || 'todos');
        if (k === 'todos') state.filterTech = 'todos';
        else {
          const v = window.prompt('Filtrar por técnico (deixe vazio para todos):') ?? '';
          state.filterTech = String(v).trim() ? String(v).trim() : 'todos';
        }
        render();
        return;
      }

      // Clique no card abre edição (modal padrão do app)
      const card = t?.closest?.('[data-te2-id]');
      if (card) {
        const now = Date.now();
        if (now < state.suppressOpenUntil) return;
        const id = Number(card.getAttribute('data-te2-id') || 0);
        if (id) Controllers?.opTask?.openEditModal?.(id);
        return;
      }
    });

    // Fechar modal: click no backdrop
    document.addEventListener('pointerdown', (e) => {
      const m = document.getElementById('te2Modal');
      if (!m || !m.classList.contains('open')) return;
      if (e.target !== m) return;
      closeModal();
    }, true);

    // ESC fecha modal
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const m = document.getElementById('te2Modal');
      if (!m || !m.classList.contains('open')) return;
      e.preventDefault();
      closeModal();
    });

    // Autofill endereço pela CTO
    root.addEventListener('input', (e) => {
      const el = e.target;
      if (el?.id === 'te2Endereco') el.dataset.te2Manual = '1';
      if (el?.id === 'te2CtoId') {
        const endEl = document.getElementById('te2Endereco');
        if (endEl && endEl.dataset.te2Autofill === '1') endEl.dataset.te2Manual = '0';
        scheduleCtoAutofill();
      }
    });

    // Drag & drop (HTML5) — estável + supressão de clique fantasma
    root.addEventListener('dragstart', (e) => {
      const card = e.target?.closest?.('[data-te2-id]');
      if (!card) return;
      const id = Number(card.getAttribute('data-te2-id') || 0);
      if (!id) return;
      state.drag.id = id;
      card.classList.add('is-dragging');
      state.suppressOpenUntil = Date.now() + 450;
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(id));
      } catch { /* ignore */ }
    });

    root.addEventListener('dragend', (e) => {
      const card = e.target?.closest?.('[data-te2-id]');
      card?.classList?.remove?.('is-dragging');
      state.drag.id = 0;
      root.querySelectorAll('.te2-col').forEach(c => c.classList.remove('is-drag-over'));
    });

    root.addEventListener('dragover', (e) => {
      const zone = e.target?.closest?.('[data-te2-drop]');
      if (!zone) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.closest('.te2-col')?.classList?.add?.('is-drag-over');
    });

    root.addEventListener('dragleave', (e) => {
      const zone = e.target?.closest?.('[data-te2-drop]');
      if (!zone) return;
      const col = zone.closest('.te2-col');
      if (!col) return;
      if (e.relatedTarget && col.contains(e.relatedTarget)) return;
      col.classList.remove('is-drag-over');
    });

    root.addEventListener('drop', (e) => {
      const zone = e.target?.closest?.('[data-te2-drop]');
      if (!zone) return;
      e.preventDefault();
      zone.closest('.te2-col')?.classList?.remove?.('is-drag-over');
      let id = state.drag.id;
      if (!id) {
        try { id = Number(e.dataTransfer.getData('text/plain') || 0); } catch { id = 0; }
      }
      if (!id) return;
      const colKey = String(zone.getAttribute('data-te2-drop') || 'pendente');
      setStatusFromDrop(id, colKey);
      render();
    });
  }

  function render() {
    const root = rootEl();
    if (!root) return;
    ensureShell(root);
    bindOnce(root);

    const all = getAll();
    const filtered = applyFilters(all);
    const c = countsByStatus(filtered);

    paintFilterChips(root);
    renderMetrics(root, c);
    const board = root.querySelector('[data-te2-board]');
    renderBoard(board, filtered);
  }

  return { render };
})();

/** Base local de CTO/setores: JSONs em `src/data/` (formato `{ nome, lat, lng, aliases? }`); inclui export de viabilidade Ipatinga (KML→pontos). */
const CtoLocationRegistry = (() => {
  /** @type {Map<string, { lat: number, lng: number, nome: string }>} */
  let index = new Map();
  let loadPromise = null;

  function normalizeLabel(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/^\s*cto\s+/i, '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function ingestEntry(entry) {
    if (!entry || typeof entry !== 'object') return;
    const lat = Number(entry.lat);
    const lng = Number(entry.lng ?? entry.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const nome = String(entry.nome || '').trim();
    if (!nome) return;
    const payload = { lat, lng, nome };
    const keys = new Set([normalizeLabel(nome)]);
    if (Array.isArray(entry.aliases)) {
      entry.aliases.forEach(a => {
        const k = normalizeLabel(a);
        if (k) keys.add(k);
      });
    }
    keys.forEach(k => {
      if (k) index.set(k, payload);
    });
  }

  function resolveCtoDataJsonUrls() {
    const files = [
      'cto-locations-1.json',
      'cto-locations-2.json',
      'cto-ipatinga-viabilidade.json',
      'cto-gv-viabilidade.json',
    ];
    const cfg = typeof window !== 'undefined' ? window.APP_CONFIG : null;
    if (cfg && typeof cfg.ctoDataBase === 'string' && cfg.ctoDataBase.trim()) {
      const base = cfg.ctoDataBase.trim().replace(/\/?$/, '/');
      return files.map(f => `${base}${f}`);
    }
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      const src = scripts[i].src;
      if (src && /\/main\.js(\?|#|$)/i.test(src)) {
        const dataBase = new URL('../data/', src).href;
        return files.map(f => new URL(f, dataBase).href);
      }
    }
    const path = window.location.pathname || '/';
    let dirPath = path;
    if (!dirPath.endsWith('/')) {
      const last = (path.split('/').pop() || '');
      if (/\.[a-z0-9]+$/i.test(last)) {
        dirPath = path.replace(/\/[^/]+$/, '/');
      } else {
        dirPath = `${path}/`;
      }
    }
    const base = `${window.location.origin}${dirPath}`;
    return files.map(f => new URL(`src/data/${f}`, base).href);
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const paths = resolveCtoDataJsonUrls();
      const results = await Promise.all(
        paths.map(p =>
          fetch(p, { cache: 'no-cache' })
            .then(r => (r.ok ? r.json() : []))
            .catch(() => [])
        )
      );
      index = new Map();
      for (const data of results) {
        const arr = Array.isArray(data) ? data : [];
        arr.forEach(ingestEntry);
      }
    })();
    return loadPromise;
  }

  function findByQuery(raw) {
    if (!index.size) return null;
    const q = normalizeLabel(raw);
    if (!q) return null;
    if (index.has(q)) return index.get(q);
    let best = null;
    let bestKeyLen = -1;
    for (const [k, v] of index) {
      if (k.startsWith(q) && k.length > bestKeyLen) {
        best = v;
        bestKeyLen = k.length;
      }
    }
    if (best) return best;
    bestKeyLen = -1;
    for (const [k, v] of index) {
      if (q.startsWith(k) && k.length > bestKeyLen) {
        best = v;
        bestKeyLen = k.length;
      }
    }
    if (best) return best;
    bestKeyLen = -1;
    for (const [k, v] of index) {
      if (k.includes(q) || q.includes(k)) {
        if (k.length > bestKeyLen) {
          best = v;
          bestKeyLen = k.length;
        }
      }
    }
    return best;
  }

  return { load, findByQuery };
})();


/** Notificações do sininho: sistema (tarefas novas) + menções no chat (se habilitado). */
const ChatMentionNotifs = {
  _readInbox() {
    try {
      const r2 = localStorage.getItem(TOPBAR_NOTIF_INBOX_KEY);
      if (r2) {
        const p2 = JSON.parse(r2);
        if (p2 && Array.isArray(p2.items)) return p2;
      }
      // Fallback: inbox antigo (somente menções)
      const r = localStorage.getItem(CHAT_MENTION_INBOX_KEY);
      if (!r) return { items: [] };
      const p = JSON.parse(r);
      if (!(p && Array.isArray(p.items))) return { items: [] };
      return {
        items: p.items
          .map(it => ({
            type: 'chat_mention',
            id: Number(it?.id) || 0,
            fromKey: String(it?.fromKey || ''),
            fromName: String(it?.fromName || '—'),
            snippet: String(it?.snippet || ''),
            createdAt: String(it?.createdAt || ''),
          }))
          .filter(x => x.id > 0),
      };
    } catch {
      return { items: [] };
    }
  },
  _writeInbox(data) {
    try {
      localStorage.setItem(TOPBAR_NOTIF_INBOX_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  },
  _readLastSeenId() {
    try {
      const n = Number(localStorage.getItem(TOPBAR_NOTIF_LAST_SEEN_KEY) || 0);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  },
  _writeLastSeenId(v) {
    try { localStorage.setItem(TOPBAR_NOTIF_LAST_SEEN_KEY, String(Number(v) || 0)); } catch {}
  },
  _readHandledSet() {
    try {
      const r = localStorage.getItem(CHAT_MENTION_HANDLED_IDS_KEY);
      const a = r ? JSON.parse(r) : [];
      if (!Array.isArray(a)) return new Set();
      return new Set(a.map(Number).filter(n => Number.isFinite(n)));
    } catch {
      return new Set();
    }
  },
  _writeHandledSet(set) {
    const arr = [...set].sort((x, y) => x - y).slice(-400);
    try {
      localStorage.setItem(CHAT_MENTION_HANDLED_IDS_KEY, JSON.stringify(arr));
    } catch {
      /* ignore */
    }
  },
  /**
   * @param {object[]} messages
   * @param {string} myKey
   * @param {{ incremental?: boolean }} [opts] incremental=true só após since>0 (evita disparar no histórico ao abrir chat).
   */
  processIncomingMessages(messages, myKey, opts = {}) {
    if (opts.incremental !== true) return;
    const mk = String(myKey || '').toLowerCase();
    if (!mk || !Array.isArray(messages) || !messages.length) return;
    const handled = this._readHandledSet();
    const inbox = this._readInbox();
    let inboxChanged = false;
    for (const m of messages) {
      const id = Number(m.id);
      if (!Number.isFinite(id)) continue;
      if (handled.has(id)) continue;
      handled.add(id);
      if (String(m.userKey || '').toLowerCase() === mk) continue;
      if (!Utils.messageMentionsUser(m.body, mk)) continue;
      if (inbox.items.some(x => x.type === 'chat_mention' && x.id === id)) continue;
      inbox.items.unshift({
        type: 'chat_mention',
        id,
        fromKey: String(m.userKey || ''),
        fromName: String(m.displayName || m.userKey || '—'),
        snippet: String(m.body || '').trim().slice(0, 140),
        createdAt: String(m.createdAt || ''),
      });
      if (inbox.items.length > 40) inbox.items.length = 40;
      inboxChanged = true;
    }
    this._writeHandledSet(handled);
    if (inboxChanged) this._writeInbox(inbox);
    this.syncBellUi();
  },
  processIncomingTaskNotifications(notifs) {
    if (!Array.isArray(notifs) || !notifs.length) return;
    const inbox = this._readInbox();
    let changed = false;
    for (const n of notifs) {
      const id = Number(n?.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (inbox.items.some(x => x.type === 'task_added' && Number(x.id) === id)) continue;
      inbox.items.unshift({
        type: 'task_added',
        id,
        title: String(n?.title || 'Nova tarefa'),
        message: String(n?.message || ''),
        opCategory: String(n?.opCategory || ''),
        createdBy: String(n?.createdBy || ''),
        createdAt: String(n?.createdAt || ''),
      });
      changed = true;
    }
    if (changed) {
      if (inbox.items.length > 60) inbox.items.length = 60;
      this._writeInbox(inbox);
      this.syncBellUi();
      const panel = document.getElementById('topbarNotifPanel');
      if (panel && !panel.hidden) this.renderDropdown();
    }
  },
  markAllRead() {
    const inbox = this._readInbox();
    const maxId = inbox.items.reduce((m, it) => Math.max(m, Number(it?.id) || 0), 0);
    if (maxId > 0) this._writeLastSeenId(maxId);
    this.syncBellUi();
  },
  syncBellUi() {
    const inbox = this._readInbox();
    const lastSeen = this._readLastSeenId();
    const n = inbox.items.filter(x => Number(x?.id) > lastSeen).length;
    const badge = document.getElementById('topbarNotifBadge');
    const btn = document.getElementById('topbarNotifBtn');
    if (badge) {
      badge.textContent = n > 9 ? '9+' : String(n);
      badge.hidden = n <= 0;
    }
    if (btn) {
      btn.title = n > 0 ? `${n} notificação(ões)` : 'Notificações';
      btn.setAttribute('aria-label', n > 0 ? `Notificações: ${n}` : 'Notificações');
    }
  },
  _closePanel() {
    const panel = document.getElementById('topbarNotifPanel');
    const btn = document.getElementById('topbarNotifBtn');
    if (panel) panel.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  },
  renderDropdown() {
    const panel = document.getElementById('topbarNotifPanel');
    if (!panel) return;
    const inbox = this._readInbox();
    const items = inbox.items.slice(0, 30);
    if (!items.length) {
      panel.innerHTML = '<div class="topbar-notif-empty">Nenhuma notificação ainda.</div>';
      return;
    }
    panel.innerHTML = items
      .map(
        it => {
          if (it.type === 'task_added') {
            const title = String(it.title || 'Nova tarefa');
            const msg = String(it.message || '').trim();
            const who = String(it.createdBy || '').trim();
            const snippet = [msg, who ? `por ${who}` : ''].filter(Boolean).join(' · ').slice(0, 160);
            return `<button type="button" class="topbar-notif-item" role="menuitem" data-notif-id="${Number(it.id)}">
<span class="topbar-notif-item-title">${Utils.escapeHtml(title)}</span>
<span class="topbar-notif-item-snippet">${Utils.escapeHtml(snippet || '—')}</span>
</button>`;
          }
          // chat mention
          return `<button type="button" class="topbar-notif-item" role="menuitem" data-chat-msg-id="${Number(it.id)}">
<span class="topbar-notif-item-title">${Utils.escapeHtml(it.fromName)} mencionou você no chat</span>
<span class="topbar-notif-item-snippet">${Utils.escapeHtml(it.snippet)}</span>
</button>`;
        },
      )
      .join('');
    panel.querySelectorAll('[data-chat-msg-id]').forEach(b => {
      b.addEventListener('click', () => {
        const mid = b.dataset.chatMsgId;
        this.markAllRead();
        this._closePanel();
        UI.navigateTo('chat');
        queueMicrotask(() => {
          const row = document.querySelector(`[data-chat-id="${mid}"]`);
          row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      });
    });
    panel.querySelectorAll('[data-notif-id]').forEach(b => {
      b.addEventListener('click', () => {
        this.markAllRead();
        this._closePanel();
      });
    });
  },
  init() {
    this.syncBellUi();
    const btn = document.getElementById('topbarNotifBtn');
    const panel = document.getElementById('topbarNotifPanel');
    const wrap = document.getElementById('topbarNotifWrap');
    btn?.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = panel && !panel.hidden;
      if (isOpen) {
        this._closePanel();
        return;
      }
      this.markAllRead();
      this.renderDropdown();
      if (panel) panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    });
    document.addEventListener(
      'mousedown',
      e => {
        if (!panel || panel.hidden) return;
        if (wrap && wrap.contains(e.target)) return;
        this._closePanel();
      },
      true,
    );
  },
};

/* ─────────────────────────────────────────────────────────────
   CONTROLLERS — Lógica de interação do usuário
───────────────────────────────────────────────────────────── */
/** Seletor de emojis do chat (grupos estilo WhatsApp). */
const TEAM_CHAT_EMOJI_GROUPS = [
  {
    id: 'faces',
    label: 'Rostos',
    emojis: [
      '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '🥲', '☺️', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖',
    ],
  },
  {
    id: 'maos',
    label: 'Mãos',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '👏', '🙌', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶',
    ],
  },
  {
    id: 'amor',
    label: 'Amor',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💋', '🔥', '✨', '💫', '⭐', '🌟', '💯',
    ],
  },
  {
    id: 'objetos',
    label: 'Trabalho',
    emojis: [
      '💼', '📁', '📎', '📌', '📋', '📧', '📱', '💻', '⌚', '⏰', '📍', '🗺️', '🔔', '📣', '💡', '🔦', '🏠', '🏢', '🚗', '🚙', '🛠️', '🔧', '⚡', '🔒', '🔑', '💰', '✅', '❌', '❗', '❓', '⚠️', '🎉', '🎊', '🎁', '🏆', '🥇', '🚀',
    ],
  },
  {
    id: 'comida',
    label: 'Comida',
    emojis: [
      '🍕', '🍔', '🍟', '🌭', '🥪', '🌮', '🌯', '🥗', '🍝', '🍜', '🍲', '🍱', '🍣', '🍪', '🎂', '☕', '🍺', '🥤', '🧉',
    ],
  },
  {
    id: 'sport',
    label: 'Esporte / BR',
    emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎯', '🏁', '🇧🇷', '🥳', '👏', '💪'],
  },
];

const Controllers = {
  theme: {
    init() {
      // Tema único (escuro minimalista). Mantido por compatibilidade.
    },
  },
  auth: {
    _sessionKey: 'planner.session.v1',
    _displayNameKey: 'planner.session.displayName.v1',
    _sessionUserKey: SESSION_USER_KEY,
    _getAllowedUsers() {
      const list = window.APP_CONFIG && window.APP_CONFIG.authUsers;
      const base = Array.isArray(list) ? list : [];
      const fromConfig = base.filter(u => u && typeof u.user === 'string' && typeof u.pass === 'string');
      // Usuário de teste embutido (fallback local).
      return [...fromConfig, { user: 'teste', pass: '1123' }];
    },
    _submitting: false,
    _isAuthenticated() {
      return localStorage.getItem(this._sessionKey) === '1';
    },
    _lock() {
      document.body.classList.add('auth-locked');
      document.body.classList.remove('planner-dash-mode');
    },
    _unlock() {
      document.body.classList.remove('auth-locked');
      document.body.classList.add('planner-dash-mode');
    },
    _finishLogin(displayName, userKeyRaw = '') {
      const name = String(displayName || '').trim() || 'Usuário';
      const userKey = String(userKeyRaw || name).trim().toLowerCase();
      localStorage.setItem(this._sessionKey, '1');
      localStorage.setItem(this._displayNameKey, name);
      localStorage.setItem(this._sessionUserKey, userKey);
      this._unlock();
      this._syncSidebarUser();
      queueMicrotask(() => {
        UI.scheduleTaskIdAutofillCleanup?.();
        ChatMentionNotifs.syncBellUi();
        UI.restoreLastPageIfAuthed?.();
        if (Controllers.auth._isAuthenticated() && Store.currentPage !== 'chat') {
          Controllers.teamChat.startBackgroundNotify?.();
        }
      });
    },
    _syncSidebarUser() {
      const nameEl = document.getElementById('sidebarUserName');
      const roleEl = document.getElementById('sidebarUserRole');
      if (!nameEl || !roleEl) return;

      const logged = this._isAuthenticated();
      const storedName = (localStorage.getItem(this._displayNameKey) || '').trim();
      const display = logged ? (storedName || 'Usuário') : '—';

      nameEl.textContent = display;
      roleEl.textContent = logged ? 'Administrador' : '—';
    },
    async _login(user, pass) {
      if (!user || !pass) {
        ToastService.show('Preencha usuário e senha para entrar', 'danger');
        return false;
      }
      const normalizedUser = String(user).trim().toLowerCase();
      const normalizedPass = String(pass).trim();

      // Preferência: autenticar no servidor (quando a API remota estiver habilitada).
      if (Store.isRemoteApiEnabled()) {
        try {
          const res = await Store.loginRemote(normalizedUser, normalizedPass);
          if (res && res.ok) {
            this._finishLogin(user, normalizedUser);
            return true;
          }
        } catch {
          ToastService.show('Falha ao autenticar no servidor', 'danger');
          return false;
        }
        ToastService.show('Usuário ou senha inválidos', 'danger');
        return false;
      }

      // Fallback apenas para ambientes sem API remota (configure em `config.js` via authUsers).
      const validLocal = this._getAllowedUsers().some(
        item => item.user.toLowerCase() === normalizedUser && item.pass === normalizedPass
      );
      if (!validLocal) {
        if (!this._getAllowedUsers().length) {
          ToastService.show('Autenticação indisponível: configure `authUsers` em `config.js` ou use deploy com API.', 'danger');
        } else {
          ToastService.show('Usuário ou senha inválidos', 'danger');
        }
        return false;
      }

      this._finishLogin(user, normalizedUser);
      return true;
    },
    logout() {
      Controllers.teamChat?.stop?.();
      Controllers.teamChat?.stopBackgroundNotify?.();
      try {
        localStorage.removeItem(CHAT_MENTION_INBOX_KEY);
      } catch {
        /* ignore */
      }
      ChatMentionNotifs._closePanel();
      ChatMentionNotifs.syncBellUi();
      localStorage.removeItem(this._sessionKey);
      localStorage.removeItem(this._displayNameKey);
      localStorage.removeItem(this._sessionUserKey);
      this._lock();
      const passInput = document.getElementById('loginPass');
      if (passInput) passInput.value = '';
      this._syncSidebarUser();
      ToastService.show('Sessão encerrada', 'info');
    },
    init() {
      // Autenticação removida: sempre libera o app (sem senha).
      if (!this._isAuthenticated()) {
        this._finishLogin('Usuário', 'usuario');
      } else {
        this._unlock();
        UI.scheduleTaskIdAutofillCleanup?.();
      }
      this._syncSidebarUser();

      const form = document.getElementById('loginForm');
      form?.addEventListener('submit', async e => {
        e.preventDefault();
        if (this._submitting) return;
        this._submitting = true;
        const submitBtn = document.getElementById('loginSubmitBtn');
        const submitLabel = document.getElementById('loginSubmitLabel');
        const prevLabel = submitLabel ? submitLabel.textContent : submitBtn ? submitBtn.textContent : '';
        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.setAttribute('aria-busy', 'true');
          }
          if (submitLabel) submitLabel.textContent = 'Entrando…';
          else if (submitBtn) submitBtn.textContent = 'Entrando…';
          const user = document.getElementById('loginUser')?.value.trim();
          const pass = document.getElementById('loginPass')?.value.trim();

          const ok = await this._login(user, pass);
          if (ok) {
            ToastService.show('Login realizado com sucesso', 'success');
          }
        } finally {
          this._submitting = false;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.removeAttribute('aria-busy');
          }
          if (submitLabel) submitLabel.textContent = prevLabel || 'ACESSAR SISTEMA';
          else if (submitBtn) submitBtn.textContent = prevLabel || 'Entrar';
        }
      });

      document.getElementById('loginForgotLink')?.addEventListener('click', e => {
        e.preventDefault();
        ToastService.show('Recuperação de senha não está disponível neste painel. Fale com o administrador.', 'info');
      });
      document.getElementById('loginSsoBtn')?.addEventListener('click', () => {
        ToastService.show('SSO corporativo não configurado nesta instância.', 'info');
      });

      const verEl = document.getElementById('loginVersionLabel');
      if (verEl) {
        const b = window.APP_CONFIG && window.APP_CONFIG.appBuild ? String(window.APP_CONFIG.appBuild) : '';
        verEl.textContent = b ? 'build ' + b : 'painel interno';
      }

      document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());

      // Menu do usuário (sidebar footer): clicar abre opção de sair.
      const pill = document.getElementById('userPill');
      const menu = document.getElementById('userMenu');
      const setOpen = (open) => {
        if (!pill || !menu) return;
        menu.hidden = !open;
        pill.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      const toggle = () => {
        if (!pill || !menu) return;
        setOpen(Boolean(menu.hidden));
      };
      pill?.addEventListener('click', (e) => {
        e.preventDefault();
        toggle();
      });
      pill?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        } else if (e.key === 'Escape') {
          setOpen(false);
        }
      });
      document.addEventListener('click', (e) => {
        if (!pill || !menu) return;
        const t = e.target;
        if (menu.hidden) return;
        if (t && (pill.contains(t) || menu.contains(t))) return;
        setOpen(false);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        setOpen(false);
      });
      document.getElementById('logoutBtn')?.addEventListener('click', () => setOpen(false));
    },
  },

  /* ── Sidebar ──────────────────────────────────────────── */
  sidebar: {
    MOBILE_MQ: typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)') : { matches: false, addEventListener: () => {} },

    isMobileNav() {
      return this.MOBILE_MQ.matches;
    },

    closeMobileNav() {
      document.body.classList.remove('nav-open');
      const btn = document.getElementById('mobileNavBtn');
      if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Abrir menu');
      }
      const bd = document.getElementById('sidebarBackdrop');
      if (bd) {
        bd.hidden = true;
        bd.setAttribute('aria-hidden', 'true');
      }
    },

    openMobileNav() {
      document.body.classList.add('nav-open');
      const btn = document.getElementById('mobileNavBtn');
      if (btn) {
        btn.setAttribute('aria-expanded', 'true');
        btn.setAttribute('aria-label', 'Fechar menu');
      }
      const bd = document.getElementById('sidebarBackdrop');
      if (bd) {
        bd.hidden = false;
        bd.setAttribute('aria-hidden', 'false');
      }
    },

    toggleMobileNav() {
      if (document.body.classList.contains('nav-open')) this.closeMobileNav();
      else this.openMobileNav();
    },

    init() {
      const sidebar = document.getElementById('sidebar');
      const collapseBtn = document.getElementById('collapseBtn');

      if (collapseBtn && sidebar) {
        collapseBtn.addEventListener('click', () => {
          if (this.isMobileNav()) {
            this.closeMobileNav();
            return;
          }
          sidebar.classList.toggle('collapsed');
          Store.sidebarOpen = !sidebar.classList.contains('collapsed');
        });
      }

      document.getElementById('mobileNavBtn')?.addEventListener('click', () => this.toggleMobileNav());
      document.getElementById('sidebarBackdrop')?.addEventListener('click', () => this.closeMobileNav());

      const onViewportNavMode = e => {
        if (!e.matches && sidebar) {
          this.closeMobileNav();
          if (!Store.sidebarOpen) sidebar.classList.add('collapsed');
          else sidebar.classList.remove('collapsed');
        }
      };
      if (typeof this.MOBILE_MQ.addEventListener === 'function') {
        this.MOBILE_MQ.addEventListener('change', onViewportNavMode);
      } else if (typeof this.MOBILE_MQ.addListener === 'function') {
        this.MOBILE_MQ.addListener(onViewportNavMode);
      }

      document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
          if (this.isMobileNav()) this.closeMobileNav();
        });
      });

      document.querySelectorAll('.nav-item[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (Date.now() - SidebarNavOrder.lastDropAt < 420) return;
          UI.navigateTo(btn.dataset.page);
        });
      });
    },
  },

  /* ── Dashboard Task Modal ─────────────────────────────── */
  task: {
    _clearForm() {
      document.getElementById('f-titulo').value      = '';
      document.getElementById('f-responsavel').value = '';
      document.getElementById('f-prazo').value       = '';
      document.getElementById('f-status').value      = 'Pendente';
      document.getElementById('f-prioridade').value  = 'Alta';
    },

    _validate() {
      let titulo      = document.getElementById('f-titulo').value.trim();
      let responsavel = document.getElementById('f-responsavel').value.trim();
      if (!titulo)      titulo = 'Nova tarefa';
      if (!responsavel) responsavel = getSignedUserName();
      return {
        titulo, responsavel,
        prazo:      document.getElementById('f-prazo').value,
        status:     document.getElementById('f-status').value,
        prioridade: document.getElementById('f-prioridade').value,
      };
    },

    openNewModal() {
      Store.editingTaskId = null;
      document.getElementById('taskModalTitle').textContent = 'Nova tarefa';
      this._clearForm();
      ModalService.open('taskModal');
    },

    openEditModal(id) {
      const task = Store.findTask(id);
      if (!task) return;
      Store.editingTaskId = id;
      document.getElementById('taskModalTitle').textContent  = 'Editar tarefa';
      document.getElementById('f-titulo').value          = task.titulo;
      document.getElementById('f-responsavel').value     = task.responsavel;
      document.getElementById('f-prazo').value           = task.prazo || '';
      document.getElementById('f-status').value          = task.status;
      document.getElementById('f-prioridade').value      = task.prioridade;
      ModalService.open('taskModal');
    },

    save() {
      const data = this._validate();
      if (!data) return;

      if (Store.editingTaskId) {
        Store.updateTask(Store.editingTaskId, data);
        ToastService.show('Tarefa atualizada com sucesso', 'success');
      } else {
        Store.addTask(data);
        ToastService.show('Tarefa criada com sucesso', 'success');
      }

      ModalService.close('taskModal');
      UI.renderDashboard();
        },

    toggleDone(id, source = 'dashboard') {
      if (source === 'operacional') {
        const task = Store.findOpTask(id);
        if (!task) return;
        const wasDone = task.status === 'Concluída' || task.status === 'Finalizada';
        const nextStatus = wasDone ? 'Em andamento' : 'Concluída';
        OpTaskService.changeStatus(id, nextStatus);
        UI.refreshOperationalUi();
      } else {
        const task = Store.findTask(id);
        if (!task) return;
        const wasDone = task.status === 'Concluída';
        Store.updateTask(id, { status: wasDone ? 'Pendente' : 'Concluída' });
      }
      UI.renderDashboard();
        },

    init() {
      document.getElementById('openTaskModalBtn')?.addEventListener('click', () => this.openNewModal());
      document.getElementById('saveTaskBtn').addEventListener('click', () => this.save());
      ['closeTaskModal','cancelTaskModal'].forEach(id =>
        document.getElementById(id)?.addEventListener('click', () => ModalService.close('taskModal'))
      );

      // refreshBtn agora e gerenciado por manualRefresh() em initApp()
    },
  },

  /* ── Op Task Modal ────────────────────────────────────── */
  opTask: {
    _syncTecnicosDatalist() {
      const listEl = document.getElementById('op-tecnicos-list');
      if (!listEl) return;
      const regiaoRaw = document.getElementById('op-regiao')?.value || '';
      const techs = getTechDirectory(WebhookService._normalizeRegionKey(regiaoRaw));
      listEl.innerHTML = techs.map(t => `<option value="${t.name}"></option>`).join('');
    },
    _syncSelectedTecnicoChatId() {
      const input = document.getElementById('op-responsavel');
      const hidden = document.getElementById('op-responsavel-chatid');
      if (!input || !hidden) return;
      const key = normalizeTechName(input.value);
      const regiaoRaw = document.getElementById('op-regiao')?.value || '';
      const match = getTechDirectory(WebhookService._normalizeRegionKey(regiaoRaw)).find(t => t.key === key);
      hidden.value = match ? match.chatUserId : '';
    },
    _newTaskPreset: null,
    _globalStatusPickerOpId: 0,
    _coordsLookupTimer: null,
    _setorCtoLookupTimer: null,
    _qdpCtoLookupTimer: null,
    _isAtendimentoCategory(category = Store.currentOpCategory) {
      return category === 'atendimento-cliente';
    },
    _isOtimizacaoRedeCategory(category = Store.currentOpCategory) {
      return category === 'otimizacao-rede';
    },
    /** Ajusta src das imagens salvas no servidor para URL absoluta da API ao editar. */
    _normalizeOtimDescricaoImgSrcForEdit(html) {
      if (!html || typeof html !== 'string') return '';
      const base = String(ApiService.baseUrl || '').replace(/\/$/, '');
      if (!base) return html;
      let h = html;
      h = h.replace(/src=(["'])api\/op_task_image\.php/gi, `src=$1${base}/op_task_image.php`);
      h = h.replace(/src=(["'])op_task_image\.php/gi, `src=$1${base}/op_task_image.php`);
      return h;
    },
    /** Bloco imagem + botão remover no editor de descrição Otimização de Rede. */
    _buildOtimDescImageWrap(src) {
      const wrap = document.createElement('span');
      wrap.className = 'op-editor-img-wrap';
      wrap.contentEditable = 'false';
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'op-editor-img-remove';
      btn.setAttribute('aria-label', 'Remover imagem');
      btn.title = 'Remover imagem';
      btn.textContent = '×';
      wrap.appendChild(img);
      wrap.appendChild(btn);
      return wrap;
    },
    /** Envolve <img> soltas com o bloco que tem botão de excluir (após carregar HTML do servidor). */
    _wrapBareOtimDescricaoImages(container) {
      if (!container) return;
      const list = [...container.querySelectorAll('img')].filter(im => !im.closest('.op-editor-img-wrap'));
      list.forEach((img) => {
        const wrap = this._buildOtimDescImageWrap(img.getAttribute('src') || img.src);
        img.replaceWith(wrap);
      });
    },
    _isAtendimentoClienteCategory(category = Store.currentOpCategory) {
      return category === 'atendimento-cliente';
    },
    _isRompimentoCategory(category = Store.currentOpCategory) {
      return category === 'rompimentos';
    },
    _isTrocaPosteCategory(category = Store.currentOpCategory) {
      return category === 'troca-poste';
    },
    _toggleGroup(groupId, visible) {
      const el = document.getElementById(groupId);
      if (!el) return;
      el.style.display = visible ? '' : 'none';
    },
    _parseCoords(raw) {
      if (!raw) return null;
      const normalized = raw.replace(/\s+/g, '');
      const parts = normalized.split(',');
      if (parts.length !== 2) return null;
      const lat = Number(parts[0]);
      const lon = Number(parts[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
      return { lat, lon };
    },
    /**
     * @param {string} rawCoords
     * @param {'rompimento'|'otim'|'cemig'} ctx — alvo dos campos de endereço (padrão: rompimento / troca de poste).
     */
    async _resolveCoordsToAddress(rawCoords, ctx = 'rompimento') {
      const coords = this._parseCoords(rawCoords);
      const ids =
        ctx === 'otim'
          ? { address: 'op-otim-address', hint: 'op-otim-address-hint' }
          : ctx === 'cemig'
            ? { address: 'op-cemig-address', hint: 'op-cemig-address-hint' }
            : { address: 'op-address-readonly', hint: 'op-address-hint' };
      const addressInput = document.getElementById(ids.address);
      const hint = document.getElementById(ids.hint);
      if (!addressInput || !hint) return;

      if (!coords) {
        addressInput.value = '';
        hint.textContent = 'Coordenadas inválidas. Use o formato: latitude, longitude.';
        return;
      }

      hint.textContent = 'Buscando endereço...';
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.lat}&lon=${coords.lon}&zoom=18&addressdetails=1`;
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
          },
        });
        if (!response.ok) throw new Error('Falha na consulta');
        const payload = await response.json();
        const addr = payload?.address || {};
        const rua = addr.road || addr.pedestrian || addr.residential || addr.path || '';
        const bairro = addr.suburb || addr.neighbourhood || addr.city_district || addr.quarter || '';
        const text = [rua, bairro].filter(Boolean).join(' - ');
        if (!text) {
          addressInput.value = '';
          hint.textContent = 'Não foi possível identificar rua e bairro para essas coordenadas.';
          return;
        }
        addressInput.value = text;
        hint.textContent = 'Localização identificada automaticamente.';
      } catch {
        addressInput.value = '';
        hint.textContent = 'Não foi possível converter coordenadas em endereço agora.';
      }
    },
    _applyCtoLookupFromSetor() {
      if (!this._isRompimentoCategory()) return;
      const setorHint = document.getElementById('op-setor-cto-hint');
      const setorEl = document.getElementById('op-setor-cto');
      if (!setorEl) return;
      const q = setorEl.value.trim();
      if (!q) {
        if (setorHint) setorHint.textContent = '';
        return;
      }
      CtoLocationRegistry.load().then(() => {
        if (!this._isRompimentoCategory()) return;
        const hit = CtoLocationRegistry.findByQuery(q);
        const coordsInput = document.getElementById('op-coords');
        if (!hit) {
          if (setorHint && q.length >= 4) {
            setorHint.textContent = 'Não encontrado na base — preencha as coordenadas manualmente.';
          } else if (setorHint) setorHint.textContent = '';
          return;
        }
        if (setorHint) {
          setorHint.textContent = `Base: ${hit.nome} (ajuste as coordenadas se o rompimento for em outro ponto).`;
        }
        if (!coordsInput) return;
        coordsInput.value = `${hit.lat}, ${hit.lng}`;
        this._resolveCoordsToAddress(coordsInput.value);
      });
    },

    _applyCtoLookupFromQdpCto() {
      const existing = Store.editingOpTaskId ? Store.findOpTask(Store.editingOpTaskId) : null;
      const category = existing?.categoria
        || (this._newTaskPreset && this._newTaskPreset.category)
        || Store.currentOpCategory;
      if (category !== 'qualidade-potencia' && category !== 'manutencao-corretiva') return;

      const ctoHint = document.getElementById('op-qdp-cto-hint');
      const ctoEl = document.getElementById('op-qdp-cto');
      if (!ctoEl) return;
      const q = ctoEl.value.trim();
      if (!q) {
        if (ctoHint) ctoHint.textContent = '';
        return;
      }

      CtoLocationRegistry.load().then(() => {
        const existing2 = Store.editingOpTaskId ? Store.findOpTask(Store.editingOpTaskId) : null;
        const category2 = existing2?.categoria
          || (this._newTaskPreset && this._newTaskPreset.category)
          || Store.currentOpCategory;
        if (category2 !== 'qualidade-potencia' && category2 !== 'manutencao-corretiva') return;

        const hit = CtoLocationRegistry.findByQuery(q);
        const coordsInput = document.getElementById('op-coords');
        if (!hit) {
          if (ctoHint && q.length >= 4) ctoHint.textContent = 'Não encontrado na base — preencha as coordenadas manualmente.';
          else if (ctoHint) ctoHint.textContent = '';
          return;
        }
        if (ctoHint) ctoHint.textContent = `Base: ${hit.nome}.`;
        if (!coordsInput) return;
        coordsInput.value = `${hit.lat}, ${hit.lng}`;
        this._resolveCoordsToAddress(coordsInput.value);
      });
    },
    /**
     * Recoloca Prioridade/Região na linha padrão (evita ficarem presos nos slots do ATD ou no modo rompimento).
     */
    _restoreOpModalLayout() {
      const body = document.getElementById('opTaskModalBody');
      const priorityRow = document.getElementById('opPriorityRegionRow');
      const prioridade = document.getElementById('opPrioridadeGroup');
      const regiao = document.getElementById('opRegiaoGroup');
      const coordsRow = document.getElementById('opRompimentoCoordsRow');
      const setorGroup = document.getElementById('opRompimentoSetorGroup');
      const atdChild = document.getElementById('opAtdChildOnlyWrap');
      const mainRow = document.getElementById('opMainRow');
      const responsavel = document.getElementById('opResponsavelGroup');
      const prazoGroup = document.getElementById('opPrazoGroup');
      if (!body || !priorityRow || !prioridade || !regiao) return;
      priorityRow.appendChild(prioridade);
      priorityRow.appendChild(regiao);
      if (atdChild && atdChild.parentNode === body) atdChild.after(priorityRow);
      else body.appendChild(priorityRow);
      // Garante que o bloco de coordenadas volte para o lugar padrão (logo após o grupo de CTO do rompimento)
      if (coordsRow && body.contains(coordsRow) && setorGroup && setorGroup.parentNode === body) {
        if (coordsRow.previousElementSibling !== setorGroup) {
          setorGroup.after(coordsRow);
        }
      }
      if (mainRow && responsavel && prazoGroup) {
        mainRow.appendChild(responsavel);
        mainRow.appendChild(prazoGroup);
      }
      this._restoreOtimRedeLayout();
    },
    /** Recoloca Região e Técnico após o modo Otimização de Rede. */
    _restoreOtimRedeLayout() {
      const body = document.getElementById('opTaskModalBody');
      const tituloGroup = document.getElementById('opTituloGroup');
      const mainRow = document.getElementById('opMainRow');
      const priorityRow = document.getElementById('opPriorityRegionRow');
      const prioridade = document.getElementById('opPrioridadeGroup');
      const regiao = document.getElementById('opRegiaoGroup');
      const responsavel = document.getElementById('opResponsavelGroup');
      const prazo = document.getElementById('opPrazoGroup');
      // Volta o "Nome" para o lugar padrão (acima da linha principal), caso tenha sido movido para o bloco do OTIM.
      if (body && tituloGroup && tituloGroup.parentElement !== body) {
        if (mainRow) body.insertBefore(tituloGroup, mainRow);
        else body.insertBefore(tituloGroup, body.firstChild);
      }
      if (priorityRow && prioridade && regiao && regiao.parentElement !== priorityRow) {
        priorityRow.appendChild(prioridade);
        priorityRow.appendChild(regiao);
      }
      if (mainRow && responsavel && prazo) {
        mainRow.appendChild(responsavel);
        mainRow.appendChild(prazo);
      }
    },
    _syncRompimentoRegiaoPlacement(isRompimento) {
      const regiao = document.getElementById('opRegiaoGroup');
      const prioridade = document.getElementById('opPrioridadeGroup');
      const extraRow = document.getElementById('opRompimentoExtraRow');
      const mainRow = document.getElementById('opMainRow');
      if (!regiao || !prioridade || !extraRow || !mainRow) return;
      if (isRompimento) {
        mainRow.before(regiao);
        // FIX: prioridade deve ser o último campo no Rompimento (após "clientes afetados")
        const clientesGroup = document.getElementById('op-clientes-afetados')?.closest('.form-group');
        if (clientesGroup) clientesGroup.after(prioridade);
        else extraRow.appendChild(prioridade);
      } else {
        prioridade.after(regiao);
      }
    },
    _syncCoordsBlockUi(isRompimento, isTrocaPoste) {
      const block = document.getElementById('opRompimentoCoordsRow');
      const coordsInput = document.getElementById('op-coords');
      const hint = document.getElementById('op-address-hint');
      if (!block) return;
      const modalCat = Store.editingOpTaskId
        ? (Store.findOpTask(Store.editingOpTaskId)?.categoria || Store.currentOpCategory)
        : (this._newTaskPreset?.category || Store.currentOpCategory);
      const isQdp = modalCat === 'qualidade-potencia';
      const cLab = block.querySelector('label[for="op-coords"]');
      const aLab = block.querySelector('label[for="op-address-readonly"]');
      if (isQdp) {
        if (cLab) cLab.textContent = 'Coordenadas';
        if (aLab) aLab.textContent = 'Endereço (rua / bairro)';
        if (coordsInput) coordsInput.placeholder = 'Preenchidas pela CTO ou edite manualmente';
        if (hint && !document.getElementById('op-address-readonly')?.value) {
          hint.textContent = 'Digite a CTO para preencher coordenadas e endereço automaticamente.';
        }
        return;
      }
      if (isTrocaPoste) {
        if (cLab) cLab.textContent = 'Coordenadas';
        if (aLab) aLab.textContent = 'Endereço (rua e bairro)';
        if (coordsInput) {
          coordsInput.placeholder = 'Latitude e longitude (ex.: -19.85, -42.95)';
          coordsInput.removeAttribute('readonly');
        }
        if (hint && !document.getElementById('op-address-readonly')?.value) {
          hint.textContent = 'Digite as coordenadas; rua e bairro serão preenchidos automaticamente.';
        }
      } else if (isRompimento) {
        if (cLab) cLab.textContent = 'Coordenadas';
        if (aLab) aLab.textContent = 'Endereço (rua / bairro)';
        if (coordsInput) coordsInput.placeholder = 'Preenchidas pela CTO ou edite manualmente';
      } else {
        if (cLab) cLab.textContent = 'Coordenadas';
        if (aLab) aLab.textContent = 'Endereço (rua / bairro)';
        if (coordsInput) coordsInput.placeholder = 'Preenchidas pela CTO ou edite manualmente';
      }
    },
    _syncCategorySpecificFields(category = Store.currentOpCategory) {
      const isAtendimento = this._isAtendimentoCategory(category);
      const isOtimRede = this._isOtimizacaoRedeCategory(category);
      const isCemig = category === 'certificacao-cemig';
      const isQdp = category === 'qualidade-potencia' || category === 'manutencao-corretiva';
      const isRompimento = this._isRompimentoCategory(category);
      const isTrocaPoste = this._isTrocaPosteCategory(category);
      const modalTitle = document.getElementById('opTaskModalTitle');
      const modalWrap = document.getElementById('opTaskModal');

      this._restoreOpModalLayout();
      this._syncRompimentoRegiaoPlacement(isRompimento);
      if (modalWrap) {
        modalWrap.classList.toggle('rompimento-mode', isRompimento);
        modalWrap.classList.toggle('troca-poste-mode', isTrocaPoste);
        modalWrap.classList.toggle('otim-rede-mode', isOtimRede);
        modalWrap.classList.toggle('cemig-mode', isCemig);
        modalWrap.classList.toggle('qdp-mode', isQdp);
      }

      this._toggleGroup('opTituloGroup', !isRompimento && !isTrocaPoste && !isCemig && !isQdp);
      // Rompimento: permitir definir data de vencimento (antes era fixo em "hoje")
      this._toggleGroup('opPrazoGroup', !isOtimRede);
      this._toggleGroup('opPriorityRegionRow', !isRompimento && !isOtimRede && !isCemig && !isQdp);

      this._toggleGroup('opParentConfig', isAtendimento);
      this._toggleGroup('opRompimentoCoordsRow', isRompimento || isTrocaPoste || isQdp);
      this._toggleGroup('opRompimentoExtraRow', isRompimento);
      this._toggleGroup('opRompimentoSetorGroup', isRompimento);
      this._toggleGroup('opQdpWrap', isQdp);

      this._syncCoordsBlockUi(isRompimento, isTrocaPoste);

      // FIX: em Rompimentos/Troca de poste o título é automático; remover campo da experiência do usuário.
      const tituloInput = document.getElementById('op-titulo');
      if (tituloInput) {
        if (isRompimento || isTrocaPoste) {
          tituloInput.value = '';
          tituloInput.disabled = true;
          tituloInput.setAttribute('aria-hidden', 'true');
          tituloInput.setAttribute('tabindex', '-1');
        } else {
          tituloInput.disabled = false;
          tituloInput.removeAttribute('aria-hidden');
          tituloInput.removeAttribute('tabindex');
        }
      }

      // Troca de poste: região + prioridade acima do técnico; região à esquerda (primeira).
      if (isTrocaPoste) {
        const priorityRow = document.getElementById('opPriorityRegionRow');
        const prioridade = document.getElementById('opPrioridadeGroup');
        const regiao = document.getElementById('opRegiaoGroup');
        const mainRow = document.getElementById('opMainRow');
        if (priorityRow && prioridade && regiao) {
          priorityRow.appendChild(regiao);
          priorityRow.appendChild(prioridade);
        }
        if (mainRow && priorityRow) mainRow.before(priorityRow);
      }

      const tituloLab = document.querySelector('label[for="op-titulo"]');
      const tecRespLab = document.querySelector('label[for="op-responsavel"]');
      const prazoLab = document.querySelector('label[for="op-prazo"]');
      if (isQdp) {
        this._toggleGroup('opMainRow', false);
        this._toggleGroup('opOtimRedeWrap', false);
        this._toggleGroup('opCemigWrap', false);
        const qdpWrap = document.getElementById('opQdpWrap');
        const qdpCliLab = document.querySelector('label[for="op-qdp-cliente"]');
        const regSlot = document.getElementById('opQdpRegiaoSlot');
        const tecSlot = document.getElementById('opQdpTecSlot');
        const prazoSlot = document.getElementById('opQdpPrazoSlot');
        const prioSlot = document.getElementById('opQdpPrioridadeSlot');
        const coordsSlot = document.getElementById('opQdpCoordsSlot');
        const coordsRow = document.getElementById('opRompimentoCoordsRow');
        const regiao = document.getElementById('opRegiaoGroup');
        const respG = document.getElementById('opResponsavelGroup');
        const prazoG = document.getElementById('opPrazoGroup');
        const prioG = document.getElementById('opPrioridadeGroup');
        if (regSlot && regiao) regSlot.appendChild(regiao);
        if (tecSlot && respG) tecSlot.appendChild(respG);
        if (prazoSlot && prazoG) prazoSlot.appendChild(prazoG);
        if (prioSlot && prioG) prioSlot.appendChild(prioG);
        if (coordsSlot && coordsRow) coordsSlot.appendChild(coordsRow);
        if (tecRespLab) tecRespLab.textContent = 'Técnico';
        if (prazoLab) prazoLab.textContent = 'Data de vencimento';
        if (qdpCliLab) qdpCliLab.textContent = category === 'manutencao-corretiva' ? 'Manutenção' : 'Nome/usuário do cliente';
        if (qdpWrap) qdpWrap.style.display = '';
      } else if (isOtimRede) {
        this._toggleGroup('opMainRow', false);
        this._toggleGroup('opOtimRedeWrap', true);
        this._toggleGroup('opCemigWrap', false);
        if (tituloLab) tituloLab.textContent = 'Nome';
        if (tecRespLab) tecRespLab.textContent = 'Técnico';
        const regSlot = document.getElementById('opOtimRegiaoSlot');
        const tecSlot = document.getElementById('opOtimTecSlot');
        const regiao = document.getElementById('opRegiaoGroup');
        const respG = document.getElementById('opResponsavelGroup');
        if (regSlot && regiao) regSlot.appendChild(regiao);
        if (tecSlot && respG) tecSlot.appendChild(respG);

        // Organização do formulário OTIM: Nome + Região/Técnico no topo, depois Protocolo/OS, depois Descrição (com imagens).
        const otimWrap = document.getElementById('opOtimRedeWrap');
        const tituloGroup = document.getElementById('opTituloGroup');
        const protoRow = otimWrap?.querySelector?.('.form-row');
        const regTecRow = document.getElementById('opOtimRegiaoTecRow');
        if (otimWrap && tituloGroup) {
          // move "Nome" para dentro do bloco dedicado da Otimização de Rede
          if (tituloGroup.parentElement !== otimWrap) {
            otimWrap.insertBefore(tituloGroup, otimWrap.firstChild);
          }
        }
        if (otimWrap && regTecRow && protoRow) {
          // garante que Região/Técnico apareçam logo após o Nome
          if (regTecRow.parentElement === otimWrap && regTecRow !== protoRow.nextSibling) {
            otimWrap.insertBefore(regTecRow, protoRow);
          }
        }
      } else if (isCemig) {
        this._toggleGroup('opMainRow', false);
        this._toggleGroup('opOtimRedeWrap', false);
        this._toggleGroup('opCemigWrap', true);
        if (tecRespLab) tecRespLab.textContent = 'Técnico';
        if (prazoLab) prazoLab.textContent = 'Data final para conclusão';
        const regSlot = document.getElementById('opCemigRegiaoSlot');
        const tecSlot = document.getElementById('opCemigTecSlot');
        const prazoSlot = document.getElementById('opCemigPrazoSlot');
        const regiao = document.getElementById('opRegiaoGroup');
        const respG = document.getElementById('opResponsavelGroup');
        const prazoG = document.getElementById('opPrazoGroup');
        if (regSlot && regiao) regSlot.appendChild(regiao);
        if (tecSlot && respG) tecSlot.appendChild(respG);
        if (prazoSlot && prazoG) prazoSlot.appendChild(prazoG);
      } else {
        this._toggleGroup('opOtimRedeWrap', false);
        this._toggleGroup('opCemigWrap', false);
        this._toggleGroup('opMainRow', true);
        if (tituloLab) tituloLab.textContent = 'Nome da tarefa';
        if (tecRespLab) tecRespLab.textContent = 'Técnico responsável';
        if (prazoLab) prazoLab.textContent = 'Data de vencimento';
      }

      if (modalTitle && !Store.editingOpTaskId) {
        if (isRompimento) modalTitle.textContent = 'Nova tarefa de rompimento';
        else if (isTrocaPoste) modalTitle.textContent = 'Nova troca de poste';
        else if (category === 'certificacao-cemig') modalTitle.textContent = 'Nova certificação Cemig';
        else if (isOtimRede) modalTitle.textContent = 'Nova otimização de rede';
        else if (isQdp) modalTitle.textContent = 'Nova qualidade de potência';
        else if (category === 'atendimento-cliente') {
          const hid = document.getElementById('op-parent-task-id');
          const isListaPai = !String(hid?.value || '').trim();
          modalTitle.textContent = isListaPai ? 'Nova lista de atendimento' : 'Nova ordem de serviço';
        } else modalTitle.textContent = 'Nova tarefa';
      }

      if (isRompimento) {
        const prioridade = document.getElementById('op-prioridade');
        if (prioridade) prioridade.value = 'Alta';
      }
    },
    _syncAtendimentoKindFields() {
      const modalCat = Store.editingOpTaskId
        ? (Store.findOpTask(Store.editingOpTaskId)?.categoria || Store.currentOpCategory)
        : (this._newTaskPreset?.category || Store.currentOpCategory);
      if (modalCat === 'otimizacao-rede') {
        const atdWrap = document.getElementById('opAtdParentOnlyWrap');
        const atdChildWrap = document.getElementById('opAtdChildOnlyWrap');
        const mainRow = document.getElementById('opMainRow');
        const priorityRow = document.getElementById('opPriorityRegionRow');
        const prazoInput = document.getElementById('op-prazo');
        const prazoGroup = prazoInput?.closest('.form-group');
        const responsavelInput = document.getElementById('op-responsavel');
        const regiaoSelect = document.getElementById('op-regiao');
        if (atdWrap) atdWrap.style.display = 'none';
        if (atdChildWrap) atdChildWrap.style.display = 'none';
        if (mainRow) mainRow.style.display = 'none';
        if (priorityRow) priorityRow.style.display = 'none';
        if (prazoGroup) prazoGroup.style.display = 'none';
        if (responsavelInput) responsavelInput.disabled = false;
        if (regiaoSelect) regiaoSelect.disabled = false;
        this._syncTecnicosDatalist();
        this._syncSelectedTecnicoChatId();
        return;
      }

      if (modalCat === 'certificacao-cemig') {
        const atdWrap = document.getElementById('opAtdParentOnlyWrap');
        const atdChildWrap = document.getElementById('opAtdChildOnlyWrap');
        const mainRow = document.getElementById('opMainRow');
        const priorityRow = document.getElementById('opPriorityRegionRow');
        const responsavelInput = document.getElementById('op-responsavel');
        const regiaoSelect = document.getElementById('op-regiao');
        const prazoInput = document.getElementById('op-prazo');
        const prazoGroup = prazoInput?.closest('.form-group');
        const regiaoGroup = regiaoSelect?.closest('.form-group');
        const responsavelGroup = responsavelInput?.closest('.form-group');
        if (atdWrap) atdWrap.style.display = 'none';
        if (atdChildWrap) atdChildWrap.style.display = 'none';
        if (mainRow) mainRow.style.display = 'none';
        if (priorityRow) priorityRow.style.display = 'none';
        [responsavelGroup, prazoGroup, regiaoGroup].forEach((g) => {
          if (g) g.style.display = '';
        });
        if (responsavelInput) responsavelInput.disabled = false;
        if (regiaoSelect) regiaoSelect.disabled = false;
        if (prazoInput) prazoInput.disabled = false;
        this._syncTecnicosDatalist();
        this._syncSelectedTecnicoChatId();
        return;
      }

      const hiddenParent = document.getElementById('op-parent-task-id');
      const isParent = !String(hiddenParent?.value || '').trim();
      const responsavelInput = document.getElementById('op-responsavel');
      const prazoInput = document.getElementById('op-prazo');
      const regiaoSelect = document.getElementById('op-regiao');
      const responsavelGroup = responsavelInput?.closest('.form-group');
      const prazoGroup = prazoInput?.closest('.form-group');
      const regiaoGroup = regiaoSelect?.closest('.form-group');
      // Importante: usar modalCat (preset / tarefa em edição), não só Store.currentOpCategory
      // (na página Atendimento a aba Tarefas pode estar com outra categoria selecionada).
      const isRompimento = modalCat === 'rompimentos';
      const isTrocaPoste = modalCat === 'troca-poste';
      const isAtdCliente = modalCat === 'atendimento-cliente';
      const atdWrap = document.getElementById('opAtdParentOnlyWrap');
      const atdChildWrap = document.getElementById('opAtdChildOnlyWrap');
      const regiaoSlot = document.getElementById('opAtdRegiaoSlot');
      const prioridadeSlot = document.getElementById('opAtdPrioridadeSlot');
      const childTecnicoSlot = document.getElementById('opAtdChildTecnicoSlot');
      const childRegiaoSlot = document.getElementById('opAtdChildRegiaoSlot');
      const priorityRow = document.getElementById('opPriorityRegionRow');
      const mainRow = document.getElementById('opMainRow');

      [responsavelGroup, prazoGroup, regiaoGroup].forEach(group => {
        if (!group) return;
        if (isRompimento || isTrocaPoste) {
          group.style.display = '';
          return;
        }
        group.style.display = isParent ? '' : 'none';
      });

      const atdParentOnly = isAtdCliente && isParent && !isRompimento && !isTrocaPoste;
      const atdChildOnly = isAtdCliente && !isParent && !isRompimento && !isTrocaPoste;

      // Atendimento ao Cliente (pai): deixa apenas os campos essenciais do formulário.
      if (atdWrap) atdWrap.style.display = atdParentOnly ? '' : 'none';
      if (atdChildWrap) atdChildWrap.style.display = atdChildOnly ? '' : 'none';
      if (mainRow) mainRow.style.display = atdParentOnly ? 'none' : '';
      if (priorityRow) priorityRow.style.display = atdParentOnly ? 'none' : '';

      if (atdParentOnly) {
        const prioridadeGroup = document.getElementById('opPrioridadeGroup');
        if (prioridadeSlot && prioridadeGroup && prioridadeGroup.parentElement !== prioridadeSlot) {
          prioridadeSlot.appendChild(prioridadeGroup);
        }
        if (regiaoSlot && regiaoGroup && regiaoGroup.parentElement !== regiaoSlot) {
          regiaoSlot.appendChild(regiaoGroup);
        }
        const parentTecSlotI = document.getElementById('opAtdParentTecnicoSlot');
        const tecGroupParent = responsavelInput?.closest('.form-group');
        if (parentTecSlotI && tecGroupParent && tecGroupParent.parentElement !== parentTecSlotI) {
          parentTecSlotI.appendChild(tecGroupParent);
        }
      }

      if (atdChildOnly) {
        // Para filha: mostra técnico + região no bloco próprio e esconde prazo/prioridade
        const tecGroup = responsavelInput?.closest('.form-group');
        if (childTecnicoSlot && tecGroup && tecGroup.parentElement !== childTecnicoSlot) {
          childTecnicoSlot.appendChild(tecGroup);
        }
        if (childRegiaoSlot && regiaoGroup && regiaoGroup.parentElement !== childRegiaoSlot) {
          childRegiaoSlot.appendChild(regiaoGroup);
        }
        if (tecGroup) tecGroup.style.display = '';
        if (regiaoGroup) regiaoGroup.style.display = '';
        if (prazoGroup) prazoGroup.style.display = 'none';
        if (priorityRow) priorityRow.style.display = 'none';
      } else {
        // Fora do modo filha, reexibe prazo se estiver aplicável (categorySpecificFields pode esconder depois)
        if (prazoGroup && !isRompimento) prazoGroup.style.display = '';
      }

      if (responsavelInput) {
        // Atendimento: técnico é opcional (pai e filha).
        if (atdParentOnly || atdChildOnly) responsavelInput.disabled = false;
        else if (isRompimento || isTrocaPoste) {
          const hasRegion = Boolean(String(regiaoSelect?.value || '').trim());
          responsavelInput.disabled = !hasRegion;
          if (!hasRegion) {
            responsavelInput.value = '';
            const hiddenChat = document.getElementById('op-responsavel-chatid');
            if (hiddenChat) hiddenChat.value = '';
          }
        } else {
          responsavelInput.disabled = !isParent;
        }
      }
      if (prazoInput) {
        prazoInput.disabled = atdParentOnly ? true : (isRompimento ? true : !isParent);
      }
      if (regiaoSelect) {
        if (atdChildOnly) regiaoSelect.disabled = false;
        else if (isTrocaPoste || isRompimento) regiaoSelect.disabled = false;
        else regiaoSelect.disabled = !isParent;
      }

      const tituloGrp = document.getElementById('opTituloGroup');
      const tituloLabS = document.querySelector('label[for="op-titulo"]');
      if (tituloGrp) {
        if (atdParentOnly || atdChildOnly) tituloGrp.style.display = 'none';
        else {
          tituloGrp.style.display = '';
          if (tituloLabS && isAtdCliente) tituloLabS.textContent = 'Nome da tarefa';
        }
      }

      this._syncTecnicosDatalist();
      this._syncSelectedTecnicoChatId();
    },

    _syncParentHidden(currentTask = null) {
      const hidden = document.getElementById('op-parent-task-id');
      if (!hidden) return;
      if (currentTask && currentTask.parentTaskId) hidden.value = String(currentTask.parentTaskId);
      else if (this._newTaskPreset?.parentTaskId) hidden.value = String(this._newTaskPreset.parentTaskId);
      else hidden.value = '';
    },
    _closeAtdStatusDropdown() {
      const dd = document.getElementById('opAtdStatusDropdown');
      if (!dd) return;
      dd.hidden = true;
      delete dd.dataset.childId;
    },
    _positionAtdStatusDropdown(anchorEl) {
      const dd = document.getElementById('opAtdStatusDropdown');
      if (!dd || !anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const ddW = dd.offsetWidth || 188;
      const ddH = dd.offsetHeight || 120;
      let left = rect.left;
      let top = rect.bottom + 6;
      if (left + ddW > window.innerWidth - 8) left = window.innerWidth - ddW - 8;
      if (left < 8) left = 8;
      if (top + ddH > window.innerHeight - 8) top = rect.top - ddH - 6;
      if (top < 8) top = 8;
      dd.style.left = `${Math.round(left)}px`;
      dd.style.top = `${Math.round(top)}px`;
    },

    _closeGlobalStatusPicker() {
      const dd = document.getElementById('opGlobalStatusPicker');
      if (dd) dd.hidden = true;
      this._globalStatusPickerOpId = 0;
    },

    _positionGlobalStatusPicker(anchorEl) {
      const dd = document.getElementById('opGlobalStatusPicker');
      if (!dd || !anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const ddW = dd.offsetWidth || 200;
      const ddH = dd.offsetHeight || 260;
      let left = rect.right - ddW;
      if (left < 8) left = Math.max(8, rect.left);
      if (left + ddW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - ddW - 8);
      let top = rect.bottom + 6;
      if (top + ddH > window.innerHeight - 8) top = Math.max(8, rect.top - ddH - 6);
      if (top < 8) top = 8;
      dd.style.left = `${Math.round(left)}px`;
      dd.style.top = `${Math.round(top)}px`;
    },

    openGlobalStatusPicker(anchorEl, opTaskId) {
      const id = Number(opTaskId);
      if (!Number.isFinite(id) || id <= 0) return;
      const task = Store.findOpTask(id);
      if (!task || !anchorEl) return;
      const dd = document.getElementById('opGlobalStatusPicker');
      const panel = document.getElementById('opGlobalStatusPickerPanel');
      if (!dd || !panel) return;

      const atdDd = document.getElementById('opAtdStatusDropdown');
      if (atdDd && !atdDd.hidden) this._closeAtdStatusDropdown();

      if (!dd.hidden && this._globalStatusPickerOpId === id) {
        this._closeGlobalStatusPicker();
        return;
      }
      this._closeGlobalStatusPicker();

      const statuses = OpTaskService.getStatusPicklist(task);
      const cur = String(task.status || '').trim();
      panel.innerHTML = statuses.map(s => {
        const isCur = s === cur;
        return `<button type="button" class="atd-status-dropdown-item${isCur ? ' is-current-op-status' : ''}" role="menuitem" data-op-pick-status="${Utils.escapeHtmlAttr(s)}">${Utils.escapeHtml(s)}${isCur ? ' \u2713' : ''}</button>`;
      }).join('');

      this._globalStatusPickerOpId = id;
      dd.hidden = false;
      requestAnimationFrame(() => {
        this._positionGlobalStatusPicker(anchorEl);
        panel.querySelector('.atd-status-dropdown-item')?.focus?.();
      });
    },

    _resetAtdChildrenListExpand() {
      const wrap = document.getElementById('opAtdChildrenWrap');
      const btn = document.getElementById('opAtdChildrenExpandBtn');
      if (wrap) wrap.classList.remove('is-expanded');
      if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.title = 'Expandir lista';
        btn.setAttribute('aria-label', 'Expandir lista de ordens de serviço vinculadas');
      }
    },
    _refreshAtdChildrenList() {
      const childrenWrap = document.getElementById('opAtdChildrenWrap');
      const childrenList = document.getElementById('opAtdChildrenList');
      if (!childrenWrap || !childrenList) return;

      const category = this._newTaskPreset?.category || Store.currentOpCategory;
      const parentHidden = document.getElementById('op-parent-task-id');
      const parentIdRaw = parentHidden?.value || '';
      const parentId = parentIdRaw ? Number(parentIdRaw) : null;

      const isAtdChild = this._isAtendimentoCategory(category) && !!parentId;
      if (!isAtdChild) {
        this._resetAtdChildrenListExpand();
        childrenWrap.style.display = 'none';
        childrenList.innerHTML = '';
        return;
      }

      const all = Store.getOpTasks()
        .filter(t => t.categoria === 'atendimento-cliente' && Number(t.parentTaskId) === parentId);
      if (!all.length) {
        childrenList.innerHTML = '<li><span class="atd-modal-children-meta">Nenhuma ordem de serviço vinculada ainda.</span></li>';
      } else {
        childrenList.innerHTML = all.map((t) => {
          const title = Utils.escapeHtml(t.titulo || t.ordemServico || '(sem título)');
          const who = Utils.escapeHtml(t.responsavel || '—');
          const prazo = t.prazo ? Utils.formatDate(t.prazo) : 'sem prazo';
          const status = Utils.escapeHtml(t.status || 'Pendente');
          const isDone = ['Concluída', 'Finalizada', 'Finalizado'].includes(t.status);
          const isEmAndamento = !isDone && t.status === 'Em andamento';
          const liClass = [isDone && 'done', isEmAndamento && 'atd-in-progress'].filter(Boolean).join(' ');
          return `
            <li class="${liClass}">
              <label class="atd-modal-children-check">
                <input type="checkbox" data-child-id="${t.id}" ${isDone ? 'checked' : ''} />
              </label>
              <div class="atd-modal-children-main">
                <span class="atd-modal-children-title">${title}</span>
                <span class="atd-modal-children-meta">${who} · ${prazo}</span>
              </div>
              <button type="button" class="atd-book-ico" data-atd-edit-child="${t.id}" title="Editar ordem de serviço" aria-label="Editar ordem de serviço">✎</button>
              ${Utils.taskCopyProtocolButtonHtml(Utils.opTaskDisplayRef(t), 'task-copy-id-btn--sm')}
              <span class="atd-modal-children-status-row">
                ${Utils.opTaskStatusPickerButtonHtml(t.id, 'op-status-picker-btn--sm')}
                <span class="atd-modal-children-status">${status}</span>
              </span>
            </li>
          `;
        }).join('');
      }
      childrenWrap.style.display = '';

      if (!childrenList.dataset.boundStatusClick) {
        childrenList.addEventListener('click', (e) => {
          const editBtn = e.target.closest?.('[data-atd-edit-child]');
          if (editBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = Number(editBtn.dataset.atdEditChild || 0);
            if (!id) return;
            Controllers.opTask.openEditModal(id);
            return;
          }

          const wrap = e.target.closest('.atd-modal-children-check');
          const input = wrap?.querySelector('input[type=checkbox]');
          if (!input) return;
          e.preventDefault();
          e.stopPropagation();
          const id = Number(input.dataset.childId || 0);
          if (!id) return;
          const dd = document.getElementById('opAtdStatusDropdown');
          if (!dd) return;
          if (!dd.hidden && dd.dataset.childId === String(id)) {
            this._closeAtdStatusDropdown();
            return;
          }
          dd.dataset.childId = String(id);
          dd.hidden = false;
          requestAnimationFrame(() => {
            this._positionAtdStatusDropdown(input);
            document.getElementById('opAtdStatusDropdown')?.querySelector('.atd-status-dropdown-item')?.focus();
          });
        });
        childrenList.dataset.boundStatusClick = '1';
      }
    },
    _regionTaskPrefix(regionRaw = '') {
      const norm = WebhookService._normalizeRegionKey(regionRaw);
      if (norm === 'GOVAL') return 'GV';
      if (norm === 'VALE_DO_ACO') return 'VL';
      if (norm === 'CARATINGA') return 'CA';
      return '';
    },
    _nextTaskCode(category = Store.currentOpCategory, regionRaw = '') {
      const prefixMap = {
        'rompimentos': 'ROM',
        'troca-poste': 'POS',
        'atendimento-cliente': 'ATD',
        'otimizacao-rede': 'NET',
        'certificacao-cemig': 'CEM',
        'correcao-atenuacao': 'ATN',
        'troca-etiqueta': 'ETQ',
        'qualidade-potencia': 'QDP',
        'manutencao-corretiva': 'MCR',
      };
      const prefix = prefixMap[category] || 'ROM';
      const count = Store.getOpTasks()
        .filter(t => t.categoria === category)
        .filter(t => !(category === 'atendimento-cliente' && t.parentTaskId))
        .length + 1;
      const regionPrefix = this._regionTaskPrefix(regionRaw);
      const base = `${prefix}-${String(count).padStart(4, '0')}`;
      return regionPrefix ? `${regionPrefix}-${base}` : base;
    },

    _fallbackTaskCode(task) {
      const prefixMap = {
        'rompimentos': 'ROM',
        'troca-poste': 'POS',
        'atendimento-cliente': 'ATD',
        'otimizacao-rede': 'NET',
        'certificacao-cemig': 'CEM',
        'correcao-atenuacao': 'ATN',
        'troca-etiqueta': 'ETQ',
        'qualidade-potencia': 'QDP',
        'manutencao-corretiva': 'MCR',
      };
      const prefix = prefixMap[task.categoria] || 'ROM';
      const regionPrefix = this._regionTaskPrefix(task?.regiao);
      const base = `${prefix}-${String(task.id).padStart(4, '0')}`;
      return regionPrefix ? `${regionPrefix}-${base}` : base;
    },

    _removeOpAtdSubprocessoLegacyOption(subp) {
      if (!subp) return;
      subp.querySelector?.('option[data-atd-subprocesso-legacy]')?.remove();
    },

    /** Preenche o select de subprocesso (atendimento pai); mantém texto legado como opção extra ao editar. */
    _setOpAtdSubprocessoSelectValue(raw) {
      const subp = document.getElementById('op-atd-subprocesso');
      if (!subp) return;
      if (subp.tagName !== 'SELECT') {
        subp.value = String(raw || '').trim();
        return;
      }
      this._removeOpAtdSubprocessoLegacyOption(subp);
      const v = String(raw || '').trim();
      if (!v) {
        subp.value = '';
        return;
      }
      const low = v.toLowerCase();
      let canon = '';
      if (low === 'prazo' || v === 'Prazo') canon = 'Prazo';
      else if (low === 'abordagem predial' || v === 'Abordagem predial') canon = 'Abordagem predial';
      if (canon) {
        subp.value = canon;
        return;
      }
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      opt.setAttribute('data-atd-subprocesso-legacy', '1');
      subp.appendChild(opt);
      subp.value = v;
    },

    _clearForm(preset = {}) {
      const category = preset.category || Store.currentOpCategory;
      document.getElementById('op-titulo').value      = '';
      document.getElementById('op-responsavel').value = '';
      const chatIdHidden = document.getElementById('op-responsavel-chatid');
      if (chatIdHidden) chatIdHidden.value = '';
      const proto = document.getElementById('op-atd-protocolo');
      const dataEnt = document.getElementById('op-atd-data-entrada');
      const dataInst = document.getElementById('op-atd-data-instalacao');
      const os = document.getElementById('op-atd-ordem-servico');
      const desc = document.getElementById('op-atd-descricao');
      const nomeCliClear = document.getElementById('op-atd-nome-cliente');
      if (nomeCliClear) nomeCliClear.value = '';
      const childTituloClear = document.getElementById('op-atd-child-titulo');
      if (childTituloClear) childTituloClear.value = '';
      if (proto) proto.value = '';
      if (dataEnt) dataEnt.value = '';
      this._setOpAtdSubprocessoSelectValue('');
      if (dataInst) dataInst.value = '';
      if (os) os.value = '';
      if (desc) desc.value = '';
      const opOtimProto = document.getElementById('op-otim-protocolo');
      const opOtimOs = document.getElementById('op-otim-ordem-servico');
      if (opOtimProto) opOtimProto.value = '';
      if (opOtimOs) opOtimOs.value = '';
      const otimDescClear = document.getElementById('op-otim-descricao');
      if (otimDescClear) otimDescClear.innerHTML = '';
      const cemigProtoClear = document.getElementById('op-cemig-protocolo');
      if (cemigProtoClear) cemigProtoClear.value = '';
      const cemigDescClear = document.getElementById('op-cemig-descricao');
      if (cemigDescClear) cemigDescClear.innerHTML = '';
      document.getElementById('op-prazo').value       = '';
      {
        const catClear = preset.category || Store.currentOpCategory;
        document.getElementById('op-prioridade').value = catClear === 'atendimento-cliente' ? '' : 'Alta';
      }
      document.getElementById('op-regiao').value      = '';
      const coordsInput = document.getElementById('op-coords');
      const addressInput = document.getElementById('op-address-readonly');
      const addressHint = document.getElementById('op-address-hint');
      if (coordsInput) coordsInput.value = '';
      if (addressInput) addressInput.value = '';
      if (addressHint) addressHint.textContent = 'Aguardando CTO ou coordenadas.';
      const otimGeoC = document.getElementById('op-otim-coords');
      const otimGeoA = document.getElementById('op-otim-address');
      const otimGeoH = document.getElementById('op-otim-address-hint');
      if (otimGeoC) otimGeoC.value = '';
      if (otimGeoA) otimGeoA.value = '';
      if (otimGeoH) otimGeoH.textContent = 'Opcional. Informe lat, long — o endereço é buscado automaticamente.';
      const cemigGeoC = document.getElementById('op-cemig-coords');
      const cemigGeoA = document.getElementById('op-cemig-address');
      const cemigGeoH = document.getElementById('op-cemig-address-hint');
      if (cemigGeoC) cemigGeoC.value = '';
      if (cemigGeoA) cemigGeoA.value = '';
      if (cemigGeoH) cemigGeoH.textContent = 'Opcional. Informe lat, long — o endereço é buscado automaticamente.';
      const setorCtoInput = document.getElementById('op-setor-cto');
      if (setorCtoInput) setorCtoInput.value = '';
      const setorHint = document.getElementById('op-setor-cto-hint');
      if (setorHint) setorHint.textContent = '';
      const parentHidden = document.getElementById('op-parent-task-id');
      if (parentHidden) parentHidden.value = preset.parentTaskId ? String(preset.parentTaskId) : '';
      const qdpCli = document.getElementById('op-qdp-cliente');
      const qdpOs = document.getElementById('op-qdp-ordem-servico');
      const qdpCto = document.getElementById('op-qdp-cto');
      if (qdpCli) qdpCli.value = '';
      if (qdpOs) qdpOs.value = '';
      if (qdpCto) qdpCto.value = '';
      // Se estiver criando subtarefa, puxa a região do pai por padrão.
      if (preset.parentTaskId) {
        const parent = Store.findOpTask(Number(preset.parentTaskId));
        if (parent?.regiao) document.getElementById('op-regiao').value = parent.regiao;
      }
      this._refreshAtdChildrenList();
      this._syncParentHidden(null);
      this._syncCategorySpecificFields(category);
      this._newTaskPreset = { ...preset };
      this._syncAtendimentoKindFields();
      const modalCopyBtnClear = document.getElementById('opTaskModalCopyIdBtn');
      if (modalCopyBtnClear) {
        modalCopyBtnClear.hidden = true;
        delete modalCopyBtnClear.dataset.copyProtocol;
      }
    },

    _validate() {
      let titulo      = document.getElementById('op-titulo').value.trim();
      let responsavel = document.getElementById('op-responsavel').value.trim();
      const responsavelChatId = document.getElementById('op-responsavel-chatid')?.value?.trim() || '';
      let prazo       = document.getElementById('op-prazo').value;
      const existing = Store.editingOpTaskId ? Store.findOpTask(Store.editingOpTaskId) : null;
      const category = existing?.categoria
        || (this._newTaskPreset && this._newTaskPreset.category)
        || Store.currentOpCategory;
      const parentTaskIdRaw = document.getElementById('op-parent-task-id')?.value || '';
      const parentTaskId = parentTaskIdRaw ? Number(parentTaskIdRaw) : (existing?.parentTaskId ? Number(existing.parentTaskId) : null);
      const isParentTask = !parentTaskId;
      let regiao = document.getElementById('op-regiao').value;
      let protocoloRaw = document.getElementById('op-atd-protocolo')?.value?.trim() || '';
      let dataEntradaRaw = document.getElementById('op-atd-data-entrada')?.value || '';
      let subProcessoRaw = document.getElementById('op-atd-subprocesso')?.value?.trim() || '';
      const dataInstalacaoRaw = document.getElementById('op-atd-data-instalacao')?.value || '';
      const ordemServicoRaw = document.getElementById('op-atd-ordem-servico')?.value?.trim() || '';
      let descAtdRaw = document.getElementById('op-atd-descricao')?.value?.trim() || '';
      const nomeClienteRaw = document.getElementById('op-atd-nome-cliente')?.value?.trim() || '';
      const qdpClienteRaw = document.getElementById('op-qdp-cliente')?.value?.trim() || '';
      const qdpOrdemServicoRaw = document.getElementById('op-qdp-ordem-servico')?.value?.trim() || '';
      const qdpCtoRaw = document.getElementById('op-qdp-cto')?.value?.trim() || '';
      const selectedParent = parentTaskId ? Store.findOpTask(parentTaskId) : null;
      const codeRegion = isParentTask ? regiao : (selectedParent?.regiao || regiao);
      const taskCode = existing?.taskCode || this._nextTaskCode(category, codeRegion);
      let coordsRaw = document.getElementById('op-coords')?.value.trim() || '';
      let autoAddress = document.getElementById('op-address-readonly')?.value.trim() || '';
      const otimGeoCoords = document.getElementById('op-otim-coords')?.value.trim() || '';
      const otimGeoAddress = document.getElementById('op-otim-address')?.value.trim() || '';
      const cemigGeoCoords = document.getElementById('op-cemig-coords')?.value.trim() || '';
      const cemigGeoAddress = document.getElementById('op-cemig-address')?.value.trim() || '';
      let clientesAfetadosRaw = document.getElementById('op-clientes-afetados')?.value.trim() || '';
      let setorCto = document.getElementById('op-setor-cto')?.value.trim() || '';
      const isRompimento = this._isRompimentoCategory(category);
      const isTrocaPoste = this._isTrocaPosteCategory(category);
      const isOtimRede = category === 'otimizacao-rede';
      const isCemig = category === 'certificacao-cemig';
      const isQdp = category === 'qualidade-potencia' || category === 'manutencao-corretiva';
      const otimProto = document.getElementById('op-otim-protocolo')?.value?.trim() || '';
      const otimOs = document.getElementById('op-otim-ordem-servico')?.value?.trim() || '';
      const cemigProto = document.getElementById('op-cemig-protocolo')?.value?.trim() || '';
      const isAtdParentOnly = this._isAtendimentoClienteCategory(category) && isParentTask && !isRompimento;
      const isAtdChildOnly = this._isAtendimentoClienteCategory(category) && !isParentTask && !isRompimento;

      if (isAtdChildOnly) {
        titulo = document.getElementById('op-atd-child-titulo')?.value?.trim() || '';
      }

      if (!isRompimento && !isTrocaPoste && !isCemig && !isOtimRede && !isQdp && !isAtdParentOnly && !isAtdChildOnly && !titulo) titulo = 'Sem título';
      if (!isAtdParentOnly && !isAtdChildOnly && isParentTask && !responsavel && !isOtimRede && !isCemig) responsavel = getSignedUserName();
      if (!isAtdParentOnly && !isAtdChildOnly && !isRompimento && !isOtimRede && !isCemig && isParentTask && !prazo) prazo = Utils.todayIso();
      const prioridadeEl = document.getElementById('op-prioridade');
      if (!isRompimento && !isOtimRede && !isCemig && !isAtdParentOnly && !isAtdChildOnly && prioridadeEl && !prioridadeEl.value) {
        prioridadeEl.value = 'Média';
      }
      if (isParentTask && !regiao && !isOtimRede && !isCemig && !this._isAtendimentoClienteCategory(category)) regiao = 'N/D';
      if (isRompimento && !setorCto) setorCto = 'N/D';
      if ((isRompimento || isTrocaPoste) && !coordsRaw) coordsRaw = '0, 0';
      if ((isRompimento || isTrocaPoste) && !autoAddress) autoAddress = 'Local não informado (teste)';
      if (isRompimento && (!clientesAfetadosRaw || !/^\d+$/.test(clientesAfetadosRaw) || Number(clientesAfetadosRaw) <= 0)) {
        clientesAfetadosRaw = '1';
      }
      if (this._isAtendimentoCategory(category) && !isParentTask && !selectedParent) {
        ToastService.show('Subtarefa inválida: crie pela tarefa pai', 'danger');
        return null;
      }

      const presetStatus = this._newTaskPreset?.status || null;
      const defaultStatus = category === 'certificacao-cemig'
        ? (presetStatus || 'Pendente')
        : this._isAtendimentoCategory(category)
          ? (isParentTask ? (presetStatus || 'Backlog') : 'A iniciar')
          : 'Criada';
      const currentStatus = existing?.status || defaultStatus;
      const normalizedStatus = (!isParentTask && this._isAtendimentoCategory(category) && (currentStatus === 'Backlog' || currentStatus === 'Criada'))
        ? 'A iniciar'
        : currentStatus;
      let finalTitulo = '';
      if (isRompimento) {
        finalTitulo = `Rompimento - ${autoAddress}`;
      } else if (isTrocaPoste) {
        finalTitulo = `Troca de poste - ${autoAddress}`;
      } else if (isCemig) {
        finalTitulo = cemigProto ? `Cemig — ${cemigProto}` : (existing?.titulo || 'Certificação Cemig');
      } else if (isOtimRede) {
        finalTitulo =
          titulo.trim() ||
          (otimProto && otimOs ? `${otimProto} · ${otimOs}` : (otimProto || otimOs || existing?.titulo || 'Otimização de rede'));
      } else if (isQdp) {
        finalTitulo = titulo.trim() || qdpClienteRaw || qdpOrdemServicoRaw || existing?.titulo || 'Qualidade de potência';
      } else if (isAtdParentOnly) {
        finalTitulo = nomeClienteRaw || titulo.trim() || existing?.titulo || '';
      } else if (isAtdChildOnly) {
        finalTitulo = titulo.trim() || existing?.titulo || '';
      } else {
        finalTitulo = titulo;
      }
      const finalPrazo = isRompimento
        ? (prazo || existing?.prazo || Utils.todayIso())
        : isOtimRede
          ? (prazo || Utils.todayIso())
          : isCemig
            ? (prazo || existing?.prazo || Utils.todayIso())
            : (isAtdParentOnly
              ? (prazo || existing?.prazo || '')
              : (isParentTask ? prazo : (selectedParent?.prazo || existing?.prazo || '')));
      const prioPick = prioridadeEl ? prioridadeEl.value : '';
      const finalPrioridade = isRompimento ? 'Alta' : (isOtimRede || isCemig ? 'Média' : prioPick);
      const finalDescricaoMeta = isRompimento
        ? `Coordenadas: ${coordsRaw} | Local: ${autoAddress}`
        : (isTrocaPoste ? '' : '');
      const setorField = isRompimento
        ? setorCto
        : (isQdp ? qdpCtoRaw : (isParentTask ? regiao : (selectedParent?.setor || selectedParent?.regiao || existing?.setor || '')));
      const regiaoField = isRompimento
        ? regiao
        : (isParentTask ? regiao : (selectedParent?.regiao || selectedParent?.setor || existing?.regiao || ''));
      const finalResponsavelChatId = isParentTask
        ? responsavelChatId
        : (selectedParent?.responsavelChatId || existing?.responsavelChatId || '');
      const finalProtocolo = isOtimRede
        ? otimProto
        : isCemig
          ? cemigProto
          : (this._isAtendimentoClienteCategory(category) && isParentTask)
            ? protocoloRaw
            : (selectedParent?.protocolo || existing?.protocolo || '');
      const finalDataEntrada = (this._isAtendimentoClienteCategory(category) && isParentTask)
        ? dataEntradaRaw
        : (selectedParent?.dataEntrada || existing?.dataEntrada || '');
      const finalSubProcesso = (this._isAtendimentoClienteCategory(category) && isParentTask)
        ? subProcessoRaw
        : (selectedParent?.subProcesso || existing?.subProcesso || '');
      const finalDataInstalacao = (this._isAtendimentoClienteCategory(category) && isParentTask)
        ? dataInstalacaoRaw
        : (selectedParent?.dataInstalacao || existing?.dataInstalacao || '');
      const finalOrdemServico = isOtimRede
        ? otimOs
        : (isQdp
          ? qdpOrdemServicoRaw
          : (this._isAtendimentoClienteCategory(category) && !isParentTask)
          ? ordemServicoRaw
          : (selectedParent?.ordemServico || existing?.ordemServico || ''));
      const finalResponsavel = isAtdParentOnly
        ? (responsavel || existing?.responsavel || '')
        : (isOtimRede || isCemig
          ? (responsavel || existing?.responsavel || '')
          : (isParentTask
            ? responsavel
            : (isAtdChildOnly
              ? (responsavel || existing?.responsavel || selectedParent?.responsavel || '')
              : (responsavel || selectedParent?.responsavel || existing?.responsavel || getSignedUserName()))));
      const otimDescEl = document.getElementById('op-otim-descricao');
      const otimDescHtml = isOtimRede && otimDescEl ? String(otimDescEl.innerHTML || '').trim() : '';
      const cemigDescEl = document.getElementById('op-cemig-descricao');
      const cemigDescHtml = isCemig && cemigDescEl ? String(cemigDescEl.innerHTML || '').trim() : '';
      const finalDescricaoAtd = isOtimRede
        ? otimDescHtml
        : isCemig
          ? cemigDescHtml
          : (this._isAtendimentoClienteCategory(category) && !isParentTask)
            ? descAtdRaw
            : finalDescricaoMeta;
      const payload = {
        taskCode,
        titulo: finalTitulo,
        responsavel: finalResponsavel,
        responsavelChatId: finalResponsavelChatId,
        setor: setorField,
        regiao: regiaoField,
        protocolo: finalProtocolo,
        dataEntrada: finalDataEntrada,
        subProcesso: finalSubProcesso,
        dataInstalacao: finalDataInstalacao,
        ordemServico: finalOrdemServico,
        clientesAfetados: isRompimento ? clientesAfetadosRaw : '',
        coordenadas: (isRompimento || isTrocaPoste || isQdp) ? coordsRaw : (isOtimRede ? otimGeoCoords : (isCemig ? cemigGeoCoords : '')),
        localizacaoTexto: (isRompimento || isTrocaPoste || isQdp) ? autoAddress : (isOtimRede ? otimGeoAddress : (isCemig ? cemigGeoAddress : '')),
        categoria:  category,
        prazo: finalPrazo,
        prioridade: finalPrioridade,
        descricao:  finalDescricaoAtd,
        status:     normalizedStatus,
        isParentTask: this._isAtendimentoCategory(category) ? isParentTask : false,
        parentTaskId: this._isAtendimentoCategory(category) ? (isParentTask ? null : parentTaskId) : null,
      };
      if (isAtdParentOnly) payload.nomeCliente = nomeClienteRaw;
      if (isQdp) payload.nomeCliente = qdpClienteRaw;
      return payload;
    },

    openNewModal(preset = {}) {
      Store.editingOpTaskId = null;
      if (preset.category) Store.currentOpCategory = preset.category;
      const isAtd = this._isAtendimentoCategory(preset.category);
      document.getElementById('opTaskModalTitle').textContent =
        isAtd && preset.parentTaskId ? 'Nova ordem de serviço'
          : isAtd && !preset.parentTaskId ? 'Nova lista de atendimento'
            : 'Nova tarefa';
      const deleteBtn = document.getElementById('deleteOpTaskBtn');
      if (deleteBtn) deleteBtn.style.display = 'none';
      this._clearForm(preset);
      const hidden = document.getElementById('op-parent-task-id');
      if (hidden) hidden.value = preset.parentTaskId ? String(preset.parentTaskId) : '';
      this._syncAtendimentoKindFields();
      ModalService.open('opTaskModal');
    },

    openEditModal(id) {
      const task = Store.findOpTask(id);
      if (!task) return;
      Store.editingOpTaskId = id;
      document.getElementById('opTaskModalTitle').textContent =
        task.categoria === 'troca-poste' ? 'Editar troca de poste'
          : task.categoria === 'certificacao-cemig' ? 'Editar certificação Cemig'
            : task.categoria === 'otimizacao-rede' ? 'Editar otimização de rede'
              : task.categoria === 'qualidade-potencia' ? 'Editar qualidade de potência'
                : 'Editar tarefa';
      document.getElementById('op-titulo').value =
        task.categoria === 'troca-poste' || task.categoria === 'certificacao-cemig' || task.categoria === 'atendimento-cliente'
          ? ''
          : task.titulo;
      document.getElementById('op-responsavel').value = task.responsavel;
      const chatIdHidden = document.getElementById('op-responsavel-chatid');
      if (chatIdHidden) chatIdHidden.value = String(task.responsavelChatId || '').trim();
      const proto = document.getElementById('op-atd-protocolo');
      const dataEnt = document.getElementById('op-atd-data-entrada');
      const dataInst = document.getElementById('op-atd-data-instalacao');
      const os = document.getElementById('op-atd-ordem-servico');
      const desc = document.getElementById('op-atd-descricao');
      const opOtimProto = document.getElementById('op-otim-protocolo');
      const opOtimOs = document.getElementById('op-otim-ordem-servico');
      const opCemigProto = document.getElementById('op-cemig-protocolo');
      if (task.categoria === 'otimizacao-rede') {
        if (opOtimProto) opOtimProto.value = String(task.protocolo || '').trim();
        if (opOtimOs) opOtimOs.value = String(task.ordemServico || '').trim();
        const otimDescEdit = document.getElementById('op-otim-descricao');
        if (otimDescEdit) {
          otimDescEdit.innerHTML = this._normalizeOtimDescricaoImgSrcForEdit(String(task.descricao || ''));
          this._wrapBareOtimDescricaoImages(otimDescEdit);
        }
        if (proto) proto.value = '';
        if (os) os.value = '';
        if (dataEnt) dataEnt.value = '';
        this._setOpAtdSubprocessoSelectValue('');
        if (dataInst) dataInst.value = '';
        if (desc) desc.value = '';
        const childTituloOtim = document.getElementById('op-atd-child-titulo');
        if (childTituloOtim) childTituloOtim.value = '';
        if (opCemigProto) opCemigProto.value = '';
        const cemigDescOtim = document.getElementById('op-cemig-descricao');
        if (cemigDescOtim) cemigDescOtim.innerHTML = '';
      } else if (task.categoria === 'certificacao-cemig') {
        let p = String(task.protocolo || '').trim();
        if (!p && task.titulo) {
          const m = String(task.titulo).match(/^Cemig\s*[—-]\s*(.+)$/);
          if (m) p = m[1].trim();
        }
        if (opCemigProto) opCemigProto.value = p;
        if (proto) proto.value = '';
        if (os) os.value = '';
        if (dataEnt) dataEnt.value = '';
        this._setOpAtdSubprocessoSelectValue('');
        if (dataInst) dataInst.value = '';
        if (desc) desc.value = '';
        const childTituloCem = document.getElementById('op-atd-child-titulo');
        if (childTituloCem) childTituloCem.value = '';
        if (opOtimProto) opOtimProto.value = '';
        if (opOtimOs) opOtimOs.value = '';
        const otimDescC = document.getElementById('op-otim-descricao');
        if (otimDescC) otimDescC.innerHTML = '';
        const cemigDescEdit = document.getElementById('op-cemig-descricao');
        if (cemigDescEdit) {
          cemigDescEdit.innerHTML = this._normalizeOtimDescricaoImgSrcForEdit(String(task.descricao || ''));
          this._wrapBareOtimDescricaoImages(cemigDescEdit);
        }
      } else if (task.categoria === 'qualidade-potencia') {
        const qdpCli = document.getElementById('op-qdp-cliente');
        const qdpOs = document.getElementById('op-qdp-ordem-servico');
        const qdpCto = document.getElementById('op-qdp-cto');
        if (qdpCli) qdpCli.value = String(task.nomeCliente || '').trim();
        if (qdpOs) qdpOs.value = String(task.ordemServico || '').trim();
        if (qdpCto) qdpCto.value = String(task.setor || '').trim();
        if (proto) proto.value = '';
        if (os) os.value = '';
        if (dataEnt) dataEnt.value = '';
        this._setOpAtdSubprocessoSelectValue('');
        if (dataInst) dataInst.value = '';
        if (desc) desc.value = '';
        const childTituloQdp = document.getElementById('op-atd-child-titulo');
        if (childTituloQdp) childTituloQdp.value = '';
        if (opOtimProto) opOtimProto.value = '';
        if (opOtimOs) opOtimOs.value = '';
        if (opCemigProto) opCemigProto.value = '';
        const otimDescQdp = document.getElementById('op-otim-descricao');
        if (otimDescQdp) otimDescQdp.innerHTML = '';
        const cemigDescQdp = document.getElementById('op-cemig-descricao');
        if (cemigDescQdp) cemigDescQdp.innerHTML = '';
      } else {
        const nomeCliEdit = document.getElementById('op-atd-nome-cliente');
        if (nomeCliEdit) {
          const nc = String(task.nomeCliente || '').trim();
          nomeCliEdit.value = nc || (task.categoria === 'atendimento-cliente' && !task.parentTaskId ? String(task.titulo || '').trim() : '');
        }
        if (proto) proto.value = String(task.protocolo || '').trim();
        if (dataEnt) dataEnt.value = String(task.dataEntrada || '').trim();
        this._setOpAtdSubprocessoSelectValue(task.subProcesso);
        if (dataInst) dataInst.value = String(task.dataInstalacao || '').trim();
        if (os) os.value = String(task.ordemServico || '').trim();
        if (desc) desc.value = String(task.descricao || '').trim();
        const childTituloEdit = document.getElementById('op-atd-child-titulo');
        if (childTituloEdit) {
          childTituloEdit.value =
            task.categoria === 'atendimento-cliente' && task.parentTaskId ? String(task.titulo || '').trim() : '';
        }
        if (opOtimProto) opOtimProto.value = '';
        if (opOtimOs) opOtimOs.value = '';
        if (opCemigProto) opCemigProto.value = '';
        const otimDescOther = document.getElementById('op-otim-descricao');
        if (otimDescOther) otimDescOther.innerHTML = '';
        const cemigDescOther = document.getElementById('op-cemig-descricao');
        if (cemigDescOther) cemigDescOther.innerHTML = '';
      }
      document.getElementById('op-prazo').value       = task.prazo || '';
      document.getElementById('op-prioridade').value  = task.prioridade || '';
      document.getElementById('op-regiao').value      = task.regiao || '';
      const hidden = document.getElementById('op-parent-task-id');
      if (hidden) hidden.value = task.parentTaskId ? String(task.parentTaskId) : '';
      const setorCtoInput = document.getElementById('op-setor-cto');
      if (setorCtoInput) setorCtoInput.value = (task.setor || '').toUpperCase();
      const setorHintEdit = document.getElementById('op-setor-cto-hint');
      if (setorHintEdit) setorHintEdit.textContent = '';
      const coordsInput = document.getElementById('op-coords');
      const addressInput = document.getElementById('op-address-readonly');
      const addressHint = document.getElementById('op-address-hint');
      const clientesInput = document.getElementById('op-clientes-afetados');
      const isRompOuTrocaCoord = task.categoria === 'rompimentos' || task.categoria === 'troca-poste';
      if (coordsInput) coordsInput.value = isRompOuTrocaCoord ? (task.coordenadas || '') : '';
      if (addressInput) addressInput.value = isRompOuTrocaCoord ? (task.localizacaoTexto || '') : '';
      const geoHintOpcional = 'Opcional. Informe lat, long — o endereço é buscado automaticamente.';
      const otimGC = document.getElementById('op-otim-coords');
      const otimGA = document.getElementById('op-otim-address');
      const otimGH = document.getElementById('op-otim-address-hint');
      const cemigGC = document.getElementById('op-cemig-coords');
      const cemigGA = document.getElementById('op-cemig-address');
      const cemigGH = document.getElementById('op-cemig-address-hint');
      if (task.categoria === 'otimizacao-rede') {
        if (otimGC) otimGC.value = String(task.coordenadas || '').trim();
        if (otimGA) otimGA.value = String(task.localizacaoTexto || '').trim();
        if (otimGH) otimGH.textContent = task.coordenadas ? 'Localização salva na tarefa.' : geoHintOpcional;
        if (cemigGC) cemigGC.value = '';
        if (cemigGA) cemigGA.value = '';
        if (cemigGH) cemigGH.textContent = geoHintOpcional;
      } else if (task.categoria === 'certificacao-cemig') {
        if (cemigGC) cemigGC.value = String(task.coordenadas || '').trim();
        if (cemigGA) cemigGA.value = String(task.localizacaoTexto || '').trim();
        if (cemigGH) cemigGH.textContent = task.coordenadas ? 'Localização salva na tarefa.' : geoHintOpcional;
        if (otimGC) otimGC.value = '';
        if (otimGA) otimGA.value = '';
        if (otimGH) otimGH.textContent = geoHintOpcional;
      } else {
        if (otimGC) otimGC.value = '';
        if (otimGA) otimGA.value = '';
        if (otimGH) otimGH.textContent = geoHintOpcional;
        if (cemigGC) cemigGC.value = '';
        if (cemigGA) cemigGA.value = '';
        if (cemigGH) cemigGH.textContent = geoHintOpcional;
      }
      if (task.categoria === 'troca-poste' && coordsInput && !String(task.coordenadas || '').trim()) {
        const descStr = String(task.descricao || '');
        const m = descStr.match(/Coordenadas:\s*([^|]+)\s*\|\s*Local:\s*(.+)/);
        if (m) {
          coordsInput.value = m[1].trim();
          if (addressInput) addressInput.value = m[2].trim();
        } else {
          const p = this._parseCoords(String(task.titulo || '').trim());
          if (p) coordsInput.value = `${p.lat}, ${p.lon}`;
        }
      }
      if (task.categoria === 'troca-poste' && coordsInput?.value && addressInput && !addressInput.value.trim()) {
        this._resolveCoordsToAddress(coordsInput.value);
      }
      if (addressHint) {
        if (task.categoria === 'troca-poste') {
          const ok = Boolean(String(addressInput?.value || '').trim());
          addressHint.textContent = ok ? 'Localização carregada.' : 'Informe coordenadas para preencher rua e bairro.';
        } else {
          addressHint.textContent = String(addressInput?.value || '').trim()
            ? 'Localização carregada.'
            : 'Aguardando CTO ou coordenadas.';
        }
      }
      if (clientesInput) clientesInput.value = task.clientesAfetados || '';
      const deleteBtn = document.getElementById('deleteOpTaskBtn');
      if (deleteBtn) deleteBtn.style.display = 'inline-flex';
      this._newTaskPreset = null;
      this._syncCategorySpecificFields(task.categoria);
      this._syncAtendimentoKindFields();
      this._syncParentHidden(task);
      ModalService.open('opTaskModal');
      if (task.categoria === 'otimizacao-rede' && otimGC?.value?.trim() && !otimGA?.value?.trim()) {
        void this._resolveCoordsToAddress(otimGC.value, 'otim');
      }
      if (task.categoria === 'certificacao-cemig' && cemigGC?.value?.trim() && !cemigGA?.value?.trim()) {
        void this._resolveCoordsToAddress(cemigGC.value, 'cemig');
      }
      const modalCopyBtn = document.getElementById('opTaskModalCopyIdBtn');
      if (modalCopyBtn) {
        const cref = Utils.opTaskDisplayRef(task);
        modalCopyBtn.hidden = !cref;
        if (cref) modalCopyBtn.dataset.copyProtocol = cref;
        else delete modalCopyBtn.dataset.copyProtocol;
      }
    },

    deleteTask(id = Store.editingOpTaskId, options = {}) {
      const task = Store.findOpTask(id);
      if (!task) return;
      const hasChildren = Store.getOpTasks().some(t => Number(t.parentTaskId) === Number(id));
      const cascade = options.cascade ?? hasChildren;
      const message = cascade
        ? 'Excluir esta tarefa pai e todas as subtarefas vinculadas?'
        : 'Excluir esta tarefa?';
      if (!window.confirm(message)) return;

      const removed = Store.removeOpTask(id, { cascade });
      if (!removed) {
        ToastService.show('Não foi possível excluir a tarefa', 'danger');
        return;
      }
      ToastService.show('Tarefa excluída com sucesso', 'success');
      ModalService.close('opTaskModal');
      UI.refreshOperationalUi();
      UI.renderDashboard();
        },

    save() {
      const data = this._validate();
      if (!data) return;
      let savedTask = null;

      if (Store.editingOpTaskId) {
        savedTask = Store.updateOpTask(Store.editingOpTaskId, data);
        ToastService.show('Tarefa atualizada com sucesso', 'success');
      } else {
        savedTask = Store.addOpTask(data);
        ToastService.show('Tarefa criada com sucesso', 'success');
        // Se já nasce em um status notificável, dispara webhook imediatamente.
        const event = OpTaskService._statusToEvent[data.status];
        if (event && savedTask) {
          const categoryLabel = OpTaskService._categoryLabels[savedTask.categoria] || savedTask.categoria;
          WebhookService.send(event, savedTask, categoryLabel);
        }
      }

      // Atualiza categoria ativa para a que foi salva (aba Tarefas)
      if (Store.currentPage === 'tarefas') Store.currentOpCategory = data.categoria;

      const isAtdChild =
        data.categoria === 'atendimento-cliente' &&
        !!data.parentTaskId &&
        !Store.editingOpTaskId;

      if (isAtdChild) {
        // Mantém modal aberto para cadastrar várias OS na sequência.
        this.openNewModal({
          category: 'atendimento-cliente',
          parentTaskId: data.parentTaskId,
          status: 'Backlog',
        });
      } else {
        ModalService.close('opTaskModal');
      }

      UI.refreshOperationalUi();
        },

    init() {
      this._syncTecnicosDatalist();
      document.getElementById('op-responsavel')?.addEventListener('input', () => this._syncSelectedTecnicoChatId());
      document.getElementById('op-regiao')?.addEventListener('change', () => {
        this._syncTecnicosDatalist();
        this._syncSelectedTecnicoChatId();
        this._syncAtendimentoKindFields();
      });

      ['op-otim-descricao', 'op-cemig-descricao'].forEach((richId) => {
        const box = document.getElementById(richId);
        if (!box) return;
        box.addEventListener('click', (e) => {
          const rm = e.target.closest('.op-editor-img-remove');
          if (!rm || !box.contains(rm)) return;
          e.preventDefault();
          e.stopPropagation();
          rm.closest('.op-editor-img-wrap')?.remove();
        });
        box.addEventListener('paste', (e) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          for (const it of items) {
            if (it.kind === 'file' && it.type.startsWith('image/')) {
              e.preventDefault();
              const file = it.getAsFile();
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const wrap = this._buildOtimDescImageWrap(reader.result);
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0 && box.contains(sel.anchorNode)) {
                  const rng = sel.getRangeAt(0);
                  rng.deleteContents();
                  rng.insertNode(wrap);
                  rng.setStartAfter(wrap);
                  rng.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(rng);
                } else {
                  box.appendChild(wrap);
                }
              };
              reader.readAsDataURL(file);
              return;
            }
          }
        });
      });

      document.getElementById('openOpTaskModalBtn').addEventListener('click', () => this.openNewModal());
      document.getElementById('openAtendimentoTaskModalBtn')?.addEventListener('click', () => {
        this.openNewModal({ kind: 'parent', category: 'atendimento-cliente', status: 'Backlog' });
      });
      document.getElementById('saveOpTaskBtn').addEventListener('click', () => this.save());

      const gPanel = document.getElementById('opGlobalStatusPickerPanel');
      if (gPanel && !gPanel.dataset.boundPick) {
        gPanel.addEventListener('click', (e) => {
          const pickBtn = e.target.closest('[data-op-pick-status]');
          if (!pickBtn || !gPanel.contains(pickBtn)) return;
          e.preventDefault();
          e.stopPropagation();
          const tid = Controllers.opTask._globalStatusPickerOpId;
          const nextStatus = pickBtn.getAttribute('data-op-pick-status');
          if (!tid || !nextStatus) return;
          const curTask = Store.findOpTask(tid);
          if (curTask && String(curTask.status) === nextStatus) {
            Controllers.opTask._closeGlobalStatusPicker();
            return;
          }
          UI._lastMovedOpTask = { id: tid, status: nextStatus };
          OpTaskService.changeStatus(tid, nextStatus);
          UI.refreshOperationalUi();
          UI.renderDashboard();
                  setTimeout(() => { UI._lastMovedOpTask = null; }, 520);
          Controllers.opTask._refreshAtdChildrenList();
          Controllers.opTask._closeGlobalStatusPicker();
          ToastService.show(`Status: ${nextStatus}`, 'success');
        });
        gPanel.dataset.boundPick = '1';
      }

      document.addEventListener(
        'click',
        e => {
          const anchor = e.target.closest('[data-op-status-picker]');
          if (!anchor) return;
          e.preventDefault();
          e.stopPropagation();
          const oid = Number(anchor.dataset.opStatusPicker);
          if (!oid) return;
          Controllers.opTask.openGlobalStatusPicker(anchor, oid);
        },
        true,
      );

      document.addEventListener(
        'pointerdown',
        e => {
          const dd = document.getElementById('opGlobalStatusPicker');
          if (!dd || dd.hidden) return;
          if (dd.contains(e.target)) return;
          if (e.target.closest('[data-op-status-picker]')) return;
          Controllers.opTask._closeGlobalStatusPicker();
        },
        true,
      );

      document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const dd = document.getElementById('opGlobalStatusPicker');
        if (!dd || dd.hidden) return;
        Controllers.opTask._closeGlobalStatusPicker();
      });

      // Dropdown de status para ordens vinculadas (lista no modal de atendimento).
      const statusDd = document.getElementById('opAtdStatusDropdown');
      if (statusDd) {
        const closeDropdown = () => this._closeAtdStatusDropdown();
        statusDd.querySelectorAll('.atd-status-dropdown-item').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = Number(statusDd.dataset.childId || 0);
            if (!id) return;
            const nextStatus = btn.dataset.status;
            if (!nextStatus) return;
            OpTaskService.changeStatus(id, nextStatus);
            this._refreshAtdChildrenList();
                      UI.refreshOperationalUi();
            closeDropdown();
          });
        });
        document.addEventListener('click', (e) => {
          if (statusDd.hidden) return;
          if (statusDd.contains(e.target)) return;
          closeDropdown();
        });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && !statusDd.hidden) closeDropdown();
        });
      }
      document.getElementById('deleteOpTaskBtn')?.addEventListener('click', () => this.deleteTask());
      // Segurança: se alguém abrir modal de subtarefa sem pai, limpa o hidden.
      document.getElementById('op-parent-task-id')?.addEventListener('input', () => this._syncAtendimentoKindFields());
      document.getElementById('op-coords')?.addEventListener('input', e => {
        const value = e.target.value;
        clearTimeout(this._coordsLookupTimer);
        this._coordsLookupTimer = setTimeout(() => this._resolveCoordsToAddress(value), 500);
      });
      document.getElementById('op-coords')?.addEventListener('blur', e => {
        this._resolveCoordsToAddress(e.target.value);
      });
      document.getElementById('op-otim-coords')?.addEventListener('input', e => {
        const value = e.target.value;
        clearTimeout(this._otimCoordsLookupTimer);
        this._otimCoordsLookupTimer = setTimeout(() => this._resolveCoordsToAddress(value, 'otim'), 500);
      });
      document.getElementById('op-otim-coords')?.addEventListener('blur', e => {
        this._resolveCoordsToAddress(e.target.value, 'otim');
      });
      document.getElementById('op-cemig-coords')?.addEventListener('input', e => {
        const value = e.target.value;
        clearTimeout(this._cemigCoordsLookupTimer);
        this._cemigCoordsLookupTimer = setTimeout(() => this._resolveCoordsToAddress(value, 'cemig'), 500);
      });
      document.getElementById('op-cemig-coords')?.addEventListener('blur', e => {
        this._resolveCoordsToAddress(e.target.value, 'cemig');
      });
      document.getElementById('op-setor-cto')?.addEventListener('input', e => {
        const el = e.target;
        const s = el.selectionStart;
        const k = el.selectionEnd;
        const up = el.value.toUpperCase();
        if (el.value !== up) {
          el.value = up;
          if (typeof s === 'number' && typeof k === 'number') el.setSelectionRange(s, k);
        }
        clearTimeout(this._setorCtoLookupTimer);
        this._setorCtoLookupTimer = setTimeout(() => this._applyCtoLookupFromSetor(), 450);
      });
      document.getElementById('op-setor-cto')?.addEventListener('blur', () => {
        this._applyCtoLookupFromSetor();
      });
      document.getElementById('op-qdp-cto')?.addEventListener('input', (e) => {
        const el = e.target;
        const s = el.selectionStart;
        const k = el.selectionEnd;
        const up = el.value.toUpperCase();
        if (el.value !== up) {
          el.value = up;
          if (typeof s === 'number' && typeof k === 'number') el.setSelectionRange(s, k);
        }
        clearTimeout(this._qdpCtoLookupTimer);
        this._qdpCtoLookupTimer = setTimeout(() => this._applyCtoLookupFromQdpCto(), 450);
      });
      document.getElementById('op-qdp-cto')?.addEventListener('blur', () => {
        this._applyCtoLookupFromQdpCto();
      });
      ['closeOpTaskModal','cancelOpTaskModal'].forEach(id =>
        document.getElementById(id)?.addEventListener('click', () => ModalService.close('opTaskModal'))
      );
      document.getElementById('opAtdChildrenExpandBtn')?.addEventListener('click', () => {
        const wrap = document.getElementById('opAtdChildrenWrap');
        const btn = document.getElementById('opAtdChildrenExpandBtn');
        if (!wrap || !btn) return;
        wrap.classList.toggle('is-expanded');
        const expanded = wrap.classList.contains('is-expanded');
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        btn.title = expanded ? 'Recolher lista' : 'Expandir lista';
        btn.setAttribute(
          'aria-label',
          expanded ? 'Recolher lista de ordens de serviço vinculadas' : 'Expandir lista de ordens de serviço vinculadas'
        );
      });
    },
  },

  /* ── Filters & Search ─────────────────────────────────── */
  filters: {
    init() {
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          Store.dashboardFilter = btn.dataset.filter;
          UI.renderTaskTable();
        });
      });

      document.getElementById('searchInput')?.addEventListener('input', e => {
        Store.dashboardSearch = e.target.value.trim().toLowerCase();
        UI.renderTaskTable();
      });

      document.getElementById('opSearchInput').addEventListener('input', e => {
        Store.opSearch = e.target.value.trim().toLowerCase();
        UI.renderKanban();
      });

      document.getElementById('opRegionSelectFilter')?.addEventListener('change', e => {
        Store.opRegionSearch = e.target.value.trim().toLowerCase();
        UI.renderKanban();
      });

      document.getElementById('opTecnicoInput')?.addEventListener('input', e => {
        Store.opTecnicoSearch = e.target.value.trim().toLowerCase();
        UI.renderKanban();
      });

      document.getElementById('opTaskIdInput')?.addEventListener('input', e => {
        Store.opTaskIdSearch = e.target.value;
        UI.renderKanban();
      });

      document.getElementById('opDateSortFilter')?.addEventListener('change', e => {
        Store.opDateSort = String(e.target.value || 'all');
        UI.renderKanban();
      });

      document.getElementById('atdOpSearchInput')?.addEventListener('input', e => {
        Store.atdOpSearch = e.target.value.trim().toLowerCase();
        UI.renderAtendimentoPage();
      });
      document.getElementById('atdOpRegionSelectFilter')?.addEventListener('change', e => {
        Store.atdOpRegionSearch = e.target.value.trim().toLowerCase();
        UI.renderAtendimentoPage();
      });
      document.getElementById('atdOpTecnicoInput')?.addEventListener('input', e => {
        Store.atdOpTecnicoSearch = e.target.value.trim().toLowerCase();
        UI.renderAtendimentoPage();
      });
      document.getElementById('atdOpTaskIdInput')?.addEventListener('input', e => {
        Store.atdOpTaskIdSearch = e.target.value;
        UI.renderAtendimentoPage();
      });
      document.getElementById('atdOpDateSortFilter')?.addEventListener('change', e => {
        Store.atdOpDateSort = String(e.target.value || 'all');
        UI.renderAtendimentoPage();
      });
    },
  },

  /* ── Tasks Category Tabs ──────────────────────────────── */
  categoryTabs: {
    // Tabs de categoria foram substituídas por navegação lateral (menu).
    _activateCategory(cat) {
      Store.currentOpCategory = cat;
      const hidden = document.getElementById('op-parent-task-id');
      if (hidden) hidden.value = '';
      Controllers.opTask._syncAtendimentoKindFields?.();
      UI.renderKanban();
    },
    init() {
      // Nada a fazer — mantido apenas por compatibilidade.
    },
  },

  /* ── Painel operacional (categorias só no topo; painel sempre visível) ───── */
  opFolders: {
    init() {
      const panel = document.getElementById('opPanelContent');
      if (panel) panel.classList.remove('hidden');
    },
  },

    webhook: {
    _lastAllSystemsOk: null,

    _syncSystemPill() {
      const pill = document.querySelector('.planner-status-pill');
      if (!pill) return;
      const textEl = pill.querySelector('span:last-child');
      const cfg = Store.getWebhookConfig?.() || {};
      const byRegion = (cfg && cfg.urlsByRegion && typeof cfg.urlsByRegion === 'object') ? cfg.urlsByRegion : {};

      const required = ['GOVAL', 'VALE_DO_ACO', 'CARATINGA', 'BACKUP'];
      const missing = required.filter(k => !String(byRegion[k] || '').trim());
      const ok = missing.length === 0;

      if (textEl) {
        textEl.textContent = ok ? 'todos os sistemas ok' : 'existe sistema off';
      }
      pill.classList.toggle('planner-status-pill--danger', !ok);

      // Notificação ao detectar que existe sistema OFF (sem spam)
      if (this._lastAllSystemsOk === null) {
        if (!ok && typeof ToastService !== 'undefined' && ToastService.show) {
          ToastService.show('Existe sistema OFF. Verifique os 4 webhooks nas Configurações.', 'warning');
        }
      } else if (this._lastAllSystemsOk === true && !ok) {
        if (typeof ToastService !== 'undefined' && ToastService.show) {
          ToastService.show('Existe sistema OFF. Verifique os 4 webhooks nas Configurações.', 'warning');
        }
      }
      this._lastAllSystemsOk = ok;
    },

    _syncBanner() {
      const config  = Store.getWebhookConfig();
      const banner  = document.getElementById('webhookBanner');
      if (!banner) return;
      const anyRegion = config?.urlsByRegion && typeof config.urlsByRegion === 'object'
        ? Object.values(config.urlsByRegion).some(v => typeof v === 'string' && v.trim())
        : false;
      if (String(config?.url || '').trim() || anyRegion) {
        banner.classList.add('visible');
      } else {
        banner.classList.remove('visible');
      }
    },

    init() {
      document.getElementById('openWebhookBtn')?.addEventListener('click', () => {
        const config = Store.getWebhookConfig();
        const byRegion = (config && config.urlsByRegion && typeof config.urlsByRegion === 'object') ? config.urlsByRegion : {};
        document.getElementById('f-webhookUrl-goval').value      = String(byRegion.GOVAL || '').trim();
        document.getElementById('f-webhookUrl-vale').value       = String(byRegion.VALE_DO_ACO || '').trim();
        document.getElementById('f-webhookUrl-caratinga').value  = String(byRegion.CARATINGA || '').trim();
        document.getElementById('f-webhookUrl-backup').value     = String(byRegion.BACKUP || '').trim();
        document.getElementById('ev-andamento').checked  = config.events.andamento;
        document.getElementById('ev-concluida').checked  = config.events.concluida;
        document.getElementById('ev-finalizada').checked = config.events.finalizada;
        ModalService.open('webhookModal');
      });

      const test = async (id) => {
        const url = document.getElementById(id)?.value?.trim();
        if (!url) { ToastService.show('Insira a URL do webhook antes de testar', 'danger'); return; }
        await WebhookService.sendTest(url);
      };
      document.getElementById('testWebhookBtn-goval')?.addEventListener('click', async () => test('f-webhookUrl-goval'));
      document.getElementById('testWebhookBtn-vale')?.addEventListener('click', async () => test('f-webhookUrl-vale'));
      document.getElementById('testWebhookBtn-caratinga')?.addEventListener('click', async () => test('f-webhookUrl-caratinga'));
      document.getElementById('testWebhookBtn-backup')?.addEventListener('click', async () => test('f-webhookUrl-backup'));

      document.getElementById('saveWebhookBtn').addEventListener('click', async () => {
        const goval = document.getElementById('f-webhookUrl-goval')?.value?.trim() || '';
        const vale  = document.getElementById('f-webhookUrl-vale')?.value?.trim() || '';
        const cara  = document.getElementById('f-webhookUrl-caratinga')?.value?.trim() || '';
        const backup = document.getElementById('f-webhookUrl-backup')?.value?.trim() || '';
        // FIX: não exigir todas as regiões — salvar com 1+ URLs preenchidas.
        const urlsByRegion = {
          ...(goval ? { GOVAL: goval } : {}),
          ...(vale ? { VALE_DO_ACO: vale } : {}),
          ...(cara ? { CARATINGA: cara } : {}),
          ...(backup ? { BACKUP: backup } : {}),
        };
        const mainUrl = goval || vale || cara || backup || '';
        if (!mainUrl) {
          ToastService.show('Informe pelo menos 1 URL de webhook para conectar.', 'danger');
          return;
        }
        const res = await Store.setWebhookConfig({
          url: mainUrl,
          urlsByRegion,
          events: {
            andamento:  document.getElementById('ev-andamento').checked,
            concluida:  document.getElementById('ev-concluida').checked,
            finalizada: document.getElementById('ev-finalizada').checked,
          },
        });
        this._syncBanner();
        this._syncSystemPill();
        ModalService.close('webhookModal');
        if (!Store.isRemoteApiEnabled()) {
          ToastService.show('Google Chat conectado (salvo só neste navegador).', 'success');
        } else if (res && res.ok) {
          ToastService.show('Webhook salvo no servidor. Válido para todos que acessam o site.', 'success');
        } else {
          ToastService.show(
            'Salvo no navegador. No servidor falhou: verifique api/credentials.php, permissões da pasta api e o PHP no cPanel.',
            'danger'
          );
        }
      });

      document.getElementById('disconnectWebhook')?.addEventListener('click', async () => {
        const res = await Store.setWebhookConfig({ url: '', urlsByRegion: {} });
        this._syncBanner();
        this._syncSystemPill();
        if (Store.isRemoteApiEnabled() && (!res || !res.ok)) {
          ToastService.show('Desconectado aqui; não atualizou no servidor.', 'warning');
        } else {
          ToastService.show('Webhook desconectado', 'info');
        }
      });

      ['closeWebhookModal','cancelWebhookModal'].forEach(id =>
        document.getElementById(id)?.addEventListener('click', () => ModalService.close('webhookModal'))
      );

      this._syncBanner();
      this._syncSystemPill();
    },
  },

  /* ── Notes (removido) ─────────────────────────────────── */
  notes: {
    init() {
      // Bloco de "Notas rápidas" do dashboard foi removido.
    },
  },

  /* ── Chat da equipe (MySQL + polling; sem WebSocket) ───── */
  teamChat: {
    /** timeoutId do poll (setTimeout recursivo com jitter — setInterval em aba em segundo plano some browsers “congelam”). */
    _timer: null,
    /** Poll leve fora do chat (badge “novas”). */
    _notifyTimer: null,
    _lastId: 0,
    /** Fila serial: evita corrida entre poll e envio (antes _inFlight descartava o refresh após Enviar). */
    _loadChain: Promise.resolve(),
    _emojiBuilt: false,
    /** Evita reabrir o painel no click após fechar no mousedown do botão 😊. */
    _suppressNextEmojiBtnClick: false,

    _els() {
      return {
        list: document.getElementById('teamChatList'),
        offline: document.getElementById('teamChatOffline'),
        input: document.getElementById('teamChatInput'),
        send: document.getElementById('teamChatSend'),
        jump: document.getElementById('teamChatJumpBottom'),
        emojiBtn: document.getElementById('teamChatEmojiBtn'),
        emojiPanel: document.getElementById('teamChatEmojiPanel'),
        emojiTabs: document.getElementById('teamChatEmojiTabs'),
        emojiGrid: document.getElementById('teamChatEmojiGrid'),
      };
    },

    _isEmojiPanelOpen() {
      const { emojiPanel } = this._els();
      return !!(emojiPanel && !emojiPanel.hidden);
    },

    _closeEmojiPanel() {
      const { emojiBtn, emojiPanel } = this._els();
      if (emojiPanel) emojiPanel.hidden = true;
      if (emojiBtn) emojiBtn.setAttribute('aria-expanded', 'false');
    },

    _openEmojiPanel() {
      this._hideMentionSuggest();
      this._ensureEmojiPanelBuilt();
      const { emojiBtn, emojiPanel } = this._els();
      if (emojiPanel) emojiPanel.hidden = false;
      if (emojiBtn) emojiBtn.setAttribute('aria-expanded', 'true');
    },

    _toggleEmojiPanel() {
      if (this._isEmojiPanelOpen()) this._closeEmojiPanel();
      else this._openEmojiPanel();
    },

    _ensureEmojiPanelBuilt() {
      if (this._emojiBuilt) return;
      const { emojiTabs, emojiGrid } = this._els();
      if (!emojiTabs || !emojiGrid) return;
      this._emojiBuilt = true;
      TEAM_CHAT_EMOJI_GROUPS.forEach((g, idx) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `team-chat-emoji-tab${idx === 0 ? ' is-active' : ''}`;
        tab.textContent = g.label;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
        tab.addEventListener('click', () => this._setEmojiTab(idx));
        emojiTabs.appendChild(tab);
      });
      this._fillEmojiGrid(0);
    },

    _setEmojiTab(idx) {
      const { emojiTabs } = this._els();
      if (emojiTabs) {
        const tabs = emojiTabs.querySelectorAll('[role="tab"]');
        tabs.forEach((t, i) => {
          t.classList.toggle('is-active', i === idx);
          t.setAttribute('aria-selected', i === idx ? 'true' : 'false');
        });
      }
      this._fillEmojiGrid(idx);
    },

    _fillEmojiGrid(tabIdx) {
      const { emojiGrid } = this._els();
      const g = TEAM_CHAT_EMOJI_GROUPS[tabIdx];
      if (!emojiGrid || !g) return;
      emojiGrid.innerHTML = '';
      for (const ch of g.emojis) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'team-chat-emoji-cell';
        b.textContent = ch;
        b.setAttribute('role', 'option');
        b.title = ch;
        b.addEventListener('click', () => {
          this._insertEmojiAtCursor(ch);
          this._closeEmojiPanel();
        });
        emojiGrid.appendChild(b);
      }
    },

    _insertEmojiAtCursor(text) {
      const { input } = this._els();
      if (!input || !text) return;
      const maxAttr = input.getAttribute('maxlength');
      const max = maxAttr != null ? parseInt(maxAttr, 10) : 2000;
      const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
      const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
      const before = input.value.slice(0, start);
      const after = input.value.slice(end);
      let insert = text;
      const room = max - before.length - after.length;
      if (room <= 0) return;
      if (insert.length > room) insert = insert.slice(0, room);
      input.value = before + insert + after;
      const newPos = start + insert.length;
      try {
        input.setSelectionRange(newPos, newPos);
      } catch {
        /* alguns browsers em input “estranho” */
      }
      input.focus();
    },

    _hideMentionSuggest() {
      const el = document.getElementById('teamChatMentionSuggest');
      if (el) el.hidden = true;
    },

    _isMentionSuggestOpen() {
      const el = document.getElementById('teamChatMentionSuggest');
      return !!(el && !el.hidden);
    },

    _updateMentionSuggest() {
      const suggest = document.getElementById('teamChatMentionSuggest');
      const { input } = this._els();
      if (!suggest || !input) return;
      const roster = Store.getTeamChatRosterKeys();
      if (!roster.length) {
        suggest.hidden = true;
        return;
      }
      const v = input.value;
      const pos = typeof input.selectionStart === 'number' ? input.selectionStart : v.length;
      const before = v.slice(0, pos);
      const at = before.lastIndexOf('@');
      if (at === -1) {
        suggest.hidden = true;
        return;
      }
      const prevOk = at === 0 || /\s/.test(before.charAt(at - 1));
      if (!prevOk) {
        suggest.hidden = true;
        return;
      }
      const q = before.slice(at + 1);
      if (/[\s\n]/.test(q)) {
        suggest.hidden = true;
        return;
      }
      const qlow = q.toLowerCase();
      const matches = roster.filter(u => u.startsWith(qlow)).slice(0, 10);
      if (!matches.length) {
        suggest.hidden = true;
        return;
      }
      suggest.innerHTML = matches
        .map(
          u =>
            `<button type="button" class="team-chat-mention-option" role="option" data-user="${Utils.escapeHtml(u)}"><span class="mention-key">@${Utils.escapeHtml(u)}</span></button>`,
        )
        .join('');
      suggest.hidden = false;
      suggest.querySelectorAll('.team-chat-mention-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const u = btn.getAttribute('data-user');
          if (u) this._insertMentionAtCaret(u);
          suggest.hidden = true;
        });
      });
    },

    _insertMentionAtCaret(userKey) {
      const { input } = this._els();
      if (!input) return;
      const maxAttr = input.getAttribute('maxlength');
      const max = maxAttr != null ? parseInt(maxAttr, 10) : 2000;
      const v = input.value;
      const pos = typeof input.selectionStart === 'number' ? input.selectionStart : v.length;
      const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : pos;
      const before = v.slice(0, pos);
      const after = v.slice(end);
      const at = before.lastIndexOf('@');
      if (at === -1) return;
      const insert = `@${userKey} `;
      const next = v.slice(0, at) + insert + after;
      if (next.length > max) return;
      input.value = next;
      const newPos = at + insert.length;
      try {
        input.setSelectionRange(newPos, newPos);
      } catch {
        /* ignore */
      }
      input.focus();
    },

    _acceptFirstMentionSuggestion() {
      const suggest = document.getElementById('teamChatMentionSuggest');
      if (!suggest || suggest.hidden) return false;
      const first = suggest.querySelector('.team-chat-mention-option[data-user]');
      if (!first) return false;
      const u = first.getAttribute('data-user');
      if (u) this._insertMentionAtCaret(u);
      suggest.hidden = true;
      return true;
    },

    _readLastSeenId() {
      try {
        const n = parseInt(localStorage.getItem(CHAT_LAST_SEEN_ID_KEY) || '0', 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      } catch {
        return 0;
      }
    },

    _markChatSeen(maxId) {
      if (!Number.isFinite(maxId) || maxId <= 0) return;
      try {
        const cur = this._readLastSeenId();
        if (maxId > cur) localStorage.setItem(CHAT_LAST_SEEN_ID_KEY, String(maxId));
      } catch {
        /* ignore */
      }
      this._syncNavBadge(0);
    },

    _syncNavBadge(count) {
      const el = document.getElementById('nav-chat-badge');
      if (!el) return;
      if (!count || Store.currentPage === 'chat') {
        el.style.display = 'none';
        el.textContent = '';
        return;
      }
      el.style.display = '';
      el.textContent = count > 9 ? '9+' : String(count);
    },

    startBackgroundNotify() {
      this.stopBackgroundNotify();
      if (!Store.isRemoteApiEnabled() || !Controllers.auth._isAuthenticated()) return;
      const tick = async () => {
        if (!Controllers.auth._isAuthenticated()) {
          this.stopBackgroundNotify();
          return;
        }
        if (Store.currentPage === 'chat') return;
        const since = this._readLastSeenId();
        if (since <= 0) return;
        const res = await Store.fetchTeamChat(since);
        if (res && res.ok && Array.isArray(res.messages) && res.messages.length) {
          this._syncNavBadge(res.messages.length);
          const myKey = String(localStorage.getItem(Controllers.auth._sessionUserKey) || '').toLowerCase();
          ChatMentionNotifs.processIncomingMessages(res.messages, myKey, { incremental: true });
        }
      };
      void tick();
      this._notifyTimer = setInterval(tick, 20000);
    },

    stopBackgroundNotify() {
      if (this._notifyTimer) {
        clearInterval(this._notifyTimer);
        this._notifyTimer = null;
      }
    },

    _scrollBottom() {
      const { list } = this._els();
      if (!list) return;
      list.scrollTop = list.scrollHeight;
    },

    _isNearBottom(px = 100) {
      const { list } = this._els();
      if (!list) return true;
      return list.scrollHeight - list.scrollTop - list.clientHeight <= px;
    },

    _toggleJumpBottom(show) {
      const { jump } = this._els();
      if (!jump) return;
      jump.hidden = !show;
    },

    _renderMessages(messages, replace) {
      const { list, offline, jump } = this._els();
      if (!list) return;

      if (!Store.isRemoteApiEnabled()) {
        if (offline) {
          offline.hidden = false;
          offline.textContent = 'API PHP desligada neste ambiente (localhost) ou indisponível. Com a pasta api no HostGator, o chat funciona automaticamente.';
        }
        if (jump) jump.hidden = true;
        list.innerHTML =
          '<div class="team-chat-empty">O chat usa o mesmo servidor do painel. Acesse pelo site publicado com <code>api</code> configurada.</div>';
        return;
      }

      const arr = Array.isArray(messages) ? messages : [];
      if (replace) {
        list.innerHTML = '';
        this._lastId = 0;
        if (jump) jump.hidden = true;
      }

      if (!arr.length && replace) {
        list.innerHTML = '<div class="team-chat-empty">Nenhuma mensagem ainda. Envie a primeira abaixo.</div>';
        this._scrollBottom();
        return;
      }

      const stickToBottom = replace || this._isNearBottom(100);
      let appended = 0;
      const myKey = String(localStorage.getItem(Controllers.auth._sessionUserKey) || '').toLowerCase();
      for (const m of arr) {
        const id = Number(m.id);
        if (!Number.isFinite(id)) continue;
        if (!replace && id <= this._lastId) continue;
        if (!replace && list.querySelector(`[data-chat-id="${id}"]`)) continue;

        this._lastId = Math.max(this._lastId, id);
        const isMe = String(m.userKey || '').toLowerCase() === myKey;
        const row = document.createElement('div');
        row.className = `team-chat-msg${isMe ? ' is-mine' : ''}`;
        row.dataset.chatId = String(id);
        const who = Utils.escapeHtml(m.displayName || m.userKey || '—');
        const whenRel = Utils.escapeHtml(Utils.formatChatRelative(m.createdAt));
        const whenFull = Utils.escapeHtml(Utils.formatChatFullDateTime(m.createdAt));
        const roster = Store.getTeamChatRosterKeys();
        const body = Utils.formatChatBodyHtml(m.body || '', roster);
        row.innerHTML = `<div class="team-chat-msg-meta"><span class="team-chat-who">${who}</span><span class="team-chat-when" title="${whenFull}">${whenRel}</span></div><div class="team-chat-msg-body">${body}</div>`;
        list.appendChild(row);
        appended += 1;
      }
      if (offline) offline.hidden = true;
      if (appended > 0 || (replace && arr.length)) {
        if (stickToBottom || replace) {
          this._scrollBottom();
          this._toggleJumpBottom(false);
        } else {
          this._toggleJumpBottom(true);
        }
      }
    },

    async _load(since) {
      if (!Controllers.auth._isAuthenticated()) return;
      const run = async () => {
        try {
          await this._loadImpl(since);
        } catch {
          /* abort / rede */
        }
      };
      this._loadChain = this._loadChain.then(run, run);
      return this._loadChain;
    },

    async _loadImpl(since) {
      if (!Store.isRemoteApiEnabled()) {
        this._renderMessages([], true);
        return;
      }
      const res = await Store.fetchTeamChat(since);
      if (res && res.ok && Array.isArray(res.messages)) {
        if (Array.isArray(res.teamRoster) && res.teamRoster.length) {
          Store.applyTeamChatRosterFromApi(res.teamRoster);
        }
        this._renderMessages(res.messages, since === 0);
        if (typeof res.lastId === 'number' && res.lastId > this._lastId) {
          this._lastId = res.lastId;
        }
        if (Store.currentPage === 'chat') {
          this._markChatSeen(this._lastId);
        }
        const myKey = String(localStorage.getItem(Controllers.auth._sessionUserKey) || '').toLowerCase();
        ChatMentionNotifs.processIncomingMessages(res.messages, myKey, { incremental: since > 0 });
      } else if (res && res.error === 'table_missing') {
        const { offline, list } = this._els();
        if (offline) {
          offline.hidden = false;
          offline.textContent =
            'Tabela team_chat_message ausente. Execute no MySQL o arquivo api/migrations/006_team_chat_message.sql (ou use o schema.sql atualizado).';
        }
        if (list) {
          list.innerHTML =
            '<div class="team-chat-empty">Configuração pendente: rode a migração do chat no banco de dados.</div>';
        }
      } else if (res && !res.ok) {
        const { offline } = this._els();
        if (offline) {
          offline.hidden = false;
          offline.textContent = 'Não foi possível carregar o chat. Tente atualizar a página.';
        }
      } else {
        const base = Store.getApiBaseUrl();
        const { offline, list } = this._els();
        const hint =
          'O painel não recebeu JSON do servidor (404, bloqueio ou URL errada). ' +
          (base
            ? `Abra no navegador: ${base}/chat.php — deve retornar JSON. Confirme api/chat.php no FTP, migração MySQL do chat e, se o painel estiver em subpasta, apiBaseUrl em src/js/config.js (ex.: https://seudominio.com.br/pasta/api).`
            : 'Confirme a pasta api no servidor e apiBaseUrl em src/js/config.js se a URL automática não bater com a subpasta.');
        if (offline) {
          offline.hidden = false;
          offline.textContent = hint;
        }
        if (list && since === 0) {
          list.innerHTML = `<div class="team-chat-empty">${Utils.escapeHtml(hint)}</div>`;
        }
      }
    },

    async send() {
      this._closeEmojiPanel();
      this._hideMentionSuggest();
      if (!Controllers.auth._isAuthenticated()) return;
      const { input } = this._els();
      if (!input) return;
      const body = input.value.trim();
      if (!body) return;
      const userKey = String(localStorage.getItem(Controllers.auth._sessionUserKey) || '')
        .trim()
        .toLowerCase();
      const displayName =
        String(localStorage.getItem(Controllers.auth._displayNameKey) || '').trim() || userKey;
      if (!userKey) {
        ToastService.show('Sessão inválida; entre novamente.', 'danger');
        return;
      }
      if (!Store.isRemoteApiEnabled()) {
        ToastService.show('API indisponível neste ambiente.', 'danger');
        return;
      }
      const btn = this._els().send;
      input.disabled = true;
      if (btn) btn.disabled = true;
      try {
        const res = await Store.sendTeamChat({ userKey, displayName, body });
        if (res && res.ok) {
          input.value = '';
          await this._load(this._lastId);
        } else if (res && res.error === 'unknown_user') {
          ToastService.show('Usuário não autorizado no servidor para este chat.', 'danger');
        } else if (res && res.error === 'table_missing') {
          ToastService.show('Execute a migração SQL do chat no MySQL.', 'danger');
        } else {
          const base = Store.getApiBaseUrl();
          const extra =
            !res && base
              ? ` Sem resposta em ${base}/chat.php — veja Rede (F12), erros PHP e apiBaseUrl no config.js se estiver em subpasta.`
              : '';
          ToastService.show(`Não foi possível enviar a mensagem.${extra}`, 'danger');
        }
      } finally {
        input.disabled = false;
        if (btn) btn.disabled = false;
        input.focus();
      }
    },

    onPageChange(page) {
      if (page === 'chat') {
        this.stopBackgroundNotify();
        this._syncNavBadge(0);
        this.start();
      } else {
        this.stop();
        this.startBackgroundNotify();
      }
    },

    /** Reanexa fila e força histórico — útil após aba em background, bfcache ou falha intermitente da rede. */
    _recoverFromSleep() {
      if (Store.currentPage !== 'chat' || !Controllers.auth._isAuthenticated()) return;
      this._loadChain = Promise.resolve();
      void this._load(0);
    },

    _schedulePoll() {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      if (Store.currentPage !== 'chat') return;
      const delay = 5500 + Math.floor(Math.random() * 2000);
      this._timer = setTimeout(() => {
        this._timer = null;
        if (Store.currentPage === 'chat' && Controllers.auth._isAuthenticated()) {
          void this._load(this._lastId);
        }
        if (Store.currentPage === 'chat') this._schedulePoll();
      }, delay);
    },

    start() {
      this.stop();
      this._loadChain = Promise.resolve();
      void this._load(0);
      this._schedulePoll();
    },

    stop() {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    },

    init() {
      const { send, input, list, jump, emojiBtn } = this._els();
      send?.addEventListener('click', () => this.send());
      emojiBtn?.addEventListener('click', e => {
        e.stopPropagation();
        if (this._suppressNextEmojiBtnClick) {
          this._suppressNextEmojiBtnClick = false;
          return;
        }
        this._toggleEmojiPanel();
      });
      document.addEventListener(
        'mousedown',
        e => {
          if (!this._isEmojiPanelOpen()) return;
          if (e.button !== 0) return;
          const btn = document.getElementById('teamChatEmojiBtn');
          if (btn && (e.target === btn || btn.contains(e.target))) {
            this._closeEmojiPanel();
            this._suppressNextEmojiBtnClick = true;
            return;
          }
          const wrap = document.querySelector('.team-chat-compose');
          if (wrap && wrap.contains(e.target)) return;
          this._closeEmojiPanel();
        },
        true,
      );
      input?.addEventListener('input', () => this._updateMentionSuggest());
      input?.addEventListener('click', () => queueMicrotask(() => this._updateMentionSuggest()));
      input?.addEventListener('keyup', e => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this._updateMentionSuggest();
      });
      input?.addEventListener('keydown', e => {
        if (e.key === 'Escape' && this._isMentionSuggestOpen()) {
          e.preventDefault();
          this._hideMentionSuggest();
          return;
        }
        if ((e.key === 'Tab' || e.key === 'Enter') && this._isMentionSuggestOpen() && !e.shiftKey) {
          if (this._acceptFirstMentionSuggestion()) {
            e.preventDefault();
            return;
          }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.send();
        }
      });
      document.addEventListener(
        'mousedown',
        e => {
          if (!this._isMentionSuggestOpen()) return;
          const sugg = document.getElementById('teamChatMentionSuggest');
          const { input: inp } = this._els();
          if (sugg && sugg.contains(e.target)) return;
          if (inp && (e.target === inp || inp.contains(e.target))) return;
          this._hideMentionSuggest();
        },
        true,
      );
      jump?.addEventListener('click', () => {
        this._scrollBottom();
        this._toggleJumpBottom(false);
      });
      list?.addEventListener('scroll', () => {
        if (this._isNearBottom(72)) this._toggleJumpBottom(false);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this._recoverFromSleep();
      });
      window.addEventListener('pageshow', () => {
        queueMicrotask(() => this._recoverFromSleep());
      });
      window.addEventListener('online', () => {
        queueMicrotask(() => this._recoverFromSleep());
      });
    },
  },

  /* ── Global Modal Helpers ─────────────────────────────── */
  globalModal: {
    init() {
      // Fechar clicando fora
      document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
          if (e.target === overlay) overlay.classList.remove('open');
        });
      });
      // Fechar com ESC (menu mobile antes dos modais)
      document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (Controllers.teamChat._isEmojiPanelOpen()) {
          Controllers.teamChat._closeEmojiPanel();
          e.preventDefault();
          return;
        }
        const notifPanel = document.getElementById('topbarNotifPanel');
        if (notifPanel && !notifPanel.hidden) {
          ChatMentionNotifs._closePanel();
          e.preventDefault();
          return;
        }
        if (document.body.classList.contains('nav-open')) {
          Controllers.sidebar.closeMobileNav();
          return;
        }
        ModalService.closeAll();
      });
    },
  },
};


/* ─────────────────────────────────────────────────────────────
   APP INIT — Bootstrap da aplicação
───────────────────────────────────────────────────────────── */
async function initApp() {
  if (typeof window !== 'undefined') {
    if (window.__bpAppStarted) return;
    window.__bpAppStarted = true;
  }
  Controllers.theme.init();
  CtoLocationRegistry.load().catch(() => {});
  Controllers.auth.init();
  ChatMentionNotifs.syncBellUi();

  SidebarNavOrder.apply();

  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest('.task-copy-id-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const raw = String(btn.dataset.copyProtocol || '').trim();
      void Utils.copyProtocolWithToast(raw);
    },
    true,
  );

  // Bootstrap remoto pode demorar; listeners precisam existir antes do await
  // para quem logar rápido não ficar com UI “morta”.
  const bootstrapWithTimeout = async (timeoutMs) => {
    try {
      return await Promise.race([
        Store.bootstrapFromRemote(),
        new Promise(resolve => setTimeout(() => resolve(false), timeoutMs)),
      ]);
    } catch {
      return false;
    }
  };

  Controllers.sidebar.init();
  SidebarNavOrder.initDrag();
  Controllers.task.init();
  Controllers.opTask.init();
  Controllers.filters.init();
  Controllers.categoryTabs.init();
  Controllers.opFolders.init();
  Controllers.webhook.init();
  Controllers.notes.init();
  Controllers.teamChat.init();
  ChatMentionNotifs.init();
  Controllers.globalModal.init();

  void bootstrapWithTimeout(10000).then(ok => {
    if (!ok) return;
    UI.renderAgenda();
    const p = Store.currentPage;
    if (p === 'dashboard') UI.renderDashboard();
    else if (p === 'tarefas' || p === 'atendimento') UI.refreshOperationalUi();
  });

  UI.renderAgenda();
  UI.renderDashboard();

  // Clock
  UI.updateClock();
  setInterval(() => UI.updateClock(), 30000);

  // Sync rápido entre computadores:
  // - Em vez de baixar tudo toda hora, faz um GET leve (/changes.php) e só faz bootstrap quando houve mudança.
  // - O bootstrap de 25s fica como fallback caso algum proxy/cache atrapalhe ou o changes falhe.
  let lastRemoteSig = '';
  let lastSince = 0; // epoch seconds (referência do servidor / updated_at max)
  const changesSig = (payload) => {
    if (!payload || typeof payload !== 'object') return '';
    const t = Number(payload.tasks) || 0;
    const o = Number(payload.opTasks) || 0;
    const g = Number(payload.config) || 0;
    const n = Number(payload.notifications) || 0;
    const a = Number(payload.activity) || 0;
    return `${t}|${o}|${g}|${n}|${a}`;
  };
  let syncInFlight = false;
  const quickSyncTick = async () => {
    if (!ApiService.enabled()) return;
    if (!Controllers?.auth?._isAuthenticated?.()) return;
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      const ch = await ApiService.getChanges(lastSince);
      if (!ch || ch.ok !== true) {
        // Se /changes falhar (cache/proxy/endpoint ausente), faz bootstrap direto com timeout maior.
        const updated = await bootstrapWithTimeout(15000);
        if (!updated) return;
        void seedRemoteSigIfPossible();
        UI.renderDashboard();
        UI.refreshOperationalUi();
              return;
      }

      // Usa o maior updated_at das tabelas (mais confiável que serverTime para não perder updates no mesmo segundo).
      if (Number(ch.nextSince) > 0) lastSince = Number(ch.nextSince);
      else if (Number(ch.serverTime) > 0) lastSince = Number(ch.serverTime);

      const changedTasks = Array.isArray(ch.changedTasks) ? ch.changedTasks : [];
      const changedOp = Array.isArray(ch.changedOpTasks) ? ch.changedOpTasks : [];
      const changedNotifs = Array.isArray(ch.changedNotifications) ? ch.changedNotifications : [];
      const changedActivity = Array.isArray(ch.changedActivity) ? ch.changedActivity : [];

      // FIX: calcula e persiste sig ANTES de qualquer early-return,
      // evitando re-deteccao da mesma mudanca no proximo tick.
      const sig = changesSig(ch);
      const sigChanged = sig && sig !== lastRemoteSig;
      if (sig) lastRemoteSig = sig;

      const changedCount = Store.applyRemoteTasks(changedTasks) + Store.applyRemoteOpTasks(changedOp);
      if (changedCount) {
        UI.renderDashboard();
        UI.refreshOperationalUi();
            }
      if (changedNotifs.length) {
        ChatMentionNotifs.processIncomingTaskNotifications(changedNotifs);
      }
      if (changedActivity.length) {
        Store.applyRemoteActivity(changedActivity);
        window.PlannerDashboard?._renderActivityFeedFromStore?.();
      }

      // Se o servidor acusar mudanca mas nao vier diff (ex.: config),
      // faz bootstrap completo como fallback.
      if (sigChanged && !changedTasks.length && !changedOp.length) {
        const updated = await bootstrapWithTimeout(15000);
        if (!updated) return;
        UI.renderDashboard();
        UI.refreshOperationalUi();
            }
    } finally {
      syncInFlight = false;
    }
  };

  const seedRemoteSigIfPossible = async () => {
    if (!ApiService.enabled()) return;
    if (!Controllers?.auth?._isAuthenticated?.()) return;
    const ch = await ApiService.getChanges(0);
    if (!ch || ch.ok !== true) return;
    const sig = changesSig(ch);
    if (sig) lastRemoteSig = sig;
    if (Number(ch.nextSince) > 0) lastSince = Number(ch.nextSince);
    else if (Number(ch.serverTime) > 0) lastSince = Number(ch.serverTime);
  };

  // Produção (multiusuário): polling inteligente a cada 15s (mínimo possível sem sobrecarregar HostGator).
  setInterval(() => { void quickSyncTick(); }, 15000);
  setInterval(async () => {
    const updated = await bootstrapWithTimeout(6000);
    if (!updated) return;
    void seedRemoteSigIfPossible();
    UI.renderDashboard();
    UI.refreshOperationalUi();
    }, 25000);

  void seedRemoteSigIfPossible();

  /* -- Refresh manual: bootstrap + re-render + spin no botao -- */
  const manualRefresh = async (btnId) => {
    const btn = btnId ? document.getElementById(btnId) : null;
    const svg = btn?.querySelector('svg');
    if (svg) svg.style.transition = 'transform 0.6s linear';
    let angle = 0;
    const spin = btn ? setInterval(() => {
      angle += 60;
      if (svg) svg.style.transform = `rotate(${angle}deg)`;
    }, 100) : null;
    const stop = () => {
      if (spin) clearInterval(spin);
      if (svg) { svg.style.transform = 'rotate(360deg)'; setTimeout(() => { svg.style.transition = ''; svg.style.transform = ''; }, 300); }
    };
    try {
      const updated = await bootstrapWithTimeout(12000);
      if (updated) {
        void seedRemoteSigIfPossible();
        UI.renderDashboard();
        UI.refreshOperationalUi();
              ToastService.show('Dados atualizados', 'success');
      } else {
        ToastService.show('Sem conexão com a API', 'error');
      }
    } finally {
      stop();
    }
  };

  // Wiring dos botões de refresh em todas as páginas
  document.getElementById('refreshBtn')?.addEventListener('click', () => manualRefresh('refreshBtn'));
  document.getElementById('refreshOpBtn')?.addEventListener('click', () => manualRefresh('refreshOpBtn'));
  document.getElementById('refreshAtdBtn')?.addEventListener('click', () => manualRefresh('refreshAtdBtn'));

  UI.restoreLastPageIfAuthed();
  if (Controllers.auth._isAuthenticated() && Store.currentPage !== 'chat') {
    Controllers.teamChat.startBackgroundNotify();
  }
}

// Inicia quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initApp(); });
} else {
  initApp();
}

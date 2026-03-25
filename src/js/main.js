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
 * @typedef {{ id: number, titulo: string, responsavel: string, prazo: string, status: string, prioridade: string }} Task
 */

/**
 * Modelo de tarefa operacional (Rompimentos / Troca de Poste)
 * @typedef {{ id: number, titulo: string, responsavel: string, categoria: string, prazo: string, prioridade: string, descricao: string, status: OpStatus, historico: HistoryEntry[], criadaEm: string }} OpTask
 * @typedef {'Criada'|'Em andamento'|'Concluída'|'Finalizada'|'Cancelada'} OpStatus
 * @typedef {{ status: OpStatus, timestamp: string, autor: string }} HistoryEntry
 */

/**
 * Configuração do Webhook
 * @typedef {{ url: string, events: { andamento: boolean, concluida: boolean, finalizada: boolean } }} WebhookConfig
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
  };

  /**
   * Base da API: `APP_CONFIG.apiBaseUrl` (string), ou mesma origem + `/api` em produção.
   * Em localhost / 127.0.0.1 não ativa automático (Live Server não roda PHP/Node) — use só localStorage ou defina a URL manualmente.
   */
  const resolveApiBaseUrl = () => {
    const raw = APP_CONFIG.apiBaseUrl;
    if (raw === false) return '';
    if (typeof raw === 'string') {
      const trimmed = raw.trim().replace(/\/$/, '');
      if (trimmed) return trimmed;
      return '';
    }
    try {
      const { protocol, hostname, origin } = window.location;
      if (protocol !== 'http:' && protocol !== 'https:') return '';
      const h = String(hostname || '').toLowerCase();
      if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.local')) {
        return '';
      }
      return `${origin}/api`.replace(/\/$/, '');
    } catch {
      /* ignore */
    }
    return '';
  };

  const ApiService = {
    baseUrl: resolveApiBaseUrl(),
    enabled() {
      return Boolean(this.baseUrl);
    },
    async request(path, options = {}) {
      if (!this.enabled()) return null;
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
          ...options,
        });
        if (!response.ok) return null;
        const text = await response.text();
        const head = text.trim().slice(0, 12).toLowerCase();
        if (!text.trim() || head.startsWith('<!') || head.startsWith('<?') || head.startsWith('<htm')) {
          return null;
        }
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    async requestAny(paths, options = {}) {
      for (const path of paths) {
        const result = await this.request(path, options);
        if (result) return result;
      }
      return null;
    },
    async getBootstrap() {
      return this.requestAny(['/bootstrap', '/bootstrap.php']);
    },
    async login(username, password) {
      return this.requestAny(
        ['/login', '/login.php'],
        {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        },
      );
    },
    async saveTask(task) {
      return this.requestAny(['/tasks', '/tasks.php'], { method: 'POST', body: JSON.stringify(task) });
    },
    async saveOpTask(task) {
      return this.requestAny(['/op-tasks', '/op_tasks.php'], { method: 'POST', body: JSON.stringify(task) });
    },
    async deleteOpTask(id, cascade = false) {
      return this.requestAny(['/op-tasks', '/op_tasks.php'], { method: 'DELETE', body: JSON.stringify({ id, cascade }) });
    },
    async saveConfig(payload) {
      return this.requestAny(['/config', '/config.php'], { method: 'POST', body: JSON.stringify(payload) });
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

  const WEBHOOK_EVENTS_DEFAULT = { andamento: true, concluida: true, finalizada: true };
  /** @type {WebhookConfig} */
  const webhookConfig = {
    url: '',
    events: { ...WEBHOOK_EVENTS_DEFAULT },
    ...readLocal(STORAGE_KEYS.webhook, {}),
  };

  /** @type {PlannerConfig} */
  const plannerConfig = { note: '' };
  const localNote = readLocal(STORAGE_KEYS.note, '');
  if (typeof localNote === 'string') plannerConfig.note = localNote;

  const calendarStorageKey = 'planner.calendar.notes.v2';
  let calendarNotes = [];
  try {
    const raw = localStorage.getItem(calendarStorageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) calendarNotes = parsed;
    }
  } catch {
    calendarNotes = [];
  }
  let nextCalendarNoteId = calendarNotes.reduce((max, n) => Math.max(max, n.id || 0), 0) + 1;
  const persistCalendarNotes = () => {
    try { localStorage.setItem(calendarStorageKey, JSON.stringify(calendarNotes)); } catch {}
  };
  const persistSnapshot = () => {
    writeLocal(STORAGE_KEYS.tasks, tasks);
    writeLocal(STORAGE_KEYS.opTasks, opTasks);
    writeLocal(STORAGE_KEYS.webhook, webhookConfig);
    writeLocal(STORAGE_KEYS.note, plannerConfig.note || '');
  };
  const syncUpTask = (task) => { ApiService.saveTask(task); };
  const syncUpOpTask = (task) => { ApiService.saveOpTask(task); };
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
  let editingTaskId = null;
  let editingOpTaskId = null;
  let sidebarOpen = true;

  return {
    // Tasks
    getTasks:        ()      => [...tasks],
    addTask:         (data)  => {
      const t = { id: nextTaskId++, ...data };
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
    findTask:        (id)    => tasks.find(t => t.id === id),

    // OpTasks
    getOpTasks:      ()           => [...opTasks],
    getOpTasksByCategory: (cat)   => opTasks.filter(t => t.categoria === cat),
    addOpTask:       (data)       => {
      const t = { id: nextOpTaskId++, ...data, criadaEm: new Date().toISOString(), historico: [{ status: 'Criada', timestamp: new Date().toISOString(), autor: 'Sistema' }] };
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

    // Config
    getPlannerConfig: () => ({ ...plannerConfig }),
    setPlannerConfig: (data) => {
      Object.assign(plannerConfig, data);
      persistSnapshot();
      syncConfig();
    },

    // Calendar Notes
    getCalendarNotes: () => [...calendarNotes],
    getCalendarNotesByDate: (isoDate) => calendarNotes.filter(n => n.date === isoDate),
    addCalendarNote: (data) => {
      const note = { id: nextCalendarNoteId++, ...data, createdAt: new Date().toISOString() };
      calendarNotes.push(note);
      persistCalendarNotes();
      ApiService.requestAny(['/calendar-notes', '/calendar_notes.php'], { method: 'POST', body: JSON.stringify(note) });
      return note;
    },
    removeCalendarNote: (id) => {
      const sizeBefore = calendarNotes.length;
      calendarNotes = calendarNotes.filter(n => n.id !== id);
      if (calendarNotes.length !== sizeBefore) persistCalendarNotes();
      ApiService.requestAny(['/calendar-notes', '/calendar_notes.php'], { method: 'DELETE', body: JSON.stringify({ id }) });
    },
    bootstrapFromRemote: async () => {
      const payload = await ApiService.getBootstrap();
      if (!payload || !payload.ok) return false;
      if (Array.isArray(payload.tasks)) {
        tasks.splice(0, tasks.length, ...payload.tasks);
        nextTaskId = tasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;
      }
      if (Array.isArray(payload.opTasks)) {
        opTasks.splice(0, opTasks.length, ...payload.opTasks);
        nextOpTaskId = opTasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;
      }
      if (payload.webhookConfig && typeof payload.webhookConfig === 'object') {
        Object.assign(webhookConfig, payload.webhookConfig);
      }
      if (payload.plannerConfig && typeof payload.plannerConfig === 'object') {
        Object.assign(plannerConfig, payload.plannerConfig);
      }
      if (Array.isArray(payload.calendarNotes)) {
        calendarNotes = payload.calendarNotes;
        nextCalendarNoteId = calendarNotes.reduce((max, n) => Math.max(max, n.id || 0), 0) + 1;
      }
      applyDefaultWebhookUrlIfNeeded();
      persistSnapshot();
      persistCalendarNotes();
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
    get editingTaskId()     { return editingTaskId; },
    set editingTaskId(v)    { editingTaskId = v; },
    get editingOpTaskId()   { return editingOpTaskId; },
    set editingOpTaskId(v)  { editingOpTaskId = v; },
    get sidebarOpen()       { return sidebarOpen; },
    set sidebarOpen(v)      { sidebarOpen = v; },
  };
})();


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

  /** Cada linha não vazia em negrito (*sintaxe Google Chat*); linhas vazias mantidas. */
  _rompimentoBoldLines(lines) {
    return lines
      .map(line => {
        if (line === '' || line === null || line === undefined) return '';
        return `*${this._chatSafe(line)}*`;
      })
      .join('\n');
  },

  /**
   * Se o título for só coordenadas (lat, lon), devolve texto normalizado em uma linha para copiar.
   */
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
    const tecnico = task.responsavel || 'Não informado';
    const regiao = (task.regiao || '').trim() || 'Não informada';
    const titulo = (task.titulo || '').trim();
    const descExtra = (task.descricao || '').trim();
    const loc = this._trocaPosteTitleAsLocation(titulo);
    const taskId = task.taskCode || `POS-${String(task.id || '').padStart(4, '0')}`;

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
    ]);

    const coordLabel = loc.mode === 'coords' ? '📍 COORDENADAS' : '📍 LOCAL / DESCRIÇÃO';
    const locationBlock = `*${this._chatSafe(coordLabel)}*\n${this._chatSafe(loc.line)}`;

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

  /**
   * Envia mensagem formatada ao canal configurado
   * @param {'andamento'|'concluida'|'finalizada'} event
   * @param {OpTask|Task} task
   * @param {'Rompimentos'|'Troca de Poste'|null} category
   */
  async send(event, task, category = null) {
    const config = Store.getWebhookConfig();
    if (!config.url || !config.events[event]) return;

    const message = this._buildMessage(event, task, category);
    await this._post(config.url, message);
  },

  /** Monta o payload formatado */
  _buildMessage(event, task, category) {
    const opCat = String(task?.categoria ?? '').trim();

    if (opCat === 'troca-poste') {
      return this._buildTrocaPosteMessage(event, task);
    }

    if (opCat === 'rompimentos' && event === 'andamento') {
      const setor = task.setor || 'Não informado';
      const regiao = task.regiao || 'Não informada';
      const tecnico = task.responsavel || 'Não informado';
      const localizacao = task.coordenadas || 'Não informada';
      const endereco = task.localizacaoTexto || 'Não informado';
      const taskId = task.taskCode || `ROM-${String(task.id || '').padStart(4, '0')}`;
      const head = this._rompimentoBoldLines([
        '🚨 ALERTA CRÍTICO — ROMPIMENTO DETECTADO 🚨',
        '',
        '⚠️ ROMPIMENTO confirmado no sistema. Ação imediata necessária!',
        '',
        `📌 SETOR / CTO: ${setor}`,
        `🌎 REGIÃO: ${regiao}`,
        `👨‍🔧 TÉCNICO RESPONSÁVEL: ${tecnico}`,
      ]);
      const coordBlock = `*${this._chatSafe('📍 COORDENADAS')}*\n${this._chatSafe(localizacao)}`;
      const tail = this._rompimentoBoldLines([
        '',
        `🏠 ENDEREÇO: ${endereco}`,
        '',
        `🆔 ID DA TAREFA: ${taskId}`,
      ]);
      return { text: `${head}\n\n${coordBlock}${tail}` };
    }

    if (opCat === 'rompimentos' && (event === 'concluida' || event === 'finalizada')) {
      const setor = task.setor || 'Não informado';
      const regiao = task.regiao || 'Não informada';
      const tecnico = task.responsavel || 'Não informado';
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
      ToastService.show('Notificação enviada ao Google Chat', 'success');
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
    el.innerHTML = `<span class="toast-icon">${this._icons[type] || this._icons.info}</span><span class="toast-msg">${message}</span>`;
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
  close(id) { document.getElementById(id)?.classList.remove('open'); },
  closeAll() { document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); },
};


/* ─────────────────────────────────────────────────────────────
   TASK SERVICE — Regras de negócio das tarefas gerais
───────────────────────────────────────────────────────────── */
const TaskService = {
  _opCategoryLabelMap: {
    'rompimentos': 'Rompimentos',
    'troca-poste': 'Troca de Poste',
    'atendimento-cliente': 'Atendimento ao Cliente',
  },

  _isDoneStatus(status) {
    return status === 'Concluída' || status === 'Finalizada';
  },

  _isPendingStatus(status) {
    return status === 'Pendente' || status === 'Criada' || status === 'Backlog';
  },

  _isProgressStatus(status) {
    return status === 'Em andamento';
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
    const weekStr = Utils.addDaysIso(7);
    const filter = Store.dashboardFilter;
    const query  = Store.dashboardSearch;

    return this.getAllDashboardTasks().filter(t => {
      const matchFilter =
        filter === 'all' ||
        (filter === 'today' && t.prazo === tod) ||
        (filter === 'week'  && t.prazo >= tod && t.prazo <= weekStr);
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
  },

  /** Mapeia categoria → label legível */
  _categoryLabels: {
    'rompimentos': 'Rompimentos',
    'troca-poste': 'Troca de Poste',
    'atendimento-cliente': 'Atendimento ao Cliente',
  },

  /**
   * Altera o status de uma tarefa operacional e dispara webhook se necessário
   * @param {number} id
   * @param {OpStatus} newStatus
   */
  changeStatus(id, newStatus) {
    const task = Store.updateOpTaskStatus(id, newStatus);
    if (!task) return;

    const event = this._statusToEvent[newStatus];
    if (event) {
      const categoryLabel = this._categoryLabels[task.categoria] || task.categoria;
      WebhookService.send(event, task, categoryLabel);
    }
  },

  /** Retorna tarefas operacionais filtradas por categoria e busca */
  getFilteredByCategory(category) {
    const query = Store.opSearch.toLowerCase();
    return Store.getOpTasksByCategory(category).filter(t =>
      !query ||
      t.titulo.toLowerCase().includes(query) ||
      t.responsavel.toLowerCase().includes(query) ||
      t.descricao.toLowerCase().includes(query)
    );
  },

  /** Retorna contagens por status para estatísticas */
  getStatusCounts() {
    const counts = { Criada: 0, 'Em andamento': 0, Concluída: 0, Finalizada: 0, Backlog: 0 };
    Store.getOpTasks().forEach(t => {
      if (t.status === 'Backlog' || t.status === 'Criada') {
        counts.Criada++;
        counts.Backlog++;
        return;
      }
      if (counts[t.status] !== undefined) counts[t.status]++;
    });
    return counts;
  },
};

/* ─────────────────────────────────────────────────────────────
   CALENDAR SERVICE — Agenda mensal com anotações
───────────────────────────────────────────────────────────── */
const CalendarService = {
  currentMonthDate: (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  })(),
  selectedDateIso: Utils.todayIso(),

  weekdayLabels: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'],

  getMonthMatrix(monthDate) {
    const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const start = new Date(first);
    start.setDate(start.getDate() - first.getDay());

    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push({
        iso: Utils.toIsoLocal(d),
        day: d.getDate(),
        month: d.getMonth(),
        year: d.getFullYear(),
        isCurrentMonth: d.getMonth() === monthDate.getMonth(),
      });
    }
    return days;
  },

  _mapTaskToCalendarItem(task) {
    return {
      id: task.id,
      source: task.source,
      sourceLabel: task.sourceLabel,
      title: task.titulo,
      description: task.descricao || '',
      status: task.effectiveStatus || task.status,
      priority: task.prioridade,
      removable: false,
    };
  },

  _mapNoteToCalendarItem(note) {
    return {
      id: note.id,
      source: 'note',
      sourceLabel: 'Anotação',
      title: note.title,
      description: note.description || '',
      status: 'Anotado',
      priority: note.priority,
      removable: true,
    };
  },

  getItemsByDate(isoDate) {
    const tasks = TaskService.getAllDashboardTasks()
      .filter(t => t.prazo === isoDate)
      .map(t => this._mapTaskToCalendarItem(t));
    const notes = Store.getCalendarNotesByDate(isoDate).map(n => this._mapNoteToCalendarItem(n));
    return [...tasks, ...notes];
  },

  getDayMeta(isoDate) {
    const tasks = TaskService.getAllDashboardTasks().filter(t => t.prazo === isoDate);
    const notes = Store.getCalendarNotesByDate(isoDate);
    return {
      total: tasks.length + notes.length,
      dashboard: tasks.filter(t => t.source === 'dashboard').length,
      operacional: tasks.filter(t => t.source === 'operacional').length,
      note: notes.length,
    };
  },

  createNote(data) {
    return Store.addCalendarNote(data);
  },

  removeNote(id) {
    Store.removeCalendarNote(id);
  },
};

/* ─────────────────────────────────────────────────────────────
   REPORTS SERVICE — Consolidação e exportação
───────────────────────────────────────────────────────────── */
const ReportsService = {
  _sourceLabel(task) {
    if (task.source === 'dashboard') return 'Dashboard';
    return task.sourceLabel || 'Operacional';
  },

  _normalize(task) {
    const status = task.effectiveStatus || task.status;
    const isDone = ['Concluída', 'Finalizada'].includes(status);
    const isLate = status === 'Atrasada' || (!!task.prazo && task.prazo < Utils.todayIso() && !isDone && status !== 'Cancelada');
    return {
      ...task,
      status,
      sourceTag: task.source === 'dashboard' ? 'dashboard' : (task.categoria || 'operacional'),
      sourceText: this._sourceLabel(task),
      isLate,
      isDone,
    };
  },

  _periodStart(period) {
    if (period === 'all') return null;
    if (period === 'today') return Utils.todayIso();
    if (period === 'week') return Utils.addDaysIso(-7);
    if (period === 'month') return Utils.addDaysIso(-30);
    return null;
  },

  getFilteredTasks(period = 'week', category = 'all') {
    const start = this._periodStart(period);
    return TaskService.getAllDashboardTasks()
      .map(t => this._normalize(t))
      .filter(t => {
        const matchPeriod = !start || (t.prazo && t.prazo >= start && t.prazo <= Utils.todayIso());
        const matchCategory =
          category === 'all' ||
          (category === 'dashboard' && t.source === 'dashboard') ||
          (category === 'rompimentos' && t.categoria === 'rompimentos') ||
          (category === 'troca-poste' && t.categoria === 'troca-poste') ||
          (category === 'atendimento-cliente' && t.categoria === 'atendimento-cliente');
        return matchPeriod && matchCategory;
      });
  },

  getMetrics(tasks) {
    const total = tasks.length;
    const done = tasks.filter(t => t.isDone).length;
    const progress = tasks.filter(t => t.status === 'Em andamento').length;
    const late = tasks.filter(t => t.isLate).length;
    const doneRate = total ? Math.round((done / total) * 100) : 0;
    return { total, done, progress, late, doneRate };
  },

  getStatusDistribution(tasks) {
    const statuses = ['Pendente', 'Criada', 'Backlog', 'Em andamento', 'Concluída', 'Finalizada', 'Atrasada'];
    const counts = statuses.map(status => ({
      status,
      count: tasks.filter(t => t.status === status).length,
    })).filter(s => s.count > 0);
    const max = Math.max(...counts.map(c => c.count), 1);
    return counts.map(c => ({ ...c, pct: Math.round((c.count / max) * 100) }));
  },

  getLateRows(tasks) {
    return tasks
      .filter(t => t.isLate)
      .sort((a, b) => (a.prazo || '').localeCompare(b.prazo || ''))
      .map(t => {
        const diffDays = t.prazo
          ? Math.max(1, Math.floor((new Date(Utils.todayIso()) - new Date(t.prazo)) / 86400000))
          : 0;
        return { ...t, diffDays };
      });
  },

  toCsv(tasks) {
    const header = ['ID', 'Tarefa', 'Origem', 'Responsável', 'Prazo', 'Status', 'Prioridade', 'Atrasada'];
    const rows = tasks.map(t => [
      t.id,
      t.titulo,
      t.sourceText,
      t.responsavel,
      t.prazo || '',
      t.status,
      t.prioridade || '',
      t.isLate ? 'Sim' : 'Não',
    ]);
    return [header, ...rows]
      .map(cols => cols.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
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
  _normalizeAtdStatus(status) {
    if (status === 'Criada') return 'Backlog';
    return status;
  },
  /* ── Helpers de badge ───────────────────────────────────── */
  _statusBadgeMap: {
    'Backlog':      's-pendente',
    'Pendente':     's-pendente',
    'Em andamento': 's-andamento',
    'Concluída':    's-concluida',
    'Finalizada':   's-finalizada',
    'Atrasada':     's-atrasada',
    'Cancelada':    's-cancelada',
    'Criada':       's-pendente',
  },
  _priorityBadgeMap: { Alta: 'p-high', Média: 'p-med', Baixa: 'p-low' },

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
    const counts = TaskService.getCounts();
    document.getElementById('count-pending').textContent  = counts.pending;
    document.getElementById('count-progress').textContent = counts.progress;
    document.getElementById('count-done').textContent     = counts.done;
    document.getElementById('count-late').textContent     = counts.late;
    document.getElementById('sub-pending').textContent    = `${counts.total} total`;
    document.getElementById('sub-progress').textContent   = counts.progress ? 'Em execução' : 'Nenhuma ativa';
    document.getElementById('sub-done').textContent       = counts.done    ? 'Finalizadas'  : 'Nenhuma ainda';
    document.getElementById('sub-late').textContent       = counts.late    ? 'Atenção necessária' : 'Tudo em dia';

    const badgeLate = document.getElementById('badge-late');
    badgeLate.textContent   = counts.late;
    badgeLate.style.display = counts.late ? 'inline' : 'none';
  },

  /* ── Dashboard Task Table ───────────────────────────────── */
  renderTaskTable() {
    const tbody = document.getElementById('taskTableBody');
    const list  = TaskService.getFilteredTasks();
    const tod   = Utils.todayIso();

    if (!list.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Nenhuma tarefa encontrada</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(t => {
      const isLate = t.effectiveStatus === 'Atrasada' || (t.prazo && t.prazo < tod && !['Concluída','Finalizada'].includes(t.status));
      const isDone = ['Concluída','Finalizada'].includes(t.effectiveStatus);
      const color  = Utils.getAvatarColor(t.responsavel);
      const checkMarkup = `<div class="task-check ${isDone ? 'done' : ''}" data-check="${t.id}" data-check-source="${t.source}" role="checkbox" aria-checked="${isDone}" aria-label="Marcar como concluída" tabindex="0">
             ${isDone ? this.checkSvg() : ''}
           </div>`;

      return `
        <tr data-id="${t.id}" data-source="${t.source}">
          <td>
            <div class="task-name-cell">
              ${checkMarkup}
              <span style="${isDone ? 'text-decoration:line-through;opacity:.45' : ''}">${t.titulo}</span>
            </div>
          </td>
          <td>
            <div class="assignee">
              <div class="av-sm" style="background:${color};color:#0a0c0a" aria-hidden="true">${Utils.getInitials(t.responsavel)}</div>
              ${t.responsavel}
            </div>
          </td>
          <td class="date-cell ${isLate ? 'date-late' : ''}">${Utils.formatDate(t.prazo)}</td>
          <td>${this.statusBadge(t.effectiveStatus)}</td>
          <td>${this.priorityBadge(t.prioridade)} <span style="margin-left:6px;color:var(--white4);font-size:10px;font-family:var(--font-mono)">· ${t.sourceLabel}</span></td>
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
    const atendimentoCount = allOpTasks.filter(t => t.categoria === 'atendimento-cliente').length;
    const tabRompimentos = document.getElementById('tab-count-rompimentos');
    const tabTrocaPoste = document.getElementById('tab-count-troca-poste');
    const tabAtendimento = document.getElementById('tab-count-atendimento-cliente');
    if (tabRompimentos) tabRompimentos.textContent = String(rompimentosCount);
    if (tabTrocaPoste) tabTrocaPoste.textContent = String(trocaPosteCount);
    if (tabAtendimento) tabAtendimento.textContent = String(atendimentoCount);
  },

  /* ── Kanban Board ───────────────────────────────────────── */
  renderKanban() {
    const category = Store.currentOpCategory;
    const tasks    = OpTaskService.getFilteredByCategory(category);
    const tod      = Utils.todayIso();
    const isAtendimento = category === 'atendimento-cliente';
    const board = document.getElementById('kanbanBoard');
    if (isAtendimento) {
      board?.classList.add('atd-mode');
      this.renderAtendimentoList(tasks);
      return;
    }
    board?.classList.remove('atd-mode');

    const columns = [
      { status: 'Criada',       key: 'col-criada',     label: 'Criada'       },
      { status: 'Em andamento', key: 'col-andamento',  label: 'Em andamento' },
      { status: 'Concluída',    key: 'col-concluida',  label: 'Concluída'    },
      { status: 'Finalizada',   key: 'col-finalizada', label: 'Finalizada'   },
    ];

    const nextStatusMap = {
      'Criada':       ['Em andamento'],
      'Em andamento': ['Concluída'],
      'Concluída':    ['Finalizada'],
      'Finalizada':   [],
    };

    const statusLabels = {
      'Em andamento': 'Iniciar',
      'Concluída':    'Concluir',
      'Finalizada':   'Finalizar',
    };

    const statusActionClass = {
      'Em andamento': 'to-andamento',
      'Concluída':    'to-concluida',
      'Finalizada':   'to-finalizada',
    };

    board.innerHTML = columns.map(col => {
      const colTasks = tasks.filter(t => t.status === col.status);

      const cards = colTasks.length
        ? colTasks
          .filter(t => !(isAtendimento && t.parentTaskId))
          .map(t => {
            const isLate = t.prazo && t.prazo < tod && !['Concluída','Finalizada'].includes(t.status);
            const childTasks = isAtendimento
              ? tasks.filter(c => Number(c.parentTaskId) === Number(t.id))
              : [];
            const parentTag = isAtendimento
              ? `<span class="badge s-info" style="margin-bottom:6px">LISTA</span>`
              : '';
            const nextStatuses = nextStatusMap[t.status] || [];
            const actionBtns = nextStatuses.map(ns =>
              `<button class="status-action-btn ${statusActionClass[ns]}" data-op-id="${t.id}" data-to-status="${ns}">${statusLabels[ns]}</button>`
            ).join('');
            const childHtml = childTasks.length
              ? `<div class="subtask-list">${childTasks.map(c => `
                   <div class="subtask-item">
                     <span>${c.taskCode || ''} · ${c.titulo}</span>
                     <button type="button" data-open-subtask="${c.id}">${c.status}</button>
                   </div>
                 `).join('')}</div>`
              : '';

            return `
              <article class="kanban-card ${this._lastMovedOpTask && this._lastMovedOpTask.id === t.id && this._lastMovedOpTask.status === t.status ? 'just-moved' : ''}" data-op-id="${t.id}" data-op-status="${t.status}" draggable="true" aria-label="${t.titulo}">
                ${parentTag}
                <div class="kanban-card-title">${t.titulo}</div>
                <div class="kanban-card-date">${t.taskCode || ''}</div>
                <div class="kanban-card-meta">
                  <div class="kanban-card-assignee">
                    <div class="av-sm" style="background:${Utils.getAvatarColor(t.responsavel)};color:#0a0c0a;width:20px;height:20px;font-size:8px" aria-hidden="true">${Utils.getInitials(t.responsavel)}</div>
                    ${t.responsavel}
                  </div>
                  <div class="kanban-card-date ${isLate ? 'late' : ''}">${Utils.formatDate(t.prazo)}</div>
                </div>
                <div class="kanban-card-actions">${actionBtns}</div>
                ${childHtml}
              </article>
            `;
          }).join('')
        : `<div class="kanban-empty">Nenhuma tarefa</div>`;

      return `
        <div class="kanban-col ${col.key}" role="group" aria-label="Coluna ${col.label}">
          <div class="kanban-col-header">
            <span class="kanban-col-title">${col.label}</span>
            <span class="kanban-col-count">${colTasks.length}</span>
          </div>
          <div class="kanban-cards" data-col-status="${col.status}">${cards}</div>
          <button class="kanban-col-add" data-add-col="${col.status}" aria-label="Adicionar tarefa na coluna ${col.label}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Adicionar
          </button>
        </div>
      `;
    }).join('');

    // Eventos do kanban
    board.querySelectorAll('.status-action-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id       = +btn.dataset.opId;
        const toStatus = btn.dataset.toStatus;
        this._lastMovedOpTask = { id, status: toStatus };
        OpTaskService.changeStatus(id, toStatus);
        this.renderOpPage();
        setTimeout(() => { this._lastMovedOpTask = null; }, 520);
        UI.renderCalendarPage();
        UI.renderReportsPage();
        ToastService.show(`Tarefa movida para "${toStatus}"`, 'success');
      });
    });

    board.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('click', e => {
        const subtaskBtn = e.target.closest('[data-open-subtask]');
        if (subtaskBtn) {
          Controllers.opTask.openEditModal(+subtaskBtn.dataset.openSubtask);
          return;
        }
        if (e.target.closest('.status-action-btn')) return;
        const id = +card.dataset.opId;
        Controllers.opTask.openEditModal(id);
      });
    });

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
        this._lastMovedOpTask = { id: draggedId, status: targetStatus };
        OpTaskService.changeStatus(draggedId, targetStatus);
        this.renderOpPage();
        setTimeout(() => { this._lastMovedOpTask = null; }, 520);
        UI.renderCalendarPage();
        UI.renderReportsPage();
        ToastService.show(`Tarefa movida para "${targetStatus}"`, 'success');
      });
    });

    board.querySelectorAll('.kanban-col-add').forEach(btn => {
      btn.addEventListener('click', () => {
        Controllers.opTask.openNewModal();
      });
    });
  },

  renderAtendimentoList(tasks) {
    const board = document.getElementById('kanbanBoard');
    const statusLabel = (status) => status === 'Concluída' ? 'Concluído' : status;
    const statusBadgeAtd = (status) => this.statusBadge(status).replace(status, statusLabel(status));
    const normalized = tasks.map(t => {
      const normalizedStatus = this._normalizeAtdStatus(t.status);
      if (t.parentTaskId && normalizedStatus === 'Backlog') {
        return { ...t, status: 'Em andamento' };
      }
      return { ...t, status: normalizedStatus };
    });
    const parentTasks = normalized.filter(t => t.isParentTask || !t.parentTaskId);
    const childTasksAll = normalized.filter(t => t.parentTaskId);

    const sortByDefault = (a, b) => {
      const byDate = String(a.prazo || '9999-12-31').localeCompare(String(b.prazo || '9999-12-31'));
      if (byDate !== 0) return byDate;
      return String(a.criadaEm || '').localeCompare(String(b.criadaEm || ''));
    };

    const getChildren = (parentId) =>
      childTasksAll
        .filter(t => Number(t.parentTaskId) === Number(parentId))
        .sort(sortByDefault);

    const totals = {
      listas: parentTasks.length,
      subtarefas: childTasksAll.length,
      concluidas: childTasksAll.filter(t => ['Concluída', 'Finalizada'].includes(t.status)).length,
      emAndamento: childTasksAll.filter(t => t.status === 'Em andamento').length,
    };

    const renderSubtaskItem = (child, parentStatus) => `
      <div class="atd-subtask-row ${this._atdLastMoved?.id === child.id ? 'just-moved' : ''}" data-task-row-id="${child.id}" data-open-subtask="${child.id}" draggable="true" data-drag-subtask="${child.id}">
        <span class="atd-kind-badge child">Filha</span>
        <span class="atd-subtask-title">${child.titulo}</span>
        <span class="atd-parent-meta">${child.taskCode || ''}</span>
        <span class="atd-parent-meta">${child.responsavel}</span>
        <span class="atd-parent-meta">${Utils.formatDate(child.prazo)}</span>
        <span class="atd-status-cell">${statusBadgeAtd(child.status)}</span>
        <div class="atd-subtask-actions">
          <select class="atd-status-select" data-change-status="${child.id}">
            ${['Em andamento', 'Concluída', 'Finalizada'].map(s => `<option value="${s}" ${s === child.status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}
          </select>
          <button class="atd-action-btn" data-edit-subtask="${child.id}">Editar</button>
          <button class="atd-action-btn danger" data-delete-subtask="${child.id}">Excluir</button>
        </div>
      </div>
    `;

    const renderTaskItem = (parent, groupStatus) => {
      const children = getChildren(parent.id);
      const expanded = this._atendimentoExpanded[parent.id] !== false;
      const doneCount = children.filter(c => ['Concluída', 'Finalizada'].includes(c.status)).length;
      const allDone = children.length > 0 && doneCount === children.length;
      return `
        <section class="atd-parent-card" data-parent-id="${parent.id}">
          <div class="atd-parent-row ${this._atdLastMoved?.id === parent.id ? 'just-moved' : ''}" data-task-row-id="${parent.id}" data-toggle-parent="${parent.id}" role="button" tabindex="0" aria-expanded="${expanded ? 'true' : 'false'}">
            <span class="atd-chevron ${expanded ? 'open' : ''}">▾</span>
            <span class="atd-kind-badge parent">Pai</span>
            <span class="atd-parent-title">${parent.titulo}</span>
            <span class="atd-parent-meta">${parent.taskCode || ''}</span>
            <span class="atd-parent-meta">${parent.responsavel}</span>
            <span class="atd-parent-meta">${Utils.formatDate(parent.prazo)}</span>
            <span class="atd-status-cell">${statusBadgeAtd(parent.status)}</span>
            <span class="atd-parent-meta">${children.length ? `${doneCount}/${children.length} concluídas` : 'Sem subtarefas'}${allDone ? ' · OK' : ''}</span>
            <span class="atd-row-actions">
              <select class="atd-status-select" data-change-status="${parent.id}">
                ${this._atdStatusOrder.map(s => `<option value="${s}" ${s === parent.status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}
              </select>
              <button class="atd-action-btn" data-edit-parent="${parent.id}">Editar</button>
              <button class="atd-action-btn danger" data-delete-parent="${parent.id}">Excluir</button>
            </span>
          </div>
          <div class="atd-subtasks ${expanded ? 'open' : ''}" data-drop-parent="${parent.id}">
            ${children.length ? children.map(c => renderSubtaskItem(c, parent.status)).join('') : `<div class="calendar-empty" style="padding:12px 8px">Sem subtarefas nesta lista.</div>`}
            <button class="kanban-col-add" style="margin:8px 0 0" data-add-child="${parent.id}" data-group-status="${groupStatus}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Adicionar subtarefa
            </button>
          </div>
        </section>
      `;
    };

    const renderTaskGroup = (status) => {
      const groupParents = parentTasks
        .filter(t => t.status === status)
        .sort(sortByDefault);
      const expanded = this._atendimentoGroupExpanded[status] !== false;
      return `
        <section class="atd-group" data-group="${status}">
          <header class="atd-group-head">
            <button type="button" class="atd-group-toggle" data-toggle-group="${status}">
              <span class="atd-chevron ${expanded ? 'open' : ''}">▾</span>
              <span class="atd-group-title">${status.toUpperCase()}</span>
              <span class="atd-group-count">${groupParents.length}</span>
            </button>
          </header>
          <div class="atd-group-body ${expanded ? 'open' : ''}">
            ${groupParents.length
              ? `<div class="atd-table-head"><span></span><span>Tipo</span><span>Tarefa</span><span>ID</span><span>Responsável</span><span>Prazo</span><span>Status</span><span>Progresso</span><span>Ações</span></div>${groupParents.map(p => renderTaskItem(p, status)).join('')}`
              : `<div class="calendar-empty">Nenhuma tarefa neste grupo.</div>`}
          </div>
        </section>
      `;
    };

    board.innerHTML = `
      <div class="atd-list-wrap">
        <div class="atd-list-toolbar">
          <span class="panel-title">Atendimento ao Cliente · Listas e Subtarefas</span>
          <div class="atd-toolbar-right">
            <div class="atd-kpi-group" aria-label="Indicadores de atendimento">
              <span class="atd-kpi">Listas: <strong>${totals.listas}</strong></span>
              <span class="atd-kpi">Subtarefas: <strong>${totals.subtarefas}</strong></span>
              <span class="atd-kpi">Em andamento: <strong>${totals.emAndamento}</strong></span>
              <span class="atd-kpi">Concluídas: <strong>${totals.concluidas}</strong></span>
            </div>
            <button class="primary-btn" id="addAtdParentBtn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nova lista
            </button>
          </div>
        </div>
        <div class="atd-groups">
          ${this._atdStatusOrder.map(renderTaskGroup).join('')}
        </div>
      </div>
    `;

    document.getElementById('addAtdParentBtn')?.addEventListener('click', () => {
      Controllers.opTask.openNewModal({ kind: 'parent', category: 'atendimento-cliente', status: 'Backlog' });
    });

    board.querySelectorAll('[data-toggle-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        const status = btn.dataset.toggleGroup;
        this._atendimentoGroupExpanded[status] = !(this._atendimentoGroupExpanded[status] !== false);
        this.renderAtendimentoList(normalized);
      });
    });

    board.querySelectorAll('[data-toggle-parent]').forEach(btn => {
      const toggleParent = (e) => {
        const parentId = Number(e.currentTarget.dataset.toggleParent);
        if (e.target.closest('.atd-row-actions')) return;
        this._atendimentoExpanded[parentId] = !(this._atendimentoExpanded[parentId] !== false);
        this.renderAtendimentoList(normalized);
      };
      btn.addEventListener('click', toggleParent);
      btn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleParent(e);
        }
      });
    });

    board.querySelectorAll('[data-change-status]').forEach(select => {
      select.addEventListener('change', e => {
        e.stopPropagation();
        const id = Number(select.dataset.changeStatus);
        const newStatus = select.value;
        const task = Store.findOpTask(id);
        if (!task) return;
        const isChild = Boolean(task.parentTaskId);
        const targetGroup = isChild
          ? this._normalizeAtdStatus(Store.findOpTask(Number(task.parentTaskId))?.status || 'Backlog')
          : newStatus;
        this._atdLastMoved = { id, status: targetGroup };
        this._atendimentoGroupExpanded[targetGroup] = true;
        OpTaskService.changeStatus(id, newStatus);
        UI.renderOpPage();
        UI.renderCalendarPage();
        UI.renderReportsPage();
      });
    });

    board.querySelectorAll('[data-edit-parent]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        Controllers.opTask.openEditModal(Number(btn.dataset.editParent));
      });
    });
    board.querySelectorAll('[data-delete-parent]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        Controllers.opTask.deleteTask(Number(btn.dataset.deleteParent), { cascade: true });
      });
    });
    board.querySelectorAll('[data-add-child]').forEach(btn => {
      btn.addEventListener('click', e => {
        const parentId = Number(e.currentTarget.dataset.addChild);
        Controllers.opTask.openNewModal({ kind: 'child', parentTaskId: parentId, category: 'atendimento-cliente' });
      });
    });

    board.querySelectorAll('[data-open-subtask]').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.atd-subtask-actions')) return;
        Controllers.opTask.openEditModal(Number(row.dataset.openSubtask));
      });
    });
    board.querySelectorAll('[data-edit-subtask]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        Controllers.opTask.openEditModal(Number(btn.dataset.editSubtask));
      });
    });
    board.querySelectorAll('[data-delete-subtask]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        Controllers.opTask.deleteTask(Number(btn.dataset.deleteSubtask), { cascade: false });
      });
    });

    let draggedSubtaskId = null;
    board.querySelectorAll('[data-drag-subtask]').forEach(row => {
      row.addEventListener('dragstart', e => {
        draggedSubtaskId = Number(row.dataset.dragSubtask);
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(draggedSubtaskId));
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        board.querySelectorAll('.atd-subtasks.drop-over').forEach(el => el.classList.remove('drop-over'));
      });
    });
    board.querySelectorAll('[data-drop-parent]').forEach(zone => {
      zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.classList.add('drop-over');
      });
      zone.addEventListener('dragleave', e => {
        if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
        zone.classList.remove('drop-over');
      });
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drop-over');
        const targetParentId = Number(zone.dataset.dropParent);
        if (!draggedSubtaskId || !targetParentId) return;
        const subtask = Store.findOpTask(draggedSubtaskId);
        if (!subtask || Number(subtask.parentTaskId) === targetParentId) return;
        Store.updateOpTask(draggedSubtaskId, { parentTaskId: targetParentId, isParentTask: false });
        UI.renderOpPage();
        UI.renderCalendarPage();
        UI.renderReportsPage();
        ToastService.show('Subtarefa movida para outra lista', 'success');
      });
    });

    if (this._atdLastMoved?.id) {
      const movedId = this._atdLastMoved.id;
      requestAnimationFrame(() => {
        const el = board.querySelector(`[data-task-row-id="${movedId}"]`);
        if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
      setTimeout(() => { this._atdLastMoved = null; }, 650);
    }
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
      }));

    const noteItems = Store.getCalendarNotes()
      .filter(n => n.date && n.date >= startIso && n.date <= endIso)
      .map(n => ({
        date: n.date,
        text: n.title,
        source: 'Anotação',
      }));

    const agenda = [...taskItems, ...noteItems]
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
        };
      });

    const list = document.getElementById('agendaList');
    if (!agenda.length) {
      list.innerHTML = `<li class="agenda-item"><div><div class="agenda-desc">Nenhum item marcado para esta semana.</div><div class="agenda-time">Adicione tarefas ou anotações no calendário.</div></div></li>`;
      return;
    }

    list.innerHTML = agenda.map(a => `
      <li class="agenda-item">
        <div class="agenda-day">${a.day}</div>
        <div>
          <div class="agenda-desc">${a.text}</div>
          <div class="agenda-time">${a.time}</div>
        </div>
      </li>
    `).join('');
  },

  /* ── Calendar ───────────────────────────────────────────── */
  renderCalendarPage() {
    const monthTitle = document.getElementById('calendarMonthTitle');
    const weekdays = document.getElementById('calendarWeekdays');
    const grid = document.getElementById('calendarGrid');
    if (!monthTitle || !weekdays || !grid) return;

    const monthDate = CalendarService.currentMonthDate;
    monthTitle.textContent = Utils.monthLabel(monthDate);

    if (!weekdays.dataset.ready) {
      weekdays.innerHTML = CalendarService.weekdayLabels
        .map(d => `<div class="calendar-weekday">${d}</div>`)
        .join('');
      weekdays.dataset.ready = '1';
    }

    const today = Utils.todayIso();
    const selected = CalendarService.selectedDateIso;
    const days = CalendarService.getMonthMatrix(monthDate);

    grid.innerHTML = days.map(day => {
      const meta = CalendarService.getDayMeta(day.iso);
      const dotHtml = [
        meta.dashboard ? `<span class="calendar-dot dashboard" title="Tarefas do Dashboard"></span>` : '',
        meta.operacional ? `<span class="calendar-dot operacional" title="Tarefas Operacionais"></span>` : '',
        meta.note ? `<span class="calendar-dot note" title="Anotações"></span>` : '',
      ].join('');

      return `
        <button class="calendar-day ${day.isCurrentMonth ? '' : 'outside'} ${day.iso === today ? 'today' : ''} ${day.iso === selected ? 'selected' : ''}" data-date="${day.iso}" role="gridcell" aria-label="Dia ${day.day}, ${day.month + 1}/${day.year}">
          <span class="calendar-day-number">${day.day}</span>
          <span class="calendar-dot-list">${dotHtml}</span>
          <span class="calendar-day-count">${meta.total ? `${meta.total} item(ns)` : ''}</span>
        </button>
      `;
    }).join('');

    this.renderCalendarDayDetails();
  },

  renderCalendarDayDetails() {
    const label = document.getElementById('calendarSelectedDateLabel');
    const list = document.getElementById('calendarDayList');
    if (!label || !list) return;

    const dateIso = CalendarService.selectedDateIso;
    label.textContent = Utils.prettyDate(dateIso);

    const items = CalendarService.getItemsByDate(dateIso);
    if (!items.length) {
      list.innerHTML = `<div class="calendar-empty">Nenhuma tarefa ou anotação para esta data.</div>`;
      return;
    }

    list.innerHTML = items.map(item => `
      <article class="calendar-item">
        <div class="calendar-item-top">
          <span class="calendar-item-title">${item.title}</span>
          ${item.removable ? `<button class="calendar-remove-btn" data-remove-note="${item.id}" title="Remover anotação" aria-label="Remover anotação">Remover</button>` : ''}
        </div>
        <div class="calendar-item-meta">${item.sourceLabel} · ${item.status} · Prioridade ${item.priority || 'Média'}</div>
        ${item.description ? `<div class="calendar-item-desc">${item.description}</div>` : ''}
      </article>
    `).join('');
  },

  /* ── Reports ────────────────────────────────────────────── */
  renderReportsPage() {
    const periodEl = document.getElementById('reportPeriodFilter');
    const categoryEl = document.getElementById('reportCategoryFilter');
    if (!periodEl || !categoryEl) return;

    const tasks = ReportsService.getFilteredTasks(periodEl.value, categoryEl.value);
    const metrics = ReportsService.getMetrics(tasks);
    const statusDist = ReportsService.getStatusDistribution(tasks);
    const lateRows = ReportsService.getLateRows(tasks);
    const statusClassMap = {
      'Pendente': 's-pendente',
      'Criada': 's-pendente',
      'Em andamento': 's-andamento',
      'Concluída': 's-concluida',
      'Finalizada': 's-finalizada',
      'Atrasada': 's-atrasada',
    };

    document.getElementById('r-total').textContent = metrics.total;
    document.getElementById('r-done').textContent = metrics.done;
    document.getElementById('r-progress').textContent = metrics.progress;
    document.getElementById('r-late').textContent = metrics.late;
    document.getElementById('r-done-rate').textContent = `${metrics.doneRate}% de conclusão`;

    const reportBars = document.getElementById('reportBars');
    reportBars.innerHTML = statusDist.length
      ? statusDist.map(item => {
          const safeCls = statusClassMap[item.status] || 's-info';
          return `
            <div class="report-bar-row">
              <div class="report-bar-head"><span>${item.status}</span><span>${item.count}</span></div>
              <div class="report-bar-track">
                <div class="report-bar-fill ${safeCls}" style="width:${item.pct}%"></div>
              </div>
            </div>
          `;
        }).join('')
      : '<div class="calendar-empty">Sem dados para o filtro selecionado.</div>';

    const lateTbody = document.getElementById('reportLateTableBody');
    lateTbody.innerHTML = lateRows.length
      ? lateRows.map(row => `
          <tr>
            <td>${row.titulo}</td>
            <td>${row.sourceText}</td>
            <td>${row.responsavel}</td>
            <td class="date-cell date-late">${Utils.formatDate(row.prazo)}</td>
            <td class="date-cell date-late">${row.diffDays}</td>
          </tr>
        `).join('')
      : '<tr class="empty-row"><td colspan="5">Nenhuma tarefa atrasada no período.</td></tr>';
  },

  /* ── Clock ──────────────────────────────────────────────── */
  updateClock() {
    const d    = new Date();
    const opts = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
    const date = d.toLocaleDateString('pt-BR', opts);
    const time = `${Utils.pad(d.getHours())}:${Utils.pad(d.getMinutes())}`;
    document.getElementById('topbarDate').textContent = `${date} — ${time}`;
  },

  /* ── Page navigation ────────────────────────────────────── */
  navigateTo(page) {
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
      dashboard: { title: 'Dashboard',    crumb: 'Visão Geral' },
      tarefas:   { title: 'Tarefas',      crumb: 'Operacionais' },
      calendario:{ title: 'Calendário',   crumb: 'Agenda' },
      relatorios:{ title: 'Relatórios',   crumb: 'Análises' },
      config:    { title: 'Configurações',crumb: 'Sistema' },
    };
    const meta = titles[page] || { title: page, crumb: '' };
    document.getElementById('pageTitle').textContent      = meta.title;
    document.getElementById('breadcrumbLeaf').textContent = meta.crumb;

    Store.currentPage = page;

    // Re-renderiza página específica
    if (page === 'tarefas') this.renderOpPage();
    if (page === 'calendario') this.renderCalendarPage();
    if (page === 'relatorios') this.renderReportsPage();
  },

  /* ── Full dashboard render ─────────────────────────────── */
  renderDashboard() {
    this.renderAgenda();
    this.renderDashboardStats();
    this.renderTaskTable();
  },

  /* ── Full op page render ────────────────────────────────── */
  renderOpPage() {
    this.renderOpStats();
    this.renderKanban();
  },
};

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


/* ─────────────────────────────────────────────────────────────
   CONTROLLERS — Lógica de interação do usuário
───────────────────────────────────────────────────────────── */
const Controllers = {
  auth: {
    _sessionKey: 'planner.session.v1',
    _getAllowedUsers() {
      const list = window.APP_CONFIG && window.APP_CONFIG.authUsers;
      if (!Array.isArray(list) || !list.length) return [];
      return list.filter(u => u && typeof u.user === 'string' && typeof u.pass === 'string');
    },
    _submitting: false,
    _isAuthenticated() {
      return localStorage.getItem(this._sessionKey) === '1';
    },
    _lock() {
      document.body.classList.add('auth-locked');
    },
    _unlock() {
      document.body.classList.remove('auth-locked');
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
            localStorage.setItem(this._sessionKey, '1');
            this._unlock();
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

      localStorage.setItem(this._sessionKey, '1');
      this._unlock();
      return true;
    },
    logout() {
      localStorage.removeItem(this._sessionKey);
      this._lock();
      const passInput = document.getElementById('loginPass');
      if (passInput) passInput.value = '';
      ToastService.show('Sessão encerrada', 'info');
    },
    init() {
      if (this._isAuthenticated()) this._unlock();
      else this._lock();

      const form = document.getElementById('loginForm');
      form?.addEventListener('submit', async e => {
        e.preventDefault();
        if (this._submitting) return;
        this._submitting = true;
        try {
          const user = document.getElementById('loginUser')?.value.trim();
          const pass = document.getElementById('loginPass')?.value.trim();

          const ok = await this._login(user, pass);
          if (ok) {
            ToastService.show('Login realizado com sucesso', 'success');
          }
        } finally {
          this._submitting = false;
        }
      });

      document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
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

      collapseBtn.addEventListener('click', () => {
        if (this.isMobileNav()) {
          this.closeMobileNav();
          return;
        }
        sidebar.classList.toggle('collapsed');
        Store.sidebarOpen = !sidebar.classList.contains('collapsed');
      });

      document.getElementById('mobileNavBtn')?.addEventListener('click', () => this.toggleMobileNav());
      document.getElementById('sidebarBackdrop')?.addEventListener('click', () => this.closeMobileNav());

      const onViewportNavMode = e => {
        if (!e.matches) {
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

      document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
        btn.addEventListener('click', () => UI.navigateTo(btn.dataset.page));
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
      const titulo      = document.getElementById('f-titulo').value.trim();
      const responsavel = document.getElementById('f-responsavel').value.trim();
      if (!titulo)      { ToastService.show('Informe o título da tarefa', 'danger');       return null; }
      if (!responsavel) { ToastService.show('Informe o responsável pela tarefa', 'danger'); return null; }
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
      UI.renderCalendarPage();
      UI.renderReportsPage();
    },

    toggleDone(id, source = 'dashboard') {
      if (source === 'operacional') {
        const task = Store.findOpTask(id);
        if (!task) return;
        const wasDone = task.status === 'Concluída' || task.status === 'Finalizada';
        const nextStatus = wasDone ? 'Em andamento' : 'Concluída';
        OpTaskService.changeStatus(id, nextStatus);
        UI.renderOpPage();
      } else {
        const task = Store.findTask(id);
        if (!task) return;
        const wasDone = task.status === 'Concluída';
        Store.updateTask(id, { status: wasDone ? 'Pendente' : 'Concluída' });
      }
      UI.renderDashboard();
      UI.renderCalendarPage();
      UI.renderReportsPage();
    },

    init() {
      document.getElementById('openTaskModalBtn').addEventListener('click', () => this.openNewModal());
      document.getElementById('saveTaskBtn').addEventListener('click', () => this.save());
      ['closeTaskModal','cancelTaskModal'].forEach(id =>
        document.getElementById(id)?.addEventListener('click', () => ModalService.close('taskModal'))
      );

      document.getElementById('taskTableBody').addEventListener('click', e => {
        const checkEl = e.target.closest('[data-check]');
        if (checkEl) {
          this.toggleDone(+checkEl.dataset.check, checkEl.dataset.checkSource || 'dashboard');
          return;
        }
        const row = e.target.closest('tr[data-id]');
        if (row) {
          const id = +row.dataset.id;
          if (row.dataset.source === 'operacional') Controllers.opTask.openEditModal(id);
          else this.openEditModal(id);
        }
      });

      document.getElementById('refreshBtn').addEventListener('click', () => UI.renderDashboard());
    },
  },

  /* ── Op Task Modal ────────────────────────────────────── */
  opTask: {
    _newTaskPreset: null,
    _coordsLookupTimer: null,
    _setorCtoLookupTimer: null,
    _isAtendimentoCategory(category = Store.currentOpCategory) {
      return category === 'atendimento-cliente';
    },
    _isRompimentoCategory(category = Store.currentOpCategory) {
      return category === 'rompimentos';
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
    async _resolveCoordsToAddress(rawCoords) {
      const coords = this._parseCoords(rawCoords);
      const addressInput = document.getElementById('op-address-readonly');
      const hint = document.getElementById('op-address-hint');
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
    _syncRompimentoRegiaoPlacement(isRompimento) {
      const regiao = document.getElementById('opRegiaoGroup');
      const prioridade = document.getElementById('opPrioridadeGroup');
      const extraRow = document.getElementById('opRompimentoExtraRow');
      if (!regiao || !prioridade || !extraRow) return;
      if (isRompimento) {
        extraRow.after(regiao);
      } else {
        prioridade.after(regiao);
      }
    },
    _syncCategorySpecificFields(category = Store.currentOpCategory) {
      const isAtendimento = this._isAtendimentoCategory(category);
      const isRompimento = this._isRompimentoCategory(category);
      const modalTitle = document.getElementById('opTaskModalTitle');
      const modalWrap = document.getElementById('opTaskModal');

      this._syncRompimentoRegiaoPlacement(isRompimento);
      if (modalWrap) modalWrap.classList.toggle('rompimento-mode', isRompimento);

      this._toggleGroup('opTituloGroup', !isRompimento);
      this._toggleGroup('opPrazoGroup', !isRompimento);
      this._toggleGroup('opPriorityRegionRow', !isRompimento);

      this._toggleGroup('opParentConfig', isAtendimento);
      this._toggleGroup('opRompimentoCoordsRow', isRompimento);
      this._toggleGroup('opRompimentoExtraRow', isRompimento);
      this._toggleGroup('opRompimentoSetorGroup', isRompimento);
      if (modalTitle && !Store.editingOpTaskId) {
        modalTitle.textContent = isRompimento ? 'Nova tarefa de rompimento' : 'Nova tarefa';
      }

      if (isRompimento) {
        const prioridade = document.getElementById('op-prioridade');
        if (prioridade) prioridade.value = 'Alta';
      }
    },
    _syncAtendimentoKindFields() {
      const kindEl = document.getElementById('op-task-kind');
      const isParent = (kindEl?.value || 'parent') === 'parent';
      const responsavelInput = document.getElementById('op-responsavel');
      const prazoInput = document.getElementById('op-prazo');
      const regiaoSelect = document.getElementById('op-regiao');
      const responsavelGroup = responsavelInput?.closest('.form-group');
      const prazoGroup = prazoInput?.closest('.form-group');
      const regiaoGroup = regiaoSelect?.closest('.form-group');
      const isRompimento = this._isRompimentoCategory();

      [responsavelGroup, prazoGroup, regiaoGroup].forEach(group => {
        if (!group) return;
        if (isRompimento) {
          group.style.display = '';
          return;
        }
        group.style.display = isParent ? '' : 'none';
      });

      if (responsavelInput) {
        responsavelInput.disabled = isRompimento ? false : !isParent;
      }
      if (prazoInput) {
        prazoInput.disabled = isRompimento ? true : !isParent;
      }
      if (regiaoSelect) {
        regiaoSelect.disabled = isRompimento ? false : !isParent;
      }
    },

    _parentTaskOptions(currentTaskId = null) {
      return Store.getOpTasks().filter(t =>
        t.categoria === 'atendimento-cliente' &&
        t.isParentTask === true &&
        t.id !== currentTaskId
      );
    },
    _syncParentTaskUi(category = Store.currentOpCategory, currentTask = null) {
      const wrap = document.getElementById('opParentConfig');
      const kindEl = document.getElementById('op-task-kind');
      const parentSelect = document.getElementById('op-parent-task');
      if (!wrap || !kindEl || !parentSelect) return;

      if (!this._isAtendimentoCategory(category)) {
        wrap.style.display = 'none';
        kindEl.value = 'parent';
        parentSelect.value = '';
        const responsavelInput = document.getElementById('op-responsavel');
        const prazoInput = document.getElementById('op-prazo');
        const regiaoSelect = document.getElementById('op-regiao');
        [responsavelInput, prazoInput, regiaoSelect].forEach(input => {
          const group = input?.closest('.form-group');
          if (group) group.style.display = '';
          if (input) input.disabled = false;
        });
        this._syncCategorySpecificFields(category);
        return;
      }

      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      const currentId = currentTask?.id || null;
      const options = this._parentTaskOptions(currentId);
      parentSelect.innerHTML = `<option value="">Selecione uma tarefa pai</option>${options.map(t =>
        `<option value="${t.id}">${t.taskCode || `ATD-${String(t.id).padStart(4, '0')}`} - ${t.titulo}</option>`
      ).join('')}`;

      if (currentTask) {
        kindEl.value = currentTask.isParentTask ? 'parent' : 'child';
        parentSelect.value = currentTask.parentTaskId ? String(currentTask.parentTaskId) : '';
      } else {
        kindEl.value = 'parent';
        parentSelect.value = '';
      }

      parentSelect.disabled = kindEl.value === 'parent';
      this._syncCategorySpecificFields(category);
      this._syncAtendimentoKindFields();
    },
    _nextTaskCode(category = Store.currentOpCategory) {
      const prefixMap = {
        'rompimentos': 'ROM',
        'troca-poste': 'POS',
        'atendimento-cliente': 'ATD',
      };
      const prefix = prefixMap[category] || 'ROM';
      const count = Store.getOpTasks().filter(t => t.categoria === category).length + 1;
      return `${prefix}-${String(count).padStart(4, '0')}`;
    },

    _fallbackTaskCode(task) {
      const prefixMap = {
        'rompimentos': 'ROM',
        'troca-poste': 'POS',
        'atendimento-cliente': 'ATD',
      };
      const prefix = prefixMap[task.categoria] || 'ROM';
      return `${prefix}-${String(task.id).padStart(4, '0')}`;
    },

    _clearForm(preset = {}) {
      const category = preset.category || Store.currentOpCategory;
      document.getElementById('op-titulo').value      = '';
      document.getElementById('op-responsavel').value = '';
      document.getElementById('op-prazo').value       = '';
      document.getElementById('op-prioridade').value  = 'Alta';
      document.getElementById('op-regiao').value      = '';
      const coordsInput = document.getElementById('op-coords');
      const addressInput = document.getElementById('op-address-readonly');
      const addressHint = document.getElementById('op-address-hint');
      if (coordsInput) coordsInput.value = '';
      if (addressInput) addressInput.value = '';
      if (addressHint) addressHint.textContent = 'Aguardando CTO ou coordenadas.';
      const setorCtoInput = document.getElementById('op-setor-cto');
      if (setorCtoInput) setorCtoInput.value = '';
      const setorHint = document.getElementById('op-setor-cto-hint');
      if (setorHint) setorHint.textContent = '';
      this._syncParentTaskUi(category, null);
      this._syncCategorySpecificFields(category);
      this._newTaskPreset = { ...preset };
      if (this._isAtendimentoCategory(category)) {
        const kindEl = document.getElementById('op-task-kind');
        const parentSelect = document.getElementById('op-parent-task');
        if (kindEl && preset.kind) kindEl.value = preset.kind;
        if (parentSelect) {
          parentSelect.disabled = (kindEl?.value || 'parent') === 'parent';
          if (preset.parentTaskId) parentSelect.value = String(preset.parentTaskId);
        }
      }
    },

    _validate() {
      const titulo      = document.getElementById('op-titulo').value.trim();
      const responsavel = document.getElementById('op-responsavel').value.trim();
      const prazo       = document.getElementById('op-prazo').value;
      const taskKind = document.getElementById('op-task-kind')?.value || 'parent';
      const isParentTask = taskKind === 'parent';
      const parentTaskIdRaw = document.getElementById('op-parent-task')?.value || '';
      const parentTaskId = parentTaskIdRaw ? Number(parentTaskIdRaw) : null;
      const existing = Store.editingOpTaskId ? Store.findOpTask(Store.editingOpTaskId) : null;
      const category = existing?.categoria || Store.currentOpCategory;
      const regiao = document.getElementById('op-regiao').value;
      const taskCode = existing?.taskCode || this._nextTaskCode(category);
      const selectedParent = parentTaskId ? Store.findOpTask(parentTaskId) : null;
      const coordsRaw = document.getElementById('op-coords')?.value.trim() || '';
      const autoAddress = document.getElementById('op-address-readonly')?.value.trim() || '';
      const clientesAfetadosRaw = document.getElementById('op-clientes-afetados')?.value.trim() || '';
      const setorCto = document.getElementById('op-setor-cto')?.value.trim() || '';
      const isRompimento = this._isRompimentoCategory(category);

      if (!isRompimento && !titulo)      { ToastService.show('Informe o título da tarefa', 'danger');       return null; }
      if (isParentTask && !responsavel) { ToastService.show('Informe o responsável pela tarefa', 'danger'); return null; }
      if (!isRompimento && isParentTask && !prazo)       { ToastService.show('Informe a data de vencimento', 'danger');      return null; }
      if (!isRompimento && !document.getElementById('op-prioridade').value) { ToastService.show('Informe a prioridade', 'danger'); return null; }
      if (isParentTask && !regiao)      { ToastService.show('Informe a região', 'danger');                   return null; }
      if (isRompimento && !setorCto) {
        ToastService.show('Informe o nome da CTO ou setor', 'danger');
        return null;
      }
      if (isRompimento && !coordsRaw)   { ToastService.show('Informe as coordenadas da localização', 'danger'); return null; }
      if (isRompimento && !autoAddress) { ToastService.show('A localização automática (rua/bairro) é obrigatória', 'danger'); return null; }
      if (isRompimento && (!clientesAfetadosRaw || !/^\d+$/.test(clientesAfetadosRaw) || Number(clientesAfetadosRaw) <= 0)) {
        ToastService.show('Informe uma quantidade de clientes afetados válida', 'danger');
        return null;
      }
      if (this._isAtendimentoCategory(category) && !isParentTask && !parentTaskId) {
        ToastService.show('Selecione a tarefa pai para criar uma tarefa filha', 'danger');
        return null;
      }
      const presetStatus = this._newTaskPreset?.status || null;
      const defaultStatus = this._isAtendimentoCategory(category)
        ? (isParentTask ? (presetStatus || 'Backlog') : 'Em andamento')
        : 'Criada';
      const currentStatus = existing?.status || defaultStatus;
      const normalizedStatus = (!isParentTask && this._isAtendimentoCategory(category) && (currentStatus === 'Backlog' || currentStatus === 'Criada'))
        ? 'Em andamento'
        : currentStatus;
      const finalTitulo = isRompimento
        ? `Rompimento - ${autoAddress}`
        : titulo;
      const finalPrazo = isRompimento
        ? Utils.todayIso()
        : (isParentTask ? prazo : (selectedParent?.prazo || existing?.prazo || ''));
      const finalPrioridade = isRompimento ? 'Alta' : document.getElementById('op-prioridade').value;
      const finalDescricao = isRompimento ? `Coordenadas: ${coordsRaw} | Local: ${autoAddress}` : '';
      const setorField = isRompimento
        ? setorCto
        : (isParentTask ? regiao : (selectedParent?.setor || selectedParent?.regiao || existing?.setor || ''));
      const regiaoField = isRompimento
        ? regiao
        : (isParentTask ? regiao : (selectedParent?.regiao || selectedParent?.setor || existing?.regiao || ''));
      return {
        taskCode,
        titulo: finalTitulo,
        responsavel: isParentTask ? responsavel : (selectedParent?.responsavel || existing?.responsavel || ''),
        setor: setorField,
        regiao: regiaoField,
        clientesAfetados: isRompimento ? clientesAfetadosRaw : '',
        coordenadas: isRompimento ? coordsRaw : '',
        localizacaoTexto: isRompimento ? autoAddress : '',
        categoria:  category,
        prazo: finalPrazo,
        prioridade: finalPrioridade,
        descricao:  finalDescricao,
        status:     normalizedStatus,
        isParentTask: this._isAtendimentoCategory(category) ? isParentTask : false,
        parentTaskId: this._isAtendimentoCategory(category) ? (isParentTask ? null : parentTaskId) : null,
      };
    },

    openNewModal(preset = {}) {
      Store.editingOpTaskId = null;
      if (preset.category) Store.currentOpCategory = preset.category;
      document.getElementById('opTaskModalTitle').textContent = 'Nova tarefa';
      const deleteBtn = document.getElementById('deleteOpTaskBtn');
      if (deleteBtn) deleteBtn.style.display = 'none';
      this._clearForm(preset);
      ModalService.open('opTaskModal');
    },

    openEditModal(id) {
      const task = Store.findOpTask(id);
      if (!task) return;
      Store.editingOpTaskId = id;
      document.getElementById('opTaskModalTitle').textContent = 'Editar tarefa';
      document.getElementById('op-titulo').value      = task.titulo;
      document.getElementById('op-responsavel').value = task.responsavel;
      document.getElementById('op-prazo').value       = task.prazo || '';
      document.getElementById('op-prioridade').value  = task.prioridade;
      document.getElementById('op-regiao').value      = task.regiao || '';
      const setorCtoInput = document.getElementById('op-setor-cto');
      if (setorCtoInput) setorCtoInput.value = (task.setor || '').toUpperCase();
      const setorHintEdit = document.getElementById('op-setor-cto-hint');
      if (setorHintEdit) setorHintEdit.textContent = '';
      const coordsInput = document.getElementById('op-coords');
      const addressInput = document.getElementById('op-address-readonly');
      const addressHint = document.getElementById('op-address-hint');
      const clientesInput = document.getElementById('op-clientes-afetados');
      if (coordsInput) coordsInput.value = task.coordenadas || '';
      if (addressInput) addressInput.value = task.localizacaoTexto || '';
      if (addressHint) addressHint.textContent = task.localizacaoTexto ? 'Localização carregada.' : 'Aguardando CTO ou coordenadas.';
      if (clientesInput) clientesInput.value = task.clientesAfetados || '';
      const deleteBtn = document.getElementById('deleteOpTaskBtn');
      if (deleteBtn) deleteBtn.style.display = 'inline-flex';
      this._newTaskPreset = null;
      this._syncParentTaskUi(task.categoria, task);
      this._syncCategorySpecificFields(task.categoria);
      this._syncAtendimentoKindFields();
      ModalService.open('opTaskModal');
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
      UI.renderOpPage();
      UI.renderDashboard();
      UI.renderCalendarPage();
      UI.renderReportsPage();
    },

    save() {
      const data = this._validate();
      if (!data) return;

      if (Store.editingOpTaskId) {
        Store.updateOpTask(Store.editingOpTaskId, data);
        ToastService.show('Tarefa atualizada com sucesso', 'success');
      } else {
        Store.addOpTask(data);
        ToastService.show('Tarefa criada com sucesso', 'success');
      }

      // Atualiza categoria ativa para a que foi salva
      Store.currentOpCategory = data.categoria;

      ModalService.close('opTaskModal');
      UI.renderOpPage();
      UI.renderCalendarPage();
      UI.renderReportsPage();
      // Atualiza tabs
      document.querySelectorAll('.tasks-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.category === Store.currentOpCategory);
        t.setAttribute('aria-selected', t.dataset.category === Store.currentOpCategory ? 'true' : 'false');
      });
    },

    init() {
      document.getElementById('openOpTaskModalBtn').addEventListener('click', () => this.openNewModal());
      document.getElementById('saveOpTaskBtn').addEventListener('click', () => this.save());
      document.getElementById('deleteOpTaskBtn')?.addEventListener('click', () => this.deleteTask());
      document.getElementById('op-task-kind')?.addEventListener('change', e => {
        const parentSelect = document.getElementById('op-parent-task');
        if (!parentSelect) return;
        const isParent = e.target.value === 'parent';
        parentSelect.disabled = isParent;
        if (isParent) parentSelect.value = '';
        this._syncAtendimentoKindFields();
      });
      document.getElementById('op-coords')?.addEventListener('input', e => {
        const value = e.target.value;
        clearTimeout(this._coordsLookupTimer);
        this._coordsLookupTimer = setTimeout(() => this._resolveCoordsToAddress(value), 500);
      });
      document.getElementById('op-coords')?.addEventListener('blur', e => {
        this._resolveCoordsToAddress(e.target.value);
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
      ['closeOpTaskModal','cancelOpTaskModal'].forEach(id =>
        document.getElementById(id)?.addEventListener('click', () => ModalService.close('opTaskModal'))
      );
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

      document.getElementById('searchInput').addEventListener('input', e => {
        Store.dashboardSearch = e.target.value.trim().toLowerCase();
        UI.renderTaskTable();
      });

      document.getElementById('opSearchInput').addEventListener('input', e => {
        Store.opSearch = e.target.value.trim().toLowerCase();
        UI.renderKanban();
      });
    },
  },

  /* ── Tasks Category Tabs ──────────────────────────────── */
  categoryTabs: {
    init() {
      document.querySelectorAll('.tasks-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.tasks-tab').forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
          });
          tab.classList.add('active');
          tab.setAttribute('aria-selected', 'true');
          Store.currentOpCategory = tab.dataset.category;
          Controllers.opTask._syncParentTaskUi(Store.currentOpCategory, null);
          UI.renderKanban();
        });
      });
    },
  },

  /* ── Reports ──────────────────────────────────────────── */
  reports: {
    _exportCsv() {
      const period = document.getElementById('reportPeriodFilter').value;
      const category = document.getElementById('reportCategoryFilter').value;
      const tasks = ReportsService.getFilteredTasks(period, category);
      const csv = ReportsService.toCsv(tasks);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-burrinho-projetos-${Utils.todayIso()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      ToastService.show('Relatório exportado em CSV', 'success');
    },

    init() {
      const periodEl = document.getElementById('reportPeriodFilter');
      const categoryEl = document.getElementById('reportCategoryFilter');
      const refreshEl = document.getElementById('reportRefreshBtn');
      const exportEl = document.getElementById('reportExportBtn');
      if (!periodEl || !categoryEl || !refreshEl || !exportEl) return;

      [periodEl, categoryEl].forEach(el => {
        el.addEventListener('change', () => UI.renderReportsPage());
      });
      refreshEl.addEventListener('click', () => UI.renderReportsPage());
      exportEl.addEventListener('click', () => this._exportCsv());
    },
  },

  /* ── Calendar ─────────────────────────────────────────── */
  calendar: {
    _openNoteModal(prefillDate) {
      document.getElementById('cal-note-date').value = prefillDate || CalendarService.selectedDateIso;
      document.getElementById('cal-note-title').value = '';
      document.getElementById('cal-note-desc').value = '';
      document.getElementById('cal-note-priority').value = 'Média';
      ModalService.open('calendarNoteModal');
    },

    _saveNote() {
      const date = document.getElementById('cal-note-date').value;
      const title = document.getElementById('cal-note-title').value.trim();
      const description = document.getElementById('cal-note-desc').value.trim();
      const priority = document.getElementById('cal-note-priority').value;

      if (!date) { ToastService.show('Selecione a data da anotação', 'danger'); return; }
      if (!title) { ToastService.show('Informe o título da anotação', 'danger'); return; }

      CalendarService.createNote({ date, title, description, priority });
      CalendarService.selectedDateIso = date;
      ModalService.close('calendarNoteModal');
      UI.renderAgenda();
      UI.renderCalendarPage();
      ToastService.show('Anotação salva no calendário', 'success');
    },

    init() {
      const grid = document.getElementById('calendarGrid');
      const dayList = document.getElementById('calendarDayList');
      if (!grid || !dayList) return;

      document.getElementById('calendarPrevBtn').addEventListener('click', () => {
        const d = CalendarService.currentMonthDate;
        CalendarService.currentMonthDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        UI.renderCalendarPage();
      });

      document.getElementById('calendarNextBtn').addEventListener('click', () => {
        const d = CalendarService.currentMonthDate;
        CalendarService.currentMonthDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        UI.renderCalendarPage();
      });

      document.getElementById('calendarTodayBtn').addEventListener('click', () => {
        const now = new Date();
        CalendarService.currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
        CalendarService.selectedDateIso = Utils.todayIso();
        UI.renderCalendarPage();
      });

      grid.addEventListener('click', e => {
        const btn = e.target.closest('[data-date]');
        if (!btn) return;
        CalendarService.selectedDateIso = btn.dataset.date;
        UI.renderCalendarPage();
      });

      dayList.addEventListener('click', e => {
        const removeBtn = e.target.closest('[data-remove-note]');
        if (!removeBtn) return;
        CalendarService.removeNote(+removeBtn.dataset.removeNote);
        UI.renderAgenda();
        UI.renderCalendarPage();
        ToastService.show('Anotação removida', 'info');
      });

      document.getElementById('calendarAddNoteBtn').addEventListener('click', () => {
        this._openNoteModal(CalendarService.selectedDateIso);
      });

      document.getElementById('saveCalendarNoteBtn').addEventListener('click', () => this._saveNote());
      ['closeCalendarNoteModal', 'cancelCalendarNoteModal'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => ModalService.close('calendarNoteModal'));
      });
    },
  },

  /* ── Webhook ──────────────────────────────────────────── */
  webhook: {
    _syncBanner() {
      const config  = Store.getWebhookConfig();
      const banner  = document.getElementById('webhookBanner');
      const urlDisp = document.getElementById('webhookUrlDisplay');
      if (config.url) {
        urlDisp.textContent = config.url.length > 45 ? config.url.slice(0, 42) + '…' : config.url;
        banner.classList.add('visible');
      } else {
        banner.classList.remove('visible');
      }
    },

    init() {
      document.getElementById('openWebhookBtn').addEventListener('click', () => {
        const config = Store.getWebhookConfig();
        document.getElementById('f-webhookUrl').value    = config.url;
        document.getElementById('ev-andamento').checked  = config.events.andamento;
        document.getElementById('ev-concluida').checked  = config.events.concluida;
        document.getElementById('ev-finalizada').checked = config.events.finalizada;
        ModalService.open('webhookModal');
      });

      document.getElementById('testWebhookBtn').addEventListener('click', async () => {
        const url = document.getElementById('f-webhookUrl').value.trim();
        if (!url) { ToastService.show('Insira a URL do webhook antes de testar', 'danger'); return; }
        await WebhookService.sendTest(url);
      });

      document.getElementById('saveWebhookBtn').addEventListener('click', async () => {
        const url = document.getElementById('f-webhookUrl').value.trim();
        if (!url) { ToastService.show('Insira a URL do webhook', 'danger'); return; }
        const res = await Store.setWebhookConfig({
          url,
          events: {
            andamento:  document.getElementById('ev-andamento').checked,
            concluida:  document.getElementById('ev-concluida').checked,
            finalizada: document.getElementById('ev-finalizada').checked,
          },
        });
        this._syncBanner();
        ModalService.close('webhookModal');
        if (!Store.isRemoteApiEnabled()) {
          ToastService.show('Google Chat conectado (salvo só neste navegador).', 'success');
        } else if (res && res.ok) {
          ToastService.show('Webhook salvo no servidor. Válido para todos que acessam o site.', 'success');
        } else {
          ToastService.show('Salvo no navegador. No servidor falhou: no Vercel, crie BLOB_READ_WRITE_TOKEN em Environment Variables.', 'danger');
        }
      });

      document.getElementById('disconnectWebhook').addEventListener('click', async () => {
        const res = await Store.setWebhookConfig({ url: '' });
        this._syncBanner();
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
    },
  },

  /* ── Notes ────────────────────────────────────────────── */
  notes: {
    init() {
      const textarea = document.getElementById('noteTextarea');
      textarea.value = Store.getPlannerConfig().note;
      document.getElementById('saveNoteBtn').addEventListener('click', () => {
        const val = textarea.value.trim();
        if (!val) { ToastService.show('Escreva algo antes de salvar', 'danger'); return; }
        Store.setPlannerConfig({ note: val });
        ToastService.show('Nota salva', 'success');
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
  CtoLocationRegistry.load().catch(() => {});
  Controllers.auth.init();

  // Bootstrap remoto pode demorar e bloquear interações do login.
  // Garantimos um "timeout" para manter a UI responsiva.
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

  await bootstrapWithTimeout(8000);
  // Inicializa todos os controllers
  Controllers.sidebar.init();
  Controllers.task.init();
  Controllers.opTask.init();
  Controllers.filters.init();
  Controllers.categoryTabs.init();
  Controllers.reports.init();
  Controllers.calendar.init();
  Controllers.webhook.init();
  Controllers.notes.init();
  Controllers.globalModal.init();

  // Renderização inicial
  UI.renderAgenda();
  UI.renderDashboard();
  UI.renderCalendarPage();
  UI.renderReportsPage();

  // Clock
  UI.updateClock();
  setInterval(() => UI.updateClock(), 30000);
  setInterval(async () => {
    const updated = await bootstrapWithTimeout(8000);
    if (!updated) return;
    UI.renderDashboard();
    UI.renderOpPage();
    UI.renderCalendarPage();
    UI.renderReportsPage();
  }, 25000);
}

// Inicia quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initApp(); });
} else {
  initApp();
}
//teste
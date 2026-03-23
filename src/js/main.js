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


/* ─────────────────────────────────────────────────────────────
   STATE STORE — Fonte única da verdade
   Futura integração: substituir por chamadas à API/banco
───────────────────────────────────────────────────────────── */
const Store = (() => {
  /** @type {Task[]} */
  const tasks = [
    { id: 1, titulo: 'Revisar relatório financeiro',   responsavel: 'Ana',    prazo: '2026-03-25', status: 'Em andamento', prioridade: 'Alta'  },
    { id: 2, titulo: 'Atualizar planilha de vendas',   responsavel: 'Carlos', prazo: '2026-03-24', status: 'Atrasada',     prioridade: 'Média' },
    { id: 3, titulo: 'Enviar documentação ao cliente', responsavel: 'João',   prazo: '2026-03-26', status: 'Pendente',     prioridade: 'Baixa' },
    { id: 4, titulo: 'Reunião com fornecedores',       responsavel: 'Maria',  prazo: '2026-03-28', status: 'Pendente',     prioridade: 'Média' },
    { id: 5, titulo: 'Fechamento de contrato',         responsavel: 'Pedro',  prazo: '2026-03-27', status: 'Em andamento', prioridade: 'Alta'  },
  ];
  let nextTaskId = 6;

  /** @type {OpTask[]} */
  const opTasks = [
    {
      id: 1, titulo: 'Cabo rompido Rua das Flores 120', responsavel: 'Marcos',
      categoria: 'rompimentos', prazo: '2026-03-24', prioridade: 'Alta',
      taskCode: 'ROM-0001', setor: 'Manutenção Norte', clientesAfetados: '83',
      descricao: 'Cabo de média tensão rompido — poste 1432', status: 'Em andamento',
      historico: [
        { status: 'Criada',       timestamp: '2026-03-23T08:00:00', autor: 'Sistema' },
        { status: 'Em andamento', timestamp: '2026-03-23T09:15:00', autor: 'Marcos'  },
      ],
      criadaEm: '2026-03-23T08:00:00',
    },
    {
      id: 2, titulo: 'Rompimento Av. Brasil 450', responsavel: 'Lucas',
      categoria: 'rompimentos', prazo: '2026-03-25', prioridade: 'Média',
      taskCode: 'ROM-0002', setor: 'Manutenção Centro', clientesAfetados: '41',
      descricao: 'Cabo subterrâneo — verificar caixa de passagem', status: 'Criada',
      historico: [{ status: 'Criada', timestamp: '2026-03-23T10:00:00', autor: 'Sistema' }],
      criadaEm: '2026-03-23T10:00:00',
    },
    {
      id: 3, titulo: 'Substituição Poste 2210 — Praça Central', responsavel: 'Roberto',
      categoria: 'troca-poste', prazo: '2026-03-26', prioridade: 'Alta',
      taskCode: 'POS-0001', setor: 'Infraestrutura', clientesAfetados: '27',
      descricao: 'Poste danificado por acidente de trânsito', status: 'Concluída',
      historico: [
        { status: 'Criada',       timestamp: '2026-03-22T07:00:00', autor: 'Sistema' },
        { status: 'Em andamento', timestamp: '2026-03-22T09:00:00', autor: 'Roberto' },
        { status: 'Concluída',    timestamp: '2026-03-23T11:00:00', autor: 'Roberto' },
      ],
      criadaEm: '2026-03-22T07:00:00',
    },
    {
      id: 4, titulo: 'Troca Poste 0891 — Rua Santos Dumont', responsavel: 'André',
      categoria: 'troca-poste', prazo: '2026-03-27', prioridade: 'Baixa',
      taskCode: 'POS-0002', setor: 'Infraestrutura', clientesAfetados: '12',
      descricao: 'Poste desgastado — substituição preventiva', status: 'Criada',
      historico: [{ status: 'Criada', timestamp: '2026-03-23T11:30:00', autor: 'Sistema' }],
      criadaEm: '2026-03-23T11:30:00',
    },
  ];
  let nextOpTaskId = 5;

  /** @type {WebhookConfig} */
  const webhookConfig = {
    url: '',
    events: { andamento: true, concluida: true, finalizada: true },
  };

  /** @type {PlannerConfig} */
  const plannerConfig = {
    note: 'Lembrar de validar as atividades prioritárias do setor antes do fechamento semanal.',
  };

  const calendarStorageKey = 'planner.calendar.notes.v1';
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
    addTask:         (data)  => { const t = { id: nextTaskId++, ...data }; tasks.push(t); return t; },
    updateTask:      (id, d) => { const i = tasks.findIndex(t => t.id === id); if (i !== -1) Object.assign(tasks[i], d); return tasks[i]; },
    findTask:        (id)    => tasks.find(t => t.id === id),

    // OpTasks
    getOpTasks:      ()           => [...opTasks],
    getOpTasksByCategory: (cat)   => opTasks.filter(t => t.categoria === cat),
    addOpTask:       (data)       => { const t = { id: nextOpTaskId++, ...data, criadaEm: new Date().toISOString(), historico: [{ status: 'Criada', timestamp: new Date().toISOString(), autor: 'Sistema' }] }; opTasks.push(t); return t; },
    updateOpTaskStatus: (id, newStatus, autor = 'Usuário') => {
      const task = opTasks.find(t => t.id === id);
      if (!task) return null;
      task.status = newStatus;
      task.historico.push({ status: newStatus, timestamp: new Date().toISOString(), autor });
      return task;
    },
    updateOpTask: (id, data) => {
      const i = opTasks.findIndex(t => t.id === id);
      if (i !== -1) Object.assign(opTasks[i], data);
      return opTasks[i];
    },
    findOpTask: (id) => opTasks.find(t => t.id === id),

    // Webhook
    getWebhookConfig: ()     => ({ ...webhookConfig }),
    setWebhookConfig: (data) => Object.assign(webhookConfig, data),

    // Config
    getPlannerConfig: () => ({ ...plannerConfig }),
    setPlannerConfig: (data) => Object.assign(plannerConfig, data),

    // Calendar Notes
    getCalendarNotes: () => [...calendarNotes],
    getCalendarNotesByDate: (isoDate) => calendarNotes.filter(n => n.date === isoDate),
    addCalendarNote: (data) => {
      const note = { id: nextCalendarNoteId++, ...data, createdAt: new Date().toISOString() };
      calendarNotes.push(note);
      persistCalendarNotes();
      return note;
    },
    removeCalendarNote: (id) => {
      const sizeBefore = calendarNotes.length;
      calendarNotes = calendarNotes.filter(n => n.id !== id);
      if (calendarNotes.length !== sizeBefore) persistCalendarNotes();
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
    const labels = {
      andamento:  '🔵 *Tarefa em Andamento*',
      concluida:  '✅ *Tarefa Concluída*',
      finalizada: '🏁 *Tarefa Finalizada*',
    };
    const categoryLine = category ? `\nCategoria: *${category}*` : '';
    const descLine = task.descricao ? `\nDescrição: ${task.descricao}` : '';
    return {
      text: `${labels[event]}\n*${task.titulo}*\nResponsável: ${task.responsavel} | Prazo: ${Utils.formatDate(task.prazo)} | Prioridade: ${task.prioridade}${categoryLine}${descLine}`,
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
  },

  _isDoneStatus(status) {
    return status === 'Concluída' || status === 'Finalizada';
  },

  _isPendingStatus(status) {
    return status === 'Pendente' || status === 'Criada';
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
    const counts = { Criada: 0, 'Em andamento': 0, Concluída: 0, Finalizada: 0 };
    Store.getOpTasks().forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });
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
          (category === 'troca-poste' && t.categoria === 'troca-poste');
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
    const statuses = ['Pendente', 'Criada', 'Em andamento', 'Concluída', 'Finalizada', 'Atrasada'];
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
  /* ── Helpers de badge ───────────────────────────────────── */
  _statusBadgeMap: {
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
      const checkMarkup = t.source === 'dashboard'
        ? `<div class="task-check ${isDone ? 'done' : ''}" data-check="${t.id}" data-check-source="${t.source}" role="checkbox" aria-checked="${isDone}" aria-label="Marcar como concluída" tabindex="0">
             ${isDone ? this.checkSvg() : ''}
           </div>`
        : `<div class="task-check ${isDone ? 'done' : ''}" style="opacity:.55;cursor:default" aria-hidden="true">
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
    document.getElementById('tab-count-rompimentos').textContent = allOpTasks.filter(t => t.categoria === 'rompimentos').length;
    document.getElementById('tab-count-troca-poste').textContent = allOpTasks.filter(t => t.categoria === 'troca-poste').length;
  },

  /* ── Kanban Board ───────────────────────────────────────── */
  renderKanban() {
    const category = Store.currentOpCategory;
    const tasks    = OpTaskService.getFilteredByCategory(category);
    const tod      = Utils.todayIso();

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

    const board = document.getElementById('kanbanBoard');
    board.innerHTML = columns.map(col => {
      const colTasks = tasks.filter(t => t.status === col.status);

      const cards = colTasks.length
        ? colTasks.map(t => {
            const isLate = t.prazo && t.prazo < tod && !['Concluída','Finalizada'].includes(t.status);
            const nextStatuses = nextStatusMap[t.status] || [];
            const actionBtns = nextStatuses.map(ns =>
              `<button class="status-action-btn ${statusActionClass[ns]}" data-op-id="${t.id}" data-to-status="${ns}">${statusLabels[ns]}</button>`
            ).join('');

            return `
              <article class="kanban-card ${this._lastMovedOpTask && this._lastMovedOpTask.id === t.id && this._lastMovedOpTask.status === t.status ? 'just-moved' : ''}" data-op-id="${t.id}" data-op-status="${t.status}" draggable="true" aria-label="${t.titulo}">
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

  /* ── Agenda ─────────────────────────────────────────────── */
  renderAgenda() {
    const agenda = [
      { day: 'Seg', text: 'Reunião de status',    time: '09:00' },
      { day: 'Qua', text: 'Revisão de contratos', time: '14:00' },
      { day: 'Sex', text: 'Entrega de relatório', time: '11:00' },
      { day: 'Qui', text: 'Treinamento interno',  time: '15:30' },
    ];
    const list = document.getElementById('agendaList');
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
    this.renderDashboardStats();
    this.renderTaskTable();
  },

  /* ── Full op page render ────────────────────────────────── */
  renderOpPage() {
    this.renderOpStats();
    this.renderKanban();
  },
};


/* ─────────────────────────────────────────────────────────────
   CONTROLLERS — Lógica de interação do usuário
───────────────────────────────────────────────────────────── */
const Controllers = {

  /* ── Sidebar ──────────────────────────────────────────── */
  sidebar: {
    init() {
      document.getElementById('collapseBtn').addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('collapsed');
        Store.sidebarOpen = !sidebar.classList.contains('collapsed');
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

    toggleDone(id) {
      const task = Store.findTask(id);
      if (!task) return;
      const wasDone = task.status === 'Concluída';
      Store.updateTask(id, { status: wasDone ? 'Pendente' : 'Concluída' });
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
          if (checkEl.dataset.checkSource === 'dashboard') this.toggleDone(+checkEl.dataset.check);
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
    _nextTaskCode(category = Store.currentOpCategory) {
      const prefix = category === 'troca-poste' ? 'POS' : 'ROM';
      const count = Store.getOpTasks().filter(t => t.categoria === category).length + 1;
      return `${prefix}-${String(count).padStart(4, '0')}`;
    },

    _fallbackTaskCode(task) {
      const prefix = task.categoria === 'troca-poste' ? 'POS' : 'ROM';
      return `${prefix}-${String(task.id).padStart(4, '0')}`;
    },

    _clearForm() {
      const category = Store.currentOpCategory;
      document.getElementById('op-task-code').value  = this._nextTaskCode(category);
      document.getElementById('op-titulo').value      = '';
      document.getElementById('op-setor').value       = '';
      document.getElementById('op-responsavel').value = '';
      document.getElementById('op-clientes-afetados').value = '';
      document.getElementById('op-descricao').value   = '';
      document.getElementById('op-prioridade').value  = 'Alta';
    },

    _validate() {
      const taskCode    = document.getElementById('op-task-code').value.trim();
      const titulo      = document.getElementById('op-titulo').value.trim();
      const setor       = document.getElementById('op-setor').value.trim();
      const responsavel = document.getElementById('op-responsavel').value.trim();
      const clientesAfetados = document.getElementById('op-clientes-afetados').value.trim();
      const existing = Store.editingOpTaskId ? Store.findOpTask(Store.editingOpTaskId) : null;

      if (!taskCode)    { ToastService.show('ID da tarefa é obrigatório', 'danger'); return null; }
      if (!titulo)      { ToastService.show('Informe o título da tarefa', 'danger');       return null; }
      if (!setor)       { ToastService.show('Informe o nome do setor', 'danger');          return null; }
      if (!responsavel) { ToastService.show('Informe o responsável pela tarefa', 'danger'); return null; }
      return {
        taskCode, titulo, setor, responsavel, clientesAfetados,
        categoria:  existing?.categoria || Store.currentOpCategory,
        prazo:      existing?.prazo || Utils.todayIso(),
        prioridade: document.getElementById('op-prioridade').value,
        descricao:  document.getElementById('op-descricao').value.trim(),
        status:     existing?.status || 'Criada',
      };
    },

    openNewModal() {
      Store.editingOpTaskId = null;
      document.getElementById('opTaskModalTitle').textContent = 'Nova tarefa';
      this._clearForm();
      ModalService.open('opTaskModal');
    },

    openEditModal(id) {
      const task = Store.findOpTask(id);
      if (!task) return;
      Store.editingOpTaskId = id;
      document.getElementById('opTaskModalTitle').textContent = 'Editar tarefa';
      document.getElementById('op-task-code').value   = task.taskCode || this._fallbackTaskCode(task);
      document.getElementById('op-titulo').value      = task.titulo;
      document.getElementById('op-setor').value       = task.setor || '';
      document.getElementById('op-responsavel').value = task.responsavel;
      document.getElementById('op-clientes-afetados').value = task.clientesAfetados || '';
      document.getElementById('op-descricao').value   = task.descricao || '';
      document.getElementById('op-prioridade').value  = task.prioridade;
      ModalService.open('opTaskModal');
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

      document.getElementById('saveWebhookBtn').addEventListener('click', () => {
        const url = document.getElementById('f-webhookUrl').value.trim();
        if (!url) { ToastService.show('Insira a URL do webhook', 'danger'); return; }
        Store.setWebhookConfig({
          url,
          events: {
            andamento:  document.getElementById('ev-andamento').checked,
            concluida:  document.getElementById('ev-concluida').checked,
            finalizada: document.getElementById('ev-finalizada').checked,
          },
        });
        this._syncBanner();
        ToastService.show('Google Chat conectado com sucesso!', 'success');
        ModalService.close('webhookModal');
      });

      document.getElementById('disconnectWebhook').addEventListener('click', () => {
        Store.setWebhookConfig({ url: '' });
        this._syncBanner();
        ToastService.show('Webhook desconectado', 'info');
      });

      ['closeWebhookModal','cancelWebhookModal'].forEach(id =>
        document.getElementById(id)?.addEventListener('click', () => ModalService.close('webhookModal'))
      );
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
      // Fechar com ESC
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') ModalService.closeAll();
      });
    },
  },
};


/* ─────────────────────────────────────────────────────────────
   APP INIT — Bootstrap da aplicação
───────────────────────────────────────────────────────────── */
function initApp() {
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
}

// Inicia quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

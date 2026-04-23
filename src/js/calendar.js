/**
 * Calendário v3 — CRUD completo via api/eventos.php (vanilla).
 * Depende de Utils/ToastService/ModalService/Store/ApiService do main.js.
 */
(function () {
  'use strict';

  const CATEGORIES = [
    { key: 'Rompimentos', color: 'red' },
    { key: 'Alta', color: 'red2' },
    { key: 'Em andamento', color: 'green' },
    { key: 'Manutenção', color: 'amber' },
  ];

  const WEEKDAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

  const pad2 = (n) => String(n).padStart(2, '0');
  const toIsoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const toHm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const parseDt = (s) => {
    const raw = String(s || '').trim();
    if (!raw) return null;
    // "YYYY-MM-DD HH:mm:ss" ou ISO; Date lida bem com "YYYY-MM-DDTHH:mm:ss"
    const norm = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const d = new Date(norm);
    return Number.isFinite(d.getTime()) ? d : null;
  };
  const fmtDatePt = (isoDate) => {
    const [y, m, d] = String(isoDate || '').split('-').map(Number);
    if (!y || !m || !d) return '—';
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  };
  const startOfWeek = (d) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - x.getDay());
    x.setHours(0, 0, 0, 0);
    return x;
  };

  function categoryClass(cat) {
    const c = String(cat || '').trim();
    if (c === 'Rompimentos') return 'cal-pill cal-pill--romp';
    if (c === 'Alta') return 'cal-pill cal-pill--alta';
    if (c === 'Manutenção') return 'cal-pill cal-pill--manut';
    return 'cal-pill cal-pill--and';
  }

  function apiPathsFor(endpointWithQuery) {
    const p = String(endpointWithQuery || '');
    const base = String(ApiService && ApiService.baseUrl ? ApiService.baseUrl : '').replace(/\/+$/, '');
    const baseEndsWithApi = /\/api$/i.test(base);

    const primary = baseEndsWithApi ? p : `/api${p.startsWith('/') ? '' : '/'}${p}`;
    const secondary = baseEndsWithApi ? `/api${p.startsWith('/') ? '' : '/'}${p}` : p;
    const stripPhp = (s) => s.replace(/\.php(\?|$)/, '$1');
    return [...new Set([primary, stripPhp(primary), secondary, stripPhp(secondary)])];
  }

  const Api = {
    async listMonth(year, month0) {
      const mes = month0 + 1;
      const b = Date.now();
      const q = `action=listar&mes=${mes}&ano=${year}&_=${b}`;
      const j = await ApiService.requestAny(apiPathsFor(`/eventos.php?${q}`), { method: 'GET', timeoutMs: 12000 });
      if (!j || j.ok !== true) {
        const err = (j && j.error) ? String(j.error) : 'Falha ao listar eventos';
        throw new Error(err);
      }
      return Array.isArray(j.eventos) ? j.eventos : [];
    },
    async search(q) {
      const b = Date.now();
      const qs = `action=buscar&q=${encodeURIComponent(q)}&_=${b}`;
      const j = await ApiService.requestAny(apiPathsFor(`/eventos.php?${qs}`), { method: 'GET', timeoutMs: 12000 });
      if (!j || j.ok !== true) {
        const err = (j && j.error) ? String(j.error) : 'Falha na busca';
        throw new Error(err);
      }
      return Array.isArray(j.eventos) ? j.eventos : [];
    },
    async upcoming(limit = 5) {
      const b = Date.now();
      const lim = Number(limit) || 5;
      const qs = `action=proximos&limite=${encodeURIComponent(String(lim))}&_=${b}`;
      const j = await ApiService.requestAny(apiPathsFor(`/eventos.php?${qs}`), { method: 'GET', timeoutMs: 12000 });
      if (!j || j.ok !== true) {
        const err = (j && j.error) ? String(j.error) : 'Falha ao buscar próximos';
        throw new Error(err);
      }
      return Array.isArray(j.eventos) ? j.eventos : [];
    },
    async create(payload) {
      const j = await ApiService.requestAny(
        apiPathsFor('/eventos.php?action=criar'),
        { method: 'POST', body: JSON.stringify(payload), timeoutMs: 12000 }
      );
      if (!j || j.ok !== true) {
        const err = (j && j.error) ? String(j.error) : 'Falha ao criar';
        throw new Error(err);
      }
      return j.evento;
    },
    async update(id, payload) {
      const rid = Number(id) || 0;
      const j = await ApiService.requestAny(
        apiPathsFor(`/eventos.php?action=editar&id=${rid}`),
        { method: 'PUT', body: JSON.stringify(payload), timeoutMs: 12000 }
      );
      if (!j || j.ok !== true) {
        const err = (j && j.error) ? String(j.error) : 'Falha ao editar';
        throw new Error(err);
      }
      return j.evento;
    },
    async remove(id) {
      const rid = Number(id) || 0;
      const j = await ApiService.requestAny(
        apiPathsFor(`/eventos.php?action=excluir&id=${rid}`),
        { method: 'DELETE', timeoutMs: 12000 }
      );
      if (!j || j.ok !== true) {
        const err = (j && j.error) ? String(j.error) : 'Falha ao excluir';
        throw new Error(err);
      }
      return true;
    },
  };

  class CalendarApp {
    constructor(root) {
      this.root = root;
      this.view = 'month';
      const now = new Date();
      this.cursorDate = new Date(now.getFullYear(), now.getMonth(), 1);
      this.selectedDate = toIsoDate(now);
      this.events = [];
      this.loading = false;
      this.searchQuery = '';
      this.filters = new Set(CATEGORIES.map(c => c.key)); // all on

      this._bound = false;
      this._clockTimer = null;
      this._editingId = null;
      this._searchTimer = null;
      this._refreshToken = 0;

      this._maintenanceKey = 'calendar.maintenance.unlocked.v1';
      this._maintenancePassword = '91166734';
    }

    el(id) { return document.getElementById(id); }

    async init() {
      if (this._bound) return;
      this._bound = true;
      // FIX: sempre iniciar com o dia atual selecionado ao abrir a página.
      this.selectedDate = toIsoDate(new Date());
      this._renderStaticBits();
      this._bind();
      if (this._isUnlocked()) {
        await this.refresh();
      } else {
        this._showMaintenanceGate();
      }
      this._startClock();
    }

    destroy() {
      if (this._clockTimer) clearInterval(this._clockTimer);
      this._clockTimer = null;
    }

    _startClock() {
      const clock = this.el('cal-now');
      if (!clock) return;
      const tick = () => {
        const d = new Date();
        clock.textContent = d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      };
      tick();
      this._clockTimer = setInterval(tick, 1000);
    }

    _renderStaticBits() {
      const headers = this.el('cal-day-headers');
      if (headers) headers.innerHTML = WEEKDAY_LABELS.map(w => `<div class="cal-dh">${w}</div>`).join('');

      const filters = this.el('cal-filters');
      if (filters) {
        filters.innerHTML = CATEGORIES.map(c =>
          `<button type="button" class="cal-filter cal-filter--${c.color} is-on" data-cal-filter="${Utils.escapeHtmlAttr(c.key)}">${Utils.escapeHtml(c.key)}</button>`
        ).join('');
      }
    }

    _bind() {
      // Manutenção gate
      this.el('cal-maint-enter')?.addEventListener('click', () => this._tryUnlock());
      this.el('cal-maint-pass')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._tryUnlock();
      });

      this.el('cal-prev')?.addEventListener('click', () => this._nav(-1));
      this.el('cal-next')?.addEventListener('click', () => this._nav(1));
      this.el('cal-today-btn')?.addEventListener('click', () => this._goToday());
      this.el('refreshCalendarBtn')?.addEventListener('click', () => this.refresh(true));
      this.el('cal-add-btn')?.addEventListener('click', () => this._openNewModal());

      const search = this.el('cal-search');
      const clearBtn = this.el('cal-search-clear');
      const setClearVisible = (v) => {
        if (!clearBtn) return;
        clearBtn.hidden = !v;
      };
      if (search) {
        search.addEventListener('input', (e) => {
          const raw = String(e.target.value || '');
          setClearVisible(raw.trim().length > 0);
          if (this._searchTimer) clearTimeout(this._searchTimer);
          this._searchTimer = setTimeout(() => {
            this.searchQuery = raw.trim();
            this.render();
          }, 300);
        });
      }
      if (clearBtn && search) {
        clearBtn.addEventListener('click', () => {
          search.value = '';
          setClearVisible(false);
          this.searchQuery = '';
          this.render();
          search.focus();
        });
      }

      this.root.querySelectorAll('[data-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const v = String(btn.getAttribute('data-view') || 'month');
          this._setView(v);
        });
      });

      this.el('cal-filters')?.addEventListener('click', (e) => {
        const b = e.target.closest?.('[data-cal-filter]');
        if (!b) return;
        const key = String(b.getAttribute('data-cal-filter') || '').trim();
        if (!key) return;
        if (this.filters.has(key)) this.filters.delete(key);
        else this.filters.add(key);
        b.classList.toggle('is-on', this.filters.has(key));
        this.render();
      });

      this.el('cal-grid')?.addEventListener('click', (e) => {
        const day = e.target.closest?.('[data-cal-day]');
        if (!day) return;
        const iso = String(day.getAttribute('data-cal-day') || '');
        if (!iso) return;
        this.selectedDate = iso;
        this.render();
      });

      this.el('cal-grid')?.addEventListener('click', (e) => {
        const evBtn = e.target.closest?.('[data-cal-ev-id]');
        if (!evBtn) return;
        const id = Number(evBtn.getAttribute('data-cal-ev-id') || 0);
        if (!id) return;
        this._openEditModal(id);
      });

      this.el('cal-mini-grid')?.addEventListener('click', (e) => {
        const b = e.target.closest?.('[data-cal-mini-day]');
        if (!b) return;
        const iso = String(b.getAttribute('data-cal-mini-day') || '');
        if (!iso) return;
        if (b.classList.contains('is-pad')) return;
        const d = new Date(iso + 'T00:00:00');
        this.cursorDate = new Date(d.getFullYear(), d.getMonth(), 1);
        this.selectedDate = iso;
        this.refresh();
      });

      // Modal
      ['closeEventModal', 'cancelEventModal'].forEach(id => {
        this.el(id)?.addEventListener('click', () => ModalService.close('eventModal'));
      });
      this.el('saveEventBtn')?.addEventListener('click', (e) => {
        // FIX: impedir disparos não-intencionais (programáticos) no carregamento.
        e?.preventDefault?.();
        this._saveEvent(true);
      });
      this.el('deleteEventBtn')?.addEventListener('click', () => this._deleteEvent());

      // Status indicator (dropdown)
      this.el('cal-sys-btn')?.addEventListener('click', (e) => {
        e?.preventDefault?.();
        this._toggleSystemStatusDropdown();
      });
      this.el('cal-sys-dd')?.addEventListener('click', (e) => {
        const b = e.target.closest?.('[data-cal-sys-pick]');
        if (!b) return;
        const pick = String(b.getAttribute('data-cal-sys-pick') || '').trim();
        this._setSystemStatus(pick);
        this.el('cal-sys-dd').hidden = true;
      });
      document.addEventListener('pointerdown', (e) => {
        const dd = this.el('cal-sys-dd');
        const btn = this.el('cal-sys-btn');
        if (!dd || !btn) return;
        if (dd.hidden) return;
        const t = e.target;
        if (t && (dd.contains(t) || btn.contains(t))) return;
        dd.hidden = true;
      });
    }

    _setView(v) {
      const next = (v === 'week' || v === 'day') ? v : 'month';
      this.view = next;
      this.root.querySelectorAll('[data-view]').forEach((btn) => {
        btn.classList.toggle('cal-vt-active', String(btn.getAttribute('data-view')) === next);
      });
      this.render();
    }

    _nav(delta) {
      if (this.view === 'month') {
        this.cursorDate = new Date(this.cursorDate.getFullYear(), this.cursorDate.getMonth() + delta, 1);
        // FIX: ao navegar entre meses, selecionar o dia 1 do novo mês.
        this.selectedDate = toIsoDate(this.cursorDate);
        this.refresh();
        return;
      }
      const base = new Date(this.selectedDate + 'T00:00:00');
      if (this.view === 'week') base.setDate(base.getDate() + delta * 7);
      if (this.view === 'day') base.setDate(base.getDate() + delta);
      this.selectedDate = toIsoDate(base);
      this.cursorDate = new Date(base.getFullYear(), base.getMonth(), 1);
      this.refresh();
    }

    _goToday() {
      const now = new Date();
      this.cursorDate = new Date(now.getFullYear(), now.getMonth(), 1);
      this.selectedDate = toIsoDate(now);
      this.refresh();
    }

    _setLoading(v) {
      this.loading = !!v;
      this.root.classList.toggle('is-loading', this.loading);
    }

    _passesFilters(ev) {
      const cat = String(ev.categoria || 'Em andamento').trim() || 'Em andamento';
      if (!this.filters.has(cat)) return false;
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        if (!String(ev.titulo || '').toLowerCase().includes(q)) return false;
      }
      return true;
    }

    _eventsForDate(isoDate) {
      return this.events
        .filter(ev => {
          const d = parseDt(ev.data_inicio);
          return d && toIsoDate(d) === isoDate;
        })
        .filter(ev => this._passesFilters(ev))
        .sort((a, b) => (parseDt(a.data_inicio)?.getTime() || 0) - (parseDt(b.data_inicio)?.getTime() || 0));
    }

    async refresh(showToast = false) {
      const token = ++this._refreshToken;
      try {
        this._setLoading(true);
        if (!this._isUnlocked()) {
          this._showMaintenanceGate();
          return;
        }
        if (!ApiService.enabled || !ApiService.enabled()) {
          // Evita “Falha ao criar/listar” em ambiente estático sem PHP (Live Server).
          this.events = [];
          this.render();
          if (showToast) ToastService.show('API do calendário indisponível (sem PHP).', 'warning');
          return;
        }
        const y = this.cursorDate.getFullYear();
        const m0 = this.cursorDate.getMonth();
        const [monthEvents, upcoming] = await Promise.all([
          Api.listMonth(y, m0),
          Api.upcoming(5).catch(() => null),
        ]);
        if (token !== this._refreshToken) return;
        this.events = monthEvents;
        this._syncSystemStatusUi();
        this.render();
        this._renderUpcomingFromList(upcoming);
        if (showToast) ToastService.show('Calendário atualizado', 'success');
      } catch (e) {
        ToastService.show(String(e?.message || 'Erro ao carregar calendário'), 'danger');
      } finally {
        this._setLoading(false);
      }
    }

    _getSystemStatus() {
      // Se faltar webhook obrigatório, força OFF.
      const cfg = Store.getWebhookConfig?.() || {};
      const byRegion = (cfg && cfg.urlsByRegion && typeof cfg.urlsByRegion === 'object') ? cfg.urlsByRegion : {};
      const required = ['GOVAL', 'VALE_DO_ACO', 'CARATINGA', 'BACKUP'];
      const missing = required.filter(k => !String(byRegion[k] || '').trim());
      if (missing.length) return 'off';

      const key = 'cal.systemStatus.v1';
      const raw = (function () { try { return localStorage.getItem(key) || ''; } catch { return ''; } })();
      const v = String(raw || '').trim();
      if (v === 'warning' || v === 'off' || v === 'ok') return v;
      return 'ok';
    }

    _setSystemStatus(next) {
      const v = (next === 'warning' || next === 'off' || next === 'ok') ? next : 'ok';
      try { localStorage.setItem('cal.systemStatus.v1', v); } catch {}
      this._syncSystemStatusUi();
    }

    _syncSystemStatusUi() {
      const btn = this.el('cal-sys-btn');
      const dd = this.el('cal-sys-dd');
      if (!btn) return;
      const st = this._getSystemStatus();
      btn.dataset.status = st;
      btn.classList.toggle('cal-sys-btn--danger', st === 'off');
      btn.classList.toggle('cal-sys-btn--warn', st === 'warning');
      btn.classList.toggle('cal-sys-btn--ok', st === 'ok');
      btn.textContent = st === 'off' ? 'existe sistema off' : (st === 'warning' ? 'atenção sistema' : 'todos os sistemas ok');
      if (dd) {
        dd.querySelectorAll('[data-cal-sys-pick]').forEach((b) => {
          b.classList.toggle('is-active', String(b.getAttribute('data-cal-sys-pick')) === st);
        });
      }
    }

    _toggleSystemStatusDropdown() {
      const dd = this.el('cal-sys-dd');
      const btn = this.el('cal-sys-btn');
      if (!dd || !btn) return;
      dd.hidden = !dd.hidden;
      if (!dd.hidden) {
        const rect = btn.getBoundingClientRect();
        dd.style.left = `${Math.round(rect.left)}px`;
        dd.style.top = `${Math.round(rect.bottom + 6)}px`;
      }
    }

    _renderUpcomingFromList(list) {
      const el = this.el('cal-upcoming');
      if (!el) return;
      const safe = Array.isArray(list) ? list : [];
      el.innerHTML = safe.length
        ? safe.map(ev => {
          const d = parseDt(ev.data_inicio);
          const iso = d ? toIsoDate(d) : '';
          return `
            <button type="button" class="cal-up-item" data-cal-ev-id="${Number(ev.id) || 0}">
              <span class="${categoryClass(ev.categoria)}">${Utils.escapeHtml(ev.categoria || 'Em andamento')}</span>
              <span class="cal-up-title">${Utils.escapeHtml(ev.titulo || '—')}</span>
              <span class="cal-up-meta">${Utils.escapeHtml(iso ? (iso.split('-').reverse().join('/') + ' ' + toHm(d)) : '—')}</span>
            </button>
          `;
        }).join('')
        : `<div class="cal-empty-mini">Nenhum evento futuro</div>`;
      el.querySelectorAll('[data-cal-ev-id]').forEach(b => b.addEventListener('click', () => this._openEditModal(Number(b.getAttribute('data-cal-ev-id')))));
    }

    render() {
      // Labels
      const monthLabel = this.el('cal-month-label');
      if (monthLabel) {
        monthLabel.textContent = this.cursorDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      }
      const rpDate = this.el('cal-rp-date');
      if (rpDate) rpDate.textContent = fmtDatePt(this.selectedDate);

      // Cabeçalhos da grade (mês/semana/dia)
      const headers = this.el('cal-day-headers');
      if (headers && this.view === 'month') {
        headers.innerHTML = WEEKDAY_LABELS.map(w => `<div class="cal-dh">${w}</div>`).join('');
      }

      this._renderMiniCalendar();
      this._renderHeatmap();
      this._renderStatsAndTimeline();

      if (this.view === 'month') this._renderMonthGrid();
      else if (this.view === 'week') this._renderWeekGrid();
      else this._renderDayGrid();

      this._renderRightPanel();
    }

    _renderMiniCalendar() {
      const wrap = this.el('cal-mini-grid');
      if (!wrap) return;
      const y = this.cursorDate.getFullYear();
      const m = this.cursorDate.getMonth();
      const first = new Date(y, m, 1);
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
      const today = toIsoDate(new Date());
      const sel = this.selectedDate;
      let html = `<div class="cal-mini-head">${WEEKDAY_LABELS.map(d => `<span>${d}</span>`).join('')}</div><div class="cal-mini-body">`;
      const padBefore = first.getDay();
      const totalCells = weeks * 7;
      for (let i = 0; i < totalCells; i++) {
        const dayNum = i - padBefore + 1;
        const isPad = dayNum <= 0 || dayNum > daysInMonth;
        const d = new Date(y, m, Math.min(Math.max(dayNum, 1), daysInMonth));
        const iso = toIsoDate(d);
        const cls = ['cal-mini-day', isPad && 'is-pad', !isPad && iso === today && 'is-today', !isPad && iso === sel && 'is-sel'].filter(Boolean).join(' ');
        html += `<button type="button" class="${cls}" data-cal-mini-day="${iso}">${isPad ? '' : dayNum}</button>`;
      }
      html += `</div>`;
      wrap.innerHTML = html;
    }

    _renderHeatmap() {
      const hm = this.el('cal-heatmap');
      if (!hm) return;
      const y = this.cursorDate.getFullYear();
      const m = this.cursorDate.getMonth();
      const first = new Date(y, m, 1);
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
      const counts = {};
      for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${y}-${pad2(m + 1)}-${pad2(day)}`;
        counts[iso] = this._eventsForDate(iso).length;
      }
      const level = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 4);

      // Grid 6x7 alinhado ao mês
      const start = new Date(y, m, 1 - first.getDay());
      let html = '';
      for (let i = 0; i < weeks * 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const iso = toIsoDate(d);
        const isOther = d.getMonth() !== m;
        const n = isOther ? 0 : (counts[iso] || 0);
        const lv = level(n);
        html += `<button type="button" class="cal-hm-sq cal-hm-${lv}${isOther ? ' is-other' : ''}" title="${Utils.escapeHtml(iso)}: ${n} evento(s)" data-cal-mini-day="${iso}" ${isOther ? 'tabindex="-1"' : ''}></button>`;
      }
      hm.innerHTML = html;
      hm.querySelectorAll('[data-cal-mini-day]').forEach(b => b.addEventListener('click', () => {
        if (b.classList.contains('is-other')) return;
        const iso = b.getAttribute('data-cal-mini-day');
        const d = new Date(iso + 'T00:00:00');
        this.cursorDate = new Date(d.getFullYear(), d.getMonth(), 1);
        this.selectedDate = iso;
        this.refresh();
      }));
    }

    _renderStatsAndTimeline() {
      const todayIso = toIsoDate(new Date());
      const statToday = this.el('stat-today');
      const statHigh = this.el('stat-high');
      const statMonth = this.el('stat-month');

      const todayEvents = this._eventsForDate(todayIso);
      const monthEvents = this.events.filter(ev => this._passesFilters(ev));
      const highCount = todayEvents.filter(ev => String(ev.categoria || '') === 'Alta').length;

      if (statToday) statToday.textContent = String(todayEvents.length);
      if (statHigh) statHigh.textContent = String(highCount);
      if (statMonth) statMonth.textContent = String(monthEvents.length);

      const tl = this.el('cal-timeline-left');
      if (tl) {
        tl.innerHTML = todayEvents.length
          ? todayEvents.map(ev => {
            const d = parseDt(ev.data_inicio);
            return `
              <button type="button" class="cal-tl-item" data-cal-ev-id="${Number(ev.id) || 0}">
                <span class="cal-tl-time">${d ? toHm(d) : '—'}</span>
                <span class="${categoryClass(ev.categoria)}">${Utils.escapeHtml(ev.categoria || 'Em andamento')}</span>
                <span class="cal-tl-title">${Utils.escapeHtml(ev.titulo || '—')}</span>
              </button>
            `;
          }).join('')
          : `<div class="cal-empty-mini">Sem eventos hoje</div>`;
        tl.querySelectorAll('[data-cal-ev-id]').forEach(b => b.addEventListener('click', () => this._openEditModal(Number(b.getAttribute('data-cal-ev-id')))));
      }
    }

    _renderMonthGrid() {
      const grid = this.el('cal-grid');
      if (!grid) return;
      grid.classList.remove('cal-grid--week', 'cal-grid--day');
      grid.classList.add('cal-grid--month');
      const y = this.cursorDate.getFullYear();
      const m = this.cursorDate.getMonth();
      const first = new Date(y, m, 1);
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
      const start = new Date(y, m, 1 - first.getDay());
      const today = toIsoDate(new Date());
      const sel = this.selectedDate;

      let html = '';
      for (let i = 0; i < weeks * 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const iso = toIsoDate(d);
        const isOther = d.getMonth() !== m;
        const cls = ['cal-cell', isOther && 'is-other', iso === today && 'is-today', iso === sel && 'is-sel'].filter(Boolean).join(' ');
        const list = this._eventsForDate(iso);
        const searchHits = this.searchQuery ? list.length > 0 : false;
        const maxPills = 3;
        const shown = list.slice(0, maxPills);
        const more = Math.max(0, list.length - shown.length);
        html += `
          <div class="${cls}${searchHits ? ' has-search-hit' : ''}" data-cal-day="${iso}" role="gridcell" aria-label="${Utils.escapeHtml(iso)}">
            <div class="cal-cell-head">
              <span class="cal-day-num">${d.getDate()}</span>
            </div>
            <div class="cal-cell-body">
              ${shown.map(ev => `
                <button type="button" class="${categoryClass(ev.categoria)} cal-pill--in-cell" data-cal-ev-id="${Number(ev.id) || 0}" title="${Utils.escapeHtml(ev.titulo || '')}">
                  <span class="cal-pill-time">${Utils.escapeHtml(toHm(parseDt(ev.data_inicio) || new Date()))}</span>
                  <span class="cal-pill-title">${Utils.escapeHtml(Utils.truncateForCalendar ? Utils.truncateForCalendar(ev.titulo || '') : String(ev.titulo || '').slice(0, 28))}</span>
                </button>
              `).join('')}
              ${more ? `<button type="button" class="cal-more" data-cal-day="${iso}">+${more} mais</button>` : ''}
            </div>
          </div>
        `;
      }
      grid.innerHTML = html;
    }

    _renderWeekGrid() {
      const grid = this.el('cal-grid');
      if (!grid) return;
      grid.classList.remove('cal-grid--month', 'cal-grid--day');
      grid.classList.add('cal-grid--week');
      const base = startOfWeek(new Date(this.selectedDate + 'T00:00:00'));
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(base);
        d.setDate(base.getDate() + i);
        return d;
      });

      // headers com data
      const headers = this.el('cal-day-headers');
      if (headers) {
        headers.innerHTML = days.map(d => `<div class="cal-dh"><div>${WEEKDAY_LABELS[d.getDay()]}</div><div class="cal-dh-sub">${d.getDate()}/${d.getMonth() + 1}</div></div>`).join('');
      }

      // hour scale + columns
      let html = `<div class="cal-time-col">`;
      for (let h = 0; h < 24; h++) html += `<div class="cal-hour">${pad2(h)}:00</div>`;
      html += `</div><div class="cal-week-cols">`;
      days.forEach(d => {
        const iso = toIsoDate(d);
        const evs = this._eventsForDate(iso);
        html += `<div class="cal-week-col" data-cal-day="${iso}">`;
        for (let h = 0; h < 24; h++) html += `<div class="cal-hour-slot"></div>`;
        evs.forEach(ev => {
          const s = parseDt(ev.data_inicio);
          const e = parseDt(ev.data_fim) || null;
          if (!s) return;
          const startMin = s.getHours() * 60 + s.getMinutes();
          const endMin = e ? (e.getHours() * 60 + e.getMinutes()) : Math.min(24 * 60, startMin + 60);
          const top = (startMin / (24 * 60)) * 100;
          const height = Math.max(3, ((endMin - startMin) / (24 * 60)) * 100);
          html += `
            <button type="button" class="cal-block ${categoryClass(ev.categoria)}" data-cal-ev-id="${Number(ev.id) || 0}"
              style="top:${top}%;height:${height}%"
              title="${Utils.escapeHtml(ev.titulo || '')}">
              <div class="cal-block-title">${Utils.escapeHtml(ev.titulo || '—')}</div>
              <div class="cal-block-time">${Utils.escapeHtml(toHm(s))}</div>
            </button>
          `;
        });
        html += `</div>`;
      });
      html += `</div>`;
      grid.innerHTML = html;
    }

    _renderDayGrid() {
      const grid = this.el('cal-grid');
      if (!grid) return;
      grid.classList.remove('cal-grid--month', 'cal-grid--week');
      grid.classList.add('cal-grid--day');
      const d0 = new Date(this.selectedDate + 'T00:00:00');

      const headers = this.el('cal-day-headers');
      if (headers) {
        headers.innerHTML = `<div class="cal-dh cal-dh--single">${WEEKDAY_LABELS[d0.getDay()]} <span class="cal-dh-sub">${d0.getDate()}/${d0.getMonth() + 1}</span></div>`;
      }

      const iso = this.selectedDate;
      const evs = this._eventsForDate(iso);
      let html = `<div class="cal-time-col">`;
      for (let h = 0; h < 24; h++) html += `<div class="cal-hour">${pad2(h)}:00</div>`;
      html += `</div><div class="cal-day-col" data-cal-day="${iso}">`;
      for (let h = 0; h < 24; h++) html += `<div class="cal-hour-slot"></div>`;
      evs.forEach(ev => {
        const s = parseDt(ev.data_inicio);
        const e = parseDt(ev.data_fim) || null;
        if (!s) return;
        const startMin = s.getHours() * 60 + s.getMinutes();
        const endMin = e ? (e.getHours() * 60 + e.getMinutes()) : Math.min(24 * 60, startMin + 60);
        const top = (startMin / (24 * 60)) * 100;
        const height = Math.max(3, ((endMin - startMin) / (24 * 60)) * 100);
        html += `
          <button type="button" class="cal-block ${categoryClass(ev.categoria)}" data-cal-ev-id="${Number(ev.id) || 0}"
            style="top:${top}%;height:${height}%"
            title="${Utils.escapeHtml(ev.titulo || '')}">
            <div class="cal-block-title">${Utils.escapeHtml(ev.titulo || '—')}</div>
            <div class="cal-block-time">${Utils.escapeHtml(toHm(s))}${e ? '–' + Utils.escapeHtml(toHm(e)) : ''}</div>
          </button>
        `;
      });
      html += `</div>`;
      grid.innerHTML = html;
    }

    _renderRightPanel() {
      const body = this.el('cal-rp-body');
      if (!body) return;
      const list = this._eventsForDate(this.selectedDate);
      if (!list.length) {
        body.innerHTML = `<div class="cal-empty-state">Nenhum evento neste dia</div>`;
        return;
      }
      body.innerHTML = list.map(ev => {
        const s = parseDt(ev.data_inicio);
        const e = parseDt(ev.data_fim);
        const time = s ? toHm(s) : '—';
        const time2 = e ? toHm(e) : '';
        return `
          <button type="button" class="cal-rp-item" data-cal-ev-id="${Number(ev.id) || 0}">
            <div class="cal-rp-item-top">
              <span class="${categoryClass(ev.categoria)}">${Utils.escapeHtml(ev.categoria || 'Em andamento')}</span>
              <span class="cal-rp-item-time">${Utils.escapeHtml(time)}${time2 ? '–' + Utils.escapeHtml(time2) : ''}</span>
            </div>
            <div class="cal-rp-item-title">${Utils.escapeHtml(ev.titulo || '—')}</div>
            ${String(ev.descricao || '').trim() ? `<div class="cal-rp-item-desc">${Utils.escapeHtml(ev.descricao)}</div>` : ''}
          </button>
        `;
      }).join('');
      body.querySelectorAll('[data-cal-ev-id]').forEach(b => b.addEventListener('click', () => this._openEditModal(Number(b.getAttribute('data-cal-ev-id')))));
    }

    _openNewModal() {
      this._editingId = null;
      this.el('eventModalTitle').textContent = 'Novo evento';
      this.el('deleteEventBtn').style.display = 'none';
      this.el('ev-id').value = '';
      this.el('ev-titulo').value = '';
      this.el('ev-desc').value = '';
      this.el('ev-cat').value = 'Em andamento';

      const base = new Date(this.selectedDate + 'T00:00:00');
      base.setHours(9, 0, 0, 0);
      const end = new Date(base);
      end.setHours(10, 0, 0, 0);
      this.el('ev-inicio').value = `${toIsoDate(base)}T${toHm(base)}`;
      this.el('ev-fim').value = `${toIsoDate(end)}T${toHm(end)}`;

      ModalService.open('eventModal');
    }

    _openEditModal(id) {
      const ev = this.events.find(x => Number(x?.id) === Number(id));
      if (!ev) return;
      this._editingId = Number(id);
      this.el('eventModalTitle').textContent = 'Editar evento';
      this.el('deleteEventBtn').style.display = '';
      this.el('ev-id').value = String(ev.id || '');
      this.el('ev-titulo').value = String(ev.titulo || '');
      this.el('ev-desc').value = String(ev.descricao || '');
      this.el('ev-cat').value = String(ev.categoria || 'Em andamento');
      const s = parseDt(ev.data_inicio);
      const e = parseDt(ev.data_fim);
      if (s) this.el('ev-inicio').value = `${toIsoDate(s)}T${toHm(s)}`;
      if (e) this.el('ev-fim').value = `${toIsoDate(e)}T${toHm(e)}`;
      else this.el('ev-fim').value = '';
      ModalService.open('eventModal');
    }

    async _saveEvent(userTriggered) {
      if (!userTriggered) return;
      try {
        if (!this._isUnlocked()) {
          this._showMaintenanceGate();
          return;
        }
        if (!ApiService.enabled || !ApiService.enabled()) {
          ToastService.show('API do calendário indisponível (sem PHP).', 'warning');
          return;
        }
        const titulo = this.el('ev-titulo').value.trim();
        const data_inicio = this.el('ev-inicio').value;
        const data_fim = this.el('ev-fim').value;
        const categoria = this.el('ev-cat').value;
        const descricao = this.el('ev-desc').value;
        if (!titulo) {
          ToastService.show('Título é obrigatório', 'danger');
          return;
        }
        if (!data_inicio) {
          ToastService.show('Data início é obrigatória', 'danger');
          return;
        }

        const payload = { titulo, descricao, data_inicio, data_fim, categoria };
        if (this._editingId) {
          await Api.update(this._editingId, payload);
          ToastService.show('Evento atualizado', 'success');
        } else {
          await Api.create(payload);
          ToastService.show('Evento criado', 'success');
        }
        ModalService.close('eventModal');
        await this.refresh();
      } catch (e) {
        ToastService.show(String(e?.message || 'Erro ao salvar evento'), 'danger');
      }
    }

    async _deleteEvent() {
      const id = Number(this.el('ev-id').value || this._editingId || 0);
      if (!id) return;
      if (!window.confirm('Excluir este evento?')) return;
      try {
        if (!this._isUnlocked()) {
          this._showMaintenanceGate();
          return;
        }
        if (!ApiService.enabled || !ApiService.enabled()) {
          ToastService.show('API do calendário indisponível (sem PHP).', 'warning');
          return;
        }
        await Api.remove(id);
        ToastService.show('Evento excluído', 'info');
        ModalService.close('eventModal');
        await this.refresh();
      } catch (e) {
        ToastService.show(String(e?.message || 'Erro ao excluir'), 'danger');
      }
    }

    _isUnlocked() {
      try { return localStorage.getItem(this._maintenanceKey) === '1'; } catch { return false; }
    }

    _showMaintenanceGate() {
      const ov = this.el('cal-maint-overlay');
      if (!ov) return;
      ov.hidden = false;
      const hint = this.el('cal-maint-hint');
      if (hint) hint.textContent = '';
      const inp = this.el('cal-maint-pass');
      if (inp) {
        inp.value = '';
        requestAnimationFrame(() => inp.focus());
      }
    }

    async _tryUnlock() {
      const inp = this.el('cal-maint-pass');
      const hint = this.el('cal-maint-hint');
      const v = String(inp?.value || '').trim();
      if (!v) {
        if (hint) hint.textContent = 'Informe a senha para acessar.';
        return;
      }
      if (v !== this._maintenancePassword) {
        if (hint) hint.textContent = 'Senha inválida.';
        return;
      }
      try { localStorage.setItem(this._maintenanceKey, '1'); } catch {}
      const ov = this.el('cal-maint-overlay');
      if (ov) ov.hidden = true;
      ToastService.show('Acesso liberado ao calendário.', 'success');
      await this.refresh(true);
    }
  }

  let instance = null;
  window.CalendarApp = {
    init() {
      const root = document.getElementById('cal-app');
      if (!root) return;
      if (!instance) instance = new CalendarApp(root);
      return instance.init();
    },
    refresh() { return instance?.refresh?.(true); },
  };
})();


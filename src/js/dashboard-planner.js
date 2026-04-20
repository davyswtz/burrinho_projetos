/**
 * Dashboard Planner Telecom — KPIs, feed, período, relógio, tooltips (vanilla).
 * Depende de TaskService, Store, Utils (carregados por main.js).
 */
(function () {
  'use strict';

  const DADOS = {
    atividade: [
      { tipo: 'danger', texto: 'Rompimento detectado no Bairro Industrial. Técnico João S. acionado.', hora: '01:38' },
      { tipo: 'success', texto: 'Torre 07 — atenuação corrigida e finalizada por Carlos R.', hora: '01:22' },
      { tipo: 'warning', texto: 'SLA em risco — Av. Brasil sem atualização há 3h.', hora: '00:58' },
      { tipo: 'info', texto: '5 tarefas novas criadas e distribuídas para a semana.', hora: '00:31' },
      { tipo: 'success', texto: 'POP Central — etiquetagem concluída por Ana P.', hora: '00:12' },
    ],
    regioes: [
      { nome: 'Centro', tarefas: 18 },
      { nome: 'Norte', tarefas: 12 },
      { nome: 'Sul', tarefas: 8 },
      { nome: 'Leste', tarefas: 5 },
      { nome: 'Oeste', tarefas: 3 },
    ],
    equipe: [
      { iniciais: 'JO', nome: 'João S.', tarefas: 3, status: 'danger' },
      { iniciais: 'MA', nome: 'Marcos T.', tarefas: 2, status: 'warning' },
      { iniciais: 'AN', nome: 'Ana P.', tarefas: 2, status: 'success' },
      { iniciais: 'CA', nome: 'Carlos R.', tarefas: 1, status: 'success' },
    ],
    infra: {
      nosAtivos: 337,
      nosTotal: 340,
      trafegoDia: '18 TB',
      latencia: '2.4 ms',
      uptime: '99.8%',
      nosOffline: 3,
    },
    sla: {
      geral: 94.2,
      delta: '+1.4%',
      noPrazo: 65,
      emRisco: 20,
      violado: 15,
    },
  };

  const KPI_DURATION = 800;

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateNumber(el, endVal, duration, format) {
    if (!el) return;
    const fmt = format || (v => String(Math.round(v)));
    const start = performance.now();
    const from = 0;
    function frame(now) {
      const u = Math.min(1, (now - start) / duration);
      const v = from + (endVal - from) * easeOutCubic(u);
      el.textContent = fmt(v);
      if (u < 1) requestAnimationFrame(frame);
      else el.textContent = fmt(endVal);
    }
    requestAnimationFrame(frame);
  }

  function pct(n, d) {
    if (!d) return 0;
    return Math.min(100, Math.round((100 * n) / d));
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function taskToUiStatus(t) {
    const st = String(t.effectiveStatus || t.status || '');
    if (st === 'Atrasada' || (t.prazo && t.prazo < Utils.todayIso() && !['Concluída', 'Finalizada', 'Finalizado'].includes(st))) return 'urgente';
    if (['Em andamento', 'Validação', 'Envio pendente'].some(x => st.includes(x))) return 'andamento';
    if (['Concluída', 'Finalizada', 'Finalizado'].includes(st)) return 'concluida';
    return 'pendente';
  }

  const PlannerDashboard = {
    _clockTimer: null,
    _feedTimer: null,
    _kpiAnimated: false,

    init() {
      const period = document.getElementById('plannerPeriodSelect');
      if (period) {
        period.value = this._storeFilterToPeriod(Store.dashboardFilter);
        period.addEventListener('change', () => {
          Store.dashboardFilter = this._periodToStoreFilter(period.value);
          this._kpiAnimated = false;
          if (typeof UI !== 'undefined' && UI.renderDashboard) UI.renderDashboard();
        });
      }

      document.getElementById('plannerSettingsBtn')?.addEventListener('click', () => {
        if (typeof UI !== 'undefined' && UI.navigateTo) UI.navigateTo('config');
      });

      const sb = document.getElementById('plannerSidebarBuild');
      if (sb && window.APP_CONFIG && APP_CONFIG.appBuild) sb.textContent = String(APP_CONFIG.appBuild);

      this._startClock();
      this._renderActivityFeed(DADOS.atividade);
      this._scheduleFeedPulse();
      this._refreshSidebarTooltips();
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        new MutationObserver(() => this._refreshSidebarTooltips()).observe(sidebar, {
          attributes: true,
          attributeFilter: ['class'],
        });
      }
    },

    _storeFilterToPeriod(f) {
      if (f === 'today') return 'today';
      if (f === 'week') return 'week';
      if (f === 'month') return 'month';
      return 'all';
    },

    _periodToStoreFilter(p) {
      if (p === 'today') return 'today';
      if (p === 'week') return 'week';
      if (p === 'month') return 'month';
      return 'all';
    },

    _periodScale() {
      const p = document.getElementById('plannerPeriodSelect')?.value || 'all';
      if (p === 'today') return 0.12;
      if (p === 'week') return 0.45;
      if (p === 'month') return 0.78;
      return 1;
    },

    _startClock() {
      const tick = () => {
        const el = document.getElementById('topbarClock');
        if (!el) return;
        const d = new Date();
        el.textContent = d.toLocaleString('pt-BR', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
      };
      tick();
      clearInterval(this._clockTimer);
      this._clockTimer = setInterval(tick, 30000);
    },

    _refreshSidebarTooltips() {
      const side = document.getElementById('sidebar');
      if (!side || !side.classList.contains('collapsed')) {
        side?.querySelectorAll('.nav-item[data-page]').forEach(btn => {
          if (!btn.dataset.plannerTitle) btn.removeAttribute('title');
        });
        return;
      }
      side.querySelectorAll('.nav-item[data-page]').forEach(btn => {
        const lab = btn.querySelector('.nav-label');
        const t = lab ? lab.textContent.trim() : '';
        if (t) btn.setAttribute('title', t);
      });
    },

    _renderActivityFeed(items) {
      const root = document.getElementById('plannerActivityFeed');
      if (!root) return;
      const dotClass = {
        danger: 'planner-activity-dot planner-activity-dot--danger',
        warning: 'planner-activity-dot planner-activity-dot--warning',
        success: 'planner-activity-dot planner-activity-dot--success',
        info: 'planner-activity-dot planner-activity-dot--info',
      };
      root.innerHTML = items
        .map(
          it => `
        <div class="planner-activity-item">
          <span class="${dotClass[it.tipo] || dotClass.info}" aria-hidden="true"></span>
          <div>${escapeHtml(it.texto)}</div>
          <span class="planner-activity-time">${escapeHtml(it.hora)}</span>
        </div>`,
        )
        .join('');
    },

    _scheduleFeedPulse() {
      clearInterval(this._feedTimer);
      this._feedTimer = setInterval(() => {
        const root = document.getElementById('plannerActivityFeed');
        if (!root || !document.getElementById('page-dashboard')?.classList.contains('active')) return;
        const tipos = ['info', 'success', 'warning', 'danger'];
        const tipo = tipos[Math.floor(Math.random() * tipos.length)];
        const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const row = document.createElement('div');
        row.className = 'planner-activity-item planner-activity-item--enter';
        const dot = document.createElement('span');
        const dc = tipo === 'danger' ? 'danger' : tipo === 'warning' ? 'warning' : tipo === 'success' ? 'success' : 'info';
        dot.className = `planner-activity-dot planner-activity-dot--${dc}`;
        dot.setAttribute('aria-hidden', 'true');
        const mid = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = 'Sistema';
        mid.appendChild(strong);
        mid.appendChild(document.createTextNode(' — evento simulado para demonstração do feed.'));
        const tm = document.createElement('span');
        tm.className = 'planner-activity-time';
        tm.textContent = hora;
        row.appendChild(dot);
        row.appendChild(mid);
        row.appendChild(tm);
        root.insertBefore(row, root.firstChild);
        while (root.children.length > 12) root.removeChild(root.lastChild);
      }, 28000);
    },

    syncFromStore() {
      if (!document.getElementById('page-dashboard')?.classList.contains('active')) return;
      if (typeof TaskService === 'undefined') return;

      const anim = !this._kpiAnimated;
      this._applyKpis(anim);
      this._applyRegions();
      this._applyTeam();
      this._applySlaInfra(anim);
      this._kpiAnimated = true;
    },

    _applyKpis(anim) {
      const scale = this._periodScale();
      const counts = TaskService.getCounts();
      const all = TaskService.getAllDashboardTasks();
      const tod = Utils.todayIso();
      const criadas = all.filter(t => TaskService._isPendingStatus(t.effectiveStatus)).length;
      const hoje = all.filter(
        t => t.prazo === tod || String(t.criadaEm || '')
          .slice(0, 10) === tod,
      ).length;
      const romp = Store.getOpTasks().filter(t => t.categoria === 'rompimentos').length;

      const vCriadas = Math.max(0, Math.round(criadas * scale));
      const vAnd = Math.max(0, Math.round(counts.progress * scale));
      const vDone = Math.max(0, Math.round(counts.done * scale));
      const vRomp = Math.max(0, Math.round(romp * (scale > 0.5 ? 1 : scale)));

      const setKpi = (idVal, end, barFrac) => {
        const el = document.getElementById(idVal);
        const bar = document.querySelector(`[data-planner-kpi-bar="${idVal}"]`);
        if (anim && el) animateNumber(el, end, KPI_DURATION, v => String(Math.round(v)));
        else if (el) el.textContent = String(Math.round(end));
        if (bar) bar.style.width = `${Math.round(100 * barFrac)}%`;
      };

      setKpi('plannerKpiCriadas', vCriadas, Math.min(1, vCriadas / 40));
      setKpi('plannerKpiAndamento', vAnd, Math.min(1, vAnd / 20));
      setKpi('plannerKpiConcluidas', vDone, Math.min(1, vDone / 80));
      setKpi('plannerKpiRompimentos', vRomp, Math.min(1, vRomp / 10));

      const tagC = document.getElementById('plannerKpiTagCriadas');
      if (tagC) tagC.textContent = `+${hoje} hoje`;
      const tagA = document.getElementById('plannerKpiTagAndamento');
      if (tagA) tagA.textContent = vAnd ? 'ativo' : '—';
      const tagD = document.getElementById('plannerKpiTagConcluidas');
      if (tagD) tagD.textContent = `▲ ${Math.min(vDone, 12)}`;
      const tagR = document.getElementById('plannerKpiTagRompimentos');
      if (tagR) tagR.textContent = vRomp ? 'urgente' : 'ok';

      const subC = document.getElementById('plannerKpiSubCriadas');
      if (subC) subC.textContent = `${all.length} tarefas no pipeline`;
      const subA = document.getElementById('plannerKpiSubAndamento');
      if (subA) subA.textContent = vAnd ? 'Em execução no período' : 'Nenhuma ativa';
      const subD = document.getElementById('plannerKpiSubConcluidas');
      if (subD) subD.textContent = vDone ? 'Encerradas no período selecionado' : 'Nenhuma ainda';
      const subR = document.getElementById('plannerKpiSubRompimentos');
      if (subR) subR.textContent = vRomp ? 'Requer atenção imediata' : 'Sem incidentes abertos';

      const nbR = document.getElementById('navBadgeRomp');
      if (nbR) {
        nbR.textContent = String(romp);
        nbR.hidden = romp === 0;
      }
      const manut = Store.getOpTasks().filter(t => t.categoria === 'manutencao-corretiva').length;
      const nbM = document.getElementById('navBadgeManut');
      if (nbM) {
        nbM.textContent = String(manut);
        nbM.hidden = manut === 0;
      }
    },

    _applyRegions() {
      const tasks = TaskService.getFilteredTasks();
      const map = {};
      tasks.forEach(t => {
        const r = String(t.regiao || 'Outras').trim() || 'Outras';
        map[r] = (map[r] || 0) + 1;
      });
      let rows = Object.keys(map).length
        ? Object.entries(map)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([nome, tarefas]) => ({ nome, tarefas }))
        : DADOS.regioes;
      const max = Math.max(1, ...rows.map(r => r.tarefas));
      rows.forEach((row, i) => {
        const lbl = document.getElementById(`plannerRegLabel${i}`);
        const bar = document.querySelector(`[data-planner-reg-bar="${i}"]`);
        if (lbl) lbl.textContent = row.nome;
        const nEl = document.getElementById(`plannerRegNum${i}`);
        if (nEl) nEl.textContent = String(row.tarefas);
        if (bar) bar.style.width = `${pct(row.tarefas, max)}%`;
      });
      for (let i = rows.length; i < 5; i++) {
        const lbl = document.getElementById(`plannerRegLabel${i}`);
        const nEl = document.getElementById(`plannerRegNum${i}`);
        const bar = document.querySelector(`[data-planner-reg-bar="${i}"]`);
        if (lbl) lbl.textContent = '—';
        if (nEl) nEl.textContent = '0';
        if (bar) bar.style.width = '0%';
      }
    },

    _applyTeam() {
      const tasks = TaskService.getFilteredTasks();
      const by = {};
      tasks.forEach(t => {
        const n = String(t.responsavel || '').trim() || '—';
        by[n] = (by[n] || 0) + 1;
      });
      const sorted = Object.entries(by)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      const fallback = DADOS.equipe;
      const list = sorted.length ? sorted.map(([nome, c], i) => ({
        iniciais: nome.slice(0, 2).toUpperCase(),
        nome,
        tarefas: c,
        status: c >= 3 ? 'danger' : c >= 2 ? 'warning' : 'success',
      })) : fallback;

      list.forEach((m, i) => {
        const av = document.getElementById(`plannerTeamAv${i}`);
        const nm = document.getElementById(`plannerTeamName${i}`);
        const ct = document.getElementById(`plannerTeamCount${i}`);
        const dot = document.getElementById(`plannerTeamDot${i}`);
        if (av) {
          av.textContent = m.iniciais;
          const on = m.status === 'success';
          av.className = `planner-team-av ${on ? 'planner-team-av--on' : 'planner-team-av--off'}`;
        }
        if (nm) nm.textContent = m.nome;
        if (ct) ct.textContent = `${m.tarefas} tarefas`;
        if (dot) {
          dot.className = `planner-team-dot planner-team-dot--${m.status === 'danger' ? 'danger' : m.status === 'warning' ? 'warning' : 'success'}`;
        }
      });
    },

    _applySlaInfra(anim) {
      const sla = DADOS.sla;
      const elSla = document.getElementById('plannerSlaValor');
      if (elSla) {
        if (anim) animateNumber(elSla, sla.geral, KPI_DURATION, v => `${v.toFixed(1)}%`);
        else elSla.textContent = `${sla.geral.toFixed(1)}%`;
      }
      const del = document.getElementById('plannerSlaDelta');
      if (del) {
        del.textContent = sla.delta;
        del.className = `planner-sla-delta ${sla.delta.startsWith('-') ? 'planner-sla-delta--down' : 'planner-sla-delta--up'}`;
      }
      const tot = (sla.noPrazo + sla.emRisco + sla.violado) || 1;
      const w0 = document.querySelector('[data-planner-seg="ok"]');
      const w1 = document.querySelector('[data-planner-seg="risk"]');
      const w2 = document.querySelector('[data-planner-seg="bad"]');
      if (w0) w0.style.width = `${pct(sla.noPrazo, tot)}%`;
      if (w1) w1.style.width = `${pct(sla.emRisco, tot)}%`;
      if (w2) w2.style.width = `${pct(sla.violado, tot)}%`;

      const inf = DADOS.infra;
      const on = document.getElementById('plannerInfraNosOn');
      if (on) on.textContent = String(inf.nosAtivos);
      const totN = document.getElementById('plannerInfraNosTotal');
      if (totN) totN.textContent = String(inf.nosTotal);
      const bar = document.querySelector('[data-planner-infra-nos-bar]');
      if (bar) bar.style.width = `${pct(inf.nosAtivos, inf.nosTotal)}%`;
      const tr = document.getElementById('plannerInfraTraf');
      if (tr) tr.textContent = inf.trafegoDia;
      const lat = document.getElementById('plannerInfraLat');
      if (lat) lat.textContent = inf.latencia;
      const up = document.getElementById('plannerInfraUp');
      if (up) {
        up.textContent = inf.uptime;
        up.className = 'planner-infra-val planner-infra-val--pos';
      }
      const off = document.getElementById('plannerInfraOff');
      if (off) {
        off.textContent = String(inf.nosOffline);
        off.className = 'planner-infra-val planner-infra-val--neg';
      }

      const techSet = new Set(
        TaskService.getFilteredTasks().map(t => String(t.responsavel || '').trim()).filter(Boolean),
      );
      const mt = document.getElementById('plannerMiniTech');
      if (mt) mt.textContent = String(techSet.size);
      const ms = document.getElementById('plannerMiniSla');
      if (ms) ms.textContent = `${sla.geral}%`;
      const mu = document.getElementById('plannerMiniUp');
      if (mu) mu.textContent = inf.uptime;
    },
  };

  window.PlannerDashboard = PlannerDashboard;

  function boot() {
    if (!document.getElementById('page-dashboard')) return;
    PlannerDashboard.init();
    PlannerDashboard.syncFromStore();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/**
 * Dashboard Planner Telecom — KPIs, feed, período, relógio, tooltips (vanilla).
 * Depende de TaskService, Store, Utils (carregados por main.js).
 */
(function () {
  'use strict';

  // Evita duplo-disparo (pointerdown + click) no toggle.
  let __lateToggleLastTs = 0;
  function __triggerLateToggle(source, e, fn) {
    const now = Date.now();
    if (now - __lateToggleLastTs < 450) {
      return;
    }
    __lateToggleLastTs = now;
    fn();
  }

  const DADOS = {
    atividade: [
      { tipo: 'danger', texto: 'Rompimento detectado no Bairro Industrial. Técnico João S. acionado.', hora: '01:38' },
      { tipo: 'success', texto: 'Torre 07 — atenuação corrigida e finalizada por Carlos R.', hora: '01:22' },
      { tipo: 'warning', texto: 'SLA em risco — Av. Brasil sem atualização há 3h.', hora: '00:58' },
      { tipo: 'info', texto: '5 tarefas novas criadas e distribuídas para a semana.', hora: '00:31' },
      { tipo: 'success', texto: 'POP Central — etiquetagem concluída por Ana P.', hora: '00:12' },
    ],
    regioes: [
      { nome: 'Goval', tarefas: 18 },
      { nome: 'Vale do Aço', tarefas: 12 },
      { nome: 'Caratinga', tarefas: 8 },
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
    _kpiLateMode: false,
    _kpiLateModeKey: 'planner.dashboard.kpiLateMode.v1',
    _leafletMap: null,
    _leafletModalMap: null,
    _leafletHeatOverlays: [],
    _leafletModalHeatOverlays: [],
    _leafletLoadPromise: null,
    _leafletHeatZoomHandler: null,
    _leafletModalHeatZoomHandler: null,
    _heatSelectedRegion: '',
    _lastHeatRows: [],
    _lastHeatPoints: [],

    init() {
      try {
        this._kpiLateMode = localStorage.getItem(this._kpiLateModeKey) === '1';
      } catch {
        this._kpiLateMode = false;
      }

      const period = document.getElementById('plannerPeriodSelect');
      if (period) {
        period.value = this._storeFilterToPeriod(Store.dashboardFilter);
        period.addEventListener('change', () => {
          Store.dashboardFilter = this._periodToStoreFilter(period.value);
          this._kpiAnimated = false;
          if (typeof UI !== 'undefined' && UI.renderDashboard) UI.renderDashboard();
        });
      }

      // Listener direto (caso o botão exista no DOM).
      document.getElementById('plannerKpiToggleLate')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        __triggerLateToggle('click:direct', e, () => this._toggleLateMode());
      });

      // Fallback robusto: delegação no documento (cobre casos onde algum overlay
      // ou re-render substitui o botão e o listener direto não pega).
      if (!document.documentElement.dataset.plannerLateToggleBound) {
        document.documentElement.dataset.plannerLateToggleBound = '1';
        document.addEventListener('click', (e) => {
          const btn = e.target?.closest?.('#plannerKpiToggleLate');
          if (!btn) return;
          e.preventDefault();
          e.stopPropagation();
          __triggerLateToggle('click:delegated', e, () => this._toggleLateMode());
        }, true);
      }

      document.getElementById('plannerSettingsBtn')?.addEventListener('click', () => {
        if (typeof UI !== 'undefined' && UI.navigateTo) UI.navigateTo('config');
      });

      document.getElementById('plannerHeatClearRegionBtn')?.addEventListener('click', () => {
        this._heatSelectedRegion = '';
        this._kpiAnimated = false;
        if (typeof UI !== 'undefined' && UI.renderDashboard) UI.renderDashboard();
      });
      document.getElementById('plannerHeatExpandBtn')?.addEventListener('click', () => this._openHeatMapModal());
      document.getElementById('closeHeatMapModal')?.addEventListener('click', () => ModalService?.close?.('heatMapModal'));

      if (!document.documentElement.dataset.plannerHeatMapBound) {
        document.documentElement.dataset.plannerHeatMapBound = '1';
        document.addEventListener('click', (e) => {
          const cell = e.target?.closest?.('[data-planner-heat-region]');
          if (!cell) return;
          const region = String(cell.dataset.plannerHeatRegion || '').trim();
          if (!region) return;
          this._heatSelectedRegion = region;
          this._kpiAnimated = false;
          if (typeof UI !== 'undefined' && UI.renderDashboard) UI.renderDashboard();
          if (typeof ToastService !== 'undefined' && ToastService?.show) {
            ToastService.show(`Mapa filtrado por ${region}`, 'info');
          }
        });
      }

      const sb = document.getElementById('plannerSidebarBuild');
      if (sb && window.APP_CONFIG && APP_CONFIG.appBuild) sb.textContent = String(APP_CONFIG.appBuild);

      this._startClock();
      this._renderActivityFeedFromStore();
      this._refreshSidebarTooltips();
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        new MutationObserver(() => this._refreshSidebarTooltips()).observe(sidebar, {
          attributes: true,
          attributeFilter: ['class'],
        });
      }
    },

    _toggleLateMode() {
      this._kpiLateMode = !this._kpiLateMode;
      try {
        localStorage.setItem(this._kpiLateModeKey, this._kpiLateMode ? '1' : '0');
      } catch {
        /* ignore */
      }
      this._kpiAnimated = false;
      this.syncFromStore();
      if (typeof UI !== 'undefined' && typeof UI.renderDashboard === 'function') UI.renderDashboard();
      if (typeof ToastService !== 'undefined' && ToastService?.show) {
        ToastService.show(this._kpiLateMode ? 'Mostrando: Atrasadas' : 'Mostrando: Rompimentos', 'info');
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

    _renderActivityFeedFromStore() {
      if (typeof Store === 'undefined' || !Store.getActivityEvents) return;
      const raw = Store.getActivityEvents();
      const items = (Array.isArray(raw) ? raw : [])
        .slice()
        .sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0))
        .slice(0, 12)
        .map((e) => {
          const tipo = String(e?.severity || 'info');
          const who = String(e?.username || '').trim();
          const core = String(e?.message || '').trim() || '—';
          const texto = who ? `${who} — ${core}` : core;
          const createdAt = String(e?.createdAt || '');
          const hora =
            createdAt
              ? new Date(createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          return { tipo, texto, hora };
        });
      this._renderActivityFeed(items);
    },

    syncFromStore() {
      if (!document.getElementById('page-dashboard')?.classList.contains('active')) return;
      if (typeof TaskService === 'undefined') return;

      const anim = !this._kpiAnimated;
      this._applyKpis(anim);
      this._applyRegions();
      this._applyTeam();
      this._applySlaInfra(anim);
      this._renderActivityFeedFromStore();
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
      const vLate = Math.max(0, Math.round((Number(counts.late) || 0) * scale));

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
      setKpi('plannerKpiRompimentos', this._kpiLateMode ? vLate : vRomp, Math.min(1, (this._kpiLateMode ? vLate : vRomp) / 10));

      const tagC = document.getElementById('plannerKpiTagCriadas');
      if (tagC) tagC.textContent = `+${hoje} hoje`;
      const tagA = document.getElementById('plannerKpiTagAndamento');
      if (tagA) tagA.textContent = vAnd ? 'ativo' : '—';
      const tagD = document.getElementById('plannerKpiTagConcluidas');
      if (tagD) tagD.textContent = `▲ ${Math.min(vDone, 12)}`;
      const tagR = document.getElementById('plannerKpiTagRompimentos');
      if (tagR) tagR.textContent = this._kpiLateMode ? (vLate ? 'atraso' : 'ok') : (vRomp ? 'urgente' : 'ok');

      const subC = document.getElementById('plannerKpiSubCriadas');
      if (subC) subC.textContent = `${all.length} tarefas no pipeline`;
      const subA = document.getElementById('plannerKpiSubAndamento');
      if (subA) subA.textContent = vAnd ? 'Em execução no período' : 'Nenhuma ativa';
      const subD = document.getElementById('plannerKpiSubConcluidas');
      if (subD) subD.textContent = vDone ? 'Encerradas no período selecionado' : 'Nenhuma ainda';
      const subR = document.getElementById('plannerKpiSubRompimentos');
      if (subR) subR.textContent = this._kpiLateMode
        ? (vLate ? 'Tarefas com prazo vencido' : 'Sem tarefas atrasadas')
        : (vRomp ? 'Requer atenção imediata' : 'Sem incidentes abertos');

      const lblR = document.querySelector('#page-dashboard .planner-kpi--alert .planner-kpi-label');
      if (lblR) lblR.textContent = this._kpiLateMode ? 'Atrasadas' : 'Rompimentos';

      const tog = document.getElementById('plannerKpiToggleLate');
      if (tog) {
        tog.setAttribute('aria-label', this._kpiLateMode ? 'Alternar para rompimentos' : 'Alternar para atrasadas');
        tog.setAttribute('title', this._kpiLateMode ? 'Alternar para rompimentos' : 'Alternar para atrasadas');
      }

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

    _getRegionCenters() {
      const defaults = {
        Goval: { lat: -18.8545, lng: -41.9555 },
        'Vale do Aço': { lat: -19.4703, lng: -42.5476 },
        Caratinga: { lat: -19.7897, lng: -42.1392 },
        Backup: { lat: -19.9191, lng: -43.9386 },
        Outras: { lat: -19.25, lng: -42.75 },
      };
      const custom = window.APP_CONFIG?.leafletRegionCenters || window.APP_CONFIG?.googleMapsRegionCenters;
      if (!custom || typeof custom !== 'object') return defaults;
      return { ...defaults, ...custom };
    },

    _loadLeaflet() {
      if (window.L?.map) return Promise.resolve(window.L);
      if (this._leafletLoadPromise) return this._leafletLoadPromise;
      this._leafletLoadPromise = new Promise((resolve, reject) => {
        if (!document.querySelector('link[data-planner-leaflet-css]')) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
          link.dataset.plannerLeafletCss = '1';
          document.head.appendChild(link);
        }
        const urls = [
          'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
          'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
        ];
        let idx = 0;
        const loadNext = () => {
          const script = document.createElement('script');
          script.src = urls[idx++];
          script.async = true;
          script.onload = () => resolve(window.L);
          script.onerror = () => {
            if (idx < urls.length) {
              loadNext();
              return;
            }
            this._leafletLoadPromise = null;
            reject(new Error('leaflet_load_failed'));
          };
          document.head.appendChild(script);
        };
        loadNext();
      });
      return this._leafletLoadPromise;
    },

    _heatColor(level, alpha = 0.42) {
      if (level >= 4) return `rgba(255, 69, 69, ${alpha})`;
      if (level === 3) return `rgba(255, 162, 47, ${alpha})`;
      if (level === 2) return `rgba(255, 209, 102, ${alpha})`;
      if (level === 1) return `rgba(44, 255, 130, ${alpha})`;
      return `rgba(255, 255, 255, ${Math.min(alpha, 0.18)})`;
    },

    _parseTaskCoords(raw) {
      const s = String(raw || '').trim();
      if (!s) return null;
      const parts = s.split(',').map(part => part.trim());
      if (parts.length < 2) return null;
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      return { lat, lng };
    },

    _rompimentoHeatPoints(tasks, today, done) {
      return tasks
        .filter(t => String(t?.categoria || '').trim() === 'rompimentos')
        .map((t) => {
          const pos = this._parseTaskCoords(t?.coordenadas);
          if (!pos) return null;
          const status = String(t?.effectiveStatus || t?.status || '').trim();
          const prazo = String(t?.prazo || '').slice(0, 10);
          return {
            task: t,
            lat: pos.lat,
            lng: pos.lng,
            regiao: String(t?.regiao || 'Outras').trim() || 'Outras',
            aberta: !done.has(status),
            atrasada: Boolean(prazo && prazo < today && !done.has(status)),
          };
        })
        .filter(Boolean);
    },

    _clusterHeatPoints(points, zoom) {
      const cellSize =
        zoom >= 15 ? 0.0015 :
          zoom >= 13 ? 0.004 :
            zoom >= 11 ? 0.012 :
              zoom >= 9 ? 0.035 :
                0.09;
      const clusters = new Map();
      points.forEach((p) => {
        const key = `${Math.round(p.lat / cellSize)}:${Math.round(p.lng / cellSize)}`;
        if (!clusters.has(key)) {
          clusters.set(key, {
            latSum: 0,
            lngSum: 0,
            count: 0,
            abertas: 0,
            atrasadas: 0,
            regioes: new Map(),
            tasks: [],
          });
        }
        const c = clusters.get(key);
        c.latSum += p.lat;
        c.lngSum += p.lng;
        c.count += 1;
        if (p.aberta) c.abertas += 1;
        if (p.atrasada) c.atrasadas += 1;
        c.regioes.set(p.regiao, (c.regioes.get(p.regiao) || 0) + 1);
        c.tasks.push(p.task);
      });
      return [...clusters.values()].map((c) => {
        let mainRegion = 'Outras';
        let best = -1;
        c.regioes.forEach((n, reg) => {
          if (n > best) {
            best = n;
            mainRegion = reg;
          }
        });
        const score = c.count + (c.abertas * 0.8) + (c.atrasadas * 2.2);
        return {
          lat: c.latSum / c.count,
          lng: c.lngSum / c.count,
          count: c.count,
          abertas: c.abertas,
          atrasadas: c.atrasadas,
          regiao: mainRegion,
          score,
          tasks: c.tasks,
        };
      });
    },

    _renderLeafletHeatOverlays(L, points) {
      return this._renderLeafletHeatOverlaysOnMap(L, this._leafletMap, points, false);
    },

    _renderLeafletHeatOverlaysOnMap(L, map, points, isModal = false) {
      if (!map) return;
      const overlaysKey = isModal ? '_leafletModalHeatOverlays' : '_leafletHeatOverlays';
      this[overlaysKey].forEach(o => o.remove());
      this[overlaysKey] = [];

      const zoom = map.getZoom();
      const clusters = this._clusterHeatPoints(points, zoom);
      const maxScore = Math.max(1, ...clusters.map(c => c.score));
      clusters.forEach((cluster) => {
        const intensity = cluster.score / maxScore;
        const level = cluster.count === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(intensity * 4)));
        const fillColor = this._heatColor(level, level >= 4 ? 0.56 : 0.44);
        const strokeColor = this._heatColor(level, 0.96);
        const meters = Math.max(90, Math.round((90000 / Math.pow(2, Math.max(0, zoom - 7))) * (0.9 + intensity)));
        const radius = Math.min(18000, meters + (cluster.count * 75));
        const circle = L.circle([cluster.lat, cluster.lng], {
          radius,
          color: strokeColor,
          weight: 1.5,
          opacity: 0.95,
          fillColor,
          fillOpacity: 0.58,
        }).addTo(map);
        const marker = L.circleMarker([cluster.lat, cluster.lng], {
          radius: Math.max(8, Math.min(22, 8 + intensity * 12 + Math.sqrt(cluster.count))),
          color: 'rgba(255,255,255,0.82)',
          weight: 1,
          fillColor: strokeColor,
          fillOpacity: 0.97,
        }).addTo(map);
        const label = L.divIcon({
          className: 'planner-leaflet-heat-label',
          html: `<span>${cluster.count}</span>`,
          iconSize: [34, 20],
          iconAnchor: [17, 10],
        });
        const labelMarker = L.marker([cluster.lat, cluster.lng], { icon: label, interactive: false }).addTo(map);
        const popup = `<strong>${escapeHtml(cluster.regiao)}</strong><br>${cluster.count} rompimento(s) com coordenada<br>${cluster.abertas} abertos · ${cluster.atrasadas} atrasados<br><small>Zoom ${zoom}: agrupamento ${clusters.length === points.length ? 'por ponto' : 'por proximidade'}</small>`;
        circle.bindPopup(popup);
        marker.bindPopup(popup);
        this[overlaysKey].push(circle, marker, labelMarker);
      });
    },

    async _renderLeafletHeatMap(rows, heatPoints, opts = {}) {
      const isModal = Boolean(opts.isModal);
      const mapEl = document.getElementById(isModal ? 'plannerLeafletHeatMapExpanded' : 'plannerLeafletHeatMap');
      const statusEl = document.getElementById(isModal ? 'plannerLeafletHeatStatusExpanded' : 'plannerLeafletHeatStatus');
      if (!mapEl) return;
      try {
        const L = await this._loadLeaflet();
        const centers = this._getRegionCenters();
        const center = window.APP_CONFIG?.leafletMapCenter || { lat: -19.35, lng: -42.55 };
        const mapKey = isModal ? '_leafletModalMap' : '_leafletMap';
        const overlaysKey = isModal ? '_leafletModalHeatOverlays' : '_leafletHeatOverlays';
        const handlerKey = isModal ? '_leafletModalHeatZoomHandler' : '_leafletHeatZoomHandler';
        if (this[mapKey]) {
          this[mapKey].remove();
          this[mapKey] = null;
          this[overlaysKey] = [];
        }
        const map = L.map(mapEl, {
          center: [center.lat, center.lng],
          zoom: 8,
          zoomControl: true,
          attributionControl: true,
          scrollWheelZoom: true,
          wheelPxPerZoomLevel: 80,
        });
        this[mapKey] = map;
        const tileUrl = window.APP_CONFIG?.leafletTileUrl || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        const tileAttribution = window.APP_CONFIG?.leafletTileAttribution || '&copy; OpenStreetMap contributors &copy; CARTO';
        L.tileLayer(tileUrl, {
          maxZoom: 19,
          attribution: tileAttribution,
        }).addTo(map);

        const bounds = [];
        heatPoints.forEach(p => bounds.push([p.lat, p.lng]));
        if (!bounds.length) {
          rows.forEach((row) => {
            const pos = centers[row.nome] || centers.Outras;
            if (pos) bounds.push([pos.lat, pos.lng]);
          });
        }
        this._renderLeafletHeatOverlaysOnMap(L, map, heatPoints, isModal);
        if (this[handlerKey]) map.off('zoomend', this[handlerKey]);
        this[handlerKey] = () => this._renderLeafletHeatOverlaysOnMap(L, map, heatPoints, isModal);
        map.on('zoomend', this[handlerKey]);
        if (bounds.length) map.fitBounds(bounds, { padding: isModal ? [52, 52] : [26, 26], maxZoom: heatPoints.length ? 13 : 8 });
        window.setTimeout(() => map.invalidateSize(), 80);
        if (statusEl) {
          statusEl.textContent = heatPoints.length
            ? `${heatPoints.length} rompimento(s) com coordenada · zoom detalha os pontos`
            : 'Sem coordenadas de rompimento no filtro';
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = 'Mapa gratuito indisponível. Usando fallback visual.';
      }
    },

    _openHeatMapModal() {
      const shell = document.getElementById('plannerHeatModalShell');
      if (!shell) return;
      shell.innerHTML = `
        <div class="planner-heat-modal-map-wrap">
          <div class="planner-leaflet-heat-map planner-leaflet-heat-map--expanded" id="plannerLeafletHeatMapExpanded" aria-label="Mapa de calor expandido"></div>
          <span class="planner-leaflet-heat-status" id="plannerLeafletHeatStatusExpanded">Carregando mapa...</span>
        </div>
      `;
      ModalService?.open?.('heatMapModal');
      window.setTimeout(() => this._renderLeafletHeatMap(this._lastHeatRows, this._lastHeatPoints, { isModal: true }), 60);
    },

    _applyRegions() {
      const root = document.getElementById('plannerRegionHeatMap');
      if (!root) return;

      const today = Utils.todayIso();
      const done = new Set(['Concluída', 'Finalizada', 'Finalizado', 'Cancelada']);
      const normalizeRegion = (raw) => {
        const s = String(raw || '').trim();
        if (!s) return 'Outras';
        if (s.toLowerCase() === 'vale do aco') return 'Vale do Aço';
        return s;
      };
      const isLate = (t) => {
        const prazo = String(t?.prazo || '').slice(0, 10);
        const status = String(t?.effectiveStatus || t?.status || '').trim();
        return Boolean(prazo && prazo < today && !done.has(status));
      };
      const isOpen = (t) => !done.has(String(t?.effectiveStatus || t?.status || '').trim());
      const isRompimentoCountStatus = (t) => {
        const status = String(t?.effectiveStatus || t?.status || '').trim();
        return ['Em andamento', 'Concluída', 'Finalizada', 'Finalizado'].includes(status);
      };

      const allOpTasks = (typeof Store !== 'undefined' && Store.getOpTasks) ? Store.getOpTasks() : [];
      const rompimentosForTotals = allOpTasks.filter(t =>
        String(t?.categoria || '').trim() === 'rompimentos' &&
        isRompimentoCountStatus(t),
      );
      const heatPoints = this._rompimentoHeatPoints(rompimentosForTotals, today, done);
      const selectedRegion = String(this._heatSelectedRegion || '').trim();
      const heatPointsForMap = selectedRegion
        ? heatPoints.filter(p => normalizeRegion(p.regiao) === selectedRegion)
        : heatPoints;
      const map = new Map();
      rompimentosForTotals.forEach((t) => {
        const regiao = normalizeRegion(t?.regiao);
        if (!map.has(regiao)) {
          map.set(regiao, { nome: regiao, total: 0, abertas: 0, atrasadas: 0, rompimentos: 0, rompAbertos: 0, rompAtrasados: 0, rompConcluidos: 0 });
        }
        const row = map.get(regiao);
        const status = String(t?.effectiveStatus || t?.status || '').trim();
        row.total += 1;
        if (isOpen(t)) row.abertas += 1;
        if (isLate(t)) row.atrasadas += 1;
        row.rompimentos += 1;
        if (status === 'Em andamento') row.rompAbertos += 1;
        if (['Concluída', 'Finalizada', 'Finalizado'].includes(status)) row.rompConcluidos += 1;
        if (isLate(t)) row.rompAtrasados += 1;
      });

      ['Goval', 'Vale do Aço', 'Caratinga', 'Backup'].forEach((nome) => {
        if (!map.has(nome)) map.set(nome, { nome, total: 0, abertas: 0, atrasadas: 0, rompimentos: 0, rompAbertos: 0, rompAtrasados: 0, rompConcluidos: 0 });
      });

      const rows = [...map.values()]
        .map((row) => ({
          ...row,
          score: row.total + (row.abertas * 0.7) + (row.rompimentos * 1.2) + (row.atrasadas * 2.4),
        }))
        .sort((a, b) => b.score - a.score || b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));

      const maxScore = Math.max(1, ...rows.map(r => r.score));
      const clearRegionBtn = document.getElementById('plannerHeatClearRegionBtn');
      if (clearRegionBtn) {
        clearRegionBtn.hidden = !selectedRegion;
        clearRegionBtn.textContent = selectedRegion ? `Limpar ${selectedRegion}` : 'Limpar região';
      }

      const maxRompimentos = Math.max(1, ...rows.map(r => r.rompimentos));
      const rankingHtml = rows.map((row, i) => {
        const intensity = row.rompimentos / maxRompimentos;
        const level = row.rompimentos === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(intensity * 4)));
        const width = row.rompimentos === 0 ? 0 : Math.max(8, Math.round(intensity * 100));
        const meta = row.rompimentos
          ? `${row.rompAbertos} em andamento · ${row.rompConcluidos} concluídos · ${row.rompAtrasados} atrasados`
          : 'Sem rompimentos no filtro';
        const isSelected = selectedRegion === row.nome;
        return `
          <button type="button" class="planner-heat-row planner-heat-row--level-${level}${isSelected ? ' is-selected' : ''}" data-planner-heat-region="${escapeHtml(row.nome)}">
            <span class="planner-heat-row-main">
              <strong>${escapeHtml(row.nome)}</strong>
              <small id="plannerRegMeta${i}">${escapeHtml(meta)}</small>
            </span>
            <span class="planner-heat-row-count">${row.rompimentos}</span>
            <span class="planner-heat-row-bar"><span style="width:${width}%"></span></span>
          </button>
        `;
      }).join('');

      root.innerHTML = `
        <div class="planner-heat-geo" role="img" aria-label="Mapa visual de calor por região">
          <div class="planner-leaflet-heat-map" id="plannerLeafletHeatMap" aria-label="Mapa gratuito com calor por região"></div>
          <span class="planner-leaflet-heat-status" id="plannerLeafletHeatStatus">Carregando mapa gratuito...</span>
          <span class="planner-heat-map-grid" aria-hidden="true"></span>
        </div>
        <div class="planner-heat-ranking" aria-label="Ranking de calor por região">
          ${rankingHtml}
        </div>
      `;
      this._lastHeatRows = rows;
      this._lastHeatPoints = heatPointsForMap;
      this._renderLeafletHeatMap(rows, heatPointsForMap);
    },

    _applyTeam() {
      // Top técnicos por rompimentos na aba Finalizado (técnico atribuído em `responsavel`).
      const allOp = (typeof Store !== 'undefined' && Store.getOpTasks) ? Store.getOpTasks() : [];
      const rompDone = allOp.filter(t =>
        String(t?.categoria || '').trim() === 'rompimentos' &&
        String(t?.status || '').trim() === 'Finalizado',
      );

      const byTech = new Map(); // nome -> { count, regions: Map(region->count) }
      rompDone.forEach(t => {
        const nome = String(t?.responsavel || '').trim();
        if (!nome) return;
        const reg = String(t?.regiao || '').trim() || '—';
        if (!byTech.has(nome)) byTech.set(nome, { count: 0, regions: new Map() });
        const obj = byTech.get(nome);
        obj.count++;
        obj.regions.set(reg, (obj.regions.get(reg) || 0) + 1);
      });

      const pickMainRegion = (regionsMap) => {
        let best = '—';
        let bestC = -1;
        for (const [r, c] of regionsMap.entries()) {
          if (c > bestC) { bestC = c; best = r; }
        }
        return best;
      };

      const sorted = [...byTech.entries()]
        .map(([nome, obj]) => ({ nome, resolvidos: obj.count, regiao: pickMainRegion(obj.regions) }))
        .sort((a, b) => b.resolvidos - a.resolvidos)
        .slice(0, 4);

      const list = sorted.map((m) => {
        const c = Number(m.resolvidos) || 0;
        return {
          iniciais: String(m.nome || '—').slice(0, 2).toUpperCase(),
          nome: `${m.nome} — ${m.regiao}`,
          tarefas: c,
          status: c >= 8 ? 'danger' : c >= 4 ? 'warning' : 'success',
        };
      });

      for (let i = 0; i < 4; i++) {
        const m = list[i] || { iniciais: '—', nome: '—', tarefas: 0, status: 'success' };
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
        if (ct) ct.textContent = `${m.tarefas} rompimentos`;
        if (dot) {
          dot.className = `planner-team-dot planner-team-dot--${m.status === 'danger' ? 'danger' : m.status === 'warning' ? 'warning' : 'success'}`;
        }
      }
    },

    _applySlaInfra(anim) {
      const opTasks = (typeof Store !== 'undefined' && Store.getOpTasks) ? Store.getOpTasks() : [];
      const rompimentos = opTasks.filter(t => String(t?.categoria || '').trim() === 'rompimentos');

      const doneStatuses = new Set(['Concluída', 'Finalizada', 'Finalizado']);
      const okYmd = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !String(d || '').startsWith('0000');
      const todayIso = Utils.todayIso();

      const monthKey = (ymd) => String(ymd || '').slice(0, 7);
      const addMonths = (ym, delta) => {
        const y = Number(String(ym).slice(0, 4));
        const m = Number(String(ym).slice(5, 7));
        if (!Number.isFinite(y) || !Number.isFinite(m)) return ym;
        const d = new Date(Date.UTC(y, m - 1 + delta, 1));
        const yy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        return `${yy}-${mm}`;
      };

      const classify = (t) => {
        const prazo = String(t?.prazo || '').slice(0, 10);
        const st = String(t?.status || '').trim();
        const isDone = doneStatuses.has(st);

        // Data de conclusão (se houver) para medir "concluída fora do prazo".
        let endDay = '';
        if (isDone) {
          const hist = Array.isArray(t?.historico) ? t.historico : [];
          const end = [...hist].reverse().find(h => doneStatuses.has(String(h?.status || '').trim()) && h?.timestamp)?.timestamp;
          endDay = end ? String(end).slice(0, 10) : '';
        }

        if (isDone) {
          if (endDay && endDay > prazo) return 'violado';
          return 'noPrazo';
        }
        if (todayIso > prazo) return 'violado';

        // "Em risco": vencendo em até 2 dias (inclui hoje), ainda não finalizada.
        const daysLeft = Math.floor((Date.parse(prazo) - Date.parse(todayIso)) / 86400000);
        if (Number.isFinite(daysLeft) && daysLeft <= 2) return 'emRisco';
        return 'noPrazo';
      };

      // SLA mensal (rompimentos do mês corrente) + delta vs mês anterior.
      const curYm = monthKey(todayIso);
      const prevYm = addMonths(curYm, -1);
      const monthTasks = (ym) =>
        rompimentos.filter(t => okYmd(String(t?.prazo || '').slice(0, 10)) && monthKey(String(t?.prazo || '').slice(0, 10)) === ym);

      const summarizeMonth = (ym) => {
        const base = monthTasks(ym);
        const s = { total: base.length, noPrazo: 0, emRisco: 0, violado: 0 };
        base.forEach((t) => {
          const k = classify(t);
          s[k] += 1;
        });
        const geral = s.total ? (100 * s.noPrazo) / s.total : 0;
        return { ...s, geral };
      };

      const sla = summarizeMonth(curYm);
      const slaPrev = summarizeMonth(prevYm);
      const deltaVal = (slaPrev.total ? (sla.geral - slaPrev.geral) : 0);
      const deltaTxt = slaPrev.total ? `${deltaVal >= 0 ? '+' : ''}${deltaVal.toFixed(1)}%` : '—';

      const elSla = document.getElementById('plannerSlaValor');
      if (elSla) {
        if (anim) animateNumber(elSla, sla.geral, KPI_DURATION, v => `${v.toFixed(1)}%`);
        else elSla.textContent = `${sla.geral.toFixed(1)}%`;
      }
      const del = document.getElementById('plannerSlaDelta');
      if (del) {
        del.textContent = deltaTxt;
        del.className = `planner-sla-delta ${deltaTxt.startsWith('-') ? 'planner-sla-delta--down' : 'planner-sla-delta--up'}`;
      }
      const tot = (sla.noPrazo + sla.emRisco + sla.violado) || 1;
      const w0 = document.querySelector('[data-planner-seg="ok"]');
      const w1 = document.querySelector('[data-planner-seg="risk"]');
      const w2 = document.querySelector('[data-planner-seg="bad"]');
      if (w0) w0.style.width = `${pct(sla.noPrazo, tot)}%`;
      if (w1) w1.style.width = `${pct(sla.emRisco, tot)}%`;
      if (w2) w2.style.width = `${pct(sla.violado, tot)}%`;

      // Troca de poste por região (tarefa operacional)
      const tpAll = (typeof Store !== 'undefined' && Store.getOpTasks)
        ? Store.getOpTasks().filter(t => String(t?.categoria || '').trim() === 'troca-poste')
        : [];
      const countBy = { Goval: 0, 'Vale do Aço': 0, Caratinga: 0, Backup: 0, Outras: 0 };
      tpAll.forEach(t => {
        const r = String(t?.regiao || '').trim();
        if (r === 'Goval') countBy.Goval++;
        else if (r === 'Vale do Aço' || r === 'Vale do Aco') countBy['Vale do Aço']++;
        else if (r === 'Caratinga') countBy.Caratinga++;
        else if (r === 'Backup') countBy.Backup++;
        else countBy.Outras++;
      });
      const tpTotalEl = document.getElementById('plannerTpTotal');
      if (tpTotalEl) tpTotalEl.textContent = String(tpAll.length);
      const tpGovalEl = document.getElementById('plannerTpGoval');
      if (tpGovalEl) tpGovalEl.textContent = String(countBy.Goval);
      const tpValeEl = document.getElementById('plannerTpVale');
      if (tpValeEl) tpValeEl.textContent = String(countBy['Vale do Aço']);
      const tpCarEl = document.getElementById('plannerTpCaratinga');
      if (tpCarEl) tpCarEl.textContent = String(countBy.Caratinga);
      const tpBackEl = document.getElementById('plannerTpBackup');
      if (tpBackEl) tpBackEl.textContent = String(countBy.Backup);

      const ms = document.getElementById('plannerMiniSla');
      // SLA geral (rompimentos): % de itens dentro do prazo (concluídos até o prazo, ou ainda no prazo).
      const slaBase = rompimentos.filter(t => okYmd(String(t?.prazo || '').slice(0, 10)));
      const slaTotal = slaBase.length;
      const slaOk = slaBase.filter(t => {
        const prazo = String(t.prazo).slice(0, 10);
        const st = String(t.status || '').trim();
        if (doneStatuses.has(st)) {
          // tenta usar histórico para pegar data real de conclusão; se não houver, assume ok.
          const hist = Array.isArray(t?.historico) ? t.historico : [];
          const end = [...hist].reverse().find(h => doneStatuses.has(String(h?.status || '').trim()) && h?.timestamp)?.timestamp;
          if (!end) return true;
          const endDay = String(end).slice(0, 10);
          return !endDay || endDay <= prazo;
        }
        return todayIso <= prazo;
      }).length;
      const slaPct = slaTotal ? Math.round((100 * slaOk) / slaTotal) : 0;
      if (ms) ms.textContent = `${slaPct}%`;

      // Tempo médio de resolução (rompimentos): média entre início (Em andamento) e fim (Concluída/Finalizada/Finalizado).
      const avgEl = document.getElementById('plannerMiniTmp');
      const durationsMin = rompimentos.map(t => {
        const hist = Array.isArray(t?.historico) ? t.historico : [];
        if (!hist.length) return null;
        const start = hist.find(h => String(h?.status || '').trim() === 'Em andamento' && h?.timestamp)?.timestamp;
        const end = [...hist].reverse().find(h => doneStatuses.has(String(h?.status || '').trim()) && h?.timestamp)?.timestamp;
        if (!start || !end) return null;
        const a = new Date(start);
        const b = new Date(end);
        const diff = b.getTime() - a.getTime();
        if (!Number.isFinite(diff) || diff <= 0) return null;
        return Math.round(diff / 60000);
      }).filter(v => Number.isFinite(v));
      if (avgEl) {
        if (durationsMin.length) {
          const avgMin = Math.round(durationsMin.reduce((s, v) => s + v, 0) / durationsMin.length);
          const hours = avgMin / 60;
          avgEl.textContent = `${hours.toFixed(1)} h`;
        } else {
          avgEl.textContent = '—';
        }
      }
    },
  };

  window.PlannerDashboard = PlannerDashboard;

  // Fallback final: captura clique mesmo se o init não tiver bindado por algum motivo.
  // (Ex.: erro anterior no init, re-render inesperado, etc.)
  if (typeof document !== 'undefined' && !document.documentElement.dataset.plannerLateToggleGlobalBound) {
    document.documentElement.dataset.plannerLateToggleGlobalBound = '1';

    // Usa pointerdown porque "click" pode não disparar (drag/scroll/overlay).
    document.addEventListener('pointerdown', (e) => {
      const btn = e.target?.closest?.('#plannerKpiToggleLate');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        __triggerLateToggle('pointerdown:global', e, () => window.PlannerDashboard?._toggleLateMode?.());
      } catch {
        /* ignore */
      }
    }, true);

    // Fallback para navegadores antigos/ambientes sem Pointer Events.
    document.addEventListener('mousedown', (e) => {
      const btn = e.target?.closest?.('#plannerKpiToggleLate');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        __triggerLateToggle('mousedown:global', e, () => window.PlannerDashboard?._toggleLateMode?.());
      } catch {
        /* ignore */
      }
    }, true);
  }

  function boot() {
    if (!document.getElementById('page-dashboard')) return;
    PlannerDashboard.init();
    PlannerDashboard.syncFromStore();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

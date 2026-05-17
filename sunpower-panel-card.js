/**
 * SunPower Panel Card for Home Assistant — v2.0.0
 *
 * Changes in v2.0:
 * - Statistics API for week/month/year/lifetime (bypasses 10-day recorder limit)
 * - Lifetime = yearly bars, up to 15 years from earliest data
 * - Period navigation: ← prev / next → for day/week/month/year
 * - Custom date range picker
 * - Sparkline fits panel box width (ResizeObserver)
 * - Sparkline always shows today regardless of selected period
 * - Red dot ONLY for offline/unavailable panels
 * - Status: Online / Offline
 * - Period total shown in header chip
 * - Period ranges: day=midnight, week=Sunday, month=1st, year=Jan 1
 *
 * Install : config/www/sunpower-panel-card.js
 * Resource: /local/sunpower-panel-card.js?v=20
 */

const CARD_VERSION = '3.9.2';

// Panel order persistence using HA's frontend_user_data WebSocket API
// This stores data IN HOME ASSISTANT SERVER — survives any browser clear
const _LS_KEY = 'sp_panel_order';  // localStorage cache for fast sync reads
const _HA_STORAGE_KEY = 'sunpower_panel_card';  // key in HA's user data store

// ─── Colour helpers ───────────────────────────────────────────────────────────

function powerToColor(w, max) {
  if (!w || w <= 0) return { bg:'#f8fafc', text:'#94a3b8', border:'#e2e8f0' };
  const r = Math.min(w / max, 1);
  if (r < 0.15) return { bg:'#1c1917', text:'#78716c', border:'#292524' };
  if (r < 0.30) return { bg:'#1c1411', text:'#a16207', border:'#2d1f0d' };
  if (r < 0.50) return { bg:'#1f1609', text:'#ca8a04', border:'#312008' };
  if (r < 0.70) return { bg:'#271d05', text:'#d97706', border:'#3d2b06' };
  if (r < 0.85) return { bg:'#2d1f03', text:'#f59e0b', border:'#452e04' };
  return { bg:'#311a00', text:'#fb923c', border:'#4a2800' };
}

function barColor(w, max) {
  if (!w || w <= 0) return '#e2e8f0';
  const r = Math.min(w / max, 1);
  if (r < 0.3)  return '#b45309';
  if (r < 0.6)  return '#d97706';
  if (r < 0.85) return '#f59e0b';
  return '#fb923c';
}

function fmtW(w) {
  if (w === null || w === undefined || isNaN(w)) return '—';
  return w >= 1000 ? (w / 1000).toFixed(2) + ' kW' : Math.round(w) + 'W';
}

function fmtKwh(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return v.toFixed(2) + ' kWh';
}

function fmtSerial(s) { return s ? s.slice(-10) : '—'; }

// Sparkline — uses SVG with 100% viewBox so it scales with container
let _sparkId = 0;
function sparkline(hist, maxW) {
  const pts = (hist || []).filter(p => p.value > 0);
  if (pts.length < 2) return `<svg viewBox="0 0 100 28" preserveAspectRatio="none" style="width:100%;height:28px;"></svg>`;
  // Scale to actual peak — don't clamp to maxW so differences are visible
  const mx = Math.max(...pts.map(p => p.value));
  if (mx <= 0) return `<svg viewBox="0 0 100 28" preserveAspectRatio="none" style="width:100%;height:28px;"></svg>`;
  const gid = 'sg' + (++_sparkId);
  const coords = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * 100;
    const y = 26 - (p.value / mx) * 22;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = [`0,28`, ...coords, `100,28`].join(' ');
  return `<svg viewBox="0 0 100 28" preserveAspectRatio="none" style="width:100%;height:28px;display:block;">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${area}" fill="url(#${gid})"/>
    <polyline points="${coords.join(' ')}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ─── Period helpers ───────────────────────────────────────────────────────────

function periodStart(period, offset = 0) {
  const now = new Date();
  if (period === 'day') {
    const d = new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate() + offset); return d;
  }
  if (period === 'week') {
    const d = new Date(now); d.setHours(0,0,0,0);
    d.setDate(d.getDate() - d.getDay() + offset * 7); return d; // Sunday
  }
  if (period === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1); return d;
  }
  if (period === 'year') {
    return new Date(now.getFullYear() + offset, 0, 1);
  }
  return new Date(0);
}

function periodEnd(period, offset = 0) {
  if (period === 'day') {
    const d = periodStart('day', offset + 1); return d;
  }
  if (period === 'week') {
    const d = periodStart('week', offset + 1); return d;
  }
  if (period === 'month') {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  }
  if (period === 'year') {
    const now = new Date();
    return new Date(now.getFullYear() + offset + 1, 0, 1);
  }
  return new Date();
}

function periodLabel(period, offset = 0) {
  const s = periodStart(period, offset);
  const now = new Date(); now.setHours(0,0,0,0);
  if (period === 'day') {
    if (offset === 0) return 'Today';
    if (offset === -1) return 'Yesterday';
    return s.toLocaleDateString(undefined, { month:'short', day:'numeric' });
  }
  if (period === 'week') {
    const e = new Date(s); e.setDate(e.getDate() + 6);
    return `${s.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${e.toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
  }
  if (period === 'month') {
    return s.toLocaleDateString(undefined, { month:'long', year:'numeric' });
  }
  if (period === 'year') {
    return s.getFullYear().toString();
  }
  return '';
}

// ─── Card ─────────────────────────────────────────────────────────────────────

class SunpowerPanelCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._panels = [];
    this._editMode = false;
    this._dragSrc = null;
    // Note: freeze state lives at module level (null, 0)
    this._sel = null;
    this._histPeriod = 'day';
    this._offset = 0;          // period navigation offset (0 = current)
    this._customStart = null;  // custom range
    this._customEnd = null;
    this._showCustom = false;
    this._history = {};        // entity_id → [{time, value}]  (today's recorder data)
    this._stats = {};          // entity_id → [{start, sum, mean}]  (long-term statistics)
    this._loading = false;
    this._lastFetch = 0;
    this._arrangeSrc = null;
    this._arrangeGrid = null;
    this._pendingOrder = null;
    this._pendingGrid  = null;
    this._lastRenderHash = null;
    this._shadowReady = false;
  }

  set hass(hass) {
    this._hass = hass;
    // On first load, if localStorage is empty, restore from HA server storage
    if (!this._haStorageLoaded) {
      this._haStorageLoaded = true;
      if (!localStorage.getItem(_LS_KEY)) {
        this._loadSlotGridFromHA();
      }
    }
    this._syncPanels();

    // Only re-render if panel data actually changed — prevents scroll reset
    // on every HA state push (every ~5s)
    const renderHash = this._panels.map(p =>
      `${p.entity_id}:${p.power}:${p.state}`
    ).join('|') + '|edit:' + this._editMode + '|sel:' + this._sel +
      '|period:' + this._histPeriod + '|offset:' + this._offset +
      '|loading:' + this._loading;

    if (renderHash === this._lastRenderHash && this._shadowReady) {
      // Data unchanged — just update power values in-place without full re-render
      this._updatePowerInPlace();
      return;
    }
    this._lastRenderHash = renderHash;
    this._render();
    this._shadowReady = true;
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid config');
    const nc = { title:'Solar Panels', columns:4, max_watts:400, ...config, panels: config.panels || [] };

    const prevHash = this._configHash || '';
    // Primary hash: entity order (catches arrangement saves)
    // Fallback hash: structural params (catches column/watt changes)
    const isEmptySlot = p => !p || p.entity_id === '__empty__' || p._empty;
    const realPanels = nc.panels.filter(p => p && !isEmptySlot(p));
    const orderHash = realPanels.length > 0 ? realPanels.map(p => p.entity_id).join(',') : '';
    const structHash = [nc.columns, nc.max_watts, nc.title, realPanels.length].join('|');
    const newHash = orderHash || structHash;

    // Only wipe panels if structural config changed (columns, max_watts, title, count)
    const prevStructHash = (this._configStructHash) || '';
    const newStructHash = structHash;
    if (prevStructHash !== newStructHash && prevStructHash !== '') {
      this._panels = []; this._history = {}; this._stats = {};
      this._lastFetch = 0; this._sel = null; this._offset = 0;
    }
    // Restore localStorage from slot_grid if cache was cleared
    try {
      if (!localStorage.getItem(_LS_KEY) && nc.slot_grid) {
        localStorage.setItem(_LS_KEY, nc.slot_grid);
      }
    } catch(e) {}
    this._configHash = newHash;
    this._configStructHash = newStructHash;
    this._config = nc;
    if (this._config.panels.length > 0) {
      this._config.panels = this._config.panels.map(p => {
        const lbl = (p.label || '').trim();
        const isAutoLabel = /^panel\s*\d+$/i.test(lbl) || lbl === '—';
        return isAutoLabel ? { ...p, label: '' } : p;
      });
      // If panels array was provided in saved order, apply it to this._panels now
      console.warn('[SP:SETCFG] panels received:', nc.panels.length,
        'first3:', nc.panels.slice(0,3).map(p=>(p.serial||'').slice(-6)));
      if (this._panels.length > 0 && orderHash) {
        const orderedIds = nc.panels.map(p => p.entity_id);
        const panelMap = Object.fromEntries(this._panels.map(p => [p.entity_id, p]));
        const reordered = orderedIds.map(eid => panelMap[eid]).filter(Boolean);
        if (reordered.length === this._panels.length) {
          this._panels = reordered;
        }
      }
    }
  }

  getCardSize() { return 6; }
  static getConfigElement() { return document.createElement('sunpower-panel-card-editor'); }
  static getStubConfig() { return { title:'Solar Panels', columns:4, max_watts:400 }; }

  // ── Entity detection ────────────────────────────────────────────────────────

  _detectInverters() {
    if (!this._hass) return [];
    const RE = /^sensor\.inverter_[eEaA]\d{14}_power$/;
    return Object.entries(this._hass.states)
      .filter(([id]) => RE.test(id))
      .map(([id, s]) => ({
        entity_id: id,
        serial: (id.match(/[EeAa]\d{14}/) || [''])[0].toUpperCase(),
        power: (parseFloat(s.state) || 0) * 1000, // kW → W
        state: s.state,
        attributes: s.attributes,
      }))
      .sort((a, b) => a.serial.localeCompare(b.serial));
  }

  _syncPanels() {
    const inv = this._detectInverters();
    if (inv.length > 0) {
      console.info(`%c SunPower Panel Card %c v${CARD_VERSION} — ${inv.length} inverters`,
        'background:#f59e0b;color:#000;font-weight:700;padding:2px 4px;',
        'background:#111;color:#f59e0b;padding:2px 4px;');
    }
    const isEmptySlot = p => !p || !p.entity_id;
    const hasRealPanels = this._config.panels &&
      this._config.panels.some(p => p && !isEmptySlot(p));

    // Restore localStorage from slot_grid if cache was cleared
    try {
      if (!localStorage.getItem(_LS_KEY) && this._config && this._config.slot_grid) {
        localStorage.setItem(_LS_KEY, this._config.slot_grid);
      }
    } catch(e) {}

    if (hasRealPanels) {
      const panelData = this._config.panels
        .filter(p => p && !isEmptySlot(p))
        .map(p => {
          const live = inv.find(e => e.entity_id === p.entity_id || e.serial === p.serial);
          if (!live) return { ...p, power:0, state:'unavailable' };
          const lbl = (p.label || '').trim();
          const label = /^panel\s*\d+$/i.test(lbl) || !lbl ? fmtSerial(live.serial) : lbl;
          return { ...p, ...live, label };
        });

      if (this._pendingOrder) {
        const panelMap = Object.fromEntries(panelData.map(p => [p.entity_id, p]));
        const reordered = this._pendingOrder.map(eid => panelMap[eid]).filter(Boolean);

        if (reordered.length === panelData.length) {
          this._panels = reordered;
          const configIds = this._config.panels.map(p => p.entity_id).join(',');
          const pendingIds = this._pendingOrder.join(',');
          if (configIds === pendingIds) this._pendingOrder = null;
        } else {
          this._panels = panelData;
        }
      } else {
        this._panels = panelData;
      }

    } else {
      if (this._panels.length === 0 && inv.length > 0) {
        // First load, no saved config — use default serial order
        this._panels = inv.map((e, i) => ({ ...e, label: fmtSerial(e.serial), position: i }));
      } else {
        this._panels = this._panels.map(p => {
          const live = inv.find(e => e.entity_id === p.entity_id);
          if (!live) return p;
          const lbl = (p.label || '').trim();
          return { ...p, ...live, label: /^panel\s*\d+$/i.test(lbl) || !lbl ? fmtSerial(live.serial) : lbl };
        });
      }
    }
    const now = Date.now();
    if (now - this._lastFetch > 300000 && !this._loading) this._loadData();
  }

  // ── Sibling helpers ─────────────────────────────────────────────────────────

  _sibling(panel, suffix) {
    if (!this._hass || !panel.entity_id) return null;
    return this._hass.states[panel.entity_id.replace(/_power$/, `_${suffix}`)] || null;
  }

  _siblingVal(panel, suffix) {
    const s = this._sibling(panel, suffix);
    if (!s) return null;
    const v = parseFloat(s.state);
    return isNaN(v) ? null : v;
  }

  // ── Data loading ────────────────────────────────────────────────────────────
  // Day period: HA recorder history API (5-min resolution)
  // Week/Month/Year/Lifetime/Custom: HA long-term statistics API

  async _loadData() {
    if (!this._hass || !this._panels.length) return;
    this._loading = true;
    this._lastFetch = Date.now();
    this._render(); // show loading state

    const RE = /^sensor\.inverter_[eEaA]\d{14}_/;
    const powerIds = this._panels
      .filter(p => p.entity_id && RE.test(p.entity_id))
      .map(p => p.entity_id);
    const lifetimeIds = powerIds
      .map(id => id.replace(/_power$/, '_lifetime_power'))
      .filter(id => this._hass.states[id]);

    // Always fetch today's recorder history for sparklines
    await this._fetchTodayHistory(powerIds);

    // Fetch statistics for the selected period
    await this._fetchStats([...powerIds, ...lifetimeIds]);

    this._loading = false;
    this._render();
  }

  async _fetchTodayHistory(ids) {
    if (!ids.length) return;
    const today = new Date(); today.setHours(0,0,0,0);
    const end = new Date();
    try {
      const url = `history/period/${today.toISOString()}?end_time=${end.toISOString()}&filter_entity_id=${ids.slice(0,30).join(',')}&significant_changes_only=false`;
      const resp = await this._hass.callApi('GET', url);
      if (Array.isArray(resp)) {
        resp.forEach(series => {
          if (!series.length) return;
          const eid = series[0].entity_id;
          this._history[eid] = series
            .map(h => ({ time: new Date(h.last_changed), value: (parseFloat(h.state) || 0) * 1000 }))
            .filter(h => !isNaN(h.value) && h.value >= 0);
        });
      }
    } catch(e) { console.warn('[SunPower] today history failed:', e); }
  }

  async _fetchStats(ids) {
    if (!ids.length) return;

    let start, end;
    if (this._histPeriod === 'custom' && this._customStart && this._customEnd) {
      start = new Date(this._customStart);
      end = new Date(this._customEnd);
      end.setDate(end.getDate() + 1); // include end date
    } else if (this._histPeriod === 'lifetime') {
      start = new Date(); start.setFullYear(start.getFullYear() - 15);
      end = new Date();
    } else {
      start = periodStart(this._histPeriod, this._offset);
      end = periodEnd(this._histPeriod, this._offset);
    }

    // Statistics period granularity
    const statPeriod = {
      day: 'hour', week: 'day', month: 'day', year: 'month',
      lifetime: 'month', custom: 'day'
    }[this._histPeriod] || 'hour';

    // Long-term statistics are ONLY available via WebSocket, not REST API.
    // hass.callApi() calls REST → 404. Use hass.connection.sendMessagePromise() for WS.
    try {
      const msg = {
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        end_time:   end.toISOString(),
        statistic_ids: ids.slice(0, 60),
        period: statPeriod,
        types: ['sum', 'mean'],
      };
      const resp = await this._hass.connection.sendMessagePromise(msg);
      if (resp && typeof resp === 'object') {
        Object.entries(resp).forEach(([eid, buckets]) => {
          const isLifetime = eid.includes('_lifetime_power');
          this._stats[eid] = (buckets || []).map(b => ({
            time: new Date(b.start),
            sum:  parseFloat(b.sum)  || 0,
            // _power entities report in kW → convert to W; _lifetime_power in kWh → keep
            mean: isLifetime ? 0 : (parseFloat(b.mean) || 0) * 1000,
          }));
        });
        console.info('[SunPower] Statistics loaded via WebSocket:',
          Object.keys(resp).length, 'entities,', statPeriod, 'buckets');
      }
    } catch(e) {
      console.warn('[SunPower] WebSocket statistics failed:', e);
    }
  }

  // ── kWh calculation ─────────────────────────────────────────────────────────

  _getTodayKwh(panel) {
    const hist = this._history[panel.entity_id] || [];
    if (hist.length < 2) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const todayData = hist.filter(h => h.time >= today && h.value > 0);
    if (todayData.length < 2) return null;
    let kwh = 0;
    for (let i = 1; i < todayData.length; i++) {
      const dt = (todayData[i].time - todayData[i-1].time) / 3600000;
      kwh += ((todayData[i].value + todayData[i-1].value) / 2) * dt / 1000;
    }
    return kwh > 0 ? kwh : null;
  }

  _getAllTodayKwh() {
    const vals = this._panels.map(p => this._getTodayKwh(p)).filter(v => v !== null);
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v, 0);
  }

  _periodKwh(panel) {
    const ltId = panel.entity_id ? panel.entity_id.replace(/_power$/, '_lifetime_power') : null;
    const ltStats = ltId ? this._stats[ltId] : null;

    if (ltStats && ltStats.length >= 2) {
      // Use sum delta from long-term statistics (most accurate, covers all time)
      const first = ltStats[0].sum;
      const last  = ltStats[ltStats.length - 1].sum;
      const delta = last - first;
      if (delta >= 0) return delta;
    }

    // Fallback: integrate mean watts from power statistics
    const pStats = this._stats[panel.entity_id];
    if (pStats && pStats.length >= 1) {
      // Each bucket mean is avg W over the bucket period
      const bucketHours = { day:1, week:24, month:24, year:720, lifetime:720, custom:24 }[this._histPeriod] || 1;
      return pStats.reduce((s, b) => s + (b.mean * bucketHours / 1000), 0);
    }
    return null;
  }

  // Total production across all panels for the selected period
  _totalKwh() {
    const vals = this._panels.map(p => this._periodKwh(p)).filter(v => v !== null);
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v, 0);
  }

  // ── Chart buckets ───────────────────────────────────────────────────────────

  _chartBuckets(panel) {
    // Use lifetime_power sum delta for accurate kWh per bucket.
    // lifetime_power is a cumulative kWh counter — delta between consecutive
    // bucket sum values = exact kWh produced in that period.
    const ltId = panel.entity_id ? panel.entity_id.replace(/_power$/, '_lifetime_power') : null;
    const ltStats = ltId ? (this._stats[ltId] || []) : [];
    const pStats  = this._stats[panel.entity_id] || [];
    const now = new Date();

    // Helper: get kWh for a time range using lifetime_power sum delta
    // Falls back to mean*hours integration if no lifetime data
    const kwhForRange = (bS, bE, bucketHours) => {
      if (ltStats.length >= 2) {
        // Find sum values bracketing this range
        const inRange = ltStats.filter(b => b.time >= bS && b.time < bE);
        if (inRange.length >= 2) {
          const delta = inRange[inRange.length-1].sum - inRange[0].sum;
          if (delta >= 0) return delta;
        }
        // Try single bucket sum (HA may return one per period)
        const single = ltStats.find(b => b.time >= bS && b.time < bE);
        if (single && single.sum > 0) {
          // sum in statistics is cumulative — find prev bucket to get delta
          const idx = ltStats.indexOf(single);
          const prev = idx > 0 ? ltStats[idx-1] : null;
          if (prev) { const d = single.sum - prev.sum; if (d >= 0) return d; }
        }
      }
      // Fallback: mean watts × hours
      const stat = pStats.find(b => b.time >= bS && b.time < bE);
      return stat ? (stat.mean * bucketHours / 1000) : 0;
    };

    if (this._histPeriod === 'day') {
      const s = periodStart('day', this._offset);
      return Array.from({ length: 24 }, (_, h) => {
        const bS = new Date(s); bS.setHours(h);
        const bE = new Date(s); bE.setHours(h + 1);
        const kwh = kwhForRange(bS, bE, 1);
        const lbl = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`;
        return { kwh, future: bS > now, isNow: h === now.getHours() && this._offset === 0, lbl, showLbl: h % 3 === 0 };
      });
    }

    if (this._histPeriod === 'week') {
      const s = periodStart('week', this._offset);
      const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      return Array.from({ length: 7 }, (_, i) => {
        const bS = new Date(s); bS.setDate(bS.getDate() + i);
        const bE = new Date(bS); bE.setDate(bE.getDate() + 1);
        return { kwh: kwhForRange(bS, bE, 24), future: bS > now, isNow: false, lbl: dayNames[bS.getDay()], showLbl: true };
      });
    }

    if (this._histPeriod === 'month') {
      const s = periodStart('month', this._offset);
      const daysInMonth = new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate();
      return Array.from({ length: daysInMonth }, (_, i) => {
        const bS = new Date(s.getFullYear(), s.getMonth(), i + 1);
        const bE = new Date(s.getFullYear(), s.getMonth(), i + 2);
        return { kwh: kwhForRange(bS, bE, 24), future: bS > now, isNow: false, lbl: `${i+1}`, showLbl: (i+1) % 5 === 1 };
      });
    }

    if (this._histPeriod === 'year') {
      const yr = periodStart('year', this._offset).getFullYear();
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return Array.from({ length: 12 }, (_, i) => {
        const bS = new Date(yr, i, 1);
        const bE = new Date(yr, i + 1, 1);
        const daysInMonth = new Date(yr, i + 1, 0).getDate();
        return { kwh: kwhForRange(bS, bE, daysInMonth * 24), future: bS > now, isNow: false, lbl: months[i], showLbl: true };
      });
    }

    if (this._histPeriod === 'lifetime') {
      const startYear = now.getFullYear() - 14;
      return Array.from({ length: 15 }, (_, i) => {
        const yr = startYear + i;
        const bS = new Date(yr, 0, 1);
        const bE = new Date(yr + 1, 0, 1);
        // For lifetime, sum all monthly deltas within the year
        const yearLt = ltStats.filter(b => b.time >= bS && b.time < bE);
        let kwh = 0;
        if (yearLt.length >= 2) {
          kwh = yearLt[yearLt.length-1].sum - yearLt[0].sum;
          if (kwh < 0) kwh = 0;
        } else if (yearLt.length === 1 && yearLt[0].sum > 0) {
          const idx = ltStats.indexOf(yearLt[0]);
          const prev = idx > 0 ? ltStats[idx-1] : null;
          kwh = prev ? Math.max(0, yearLt[0].sum - prev.sum) : 0;
        } else {
          // Fallback: mean × hours
          const yearP = pStats.filter(b => b.time >= bS && b.time < bE);
          kwh = yearP.reduce((s, b) => s + b.mean * (365*24/yearP.length) / 1000, 0);
        }
        return { kwh, future: bS > now, isNow: false, lbl: yr.toString(), showLbl: true };
      });
    }

    // Custom range: daily buckets
    if (this._customStart && this._customEnd) {
      const s = new Date(this._customStart);
      const e = new Date(this._customEnd);
      const days = Math.min(Math.ceil((e - s) / 86400000), 90);
      return Array.from({ length: days }, (_, i) => {
        const bS = new Date(s); bS.setDate(bS.getDate() + i);
        const bE = new Date(bS); bE.setDate(bE.getDate() + 1);
        return { kwh: kwhForRange(bS, bE, 24), future: bS > now, isNow: false,
          lbl: `${bS.getMonth()+1}/${bS.getDate()}`, showLbl: i % 7 === 0 };
      });
    }

    return [];
  }

  // ── Period navigation ───────────────────────────────────────────────────────

  _navigate(dir) {
    // dir: -1 = prev, +1 = next; clamp at 0 (can't go future)
    const next = this._offset + dir;
    if (next > 0) return;
    this._offset = next;
    this._stats = {};
    this._loadData();
  }

  _setPeriod(p) {
    this._histPeriod = p;
    this._offset = 0;
    this._showCustom = (p === 'custom');
    this._stats = {};
    if (p !== 'custom') this._loadData();
    else this._render();
  }

  _applyCustom(start, end) {
    this._customStart = start;
    this._customEnd = end;
    this._showCustom = false;
    this._stats = {};
    this._loadData();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  _updatePowerInPlace() {
    // Update power/state text in existing DOM without rebuilding shadow
    // This avoids layout recalculation that causes scroll reset
    const shadow = this.shadowRoot;
    if (!shadow) return;
    const grid = shadow.getElementById('panel-grid');
    if (!grid) return;

    this._panels.forEach((panel, idx) => {
      const cell = grid.querySelector(`[data-idx="${idx}"]`);
      if (!cell) return;
      const powerEl = cell.querySelector('.p-power');
      const isFail = panel.state === 'unavailable' || panel.state === 'unknown';
      if (powerEl) powerEl.textContent = isFail ? '—' : fmtW(panel.power);
      // Update border color for fail state
      if (isFail) cell.style.borderColor = '#dc2626';
    });

    // Update header chips
    const total = this._panels.reduce((s,p) => s+(p.power||0), 0);
    const active = this._panels.filter(p => p.power > 0).length;
    const totalChip = shadow.querySelector('.chip:nth-child(2)');
    if (totalChip) totalChip.textContent = fmtW(total) + ' now';
  }

  _render() {
    const shadow = this.shadowRoot;
    if (!shadow) return;

    // Apply saved order on every non-edit render:
    // If config.panels has saved order, use that (survives HA restart)
    // Otherwise fall back to localStorage (survives element recreation)
    if (!this._editMode) {
      // If pending order exists, apply it (overrides config order during HA persist delay)
      if (this._pendingOrder) {
        const panelMap = Object.fromEntries(this._panels.map(p => [p.entity_id, p]));
        const reordered = this._pendingOrder.map(eid => panelMap[eid]).filter(Boolean);
        if (reordered.length === this._panels.length) this._panels = reordered;
      }
    }

    const maxW  = this._config.max_watts;
    const cols  = this._config.columns;
    const total = this._panels.reduce((s, p) => s + (p.power || 0), 0);
    const active = this._panels.filter(p => p.power > 0).length;
    const offline = this._panels.filter(p => p.state === 'unavailable' || p.state === 'unknown').length;
    const totalKwh = this._totalKwh();


    // Restore localStorage from slot_grid if cache was cleared
    try {
      if (!localStorage.getItem(_LS_KEY) && this._config && this._config.slot_grid) {
        localStorage.setItem(_LS_KEY, this._config.slot_grid);
      }
    } catch(e) {}

    // Build display grid preserving empty slot positions.
    // Priority: (1) localStorage (fastest, survives element recreation)
    //           (2) config.panels with _empty sentinels (survives cache clears + HA restarts)
    //           (3) flat panel list (no arrangement saved)
    let displayGrid;
    const panelMap = Object.fromEntries(this._panels.map(p => [p.entity_id, p]));
    try {
      const grid = this._getSlotGrid();
      if (grid && Array.isArray(grid)) {
        displayGrid = grid.map(eid => eid ? (panelMap[eid] || null) : null);
        const storedIds = new Set(grid.filter(Boolean));
        const extras = this._panels.filter(p => !storedIds.has(p.entity_id));
        if (extras.length) displayGrid = [...displayGrid, ...extras];
      } else {
        displayGrid = this._panels;
      }
    } catch(e) { displayGrid = this._panels; }

    // Map panel entity_id → index in this._panels (for click handler)
    const panelIndexMap = Object.fromEntries(this._panels.map((p,i) => [p.entity_id, i]));

    const gridHtml = displayGrid.map((panel, slotIdx) => {
      if (panel === null) {
        // Empty slot — show as placeholder in normal view
        return `<div class="empty-display-slot"></div>`;
      }
      const panelIdx = panelIndexMap[panel.entity_id] ?? slotIdx;
      const c = powerToColor(panel.power, maxW);
      const todayHist = this._history[panel.entity_id] || [];
      const isFail = panel.state === 'unavailable' || panel.state === 'unknown';
      const pct = Math.round(Math.min((panel.power / maxW) * 100, 100));
      const lbl = panel.label || fmtSerial(panel.serial) || `P${slotIdx+1}`;
      const kwh = this._periodKwh(panel);
      return `<div class="panel-cell${this._sel === panelIdx ? ' selected' : ''}"
        data-idx="${panelIdx}"
        style="background:${c.bg};border-color:${isFail ? '#dc2626' : c.border};"
        onclick="this.getRootNode().host._onPanelClick(${panelIdx})">
        ${isFail ? `<div class="status-dot"></div>` : ''}
        <div class="p-serial" style="color:${c.text};">${lbl}</div>
        <div class="p-power" style="color:${c.text};">${isFail ? '—' : fmtW(panel.power)}</div>
        <div class="p-bar-wrap"><div class="p-bar" style="width:${isFail ? 0 : pct}%;background:${barColor(panel.power, maxW)};"></div></div>
        <div class="p-spark">${sparkline(todayHist, maxW)}</div>
        ${(() => {
          const todayKwh = this._getTodayKwh(panel);
          return todayKwh !== null ? `<div class="p-kwh" style="color:${c.text};">↑ ${fmtKwh(todayKwh)}</div>` : '';
        })()}
        ${(() => { const t = this._siblingVal(panel, 'temperature'); return t !== null ? `<div class="p-temp" style="color:${c.text};">${t.toFixed(1)}°F</div>` : ''; })()}
      </div>`;
    }).join('');



    shadow.innerHTML = `<style>
      :host{display:block;font-family:var(--primary-font-family,'Roboto',sans-serif);}
      .card{background:var(--ha-card-background,#fff);border-radius:12px;padding:16px;border:1px solid #e2e8f0;box-shadow:0 1px 4px rgba(0,0,0,.07);}

      /* ── Header ── */
      .hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:8px;}
      .title{font-size:14px;font-weight:600;color:var(--primary-text-color,#1e293b);margin:0 0 4px;}
      .chips{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px;}
      .chip{background:#f1f5f9;border:1px solid #cbd5e1;border-radius:5px;padding:2px 7px;font-size:10px;color:#475569;white-space:nowrap;}
      .chip.warn{border-color:#dc2626;color:#dc2626;background:#fef2f2;}
      .chip.kwh{border-color:#16a34a;color:#15803d;background:#f0fdf4;}

      /* Arrange + Refresh — top-right, distinct colours */

      .actions{display:flex;gap:6px;align-items:center;flex-shrink:0;}
      .btn-refresh{background:#fff;border:1px solid #cbd5e1;border-radius:6px;color:#64748b;font-size:13px;padding:4px 8px;cursor:pointer;line-height:1;}
      .btn-refresh:hover{background:#f1f5f9;color:#1e293b;}
      .btn-arrange{background:#0f172a;border:1px solid #0f172a;border-radius:6px;color:#f8fafc;font-size:10px;font-weight:600;padding:5px 11px;cursor:pointer;white-space:nowrap;letter-spacing:.02em;}
      .btn-arrange:hover{background:#1e293b;}
      .btn-arrange.done{background:#16a34a;border-color:#16a34a;color:#fff;}
      .btn-arrange.done:hover{background:#15803d;}

      /* ── Period control group ── */
      .period-group{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:12px;}
      .period-tabs{display:flex;background:#e2e8f0;border-radius:6px;padding:2px;gap:2px;margin-bottom:8px;}
      .period-btn{flex:1;background:transparent;border:none;border-radius:4px;color:#64748b;font-size:10px;font-weight:500;padding:5px 0;cursor:pointer;text-align:center;text-transform:uppercase;letter-spacing:.05em;transition:all .15s;}
      .period-btn:hover{color:#1e293b;}
      .period-btn.active{background:#fff;color:#1e293b;box-shadow:0 1px 3px rgba(0,0,0,.1);}
      .nav-row{display:flex;align-items:center;gap:0;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;background:#fff;}
      .nav-btn{background:#fff;border:none;border-right:1px solid #e2e8f0;color:#475569;font-size:14px;padding:5px 12px;cursor:pointer;line-height:1;transition:background .12s;}
      .nav-btn:last-child{border-right:none;border-left:1px solid #e2e8f0;}
      .nav-btn:hover{background:#f1f5f9;}
      .nav-btn:disabled{opacity:.3;cursor:default;}
      .nav-label{flex:1;text-align:center;font-size:11px;font-weight:600;color:#1e293b;padding:0 8px;}
      .custom-form{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;}
      .date-input{border:1px solid #cbd5e1;border-radius:5px;padding:4px 7px;font-size:10px;color:#1e293b;background:#fff;flex:1;min-width:100px;}
      .btn-go{background:#0f172a;border:none;border-radius:5px;color:#fff;font-size:10px;font-weight:600;padding:4px 10px;cursor:pointer;}
      .btn-go:hover{background:#1e293b;}

      /* Grid */
      .grid{display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:7px;}
      .panel-cell{position:relative;border:1px solid;border-radius:8px;padding:8px;cursor:pointer;
        transition:transform .12s,box-shadow .12s;min-height:100px;display:flex;flex-direction:column;gap:2px;user-select:none;overflow:hidden;}
      .panel-cell:hover{transform:translateY(-1px);box-shadow:0 3px 10px rgba(0,0,0,.1);}
      .panel-cell.selected{box-shadow:0 0 0 2px #f59e0b;}
      .panel-cell.draggable{cursor:grab;}
      .panel-cell.drag-over{box-shadow:0 0 0 2px #3b82f6;transform:scale(1.02);}
      .drag-handle{position:absolute;top:4px;right:5px;font-size:12px;color:#94a3b8;cursor:grab;}
      .status-dot{position:absolute;top:5px;left:5px;width:7px;height:7px;border-radius:50%;background:#dc2626;animation:pulse 1.5s infinite;}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
      .p-serial{font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;}
      .p-full-serial{font-size:9px;font-weight:700;color:#000;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;letter-spacing:.02em;}
      .p-power{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2;}
      .p-bar-wrap{height:3px;background:#e2e8f0;border-radius:2px;overflow:hidden;margin-top:2px;}
      .p-bar{height:100%;border-radius:2px;transition:width .5s ease;}
      .p-spark{margin-top:3px;width:100%;overflow:hidden;}
      .p-kwh{font-size:8px;margin-top:1px;}
      .p-temp{font-size:8px;margin-top:1px;opacity:0.75;}
      .edit-hint{font-size:9px;color:#64748b;margin-top:10px;padding:7px 10px;border:1px dashed #cbd5e1;border-radius:6px;display:flex;align-items:center;justify-content:space-between;gap:8px;}
      .btn-reset-arrange{background:#dc2626;border:none;border-radius:5px;color:#fff;font-size:9px;font-weight:600;padding:3px 8px;cursor:pointer;white-space:nowrap;flex-shrink:0;}
      .btn-reset-arrange:hover{background:#b91c1c;}
      .empty{text-align:center;padding:40px 20px;color:#94a3b8;}
      .empty-slot{border:2px dashed #cbd5e1;border-radius:8px;min-height:80px;display:flex;align-items:center;justify-content:center;background:#f8fafc;cursor:pointer;transition:background .12s,border-color .12s;}
      .empty-slot.drop-target{background:#dbeafe;border-color:#3b82f6;}
      .empty-slot.ext-row{opacity:0.4;border-color:#e2e8f0;cursor:default;}
      .arrange-cell{cursor:pointer !important;}
      .arrange-selected{outline:2px solid #f59e0b !important;outline-offset:2px;}
      .empty-slot.snap-highlight{background:#dbeafe;border-color:#3b82f6;}
      .slot-label{font-size:8px;color:#cbd5e1;}
      .panel-cell.snap-highlight{box-shadow:0 0 0 2px #3b82f6;}
      .empty p{font-size:12px;margin:6px 0;}
      .empty code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:10px;color:#475569;}

      /* Detail */
      .detail{margin-top:0;margin-bottom:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;}
      .d-hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;}
      .d-title{font-size:13px;font-weight:600;color:#1e293b;}
      .d-serial{font-size:10px;color:#94a3b8;font-family:monospace;margin-top:2px;}
      .d-serial-full{font-size:13px;font-weight:700;color:#1e293b;font-family:monospace;letter-spacing:.02em;}
      .d-close{background:none;border:none;color:#94a3b8;font-size:16px;cursor:pointer;padding:0;line-height:1;}
      .d-close:hover{color:#1e293b;}
      .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:12px;}
      .metric{background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:7px 9px;}
      .m-lbl{font-size:9px;color:#94a3b8;margin-bottom:2px;}
      .m-val{font-size:13px;font-weight:500;color:#1e293b;font-variant-numeric:tabular-nums;}
      .m-val.o{color:#d97706;}.m-val.g{color:#16a34a;}.m-val.r{color:#dc2626;}
      .h-lbl{font-size:10px;color:#94a3b8;margin-bottom:8px;}
      .bar-chart{display:flex;align-items:flex-end;gap:2px;height:160px;position:relative;}
      .bar-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;position:relative;padding-bottom:14px;}
      .bar-seg{width:100%;border-radius:2px 2px 0 0;min-height:2px;}
      .bar-now .bar-seg{outline:1px solid #f59e0b;}
      .bar-time{position:absolute;bottom:0;font-size:6px;color:#64748b;white-space:nowrap;text-align:center;line-height:12px;}
    </style>
    <ha-card><div class="card">
      <div class="hdr">
        <div class="title">☀ ${this._config.title}</div>
        <div class="actions">
          <button class="btn-refresh" onclick="this.getRootNode().host._loadData()" title="Refresh">↺</button>
          <button class="btn-arrange${this._editMode ? ' done' : ''}" onclick="this.getRootNode().host._toggleEdit()">
            ${this._editMode ? '✓ Done' : '⠿ Arrange'}
          </button>
        </div>
      </div>
      <div class="chips">
        <span class="chip">${active}/${this._panels.length} online</span>
        <span class="chip">${fmtW(total)} now</span>
        ${(() => { const tk = this._getAllTodayKwh(); return tk !== null ? `<span class="chip kwh">↑ ${fmtKwh(tk)} today</span>` : ''; })()}
        ${offline > 0 ? `<span class="chip warn">⚡ ${offline} offline</span>` : ''}
        ${this._loading ? `<span class="chip">⟳</span>` : ''}
      </div>

      ${this._panels.length === 0
        ? `<div class="empty"><p>No inverters found.</p><p>Expected: <code>sensor.inverter_E&lt;14digits&gt;_power</code></p></div>`
        : `<div class="grid" id="panel-grid">${this._editMode ? this._renderSnapGrid() : gridHtml}</div>`}

      ${this._editMode && this._panels.length > 0
        ? `<div class="edit-hint">
            <span>${this._arrangeSrc !== null
              ? '<b>Panel selected</b> — click any slot to place it'
              : '👆 Click panel to select, then click any slot to move it'}</span>
            <button class="btn-reset-arrange" onclick="this.getRootNode().host._resetArrange()">↺ Reset</button>
           </div>` : ''}
    </div></ha-card>`;

    this._bindDrag();

  }

  // ── Detail panel ────────────────────────────────────────────────────────────

  _renderDetail(panel) {
    const kwh   = this._periodKwh(panel);
    const maxW  = this._config.max_watts;
    const buckets = this._chartBuckets(panel);
    const maxKwh = Math.max(...buckets.map(b => b.kwh || 0), 0.001);

    // Y-axis: use Wh when all values < 1kWh, otherwise kWh
    const useWh = maxKwh < 1;
    const fmtAxis = v => {
      if (useWh) return Math.round(v * 1000) + 'Wh';
      return v >= 1 ? v.toFixed(1) + 'kWh' : (v * 1000).toFixed(0) + 'Wh';
    };

    // Legend unit: match Y-axis unit with period context
    const bucketLabel = {
      day: 'per hour', week: 'per day', month: 'per day',
      year: 'per month', lifetime: 'per year', custom: 'per day',
    }[this._histPeriod] || '';
    const axisUnit = (useWh ? 'Wh' : 'kWh') + ' ' + bucketLabel;

    // Use px heights so bars fill the full chart area reliably
    const BAR_H = 146; // 160px chart - 14px label area
    const fmtTipD = v => v<=0?'0':maxKwh<1?Math.round(v*1000)+'Wh':v>=1?v.toFixed(2)+'kWh':(v*1000).toFixed(0)+'Wh';
    const barsHtml = buckets.map(b => {
      const frac = (b.kwh || 0) / maxKwh;
      const barPx = b.future ? 2 : Math.max(Math.round(frac * BAR_H), (b.kwh||0) > 0 ? 4 : 1);
      const col = b.future ? '#e2e8f0'
        : frac <= 0   ? '#e2e8f0'
        : frac < 0.3  ? '#b45309'
        : frac < 0.6  ? '#d97706'
        : frac < 0.85 ? '#f59e0b'
        : '#fb923c';
      const tip = b.future ? '' : fmtTipD(b.kwh||0);
      return `<div class="bar-col${b.isNow ? ' bar-now' : ''}" title="${tip}">
        <div class="bar-seg" style="height:${barPx}px;background:${col};cursor:${b.future?'default':'crosshair'};"></div>
        <span class="bar-time">${b.showLbl ? b.lbl : ''}</span>
      </div>`;
    }).join('');

    const temp  = this._siblingVal(panel, 'temperature');
    const volt  = this._siblingVal(panel, 'voltage');
    const amps  = this._siblingVal(panel, 'amps');
    const freq  = this._siblingVal(panel, 'frequency');
    const mpptV = this._siblingVal(panel, 'mppt_volts');
    const mpptA = this._siblingVal(panel, 'mppt_amps');
    const stSib = this._sibling(panel, 'state');
    const stRaw = stSib ? stSib.state : panel.state;
    const stLower = (stRaw || '').toLowerCase();
    const isOnline = panel.state !== 'unavailable' && panel.state !== 'unknown';
    const stDisplay = isOnline ? 'Online' : 'Offline';
    const stClass = isOnline ? 'g' : 'r';

    const chartTitle = {
      day: `${periodLabel('day', this._offset)} — hourly`,
      week: `${periodLabel('week', this._offset)} — daily`,
      month: `${periodLabel('month', this._offset)} — daily`,
      year: `${periodLabel('year', this._offset)} — monthly`,
      lifetime: 'Lifetime — yearly (15 yrs)',
      custom: `${this._customStart} → ${this._customEnd}`,
    }[this._histPeriod] || '';

    return `<div class="detail">
      <div class="d-hdr">
        <div>
          <div class="d-serial-full">${panel.serial || panel.entity_id}</div>
        </div>
        <button class="d-close" onclick="this.getRootNode().host._closeDetail()">✕</button>
      </div>
      <div class="metrics">
        <div class="metric"><div class="m-lbl">Now</div><div class="m-val o">${fmtW(panel.power)}</div></div>
        <div class="metric"><div class="m-lbl">${this._histPeriod.charAt(0).toUpperCase()+this._histPeriod.slice(1)}</div>
          <div class="m-val g">${fmtKwh(kwh)}</div></div>
        <div class="metric"><div class="m-lbl">Status</div><div class="m-val ${stClass}">${stDisplay}</div></div>
        ${temp  !== null ? `<div class="metric"><div class="m-lbl">Temp</div><div class="m-val">${temp.toFixed(1)}°F</div></div>` : ''}
        ${mpptV !== null ? `<div class="metric"><div class="m-lbl">MPPT V</div><div class="m-val">${mpptV.toFixed(1)} V</div></div>` : ''}
        ${mpptA !== null ? `<div class="metric"><div class="m-lbl">MPPT A</div><div class="m-val">${mpptA.toFixed(2)} A</div></div>` : ''}
        ${volt  !== null ? `<div class="metric"><div class="m-lbl">Voltage</div><div class="m-val">${Math.round(volt)} V</div></div>` : ''}
        ${amps  !== null ? `<div class="metric"><div class="m-lbl">Amps</div><div class="m-val">${amps.toFixed(3)} A</div></div>` : ''}
        ${freq  !== null ? `<div class="metric"><div class="m-lbl">Freq</div><div class="m-val">${freq.toFixed(1)} Hz</div></div>` : ''}
      </div>
      <div class="h-lbl">${chartTitle}</div>
      <div style="display:flex;gap:6px;align-items:stretch;">
        <div style="display:flex;flex-direction:column;justify-content:space-between;padding-bottom:14px;min-width:36px;border-right:1px solid #e2e8f0;padding-right:4px;">
          <span style="font-size:8px;color:#94a3b8;text-align:right;line-height:1;">${fmtAxis(maxKwh)}</span>
          <span style="font-size:8px;color:#94a3b8;text-align:right;line-height:1;">${fmtAxis(maxKwh/2)}</span>
          <span style="font-size:8px;color:#94a3b8;text-align:right;line-height:1;">0</span>
        </div>
        <div style="display:flex;flex-direction:column;flex:1;gap:4px;">
          <div class="bar-chart" style="flex:1;">${barsHtml}</div>
          <div style="font-size:8px;color:#94a3b8;text-align:right;">${axisUnit}</div>
        </div>
      </div>
    </div>`;
  }

  // ── Interactions ────────────────────────────────────────────────────────────

  _onPanelClick(idx) { if (this._editMode) return; this._sel = idx; this._openModal(idx); }
  _closeDetail() { this._sel = null; this._render(); }
  _openModal(idx) {
    const panel = this._panels[idx];
    if (!panel) return;

    // Remove any existing modal
    const existing = document.getElementById('sp-panel-modal');
    if (existing) existing.remove();

    // Create modal overlay in the main document (not shadow DOM)
    // so it covers the full screen including on mobile
    const overlay = document.createElement('div');
    overlay.id = 'sp-panel-modal';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;
      background:rgba(0,0,0,0.5);display:flex;align-items:center;
      justify-content:center;font-family:'Roboto',sans-serif;padding:16px;
    `;

    const sheet = document.createElement('div');
    sheet.style.cssText = `
      background:#fff;border-radius:16px;width:100%;max-width:540px;
      max-height:88vh;overflow-y:auto;
      box-shadow:0 8px 40px rgba(0,0,0,.25);
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // Close on overlay tap
    overlay.addEventListener('click', e => {
      if (e.target === overlay) this._closeDetail();
    });

    // Initial render then fetch stats for current period
    this._renderModalContent(sheet, panel);
    // Fetch stats for the panel (may already be cached from main card day view)
    const ltId = panel.entity_id.replace(/_power$/, '_lifetime_power');
    const ids = [panel.entity_id, ...(this._hass && this._hass.states[ltId] ? [ltId] : [])];
    this._fetchStats(ids).then(() => this._renderModalContent(sheet, panel));
  }

  _renderModalContent(sheet, panel) {
    const periods = ['day','week','month','year','lifetime','custom'];
    const canNext = this._offset < 0;
    const navLabel = this._histPeriod !== 'lifetime' && this._histPeriod !== 'custom'
      ? periodLabel(this._histPeriod, this._offset) : '';
    const kwh = this._periodKwh(panel);
    const maxW = this._config.max_watts;
    const buckets = this._chartBuckets(panel);
    const maxKwh = Math.max(...buckets.map(b => b.kwh || 0), 0.001);
    const useWh = maxKwh < 1;
    const fmtAx = v => useWh ? Math.round(v*1000)+'Wh' : v >= 1 ? v.toFixed(1)+'kWh' : (v*1000).toFixed(0)+'Wh';
    const bucketLabel = {day:'per hour',week:'per day',month:'per day',year:'per month',lifetime:'per year',custom:'per day'}[this._histPeriod]||'';
    const axisUnit = (useWh?'Wh':'kWh')+' '+bucketLabel;
    const BAR_H = 146;
    const barsHtml = buckets.map(b => {
      const frac = (b.kwh||0)/maxKwh;
      const px = b.future ? 2 : Math.max(Math.round(frac*BAR_H),(b.kwh||0)>0?4:1);
      const col = b.future?'#e2e8f0':frac<=0?'#e2e8f0':frac<0.3?'#b45309':frac<0.6?'#d97706':frac<0.85?'#f59e0b':'#fb923c';
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;position:relative;padding-bottom:14px;">
        <div style="width:100%;border-radius:2px 2px 0 0;background:${col};height:${px}px;${b.isNow?'outline:2px solid #f59e0b;':''}"></div>
        <span style="position:absolute;bottom:0;font-size:6px;color:#64748b;">${b.showLbl?b.lbl:''}</span>
      </div>`;
    }).join('');

    const temp  = this._siblingVal(panel,'temperature');
    const volt  = this._siblingVal(panel,'voltage');
    const amps  = this._siblingVal(panel,'amps');
    const freq  = this._siblingVal(panel,'frequency');
    const mpptV = this._siblingVal(panel,'mppt_volts');
    const mpptA = this._siblingVal(panel,'mppt_amps');
    const stSib = this._sibling(panel,'state');
    const stRaw = stSib?stSib.state:panel.state;
    const isOnline = panel.state!=='unavailable'&&panel.state!=='unknown';
    const chartTitle = {day:`${periodLabel('day',this._offset)} — hourly`,week:`${periodLabel('week',this._offset)} — daily`,month:`${periodLabel('month',this._offset)} — daily`,year:`${periodLabel('year',this._offset)} — monthly`,lifetime:'Lifetime — yearly (15 yrs)',custom:`${this._customStart} → ${this._customEnd}`}[this._histPeriod]||'';
    const host = this;

    sheet.innerHTML = `
      <style>
        .sp-modal * { box-sizing: border-box; font-family: 'Roboto', sans-serif; }

        .sp-modal-hdr { display:flex;align-items:center;justify-content:space-between;padding:20px 20px 10px; }
        .sp-serial { font-size:16px;font-weight:700;color:#1e293b;font-family:monospace; }
        .sp-close { width:44px;height:44px;border-radius:50%;border:none;background:#f1f5f9;color:#475569;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
        .sp-close:hover { background:#e2e8f0; }
        .sp-period-bar { display:flex;gap:3px;padding:0 20px 10px; }
        .sp-period-btn { flex:1;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;color:#94a3b8;font-size:10px;font-weight:500;padding:6px 0;cursor:pointer;text-align:center;text-transform:uppercase;letter-spacing:.05em; }
        .sp-period-btn.active { background:#f0fdf4;border-color:#22c55e;color:#15803d; }
        .sp-nav-row { display:flex;align-items:center;margin:0 20px 10px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#fff; }
        .sp-nav-btn { background:#fff;border:none;border-right:1px solid #e2e8f0;color:#475569;font-size:18px;padding:10px 16px;cursor:pointer;line-height:1; }
        .sp-nav-btn:last-child { border-right:none;border-left:1px solid #e2e8f0; }
        .sp-nav-btn:disabled { opacity:.3;cursor:default; }
        .sp-nav-lbl { flex:1;text-align:center;font-size:12px;font-weight:600;color:#1e293b; }
        .sp-metrics { display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 20px 12px; }
        .sp-metric { background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px; }
        .sp-m-lbl { font-size:10px;color:#94a3b8;margin-bottom:3px; }
        .sp-m-val { font-size:16px;font-weight:600;color:#1e293b;font-variant-numeric:tabular-nums; }
        .sp-m-val.o { color:#d97706; } .sp-m-val.g { color:#16a34a; } .sp-m-val.r { color:#dc2626; }
        .sp-chart-wrap { padding:0 20px 20px; }
        .sp-chart-lbl { font-size:11px;color:#94a3b8;margin-bottom:8px; }
        .sp-chart { display:flex;gap:6px;align-items:stretch; }
        .sp-yaxis { display:flex;flex-direction:column;justify-content:space-between;padding-bottom:14px;min-width:38px;border-right:1px solid #e2e8f0;padding-right:5px; }
        .sp-yaxis span { font-size:9px;color:#94a3b8;text-align:right;line-height:1; }
        .sp-bars-wrap { flex:1;display:flex;flex-direction:column;gap:4px; }
        .sp-bars { display:flex;align-items:flex-end;gap:2px;height:160px; }
        .sp-unit { font-size:9px;color:#94a3b8;text-align:right; }
        .sp-custom { display:flex;align-items:center;gap:6px;padding:0 20px 10px;flex-wrap:wrap; }
        .sp-date-input { border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font-size:12px;color:#1e293b;flex:1;min-width:120px; }
        .sp-go { background:#0f172a;border:none;border-radius:6px;color:#fff;font-size:11px;font-weight:600;padding:6px 14px;cursor:pointer; }
      </style>
      <div class="sp-modal">

        <div class="sp-modal-hdr">
          <div class="sp-serial">${panel.serial||panel.entity_id}</div>
          <button class="sp-close" onclick="document.getElementById('sp-panel-modal').remove()">✕</button>
        </div>

        <div class="sp-period-bar">
          ${periods.map(p=>`<button class="sp-period-btn${this._histPeriod===p?' active':''}"
            onclick="window._spSetPeriod('${p}')">${p}</button>`).join('')}
        </div>

        ${this._histPeriod!=='lifetime'&&this._histPeriod!=='custom'?`
        <div class="sp-nav-row">
          <button class="sp-nav-btn" onclick="window._spNavigate(-1)">‹</button>
          <span class="sp-nav-lbl">${navLabel}</span>
          <button class="sp-nav-btn" ${!canNext?'disabled':''} onclick="window._spNavigate(1)">›</button>
        </div>`:''}

        ${this._histPeriod==='custom'?`
        <div class="sp-custom">
          <input type="date" id="sp-cs" class="sp-date-input" value="${this._customStart||''}"/>
          <span style="color:#94a3b8;">→</span>
          <input type="date" id="sp-ce" class="sp-date-input" value="${this._customEnd||''}"/>
          <button class="sp-go" onclick="const s=document.getElementById('sp-cs').value,e=document.getElementById('sp-ce').value;if(s&&e)window._spApplyCustom(s,e);">Go</button>
        </div>`:''}

        <div class="sp-metrics">
          <div class="sp-metric"><div class="sp-m-lbl">Now</div><div class="sp-m-val o">${fmtW(panel.power)}</div></div>
          <div class="sp-metric"><div class="sp-m-lbl">${this._histPeriod.charAt(0).toUpperCase()+this._histPeriod.slice(1)}</div><div class="sp-m-val g">${fmtKwh(kwh)}</div></div>
          <div class="sp-metric"><div class="sp-m-lbl">Status</div><div class="sp-m-val ${isOnline?'g':'r'}">${isOnline?'Online':'Offline'}</div></div>
          ${temp!==null?`<div class="sp-metric"><div class="sp-m-lbl">Temp</div><div class="sp-m-val">${temp.toFixed(1)}°F</div></div>`:''}
          ${mpptV!==null?`<div class="sp-metric"><div class="sp-m-lbl">MPPT V</div><div class="sp-m-val">${mpptV.toFixed(1)} V</div></div>`:''}
          ${mpptA!==null?`<div class="sp-metric"><div class="sp-m-lbl">MPPT A</div><div class="sp-m-val">${mpptA.toFixed(2)} A</div></div>`:''}
          ${volt!==null?`<div class="sp-metric"><div class="sp-m-lbl">Voltage</div><div class="sp-m-val">${Math.round(volt)} V</div></div>`:''}
          ${amps!==null?`<div class="sp-metric"><div class="sp-m-lbl">Amps</div><div class="sp-m-val">${amps.toFixed(3)} A</div></div>`:''}
          ${freq!==null?`<div class="sp-metric"><div class="sp-m-lbl">Freq</div><div class="sp-m-val">${freq.toFixed(1)} Hz</div></div>`:''}
        </div>

        <div class="sp-chart-wrap">
          <div class="sp-chart-lbl">${chartTitle}</div>
          <div class="sp-chart">
            <div class="sp-yaxis">
              <span>${fmtAx(maxKwh)}</span>
              <span>${fmtAx(maxKwh/2)}</span>
              <span>0</span>
            </div>
            <div class="sp-bars-wrap">
              <div class="sp-bars">${barsHtml}</div>
              <div class="sp-unit">${axisUnit}</div>
            </div>
          </div>
        </div>
      </div>`;

    // Bar hover tooltips — floating div that follows mouse position
    const floatTip = document.createElement('div');
    floatTip.style.cssText = 'position:fixed;background:#1e293b;color:#fff;font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;pointer-events:none;display:none;z-index:99999;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3);';
    sheet.appendChild(floatTip);

    sheet.querySelectorAll('.sp-bar-col').forEach(col => {
      const seg = col.querySelector('.sp-bar-seg');
      if (!seg || !seg.dataset.tip || !seg.dataset.tip.trim() || seg.dataset.tip === '0') return;
      const tipText = seg.dataset.tip;

      col.addEventListener('mouseenter', e => {
        floatTip.textContent = tipText;
        floatTip.style.display = 'block';
      });
      col.addEventListener('mousemove', e => {
        floatTip.style.left = (e.clientX - floatTip.offsetWidth/2) + 'px';
        floatTip.style.top  = (e.clientY - 36) + 'px';
      });
      col.addEventListener('mouseleave', () => { floatTip.style.display = 'none'; });
      // Touch
      col.addEventListener('touchstart', () => { floatTip.textContent = tipText; floatTip.style.display = 'block'; }, {passive:true});
      col.addEventListener('touchend', () => setTimeout(() => floatTip.style.display='none', 1500));
    });

    // Expose controls to global scope so onclick strings work
    window._spSetPeriod = p => {
      host._histPeriod = p;
      host._offset = 0;
      host._stats = {};
      host._loading = true;
      host._renderModalContent(sheet, panel);
      host._fetchStats([panel.entity_id, panel.entity_id.replace(/_power$/,'_lifetime_power')].filter(id=>host._hass&&host._hass.states[id]||id===panel.entity_id))
        .then(() => { host._loading = false; host._renderModalContent(sheet, panel); });
    };
    window._spNavigate = d => {
      const next = host._offset + d;
      if (next > 0) return;
      host._offset = next;
      host._stats = {};
      host._loading = true;
      host._renderModalContent(sheet, panel);
      host._fetchStats([panel.entity_id, panel.entity_id.replace(/_power$/,'_lifetime_power')].filter(id=>host._hass&&host._hass.states[id]||id===panel.entity_id))
        .then(() => { host._loading = false; host._renderModalContent(sheet, panel); });
    };
    window._spApplyCustom = (s,e) => {
      host._customStart = s; host._customEnd = e;
      host._histPeriod = 'custom'; host._stats = {};
      host._loading = true;
      host._renderModalContent(sheet, panel);
      host._fetchStats([panel.entity_id, panel.entity_id.replace(/_power$/,'_lifetime_power')].filter(id=>host._hass&&host._hass.states[id]||id===panel.entity_id))
        .then(() => { host._loading = false; host._renderModalContent(sheet, panel); });
    };
  }

  _toggleEdit() {
    // Debounce — prevents multiple fires from shadow DOM click bubbling
    const now = Date.now();
    if (this._lastToggle && now - this._lastToggle < 800) return;
    this._lastToggle = now;

    if (!this._editMode) {
      const cols = this._config.columns;
      // Try to restore grid WITH empty slot positions from localStorage
      try {
        const stored = localStorage.getItem(_LS_KEY);
        if (stored) {
          const storedGrid = JSON.parse(stored);
          const panelMap = Object.fromEntries(this._panels.map(p => [p.entity_id, p]));
          const reconstructed = storedGrid.map(eid => eid ? (panelMap[eid] || null) : null);
          // Append any new panels not in stored grid
          const placedIds = new Set(storedGrid.filter(Boolean));
          const extras = this._panels.filter(p => !placedIds.has(p.entity_id));
          this._arrangeGrid = [...reconstructed, ...extras];
        } else if (this._getSlotGrid()) {
          // Restore arrange grid from slot_grid config field or localStorage
          const grid = this._getSlotGrid();
          const panelMap2 = Object.fromEntries(this._panels.map(p => [p.entity_id, p]));
          this._arrangeGrid = grid.map(eid => eid ? (panelMap2[eid] || null) : null);
          const storedIds2 = new Set(grid.filter(Boolean));
          const extras = this._panels.filter(p => !storedIds2.has(p.entity_id));
          if (extras.length) this._arrangeGrid = [...this._arrangeGrid, ...extras];
        } else {
          // No saved layout — start with panels + one FULL empty row
          const emptyRow = Array(cols).fill(null);
          this._arrangeGrid = [...this._panels, ...emptyRow];
        }
      } catch(e) {
        this._arrangeGrid = [...this._panels];
      }
      // Always ensure at least one full empty row at end (for downward moves)
      const rem = this._arrangeGrid.length % cols;
      if (rem !== 0) for (let i = 0; i < cols - rem; i++) this._arrangeGrid.push(null);
      // Ensure at least one full empty row exists somewhere
      const hasEmpty = this._arrangeGrid.some(x => x === null);
      if (!hasEmpty) for (let i = 0; i < cols; i++) this._arrangeGrid.push(null);
      this._arrangeSrc = null;
      this._editMode = true;
    } else {
      // Leaving arrange mode — extract non-null panels in slot order as new arrangement
      this._editMode = false;
      this._arrangeSrc = null;
      // Capture new order NOW before _syncPanels can overwrite this._panels
      const fullGrid = this._arrangeGrid; // keep nulls for position info
      const arrangedPanels = fullGrid.filter(p => p !== null);
      this._arrangeGrid = null;
      // pendingOrder stores full grid with nulls (entity_id or null per slot)
      this._pendingOrder = arrangedPanels.map(p => p.entity_id);
      this._pendingGrid  = fullGrid.map(p => p ? p.entity_id : null);
      this._panels = arrangedPanels;
      this._saveOrderToStorage(this._pendingGrid);  // store full grid with nulls
      this._saveLayoutWithOrder(arrangedPanels);
    }
    this._render();
  }

  _saveLayoutWithOrder(panelsInOrder) {
    // Save real panels as flat array (HA validates these fine).
    // Save full slot grid (with empty positions) as opaque JSON string in slot_grid.
    // HA passes unknown string config fields through unchanged — no validation.
    const fullGrid = this._pendingGrid || panelsInOrder.map(p => p ? p.entity_id : null);
    const savedPanels = panelsInOrder
      .filter(p => p && p.entity_id)
      .map(p => ({ entity_id: p.entity_id, serial: p.serial, label: p.label || fmtSerial(p.serial) }));

    this._config = {
      ...this._config,
      panels: savedPanels,
      slot_grid: JSON.stringify(fullGrid),  // opaque string, HA won't strip it
    };
    this._configHash = savedPanels.map(p => p.entity_id).join(',');
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true, composed: true,
    }));
  }

  _saveLayout() {
    // Generic save — uses this._panels as-is
    this._saveLayoutWithOrder(this._panels);
  }


  // ── Snap-to-grid arrange ────────────────────────────────────────────────────
  // In edit mode, render a fixed grid with empty slots so panels snap to positions

  // Ensure the grid always has at least one full empty row after the last panel.
  // Trims extra empty rows (keeps exactly one). Called before every arrange render.
  _ensureEmptyRow() {
    const cols = this._config.columns;
    const g = this._arrangeGrid;
    // Find last non-null slot
    let lastPanel = -1;
    for (let i = g.length - 1; i >= 0; i--) { if (g[i] !== null) { lastPanel = i; break; } }
    // Pad to complete the current row of the last panel
    const rem = g.length % cols;
    if (rem !== 0) for (let i = 0; i < cols - rem; i++) g.push(null);
    // Ensure at least one full empty row after the last panel's row
    const lastPanelRow = Math.floor(lastPanel / cols);
    const lastGridRow  = Math.floor((g.length - 1) / cols);
    if (lastGridRow <= lastPanelRow) {
      for (let i = 0; i < cols; i++) g.push(null);
    }
    // Trim: remove extra empty rows beyond 1 full row after last panel
    while (g.length > cols) {
      const lastRowStart = g.length - cols;
      const prevRowStart = lastRowStart - cols;
      if (prevRowStart < 0) break;
      const lastEmpty = g.slice(lastRowStart).every(x => x === null);
      const prevEmpty = g.slice(prevRowStart, lastRowStart).every(x => x === null);
      if (lastEmpty && prevEmpty) g.splice(lastRowStart, cols);
      else break;
    }
  }

  _renderSnapGrid() {
    const maxW = this._config.max_watts;
    const cols = this._config.columns;
    this._ensureEmptyRow();
    const g = this._arrangeGrid;

    // Find last panel row for extension-row styling
    let lastPanel = -1;
    for (let i = g.length - 1; i >= 0; i--) { if (g[i] !== null) { lastPanel = i; break; } }
    const lastPanelRow = Math.floor(lastPanel / cols);

    let html = '';
    for (let slot = 0; slot < g.length; slot++) {
      const panel = g[slot];
      const isExtRow = Math.floor(slot / cols) > lastPanelRow;
      const isSelected = this._arrangeSrc === slot;

      if (panel !== null) {
        const clr = powerToColor(panel.power, maxW);
        const lbl = panel.label || fmtSerial(panel.serial) || `P${slot+1}`;
        html += `<div class="panel-cell arrange-cell${isSelected ? ' arrange-selected' : ''}" data-slot="${slot}"
          style="background:${clr.bg};border-color:${isSelected ? '#f59e0b' : clr.border};cursor:pointer;"
          onclick="this.getRootNode().host._arrangeTap(${slot})">
          <div class="p-serial" style="color:${clr.text};">${fmtSerial(panel.serial) || lbl}</div>
          <div class="p-power" style="color:${clr.text};">${fmtW(panel.power)}</div>
        </div>`;
      } else {
        // ALL empty slots are valid targets — highlight all when panel selected
        const hasSelection = this._arrangeSrc !== null;
        const slotClass = isExtRow ? 'ext-row' : hasSelection ? 'drop-target' : '';
        html += `<div class="empty-slot ${slotClass}" data-slot="${slot}"
          onclick="this.getRootNode().host._arrangeTap(${slot})">
          <span class="slot-label">${isExtRow ? '+' : hasSelection ? '↓ place here' : 'empty'}</span>
        </div>`;
      }
    }
    return html;
  }

  // Called when user clicks a cell in arrange mode
  _arrangeTap(slot) {
    if (this._arrangeSrc === null) {
      // First click — must be a panel
      if (this._arrangeGrid[slot] === null) return;
      this._arrangeSrc = slot;
      this._render();
      return;
    }
    const from = this._arrangeSrc;
    this._arrangeSrc = null;
    if (from === slot) { this._render(); return; }
    // SWAP the two slots — nothing else moves
    const tmp = this._arrangeGrid[from];
    this._arrangeGrid[from] = this._arrangeGrid[slot];
    this._arrangeGrid[slot] = tmp;
    this._render();
  }


  // Apply saved order from localStorage if available
  _getSlotGrid() {
    // Sync read from localStorage (IDB is async, handled separately)
    try {
      const ls = localStorage.getItem(_LS_KEY);
      if (ls) return JSON.parse(ls);
    } catch(e) {}
    return null;
  }

  async _loadSlotGridFromHA() {
    if (!this._hass) return;
    try {
      const resp = await this._hass.connection.sendMessagePromise({
        type: 'frontend/get_user_data',
        key: _HA_STORAGE_KEY,
      });
      if (resp && resp.value && resp.value.slot_grid) {
        const json = resp.value.slot_grid;
        localStorage.setItem(_LS_KEY, json);
        console.info('[SP] Slot grid restored from HA server:', json.slice(0,60));
        this._render();
      }
    } catch(e) { console.warn('[SP] HA storage load failed:', e); }
  }

  _applyStoredOrder(panels) {
    try {
      const grid = this._getSlotGrid();
      if (!grid || !Array.isArray(grid)) return panels;
      const panelMap = Object.fromEntries(panels.map(p => [p.entity_id, p]));
      const ordered = grid.map(eid => eid ? panelMap[eid] : null).filter(Boolean);
      const storedIds = new Set(grid.filter(Boolean));
      const extras = panels.filter(p => !storedIds.has(p.entity_id));
      return [...ordered, ...extras];
    } catch(e) { return panels; }
  }

  _saveOrderToStorage(grid) {
    const json = JSON.stringify(grid);
    // 1. localStorage — fastest, sync access for renders
    try { localStorage.setItem(_LS_KEY, json); } catch(e) {}
    // 2. HA frontend_user_data — stored in HA server, survives ALL browser clears
    if (this._hass) {
      this._hass.connection.sendMessagePromise({
        type: 'frontend/set_user_data',
        key: _HA_STORAGE_KEY,
        value: { slot_grid: json },
      }).then(() => {
        console.info('[SP] Slot grid saved to HA server storage');
      }).catch(e => console.warn('[SP] HA storage save failed:', e));
    }
  }

  _resetArrange() {
    // Clear BOTH localStorage AND config.panels _empty sentinels
    // so reset survives cache clears too
    localStorage.removeItem(_LS_KEY);
    // Clear HA server storage too
    if (this._hass) {
      this._hass.connection.sendMessagePromise({
        type: 'frontend/set_user_data',
        key: _HA_STORAGE_KEY,
        value: null,
      }).catch(() => {});
    }
    this._pendingGrid = null;
    this._pendingOrder = null;

    // Rebuild arrangeGrid in default serial order (no empty slots)
    const inv = this._detectInverters();
    const panelMap = Object.fromEntries(this._panels.map(p => [p.entity_id, p]));
    const resetPanels = inv.length > 0
      ? inv.map(e => panelMap[e.entity_id] || e)
      : [...this._panels];

    const savedPanels = resetPanels
      .filter(p => p && p.entity_id)
      .map(p => ({ entity_id: p.entity_id, serial: p.serial, label: p.label || fmtSerial(p.serial) }));
    const { slot_grid: _removed, ...configWithoutGrid } = this._config;
    this._config = { ...configWithoutGrid, panels: savedPanels };
    this._configHash = savedPanels.map(p => p.entity_id).join(',');
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true, composed: true,
    }));

    // Update arrangeGrid and panels to reflect reset
    this._panels = resetPanels.filter(p => p && p.entity_id);
    this._arrangeGrid = [...this._panels];
    this._arrangeSrc = null;
    this._render();
  }

  _bindDrag() {
    // No-op: arrange mode uses onclick attributes calling _arrangeTap()
  }
}

// ─── Editor ───────────────────────────────────────────────────────────────────

class SunpowerPanelCardEditor extends HTMLElement {
  setConfig(c) { this._config = c; }
  connectedCallback() {
    const c = this._config || {};
    this.innerHTML = `<style>
      .ed{padding:8px 0;display:flex;flex-direction:column;gap:12px;}
      .row{display:flex;flex-direction:column;gap:4px;}
      label{font-size:12px;color:var(--secondary-text-color);}
      input{background:var(--card-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:4px;padding:6px 10px;font-size:14px;width:100%;box-sizing:border-box;}
      .hint{font-size:11px;color:var(--secondary-text-color);margin-top:2px;}
    </style>
    <div class="ed">
      <div class="row"><label>Title</label><input id="title" value="${c.title||'Solar Panels'}"/></div>
      <div class="row"><label>Columns</label><input id="columns" type="number" min="1" max="12" value="${c.columns||4}"/>
        <span class="hint">Panels per row — match your widest roof section</span></div>
      <div class="row"><label>Max watts per panel</label><input id="max_watts" type="number" min="50" max="1000" value="${c.max_watts||400}"/>
        <span class="hint">Rated capacity from your panel spec sheet</span></div>
    </div>`;
    this.querySelectorAll('input').forEach(i => i.addEventListener('change', () => {
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: { ...this._config,
          title: this.querySelector('#title').value,
          columns: parseInt(this.querySelector('#columns').value) || 4,
          max_watts: parseInt(this.querySelector('#max_watts').value) || 400,
        }}, bubbles: true, composed: true,
      }));
    }));
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────

customElements.define('sunpower-panel-card', SunpowerPanelCard);
customElements.define('sunpower-panel-card-editor', SunpowerPanelCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'sunpower-panel-card',
  name: 'SunPower Panel Monitor',
  description: 'Per-panel monitor — statistics API, period nav, lifetime history, drag-to-arrange.',
  preview: false,
});

console.info(
  `%c SunPower Panel Card %c v${CARD_VERSION} — resource URL: /local/sunpower-panel-card.js?v=67 `,
  'background:#f59e0b;color:#000;font-weight:700;padding:2px 4px;',
  'background:#111;color:#f59e0b;padding:2px 4px;'
);

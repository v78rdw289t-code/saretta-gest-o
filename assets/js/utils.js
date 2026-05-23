// ============================================================
// UTILITÁRIOS
// ============================================================

// ─── Formatação ──────────────────────────────────────────────
const Fmt = {
  currency(v) {
    const n = Number(v) || 0;
    return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  },
  date(v) {
    if (!v) return '—';
    const d = new Date(v + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
  },
  dateTime(v) {
    if (!v) return '—';
    return new Date(v).toLocaleString('pt-BR');
  },
  hours(h) {
    const total = Math.round(Number(h || 0) * 60);
    return Math.floor(total / 60) + 'h ' + String(total % 60).padStart(2, '0') + 'min';
  },
  number(v, dec = 2) { return Number(v || 0).toFixed(dec); },
  // Converte tempo do Google Sheets (decimal ou string "HH:MM")
  time(v) {
    if (!v && v !== 0) return '—';
    if (typeof v === 'string' && v.includes(':')) return v.substring(0, 5);
    const totalMin = Math.round(Number(v) * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  },
  // Converte decimal do Sheets para string usável em <input type="time">
  timeInput(v) {
    if (!v && v !== 0) return '';
    if (typeof v === 'string' && v.includes(':')) return v.substring(0, 5);
    const totalMin = Math.round(Number(v) * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  },
};

// ─── Datas ───────────────────────────────────────────────────
const DateUtil = {
  today() { return new Date().toISOString().split('T')[0]; },
  monthStart() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01'; },
  monthKey(date) {
    if (!date) return '';
    return String(date).substring(0, 7);
  },
  diffHours(start, end) {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
  },
  addMonths(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setMonth(d.getMonth() + n);
    return d.toISOString().split('T')[0];
  },
};

// ─── Toast ───────────────────────────────────────────────────
const Toast = {
  _container: null,
  _init() {
    if (!this._container) {
      this._container = document.getElementById('toast-container');
    }
  },
  show(msg, type = 'info', duration = 3500) {
    this._init();
    if (!this._container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
    this._container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 350);
    }, duration);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error', 5000); },
  warning(msg) { this.show(msg, 'warning'); },
  info(msg)    { this.show(msg, 'info'); },
};

// ─── Modal ───────────────────────────────────────────────────
const Modal = {
  open(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
  },
  close(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
  },
  closeAll() {
    document.querySelectorAll('.modal.open, .modal-center.open').forEach(m => m.classList.remove('open'));
    document.body.style.overflow = '';
  },
  confirm(msg, onYes, onNo = null) {
    document.getElementById('confirm-msg').textContent = msg;
    document.getElementById('confirm-yes').onclick = () => { this.close('modal-confirm'); onYes(); };
    document.getElementById('confirm-no').onclick  = () => { this.close('modal-confirm'); if (onNo) onNo(); };
    this.open('modal-confirm');
  },
};

// ─── Loading ─────────────────────────────────────────────────
const Loading = {
  show() { document.getElementById('global-loading')?.classList.add('visible'); },
  hide() { document.getElementById('global-loading')?.classList.remove('visible'); },
};

// ─── Helpers de DOM ──────────────────────────────────────────
function qs(sel, ctx = document) { return ctx.querySelector(sel); }
function qsa(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  });
  children.forEach(c => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}

// ─── Calculadora completa ─────────────────────────────────────
const Calculator = {
  _config: null,

  // Fatores padrão (mesmos da calculadora JSX original)
  FATORES_DEFAULT: [
    { id: 1, label: 'Risco (altura, elétrica, confinado)',          percentual: 30 },
    { id: 2, label: 'Acesso difícil (lama, animais, equip. extra)', percentual: 20 },
    { id: 3, label: 'Urgência (chamado no mesmo dia)',               percentual: 25 },
    { id: 4, label: 'Complexidade (imprevisível, diagnóstico)',      percentual: 20 },
    { id: 5, label: 'Fim de semana ou feriado',                     percentual: 30 },
    { id: 6, label: 'Cliente distante / novo',                      percentual: 20 },
    { id: 7, label: 'Sazonalidade (plantio / colheita)',            percentual: 15 },
  ],

  async getConfig() {
    if (this._config) return this._config;
    if (!LocalConfig.getUrl()) return {};
    const res = await API.db.read('config');
    const cfg = {};
    (res?.data || []).forEach(r => { cfg[r.chave] = r.valor; });
    this._config = cfg;
    return cfg;
  },

  invalidateConfig() { this._config = null; },

  cfgNum(cfg, key, def) { return Number(cfg[key]) || def; },

  getFatores(cfg) {
    try {
      const stored = cfg.fatores_json;
      if (stored) return JSON.parse(stored);
    } catch {}
    return this.FATORES_DEFAULT.map(f => ({ ...f }));
  },

  // Cálculo simples para diárias (horas × valor_hora_base)
  async calcularDia(manhaInicio, manhaFim, tardeInicio, tardeFim, valorManual = null) {
    if (valorManual !== null && valorManual !== '') return Number(valorManual);
    const cfg   = await this.getConfig();
    const base  = this.cfgNum(cfg, 'valor_hora_manutencao', 0) || this.cfgNum(cfg, 'valor_hora', 0);
    let horas   = 0;
    if (manhaInicio && manhaFim) horas += DateUtil.diffHours(manhaInicio, manhaFim);
    if (tardeInicio && tardeFim) horas += DateUtil.diffHours(tardeInicio, tardeFim);
    return Math.round(horas * base * 100) / 100;
  },

  // Cálculo completo (usado no fechamento)
  // params: { tipoServico, horaBase, horas, material, taxaAdminMaterial,
  //           fatoresAtivos, chamadaTecnica, tipoChamada, desconto, simples }
  async calcularServico(params) {
    const cfg = await this.getConfig();
    const totalPerc   = (params.fatoresAtivos || []).reduce((a, f) => a + Number(f.percentual || 0), 0);
    const horaFinal   = Number(params.horaBase) * (1 + totalPerc / 100);
    const subtotalMao = horaFinal * Number(params.horas || 0);
    const material    = Number(params.material || 0);
    const taxaAdmin   = material * (Number(params.taxaAdminMaterial || 0) / 100);
    const subtotalMat = material + taxaAdmin;
    const vChamadaPrx = this.cfgNum(cfg, 'valor_chamada_proximo',  200);
    const vChamadaDst = this.cfgNum(cfg, 'valor_chamada_distante', 250);
    const valorChamada= params.chamadaTecnica ? (params.tipoChamada === 'proximo' ? vChamadaPrx : vChamadaDst) : 0;
    const subtotalBruto       = subtotalMao + subtotalMat + valorChamada;
    const valorDesconto       = subtotalBruto * (Number(params.desconto || 0) / 100);
    const subtotalComDesconto = subtotalBruto - valorDesconto;
    const valorSimples        = subtotalComDesconto * (Number(params.simples || 0) / 100);
    const total               = subtotalComDesconto + valorSimples;
    return { horaFinal, subtotalMao, subtotalMat, taxaAdmin, valorChamada,
             subtotalBruto, valorDesconto, subtotalComDesconto, valorSimples, total, totalPerc };
  },

  calcularTotalDiarias(diarias) {
    return diarias.reduce((s, d) => s + Number(d.valor_manual || d.valor_calculado || 0), 0);
  },
};

// ─── Gerador de número de OS ─────────────────────────────────
async function nextOSNumber() {
  const res = await API.db.read('os');
  const items = res?.data || [];
  if (items.length === 0) return 'OS-001';
  const nums = items.map(o => parseInt((o.numero || '').replace(/\D/g, '')) || 0);
  return 'OS-' + String(Math.max(...nums) + 1).padStart(3, '0');
}

// ─── Status badge ────────────────────────────────────────────
function statusBadge(status) {
  const map = {
    rascunho:  ['badge-secondary', 'Rascunho'],
    andamento: ['badge-info',      'Em Andamento'],
    acerto:    ['badge-warning',   'Em Acerto'],
    fechado:   ['badge-success',   'Fechado'],
    pendente:  ['badge-warning',   'Pendente'],
    pago:      ['badge-success',   'Pago'],
    cancelado: ['badge-danger',    'Cancelado'],
  };
  const [cls, label] = map[status] || ['badge-secondary', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function tipoBadge(tipo) {
  return tipo === 'diaria'
    ? '<span class="badge badge-info">Diária</span>'
    : '<span class="badge badge-secondary">Normal</span>';
}

// ─── ActionSheet ─────────────────────────────────────────────
const ActionSheet = (() => {
  let el = null;

  function _build() {
    el = document.createElement('div');
    el.id = 'action-sheet';
    el.innerHTML = `
      <div id="action-sheet-bg"></div>
      <div id="action-sheet-content">
        <div id="action-sheet-handle"></div>
        <div id="action-sheet-title"></div>
        <div id="action-sheet-items"></div>
        <div id="action-sheet-cancel">Cancelar</div>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('action-sheet-bg').onclick     = close;
    document.getElementById('action-sheet-cancel').onclick = close;
  }

  function open(title, actions) {
    if (!el) _build();
    document.getElementById('action-sheet-title').textContent = title;
    const container = document.getElementById('action-sheet-items');
    container.innerHTML = actions.map((a, i) => `
      <div class="as-item ${a.danger ? 'as-danger' : ''}" onclick="ActionSheet._run(${i})">
        <span class="as-icon">${a.icon || '•'}</span>
        <span>${a.label}</span>
      </div>`).join('');
    el._actions = actions;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function _run(i) {
    const fn = el._actions[i]?.fn;
    close();
    if (fn) setTimeout(fn, 160);
  }

  function close() {
    if (el) el.classList.remove('open');
    document.body.style.overflow = '';
  }

  return { open, close, _run };
})();

// ─── Avatar helpers ───────────────────────────────────────────
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const _AV_COLORS = ['av-navy','av-blue','av-green','av-orange','av-teal','av-purple','av-red','av-gold'];
function avatarColor(name) {
  if (!name) return 'av-navy';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return _AV_COLORS[Math.abs(h) % _AV_COLORS.length];
}

// ─── Debounce ────────────────────────────────────────────────
function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── Filtro de busca em array ────────────────────────────────
function filterRecords(records, query, fields) {
  if (!query) return records;
  const q = query.toLowerCase();
  return records.filter(r => fields.some(f => String(r[f] || '').toLowerCase().includes(q)));
}

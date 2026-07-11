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
    let d;
    if (typeof v === 'string' && v.includes('T')) {
      // ISO datetime from Sheets: "2025-05-23T03:00:00.000Z"
      d = new Date(v);
    } else {
      // Plain "YYYY-MM-DD"
      d = new Date(String(v).substring(0, 10) + 'T00:00:00');
    }
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
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
  // Converte qualquer formato de hora do Sheets para "HH:MM"
  // Suporta: decimal (0.333=08:00), "HH:MM", "H:MM", "HH:MM:SS",
  //          ISO "1899-12-30T08:00:00.000Z" (usa getHours local para timezone)
  _parseTime(v) {
    if (v === null || v === undefined || v === '' || v === false) return null;
    if (typeof v === 'string') {
      // ── Formato seguro "@HH:MM" (salvo assim pelo app para evitar Sheets converter)
      if (v.startsWith('@')) {
        const t = v.substring(1);
        const m = t.match(/^(\d{1,2}):(\d{2})/);
        return m ? m[1].padStart(2,'0') + ':' + m[2] : null;
      }
      // ── ISO datetime do Sheets (dados antigos) — usa hora local do dispositivo
      // Sheets salva "09:12" (Brasil UTC-3) como "2026-05-23T12:12:00.000Z"
      // getHours() no dispositivo UTC-3 devolve 9 ✓
      if (v.includes('T')) {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
          return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
        }
      }
      // ── String "HH:MM", "H:MM", "HH:MM:SS"
      const m = v.match(/^(\d{1,2}):(\d{2})/);
      if (m) return m[1].padStart(2,'0') + ':' + m[2];
    }
    // ── Decimal do Sheets (0.333… = 08:00) — dados muito antigos
    const num = Number(v);
    if (!Number.isFinite(num) || num < 0) return null;
    const totalMin = Math.round(num * 24 * 60);
    return String(Math.floor(totalMin / 60)).padStart(2,'0') + ':' + String(totalMin % 60).padStart(2,'0');
  },
  time(v)      { return this._parseTime(v) ?? '—'; },
  timeInput(v) { return this._parseTime(v) ?? '';  },

  // Normaliza qualquer data (ISO completo, Date, "YYYY-MM-DD", "YYYY-MM-DD HH:MM:SS")
  // para "YYYY-MM-DD" — formato exigido por <input type="date">.
  // Sem isso, datas vindas do Sheets como ISO ("2025-05-24T03:00:00.000Z")
  // não preenchem o input ao editar e o campo fica vazio.
  dateInput(v) {
    if (!v) return '';
    const s = String(v);
    // Já está no formato esperado
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // ISO ou outro formato: usa Date e extrai partes locais (não UTC)
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },
  // Para <input type="month"> — espera "YYYY-MM".
  monthInput(v) {
    const s = this.dateInput(v);
    return s ? s.substring(0, 7) : '';
  },
  // Rótulo relativo a hoje: "hoje"/"amanhã"/"ontem"/dia-da-semana (até 6 dias)/dd/mm/aaaa.
  dataRelativa(v) {
    const s = this.dateInput(v);
    if (!s) return '—';
    const dias = DateUtil.diasAte(s);
    if (dias === 0)  return 'hoje';
    if (dias === 1)  return 'amanhã';
    if (dias === -1) return 'ontem';
    if (dias > 1 && dias <= 6) return DateUtil.weekdayLong(s);
    return this.date(s);
  },
};

// ─── Datas ───────────────────────────────────────────────────
// TUDO em data LOCAL do aparelho. Nunca usar toISOString() pra derivar
// "hoje"/"mês atual": ele devolve UTC e, no Brasil (UTC−3), das ~21h à
// meia-noite o app acharia que já é amanhã (sessão/pagamento/competência
// caindo no dia — ou mês — seguinte).
const DateUtil = {
  // 'YYYY-MM-DD' de um Date, no fuso local.
  ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  today() { return this.ymd(new Date()); },
  // 'YYYY-MM' do mês corrente (local).
  mesAtual() { return this.today().substring(0, 7); },
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
  // Soma meses SEGURANDO o dia no fim do mês: 31/01 + 1 mês = 28/02 (não 03/03).
  // Usar em parcelas mensais — setMonth cru estoura pro mês seguinte em dia 29-31.
  addMonths(dateStr, n) {
    const base = String(dateStr).substring(0, 10);
    const y = Number(base.substring(0, 4)), m = Number(base.substring(5, 7)), dia = Number(base.substring(8, 10));
    const total = (m - 1) + Number(n || 0);
    const ny = y + Math.floor(total / 12);
    const nm = ((total % 12) + 12) % 12; // 0-11
    const ultimo = new Date(ny, nm + 1, 0).getDate();
    return ny + '-' + String(nm + 1).padStart(2, '0') + '-' + String(Math.min(dia, ultimo)).padStart(2, '0');
  },
  // Dias úteis (seg–sex) entre duas datas YYYY-MM-DD, inclusive. Não desconta
  // feriados (simplificação) — serve de "capacidade normal" para diluir custo fixo.
  businessDays(startStr, endStr) {
    const start = new Date(startStr + 'T00:00:00');
    const end   = new Date(endStr + 'T00:00:00');
    if (isNaN(start) || isNaN(end) || end < start) return 0;
    let n = 0;
    const d = new Date(start);
    while (d <= end) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) n++;
      d.setDate(d.getDate() + 1);
    }
    return n;
  },
  // ─── Semana (para a Agenda) ───────────────────────────────
  addDays(dateStr, n) {
    const d = new Date(String(dateStr).substring(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + Number(n || 0));
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  },
  // Segunda-feira da semana de `dateStr`, deslocada `offset` semanas.
  weekStart(dateStr, offset = 0) {
    const base = String(dateStr || this.today()).substring(0, 10);
    const d = new Date(base + 'T00:00:00');
    if (isNaN(d.getTime())) return this.today();
    const wd = (d.getDay() + 6) % 7; // 0 = segunda
    d.setDate(d.getDate() - wd + offset * 7);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  },
  // As 7 datas (seg→dom) da semana de `dateStr`, deslocada `offset` semanas.
  weekDays(dateStr, offset = 0) {
    const seg = this.weekStart(dateStr, offset);
    return Array.from({ length: 7 }, (_, i) => this.addDays(seg, i));
  },
  weekdayShort(dateStr) {
    const d = new Date(String(dateStr).substring(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? '' : ['dom','seg','ter','qua','qui','sex','sáb'][d.getDay()];
  },
  weekdayLong(dateStr) {
    const d = new Date(String(dateStr).substring(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? '' : ['domingo','segunda','terça','quarta','quinta','sexta','sábado'][d.getDay()];
  },
  ehHoje(dateStr) { return String(dateStr).substring(0, 10) === this.today(); },
  // Nº de dias de hoje até `dateStr` (negativo = passado). Usa meia-noite local.
  diasAte(dateStr) {
    const a = new Date(this.today() + 'T00:00:00');
    const b = new Date(String(dateStr).substring(0, 10) + 'T00:00:00');
    if (isNaN(b.getTime())) return null;
    return Math.round((b - a) / 86400000);
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
  show(msg, type = 'info', duration = 3500, onClick = null) {
    this._init();
    if (!this._container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
    const dismiss = () => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 350);
    };
    // Toast clicável (usado no lembrete de contas): executa a ação e fecha ao tocar
    if (onClick) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => { dismiss(); try { onClick(); } catch (e) {} });
    }
    this._container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(dismiss, duration);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error', 5000); },
  warning(msg) { this.show(msg, 'warning'); },
  info(msg)    { this.show(msg, 'info'); },
};

// ─── Modal ───────────────────────────────────────────────────
// _modalZ garante que cada novo open() empilha ACIMA dos já abertos,
// independente da posição no DOM. Reseta quando todos fecham.
let _modalZ = 400;
const Modal = {
  open(id) {
    const el = document.getElementById(id);
    if (!el) return;
    _modalZ += 50;
    el.style.zIndex = String(_modalZ);
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  },
  close(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    el.style.zIndex = '';
    if (!document.querySelector('.modal.open, .modal-center.open')) {
      _modalZ = 400;
      document.body.style.overflow = '';
    }
  },
  closeAll() {
    document.querySelectorAll('.modal.open, .modal-center.open').forEach(m => {
      m.classList.remove('open');
      m.style.zIndex = '';
    });
    _modalZ = 400;
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
  // Mostra o spinner SOMENTE se algum dos sheets não está em cache.
  // Retorna true se o spinner foi de fato exibido — para você saber
  // se precisa chamar hide() depois.
  //   const shown = Loading.maybeShow('os', 'parcelas');
  //   ... await fetch ...
  //   if (shown) Loading.hide();
  maybeShow(...sheets) {
    if (typeof API === 'undefined' || !API.db?.isCached) { this.show(); return true; }
    const allCached = sheets.every(s => API.db.isCached(s));
    if (allCached) return false;
    this.show();
    return true;
  },
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

  // Custo fixo mensal usado no custeio por absorção. Default sugerido enquanto não
  // configurado; respeita o valor salvo (inclusive 0, para desligar o recurso).
  CUSTO_FIXO_DEFAULT: 14500,
  custoFixoMensal(cfg) {
    const raw = cfg?.custo_fixo_mensal;
    if (raw === undefined || raw === null || raw === '') return this.CUSTO_FIXO_DEFAULT;
    return Number(raw) || 0;
  },

  getFatores(cfg) {
    try {
      const stored = cfg.fatores_json;
      if (stored) return JSON.parse(stored);
    } catch {}
    return this.FATORES_DEFAULT.map(f => ({ ...f }));
  },

  // Cálculo simples para diárias (horas × valor_hora_base) — mantido para compat.
  async calcularDia(manhaInicio, manhaFim, tardeInicio, tardeFim, valorManual = null) {
    if (valorManual !== null && valorManual !== '') return Number(valorManual);
    const cfg   = await this.getConfig();
    const base  = this.cfgNum(cfg, 'valor_hora_manutencao', 0) || this.cfgNum(cfg, 'valor_hora', 0);
    let horas   = 0;
    if (manhaInicio && manhaFim) horas += DateUtil.diffHours(manhaInicio, manhaFim);
    if (tardeInicio && tardeFim) horas += DateUtil.diffHours(tardeInicio, tardeFim);
    return Math.round(horas * base * 100) / 100;
  },

  // Cálculo para diárias com BLOCOS de tipo (normal / risco)
  // blocos: [{ tipo:'normal'|'risco', inicio:'HH:MM', fim:'HH:MM' }, ...]
  async calcularDiaComBlocos(blocos, valorManual = null) {
    if (valorManual !== null && valorManual !== '') return Number(valorManual);
    const cfg       = await this.getConfig();
    const rateNorm  = this.cfgNum(cfg, 'valor_hora_manutencao', 0) || this.cfgNum(cfg, 'valor_hora', 0);
    const rateRisco = this.cfgNum(cfg, 'valor_hora_risco', 0) || rateNorm;
    let total = 0;
    for (const b of (blocos || [])) {
      if (!b.inicio || !b.fim) continue;
      const h    = DateUtil.diffHours(b.inicio, b.fim);
      if (h <= 0) continue;
      const rate = b.tipo === 'risco' ? rateRisco : rateNorm;
      total += h * rate;
    }
    return Math.round(total * 100) / 100;
  },

  // Retorna horas por tipo + total — usado no preview e no detalhe da OS
  calcBreakdownBlocos(blocos) {
    let hNormal = 0, hRisco = 0;
    for (const b of (blocos || [])) {
      if (!b.inicio || !b.fim) continue;
      const h = DateUtil.diffHours(b.inicio, b.fim);
      if (h <= 0) continue;
      if (b.tipo === 'risco') hRisco += h;
      else hNormal += h;
    }
    return { hNormal, hRisco, hTotal: hNormal + hRisco };
  },

  // ─── BLOCOS DE HORÁRIO COM REAJUSTE (modelo v2) ──────────────
  // Cada bloco: { inicio:'HH:MM', fim:'HH:MM', reajuste:bool, fatores:[{percentual}] }
  // Bloco avulso (retrocompat reajuste antigo): { avulso:true, horas:Number, reajuste:true, fatores }
  // Retorna breakdown completo — total = soma dos blocos (reajuste DIVIDE o dia, não soma por fora).
  calcBlocos(blocos, baseRate) {
    let hNormal = 0, hReajuste = 0, valorNormal = 0, valorReajuste = 0;
    for (const b of (blocos || [])) {
      const h = b.avulso ? Number(b.horas || 0)
                         : ((b.inicio && b.fim) ? DateUtil.diffHours(b.inicio, b.fim) : 0);
      if (!(h > 0)) continue;
      if (b.reajuste) {
        const perc = (b.fatores || []).reduce((s, f) => s + Number(f.percentual || 0), 0);
        hReajuste     += h;
        valorReajuste += h * baseRate * (1 + perc / 100);
      } else {
        hNormal     += h;
        valorNormal += h * baseRate;
      }
    }
    const round2 = (n) => Math.round(n * 100) / 100;
    return {
      horas: hNormal + hReajuste,
      valor: round2(valorNormal + valorReajuste),
      hNormal, hReajuste,
      valorNormal: round2(valorNormal), valorReajuste: round2(valorReajuste),
    };
  },

  // Converte um registro de diária no array de blocos.
  // Registros novos têm blocos_json; antigos são derivados de manhã/tarde + reajuste_json.
  blocosFromDiaria(d) {
    if (!d) return [];
    if (d.blocos_json) {
      try { const b = JSON.parse(d.blocos_json); if (Array.isArray(b) && b.length) return b; } catch {}
    }
    const blocos = [];
    // Horários antigos eram gravados com prefixo '@' (evitar interpretação do Sheets) — limpar
    const hhmm = (t) => String(t || '').replace('@', '').slice(0, 5);
    if (d.manha_inicio && d.manha_fim) blocos.push({ inicio: hhmm(d.manha_inicio), fim: hhmm(d.manha_fim), reajuste: false, fatores: [] });
    if (d.tarde_inicio && d.tarde_fim) blocos.push({ inicio: hhmm(d.tarde_inicio), fim: hhmm(d.tarde_fim), reajuste: false, fatores: [] });
    if (d.reajuste_json) {
      try {
        const rj = JSON.parse(d.reajuste_json);
        if (Number(rj.horas) > 0) blocos.push({ avulso: true, horas: Number(rj.horas), reajuste: true, fatores: rj.fatores || [] });
      } catch {}
    }
    return blocos;
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
// Origens de parcela que são MOVIMENTO de caixa, não receita/despesa do
// resultado (P&L): transferências entre contas e os movimentos da ficha do
// sócio (empréstimo e acerto). Servem só para acertar saldo de conta.
function origemForaResultado(origem) {
  return origem === 'transferencia' ||
         origem === 'fiado_emprestimo' ||
         origem === 'fiado_acerto';
}

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

// Resolve a categoria_id EFETIVA de uma parcela. Para parcelas de OS
// (origem==='os'), prioriza a categoria das SESSÕES da OS, depois a categoria
// atual da OS, por fim a da própria parcela — assim, corrigir a categoria na OS
// reflete em todo lugar mesmo que a parcela tenha sido gerada (no fechamento)
// sem categoria ou com a antiga.
function categoriaEfetivaId(p, osList, diarias, fechamentoOsByFech) {
  // Parcela de lote (várias OS → 1 parcela): categoria predominante (por valor)
  // entre as OS do lote — usada onde só cabe UMA categoria (ex: lista do Financeiro).
  // O rateio real multi-categoria fica em distribuirCategorias.
  if (p && p.origem === 'os_lote' && p.origem_id && fechamentoOsByFech) {
    const rows = fechamentoOsByFech[p.origem_id] || [];
    const porCat = {};
    rows.forEach(r => {
      const cat = categoriaEfetivaId({ origem: 'os', origem_id: r.os_id }, osList, diarias);
      if (cat) porCat[cat] = (porCat[cat] || 0) + Number(r.valor_liq || 0);
    });
    const best = Object.entries(porCat).sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  }
  if (p && p.origem === 'os' && p.origem_id) {
    const cats = (diarias || []).filter(d => d.os_id === p.origem_id && d.categoria_id).map(d => d.categoria_id);
    if (cats.length) {
      const cont = {};
      cats.forEach(c => { cont[c] = (cont[c] || 0) + 1; });
      return Object.entries(cont).sort((a, b) => b[1] - a[1])[0][0];
    }
    const os = (osList || []).find(o => o.id === p.origem_id);
    if (os && os.categoria_id) return os.categoria_id;
  }
  return (p && p.categoria_id) || '';
}

// Agrupa os itens de compra por compra_id: { compraId: [itens] }. Usado p/ ratear
// a despesa de uma compra entre as categorias dos seus itens nos relatórios.
function agruparComprasItens(itens) {
  const map = {};
  (itens || []).forEach(it => {
    if (!it.compra_id) return;
    (map[it.compra_id] = map[it.compra_id] || []).push(it);
  });
  return map;
}

// Agrupa as linhas de fechamento_os por fechamento_id: { fechId: [{os_id, valor_liq}] }.
// Usado p/ ratear a parcela única de um fechamento em lote entre as categorias das OS.
function agruparFechamentoOs(rows) {
  const map = {};
  (rows || []).forEach(r => {
    if (!r.fechamento_id) return;
    (map[r.fechamento_id] = map[r.fechamento_id] || []).push(r);
  });
  return map;
}

// Distribui o valor de uma parcela entre categorias (retorna [{categoria_id, valor}]
// que soma p.valor). Para parcelas de COMPRA, rateia pela categoria de cada item
// (proporcional ao valor_liq); para parcelas de LOTE de OS (origem='os_lote'),
// rateia pela categoria efetiva de cada OS (proporcional ao líquido de cada uma);
// para o resto, devolve a categoria efetiva única.
// ctx = { osList, diarias, comprasItensByCompra, fechamentoOsByFech }. Compras
// antigas (sem categoria nos itens) caem no caminho único — retrocompatível.
function distribuirCategorias(p, ctx) {
  ctx = ctx || {};
  const valor = Number((p && p.valor) || 0);
  if (p && p.origem === 'os_lote' && p.origem_id && ctx.fechamentoOsByFech) {
    const rows = ctx.fechamentoOsByFech[p.origem_id] || [];
    if (rows.length) {
      const porCat = {};
      let total = 0;
      rows.forEach(r => {
        const v = Number(r.valor_liq || 0);
        const cat = categoriaEfetivaId({ origem: 'os', origem_id: r.os_id }, ctx.osList, ctx.diarias);
        porCat[cat] = (porCat[cat] || 0) + v;
        total += v;
      });
      const cats = Object.keys(porCat);
      // Escala p/ p.valor (proteção a arredondamento: Σ fatias == valor da parcela).
      if (total > 0 && cats.some(c => c)) {
        return cats.map(c => ({ categoria_id: c, valor: valor * (porCat[c] / total) }));
      }
    }
  }
  if (p && p.origem === 'compra' && p.origem_id && ctx.comprasItensByCompra) {
    const itens = ctx.comprasItensByCompra[p.origem_id] || [];
    if (itens.length) {
      const porCat = {};
      let total = 0;
      itens.forEach(it => {
        const v = Number((it.valor_liq !== null && it.valor_liq !== undefined && it.valor_liq !== '')
          ? it.valor_liq : (it.valor_total || 0));
        const cat = it.categoria_id || '';
        porCat[cat] = (porCat[cat] || 0) + v;
        total += v;
      });
      const cats = Object.keys(porCat);
      // Só rateia se há base positiva E ao menos um item com categoria preenchida.
      if (total > 0 && cats.some(c => c)) {
        return cats.map(c => ({ categoria_id: c, valor: valor * (porCat[c] / total) }));
      }
    }
  }
  return [{ categoria_id: categoriaEfetivaId(p, ctx.osList, ctx.diarias, ctx.fechamentoOsByFech), valor }];
}

// ─── Seletor de mês/ano (competência) ────────────────────────
// Dois <select> (mês + ano) no lugar de <input type="month"> — sem digitar,
// sem formato pra errar. value = 'YYYY-MM'. Use MonthPicker.value(id) para ler.
const MonthPicker = {
  MESES: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
          'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
  render(id, value, onchange = '') {
    const now = new Date();
    const def = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [yy, mm] = String(value || def).split('-');
    const yNum = Number(yy) || now.getFullYear();
    const mNum = Number(mm) || (now.getMonth() + 1);
    const anos = [];
    for (let y = now.getFullYear() - 5; y <= now.getFullYear() + 1; y++) anos.push(y);
    if (!anos.includes(yNum)) { anos.push(yNum); anos.sort((a, b) => a - b); }
    const ch = onchange ? ` onchange="${onchange}"` : '';
    return `<div class="month-picker" id="${id}" style="display:flex;gap:8px">
      <select class="input" id="${id}-m" aria-label="Mês" style="flex:1;min-width:0"${ch}>
        ${this.MESES.map((nome, i) => `<option value="${i + 1}" ${i + 1 === mNum ? 'selected' : ''}>${nome}</option>`).join('')}
      </select>
      <select class="input" id="${id}-y" aria-label="Ano" style="flex:0 0 92px"${ch}>
        ${anos.map(y => `<option value="${y}" ${y === yNum ? 'selected' : ''}>${y}</option>`).join('')}
      </select>
    </div>`;
  },
  // 'YYYY-MM' a partir do id base, ou '' se incompleto.
  value(id) {
    const m = document.getElementById(`${id}-m`)?.value;
    const y = document.getElementById(`${id}-y`)?.value;
    if (!m || !y) return '';
    return `${y}-${String(m).padStart(2, '0')}`;
  },
};

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

// ─── UUID v4 (client-side) ───────────────────────────────────
// Também usado como id de idempotência dos POSTs enfileirados na
// caderneta offline (Outbox): o backend novo respeita data.id vindo
// do cliente; o antigo sobrescreve — inofensivo nos dois casos.
function genUUID() {
  return (crypto?.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));
}

// ─── GUARD: trava de duplo clique em ações que gravam ───────
// Envolver o handler com Guard.run('chave', fn): enquanto a 1ª execução não
// termina, cliques repetidos na mesma chave são IGNORADOS (era possível fechar
// uma OS 2x e gerar 2 parcelas clicando rápido). De quebra, desabilita o botão
// clicado e mostra "Aguarde…" enquanto salva (via window.event, disponível nos
// onclick inline; sem botão identificável a trava funciona igual, só sem o visual).
const Guard = (() => {
  const running = new Set();
  async function run(key, fn) {
    if (running.has(key)) return;   // já rodando → clique repetido, ignora
    running.add(key);
    const ev  = (typeof event !== 'undefined') ? event : null;
    const btn = (ev && ev.target && ev.target.closest) ? ev.target.closest('button') : null;
    const label = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Aguarde…'; }
    try {
      return await fn();
    } finally {
      running.delete(key);
      // se a tela re-renderizou, o botão antigo está solto do DOM — inofensivo
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    }
  }
  return { run, isRunning: (key) => running.has(key) };
})();

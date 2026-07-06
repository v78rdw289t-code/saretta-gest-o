// ============================================================
// OUTBOX — "Caderneta offline": fila de escritas para quando a
// obra não tem internet. O POST enfileirável que falha de rede
// (ou dispara já offline) entra aqui e é reenviado sozinho quando
// a conexão volta (evento online / app volta ao 1º plano / boot).
// Badge 📮 no header mostra quantos itens aguardam; o modal lista
// cada um com opção de enviar agora, reenviar ou descartar.
//
// Regras de segurança:
//  - Só entram na fila operações de CRUD genérico SEM check-then-write
//    no servidor (whitelist abaixo). Fechar OS, pagar parcela, compra e
//    acertos de fiado decidem sobre estado do servidor — offline, é
//    melhor pedir pra repetir do que gravar decisão tomada em cache velho.
//  - Todo create enfileirável ganha data.id gerado AQUI (genUUID). O
//    backend novo respeita esse id e, se a linha já existir, devolve
//    jaExiste (no-op) — reenvio nunca duplica. O backend antigo ignora
//    o id (inofensivo).
//  - Timeout ambíguo (AbortError: o POST PODE ter chegado) entra como
//    'incerto' e NÃO é reenviado automaticamente — só manual, pelo modal.
// ============================================================

const Outbox = (() => {
  const KEY = 'saretta_outbox_v1';

  // Whitelist v1: sheets seguras por ação (CRUD puro, sem lógica no servidor)
  const OK_CREATE = ['diarias', 'lista_compras', 'parcelas', 'os_itens', 'fiado_mov', 'compromissos'];
  const OK_UPDATE = ['diarias', 'lista_compras', 'os', 'parcelas', 'compromissos'];

  function _opOk(op) {
    if (op.action === 'create') return OK_CREATE.includes(op.sheet);
    if (op.action === 'update') return OK_UPDATE.includes(op.sheet);
    return false;
  }

  function isQueueable(action, body) {
    if (action === 'create' || action === 'update') return _opOk({ action, sheet: body.sheet });
    if (action === 'batch') {
      const ops = body.operations || [];
      return ops.length > 0 && ops.every(_opOk);
    }
    return false;
  }

  // Garante id de idempotência em todo CREATE antes do 1º envio — assim o
  // reenvio da fila usa o MESMO id e o backend novo não duplica.
  // UPDATE nunca é carimbado: id no patch reescreveria o id do registro.
  function stampIds(action, body) {
    if (action === 'create' && body.data && !body.data.id) body.data.id = genUUID();
    (body.operations || []).forEach(op => {
      if (op.action === 'create' && op.data && !op.data.id) op.data.id = genUUID();
    });
  }

  // ─── Fila (localStorage) ───────────────────────────────────
  function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }
  function _save(fila) {
    try { localStorage.setItem(KEY, JSON.stringify(fila)); } catch {}
    updateBadge();
  }
  function _patch(qid, campos) {
    _save(_load().map(i => i.qid === qid ? { ...i, ...campos } : i));
  }
  function _remove(qid) {
    _save(_load().filter(i => i.qid !== qid));
  }

  function total()     { return _load().length; }
  function pendentes() { return _load().filter(i => i.estado === 'pendente').length; }

  // ─── Entrada na fila ───────────────────────────────────────
  // Devolve um "sucesso" com queued:true — os handlers que salvam seguem o
  // caminho feliz (fecham modal, re-renderizam) sem mudança nenhuma.
  function enqueue(action, body, estado = 'pendente') {
    const fila = _load();
    fila.push({
      qid: genUUID(),
      action, body,
      criado_em: new Date().toISOString(),
      tentativas: 0,
      estado,
      erro: '',
    });
    _save(fila);
    if (estado === 'incerto') {
      Toast.warning('Não deu pra confirmar o envio — confira na caderneta 📮');
    } else {
      Toast.info('📮 Salvo na caderneta — envia sozinho quando voltar a internet');
    }
    const data = (body && body.data) ? { ...body.data } : {};
    const results = (body && body.operations)
      ? body.operations.map(op => ({ success: true, queued: true, data: op.data ? { ...op.data } : {} }))
      : undefined;
    const r = { success: true, queued: true, data };
    if (results) r.results = results;
    return r;
  }

  // ─── Reenvio (flush) ───────────────────────────────────────
  // FIFO estrito, um por vez: um create novo não pode passar na frente de um
  // antigo. Erro de REDE para o flush (tenta de novo no próximo gatilho);
  // erro de APLICAÇÃO marca 'erro' e segue; timeout ambíguo vira 'incerto'.
  let _flushing = false;
  async function flush() {
    if (_flushing) return;
    if (navigator.onLine === false) return;
    if (!_load().some(i => i.estado === 'pendente')) return;
    _flushing = true;
    let enviados = 0;
    try {
      for (;;) {
        const item = _load().find(i => i.estado === 'pendente');
        if (!item) break;
        const r = await API._postDireto(item.action, item.body);
        if (r && r.success) { _remove(item.qid); enviados++; continue; }
        if (r && r.offline) {
          if (r.errName === 'AbortError') {
            _patch(item.qid, { estado: 'incerto', tentativas: (item.tentativas || 0) + 1,
                               erro: 'Envio não confirmado (tempo esgotado)' });
            continue; // o próximo pendente ainda pode passar (o servidor respondeu, só devagar)
          }
          _patch(item.qid, { tentativas: (item.tentativas || 0) + 1 });
          break; // rede caiu de vez: preserva a ordem e espera o próximo gatilho
        }
        _patch(item.qid, { estado: 'erro', erro: (r && r.error) || 'Erro desconhecido' });
        if (typeof Notif !== 'undefined') {
          Notif.add({ tipo: 'warning', titulo: 'Item da caderneta não foi aceito',
                      texto: descreve(item), dedupeKey: 'outbox-erro-' + item.qid });
        }
      }
    } finally {
      _flushing = false;
      updateBadge();
      if (enviados > 0) Toast.success(`📮 ${enviados} item(ns) da caderneta enviado(s)`);
      _rerenderModal();
    }
  }

  // ─── Overlay otimista nas leituras ─────────────────────────
  // Sem isso, a diária salva offline "some" da tela e o dono lança de novo
  // (a duplicação humana é o risco real). Creates pendentes são appendados
  // com _pendente:true; updates aplicam patch por id. Nunca muta o cache.
  function overlay(sheet, json, filters = null) {
    const fila = _load().filter(i => i.estado !== 'erro');
    if (!fila.length || !json || !json.success || !Array.isArray(json.data)) return json;
    let data = json.data;
    let mudou = false;
    // leitura filtrada (ex.: diárias da OS aberta): o create pendente só entra
    // se bate nos MESMOS filtros — senão apareceria em tela de outro registro
    const bateFiltros = (d) => !filters ||
      Object.entries(filters).every(([k, v]) => String(d[k]) === String(v));
    fila.forEach(item => {
      const ops = item.action === 'batch'
        ? (item.body.operations || [])
        : [{ action: item.action, sheet: item.body.sheet, id: item.body.id, data: item.body.data }];
      ops.forEach(op => {
        if (op.sheet !== sheet || !op.data) return;
        if (op.action === 'create') {
          // se o servidor JÁ tem a linha (item 'incerto' que chegou), não duplica
          if (bateFiltros(op.data) && !data.some(r => String(r.id) === String(op.data.id))) {
            data = data.concat([{ ...op.data, _pendente: true }]);
            mudou = true;
          }
        } else if (op.action === 'update') {
          data = data.map(r => String(r.id) === String(op.id) ? { ...r, ...op.data, _pendente: true } : r);
          mudou = true;
        }
      });
    });
    return mudou ? { ...json, data } : json;
  }

  // ─── Badge + modal ─────────────────────────────────────────
  function updateBadge() {
    const btn = document.getElementById('btn-outbox');
    const b   = document.getElementById('outbox-badge');
    if (!btn || !b) return;
    const n = total();
    btn.classList.toggle('hidden', n === 0);
    b.textContent = n > 9 ? '9+' : String(n);
  }

  const NOME_SHEET = {
    diarias: 'Sessão de trabalho', lista_compras: 'Item da lista de compras',
    parcelas: 'Lançamento', os_itens: 'Item de OS', os: 'OS', fiado_mov: 'Movimento da ficha',
  };
  function descreve(item) {
    if (item.action === 'batch') {
      const ops = item.body.operations || [];
      return `${ops.length} registro(s) em lote (${NOME_SHEET[ops[0]?.sheet] || ops[0]?.sheet || '?'}…)`;
    }
    const d = item.body.data || {};
    const nome = NOME_SHEET[item.body.sheet] || item.body.sheet;
    const extra = d.descricao || d.data || '';
    const valor = d.valor ? ` · ${Fmt.currency(Number(d.valor) || 0)}` : '';
    return `${nome}${extra ? ' — ' + extra : ''}${valor}${item.action === 'update' ? ' (edição)' : ''}`;
  }

  function _fmtHora(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${d.toLocaleDateString('pt-BR')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const ESTADO_BADGE = {
    pendente: '<span class="badge badge-warning">aguardando</span>',
    incerto:  '<span class="badge badge-danger">a confirmar</span>',
    erro:     '<span class="badge badge-danger">recusado</span>',
  };

  function _rerenderModal() {
    const wrap = document.getElementById('outbox-list');
    if (!wrap) return;
    const modal = document.getElementById('modal-outbox');
    if (!modal || !modal.classList.contains('open')) return;
    _renderList();
  }

  function _renderList() {
    const wrap = document.getElementById('outbox-list');
    if (!wrap) return;
    const fila = _load();
    if (!fila.length) {
      wrap.innerHTML = `<div class="notif-empty">📮<div>Caderneta vazia — tudo enviado</div></div>`;
      return;
    }
    wrap.innerHTML = fila.map(i => `
      <div class="notif-item ${i.estado === 'pendente' ? 'tone-orange' : 'tone-red'}">
        <span class="notif-ico">📮</span>
        <div class="notif-main">
          <div class="notif-titulo">${descreve(i)}</div>
          ${i.erro ? `<div class="notif-texto">${i.erro}</div>` : ''}
          <div class="notif-data">${_fmtHora(i.criado_em)} · ${ESTADO_BADGE[i.estado] || i.estado}</div>
          ${i.estado !== 'pendente' ? `
            <button class="btn btn-outline btn-sm" style="margin-top:6px"
              onclick="Outbox.reenviar('${i.qid}')">↻ Reenviar</button>` : ''}
        </div>
        <button class="notif-del" title="Descartar" onclick="Outbox.descartar('${i.qid}')">✕</button>
      </div>
    `).join('');
  }

  function open() {
    _renderList();
    Modal.open('modal-outbox');
  }

  // 'incerto'/'erro' voltam pra 'pendente' e o flush tenta na hora.
  // Reenviar um 'incerto' com o backend ANTIGO pode duplicar (o id do cliente
  // é ignorado lá) — por isso o reenvio é decisão manual do dono.
  function reenviar(qid) {
    _patch(qid, { estado: 'pendente', erro: '' });
    _renderList();
    flush();
  }

  function descartar(qid) {
    const item = _load().find(i => i.qid === qid);
    if (!item) return;
    Modal.confirm(`Descartar "${descreve(item)}"? O registro NÃO será salvo.`, () => {
      _remove(qid);
      _renderList();
    });
  }

  // ─── Gatilhos de reenvio ───────────────────────────────────
  window.addEventListener('online', () => setTimeout(flush, 500));
  // Safari/iOS nem sempre dispara 'online' — voltar pro app é o gatilho que vale
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
  document.addEventListener('DOMContentLoaded', () => {
    updateBadge();
    setTimeout(flush, 2000); // depois do boot, sem competir com os reads da 1ª tela
  });

  return { isQueueable, stampIds, enqueue, flush, overlay, pendentes, total,
           updateBadge, open, reenviar, descartar, descreve };
})();

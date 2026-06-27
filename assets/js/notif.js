// ============================================================
// NOTIF — Central de notificações (inbox local, persistido em
// localStorage). Sino no header com badge de não-lidas + modal
// com a lista. As notificações são geradas pelo app (lembretes
// de contas, OS parada, etc.) e ficam guardadas aqui.
// ============================================================

const Notif = (() => {
  const KEY = 'saretta_notificacoes';
  const MAX = 60;

  function _load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
  function _save(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch {} }

  function _hojeLocal() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }

  function all() { return _load(); }
  function unreadCount() { return _load().filter(n => !n.lida).length; }

  // Adiciona uma notificação. dedupeKey evita repetir a mesma no MESMO dia
  // (ex.: o lembrete de contas é diário, não a cada abertura do app).
  // action: { page, params } opcional → vira "toque para ver".
  function add({ tipo = 'info', titulo, texto = '', icon = '', action = null, dedupeKey = null }) {
    if (!titulo) return;
    const list = _load();
    const hoje = _hojeLocal();
    const key  = dedupeKey || (titulo + '|' + texto);
    if (list.some(n => n._key === key && String(n.data).substring(0, 10) === hoje)) return;
    list.unshift({
      id:   'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      tipo, titulo, texto, icon, action, _key: key,
      data: new Date().toISOString(), lida: false,
    });
    _save(list);
    updateBadge();
  }

  function remove(id)  { _save(_load().filter(n => n.id !== id)); updateBadge(); _renderList(); }
  function limpar()    { _save([]); updateBadge(); _renderList(); }
  function marcarTodasLidas() { _save(_load().map(n => ({ ...n, lida: true }))); updateBadge(); }

  function updateBadge() {
    const b = document.getElementById('notif-badge');
    if (!b) return;
    const c = unreadCount();
    b.textContent = c > 9 ? '9+' : String(c);
    b.classList.toggle('hidden', c === 0);
  }

  const ICON = { warning: '⚠️', danger: '🔴', success: '✅', info: '🔔', os: '🛠️', money: '💰' };
  const TONE = { warning: 'orange', danger: 'red', success: 'green', info: 'blue', os: 'navy', money: 'gold' };

  function _fmtData(iso) {
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hm  = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return dia === _hojeLocal() ? `Hoje ${hm}` : `${d.toLocaleDateString('pt-BR')} ${hm}`;
  }

  function _renderList() {
    const wrap = document.getElementById('notif-list');
    if (!wrap) return;
    const list = _load();
    if (!list.length) {
      wrap.innerHTML = `<div class="notif-empty">🔕<div>Nenhuma notificação</div></div>`;
      return;
    }
    wrap.innerHTML = list.map(n => `
      <div class="notif-item ${n.lida ? '' : 'nao-lida'} tone-${TONE[n.tipo] || 'blue'}">
        <span class="notif-ico">${n.icon || ICON[n.tipo] || '🔔'}</span>
        <div class="notif-main" ${n.action ? `onclick="Notif.runAction('${n.id}')" style="cursor:pointer"` : ''}>
          <div class="notif-titulo">${n.titulo}</div>
          ${n.texto ? `<div class="notif-texto">${n.texto}</div>` : ''}
          <div class="notif-data">${_fmtData(n.data)}${n.action ? ' · toque para ver' : ''}</div>
        </div>
        <button class="notif-del" title="Remover" onclick="Notif.remove('${n.id}')">✕</button>
      </div>
    `).join('');
  }

  function runAction(id) {
    const n = _load().find(x => x.id === id);
    if (!n || !n.action) return;
    Modal.close('modal-notificacoes');
    if (n.action.page) App.navigate(n.action.page, n.action.params || {});
  }

  function open() {
    _renderList();
    Modal.open('modal-notificacoes');
    // Ao abrir, marca tudo como lido (zera o badge); a lista já foi renderizada
    // com o destaque das não-lidas.
    setTimeout(marcarTodasLidas, 30);
  }

  function init() { updateBadge(); }

  return { all, unreadCount, add, open, remove, limpar, marcarTodasLidas, runAction, updateBadge, init };
})();

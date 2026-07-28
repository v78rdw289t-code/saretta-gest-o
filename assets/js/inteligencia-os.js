// ─────────────────────────────────────────────────────────────
// INTELIGÊNCIA DA OPERAÇÃO (OS & Orçamento)
// Regras DETERMINÍSTICAS (sem IA). Consome os + os_eventos + limiares (config).
// Pura e testável: IntelOS.computar(osList, eventos, cfg, hoje)
//   → { alertas:[{nivel,icone,os_id,titulo,texto,dias}], gargalo, calibrando }.
// Funciona já com os timestamps que existem; o os_eventos enriquece com o tempo.
// ─────────────────────────────────────────────────────────────
const IntelOS = (() => {
  const DIA_MS = 24 * 60 * 60 * 1000;

  function _diasDesde(dataStr, hoje) {
    if (!dataStr) return null;
    const d = new Date(String(dataStr));
    if (isNaN(d.getTime())) return null;
    return Math.floor((hoje.getTime() - d.getTime()) / DIA_MS);
  }

  // Quando a OS entrou no status ATUAL: último evento de status p/ esse status;
  // senão, cai em data_atualizacao / data_criacao.
  function _desdeStatus(os, eventos) {
    const evs = eventos
      .filter(e => e.tipo === 'status' && String(e.os_id) === String(os.id) && e.para === os.status)
      .sort((a, b) => (String(a.ts) > String(b.ts) ? -1 : 1));
    return (evs[0] && evs[0].ts) || os.data_atualizacao || os.data_criacao || '';
  }

  function _sla(cfg, chave, def) {
    const v = Number(cfg && cfg[chave]);
    return v > 0 ? v : def;
  }

  function computar(osList, eventos, cfg, hoje) {
    hoje = hoje || new Date();
    cfg = cfg || {};
    eventos = eventos || [];
    osList = osList || [];
    const alertas = [];
    const num = o => o.numero || o.id;
    const add = (nivel, icone, o, dias, titulo, texto) =>
      alertas.push({ nivel, icone, os_id: o.id, dias, titulo, texto });

    osList.forEach(o => {
      const reg  = o.registro || 'os';
      const dias = _diasDesde(_desdeStatus(o, eventos), hoje);
      if (dias == null) return;
      if (reg === 'os') {
        if (o.status === 'aguardando_peca' && dias > _sla(cfg, 'sla_aguardando_peca_dias', 3))
          add('atencao', '📦', o, dias, `OS ${num(o)} aguardando peça há ${dias} dias`, 'Cobrar o fornecedor ou liberar outra frente.');
        else if (o.status === 'aguardando_cliente' && dias > _sla(cfg, 'sla_aguardando_cliente_dias', 5))
          add('atencao', '⏳', o, dias, `OS ${num(o)} aguardando o cliente há ${dias} dias`, 'Fazer um follow-up com o cliente.');
        else if (o.status === 'andamento' && dias > _sla(cfg, 'os_parada_dias', 10))
          add('atencao', '🐢', o, dias, `OS ${num(o)} sem movimento há ${dias} dias`, 'Retomar ou revisar o andamento.');
      } else if (reg === 'orcamento') {
        if (o.status === 'enviado' && dias > _sla(cfg, 'sla_orcamento_resposta_dias', 7))
          add('atencao', '📤', o, dias, `Orçamento ${num(o)} sem resposta há ${dias} dias`, 'Follow-up — pode estar esfriando.');
        else if (o.status === 'visita_agendada' && dias > _sla(cfg, 'sla_visita_dias', 3))
          add('atencao', '📅', o, dias, `Visita do orçamento ${num(o)} pendente há ${dias} dias`, 'Confirmar/realizar a visita.');
      }
    });

    alertas.sort((a, b) => b.dias - a.dias); // mais crítico (mais tempo) primeiro

    const gargalo = _gargalo(eventos);
    // Com pouca base, o sistema avisa que ainda está calibrando (não inventa gargalo).
    const nStatus = eventos.filter(e => e.tipo === 'status').length;
    return { alertas, gargalo, calibrando: nStatus < 6 };
  }

  // Gargalo: etapa com maior TEMPO MÉDIO, a partir das transições de status
  // (tempo que a OS ficou em cada etapa entre uma transição e a seguinte).
  function _gargalo(eventos) {
    const porOS = {};
    (eventos || []).filter(e => e.tipo === 'status').forEach(e => {
      (porOS[e.os_id] = porOS[e.os_id] || []).push(e);
    });
    const acc = {}; // etapa → { soma_ms, n }
    Object.keys(porOS).forEach(k => {
      const evs = porOS[k].sort((a, b) => (String(a.ts) > String(b.ts) ? 1 : -1));
      for (let i = 0; i < evs.length - 1; i++) {
        const etapa = evs[i].para; // status em que ficou até a próxima transição
        const dt = new Date(evs[i + 1].ts).getTime() - new Date(evs[i].ts).getTime();
        if (!etapa || !(dt >= 0)) continue;
        acc[etapa] = acc[etapa] || { soma: 0, n: 0 };
        acc[etapa].soma += dt;
        acc[etapa].n++;
      }
    });
    let melhor = null;
    Object.keys(acc).forEach(etapa => {
      const media = acc[etapa].soma / acc[etapa].n;
      if (!melhor || media > melhor.mediaMs) melhor = { etapa, mediaMs: media, n: acc[etapa].n };
    });
    if (!melhor) return null;
    return { etapa: melhor.etapa, mediaHoras: melhor.mediaMs / 3600000, n: melhor.n };
  }

  return { computar, _gargalo };
})();

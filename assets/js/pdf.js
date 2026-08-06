// ============================================================
// DOC / PDF — Geração de documentos (OS e Orçamento)
// Estratégia: monta HTML do documento + CSS @media print.
// O usuário usa "Imprimir → Salvar/Compartilhar PDF" do próprio
// aparelho (funciona offline, texto real, compartilha no WhatsApp).
// ============================================================

const Doc = (() => {

  // Lê dados da empresa da config (com fallbacks). Campos extras
  // (telefone/doc/cidade/pix) aparecem só se preenchidos em Configurações.
  function _empresa(cfg) {
    return {
      nome:     cfg.empresa_nome     || 'Saretta Serviços',
      sub:      cfg.empresa_sub      || 'Gestão de Serviços',
      telefone: cfg.empresa_telefone || '',
      doc:      cfg.empresa_doc      || '',     // CNPJ/CPF
      cidade:   cfg.empresa_cidade   || '',
      slogan:   cfg.empresa_slogan   || 'Tudo funcionando!',
    };
  }

  // Linhas de execução: só data + total de horas do dia (sem horários nem valor por dia)
  function _linhasExecucao(diarias) {
    return diarias
      .sort((a, b) => (a.data > b.data ? 1 : -1))
      .map(d => ({ data: Fmt.date(d.data), horas: Number(d.horas_totais || 0) }));
  }

  // ─── Folhinha de opções (modelo + "Mais opções") ────────────
  // Bottom-sheet reutilizável mostrado ANTES de gerar cada PDF. O usuário
  // escolhe um modelo pronto (que ajusta os toggles) e/ou liga/desliga
  // opções soltas. Lembra a última escolha por tipo de documento.

  // Preferências dos PDFs: chave própria (fora do saretta_config pra não
  // misturar com URL/token). Perder = só volta ao padrão, sem dano.
  const _PREFS_KEY = 'saretta_pdf_prefs';
  function _prefsGet(key) {
    try { return (JSON.parse(localStorage.getItem(_PREFS_KEY) || '{}'))[key] || null; }
    catch { return null; }
  }
  function _prefsSet(key, val) {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(_PREFS_KEY) || '{}'); } catch {}
    all[key] = val;
    try { localStorage.setItem(_PREFS_KEY, JSON.stringify(all)); } catch {}
  }

  // Igualdade rasa de flags booleanas (pra saber qual modelo casa com o estado).
  function _mesmasOpts(a, b, chaves) { return chaves.every(k => !!a[k] === !!b[k]); }

  let _maisAberto = false;   // lembra se o "Mais opções" ficou aberto durante a sessão da folhinha

  function _opcoesEl() {
    let ov = qs('#pdf-opts');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'pdf-opts';
      ov.innerHTML = '<div id="pdf-opts-bg"></div><div id="pdf-opts-card"></div>';
      document.body.appendChild(ov);
    }
    return ov;
  }

  // cfg = { key, icone?, titulo, subtitulo?, modelos:[{id,icon,nome,desc,opts:{}}], extras?:[{id,label,hint?}] }
  // Resolve com o objeto de flags escolhido, ou null se cancelar.
  function _opcoes(cfg) {
    return new Promise((resolve) => {
      const chaves  = (cfg.extras || []).map(e => e.id);
      const modelos = cfg.modelos || [];
      const salvo   = _prefsGet(cfg.key);
      // estado inicial = salvo (só chaves conhecidas) OU opts do 1º modelo
      const base = Object.assign({}, modelos[0] ? modelos[0].opts : {}, salvo || {});
      const estado = {}; chaves.forEach(k => estado[k] = !!base[k]);

      const ov   = _opcoesEl();
      const card = qs('#pdf-opts-card', ov);
      let fechado = false;

      const modeloSel = () => {
        const m = modelos.find(m => _mesmasOpts(estado, m.opts, chaves));
        return m ? m.id : null;
      };

      function render() {
        const selId = modeloSel();
        card.innerHTML = `
          <div class="pdfopt-handle"></div>
          <div class="pdfopt-title">${cfg.icone ? `<span>${cfg.icone}</span> ` : ''}${Fmt.esc(cfg.titulo)}</div>
          ${cfg.subtitulo ? `<div class="pdfopt-sub">${Fmt.esc(cfg.subtitulo)}</div>` : ''}
          ${modelos.map(m => `
            <button class="pdfopt-modelo${m.id === selId ? ' sel' : ''}" data-modelo="${m.id}">
              <span class="mico">${m.icon || ''}</span>
              <span style="flex:1;min-width:0">
                <span class="mnome">${Fmt.esc(m.nome)}</span>
                ${m.desc ? `<span class="mdesc">${Fmt.esc(m.desc)}</span>` : ''}
              </span>
              <span class="mcheck">✓</span>
            </button>`).join('')}
          ${chaves.length ? `
            <div class="pdfopt-mais" id="pdfopt-mais-btn">
              <span>⚙️ Mais opções</span><span>${_maisAberto ? '▴' : '▾'}</span>
            </div>
            <div class="pdfopt-extras${_maisAberto ? ' open' : ''}">
              ${cfg.extras.map(e => `
                <label class="pdfopt-row">
                  <span>${Fmt.esc(e.label)}${e.hint ? ` <span class="rhint">${Fmt.esc(e.hint)}</span>` : ''}</span>
                  <span class="pdfsw">
                    <input type="checkbox" data-extra="${e.id}" ${estado[e.id] ? 'checked' : ''}>
                    <span class="track"></span><span class="knob"></span>
                  </span>
                </label>`).join('')}
            </div>` : ''}
          <button class="pdfopt-gerar" id="pdfopt-gerar">📄 Gerar PDF</button>
        `;
        qsa('.pdfopt-modelo', card).forEach(btn => btn.onclick = () => {
          const m = modelos.find(m => m.id === btn.dataset.modelo);
          if (m) { chaves.forEach(k => estado[k] = !!m.opts[k]); render(); }
        });
        qsa('input[data-extra]', card).forEach(inp => inp.onchange = () => {
          estado[inp.dataset.extra] = inp.checked;
          // atualiza só o destaque do modelo, sem re-render (não perde o scroll)
          const selNow = modeloSel();
          qsa('.pdfopt-modelo', card).forEach(b => b.classList.toggle('sel', b.dataset.modelo === selNow));
        });
        const mais = qs('#pdfopt-mais-btn', card);
        if (mais) mais.onclick = () => { _maisAberto = !_maisAberto; render(); };
        qs('#pdfopt-gerar', card).onclick = () => finalizar(true);
      }

      function finalizar(ok) {
        if (fechado) return;
        fechado = true;
        ov.classList.remove('open');
        document.removeEventListener('keydown', onKey);
        if (ok) { _prefsSet(cfg.key, Object.assign({}, estado)); resolve(Object.assign({}, estado)); }
        else resolve(null);
      }
      function onKey(e) { if (e.key === 'Escape') finalizar(false); }

      qs('#pdf-opts-bg', ov).onclick = () => finalizar(false);
      document.addEventListener('keydown', onKey);
      render();
      ov.classList.add('open');
    });
  }

  // ─── Documento principal (OS ou Orçamento) ───────────────────
  // modo: 'os' (serviço realizado) | 'orcamento' (proposta)
  async function gerar(osId, modo = 'os') {
    const isOrc = modo === 'orcamento';
    // Folhinha de opções: escolhe o que entra no PDF (lembra a última escolha).
    const opts = await _opcoes({
      key: 'gerar_' + modo,
      icone: isOrc ? '💰' : '📋',
      titulo: isOrc ? 'Gerar orçamento' : 'Gerar OS',
      subtitulo: 'Escolha o modelo',
      modelos: [
        { id: 'completo', icon: '🧾', nome: 'Completo',
          desc: 'Itens com valor + total + observações',
          opts: { obs: true, valores: true, detalhes: true, dias: true } },
        { id: 'semvalor', icon: '🙈', nome: 'Sem valor de material',
          desc: 'Lista os itens, sem preço por peça',
          opts: { obs: true, valores: false, detalhes: true, dias: true } },
        { id: 'sototal', icon: '🧮', nome: 'Só o total',
          desc: 'Sem lista de itens, direto ao total',
          opts: { obs: true, valores: false, detalhes: false, dias: false } },
      ],
      extras: [
        { id: 'obs',      label: 'Incluir observações' },
        { id: 'valores',  label: 'Mostrar valores dos itens' },
        { id: 'detalhes', label: 'Mostrar itens e serviços' },
        ...(isOrc ? [] : [{ id: 'dias', label: 'Mostrar dias trabalhados' }]),
      ],
    });
    if (!opts) return;   // cancelou

    Loading.show();
    const [osRes, cliRes, diaRes, itRes] = await Promise.all([
      API.db.read('os'),
      API.db.read('clientes'),
      API.db.read('diarias'),
      API.db.read('os_itens'),
    ]);
    const cfg = await Calculator.getConfig();
    Loading.hide();

    const os = (osRes?.data || []).find(o => o.id === osId);
    if (!os) { Toast.error('Registro não encontrado'); return; }
    const cliente  = (cliRes?.data || []).find(c => c.id === os.cliente_id) || {};
    const diarias  = (diaRes?.data || []).filter(d => d.os_id === osId);
    const itens    = (itRes?.data  || []).filter(i => i.os_id === osId);
    // no_pdf='1' → item não aparece no PDF (mas ainda pode contar no total se for da empresa).
    const visiveis = itens.filter(i => String(i.no_pdf) !== '1');
    const grupos   = visiveis.filter(i => i.tipo === 'grupo');   // blocos "serviço + valor"
    const simples  = visiveis.filter(i => i.tipo !== 'grupo');   // material/serviço avulso
    const emp      = _empresa(cfg);

    // Total dos itens = só o faturável: material pago pelo cliente NÃO entra.
    const totalItens = Calculator.somaItensFatura(itens);   // grupos + avulsos, exclui do-cliente
    const maoObra    = diarias.reduce((s, d) => s + Number(d.valor_manual || d.valor_calculado || 0), 0);
    const totalHoras = diarias.reduce((s, d) => s + Number(d.horas_totais || 0), 0);
    // Orçamento: valor total manual (se informado) OU soma dos itens/grupos — igual à tela.
    // OS: valor calculado ou (mão de obra + itens).
    const total      = isOrc
      ? (Number(os.orcado_valor) > 0 ? Number(os.orcado_valor) : totalItens)
      : (Number(os.valor_calculado || 0) || (maoObra + totalItens));
    const prazoDias  = Number(os.prazo_dias || 0);

    const linhas    = _linhasExecucao(diarias);
    const titulo    = isOrc ? 'ORÇAMENTO' : 'ORDEM DE SERVIÇO';
    const catNome   = os.categoria_id ? App.categoriaNome(os.categoria_id) : '';

    const html = `
      <div class="doc-page">
        ${_docHead(emp, titulo, os.numero)}
        ${_clienteBloco(cliente)}

        <!-- Serviço -->
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Serviço</div>
          <div class="doc-serv-nome">${os.nome || catNome || 'Serviço'}</div>
          ${catNome && os.nome ? `<div class="doc-cli-info">Categoria: ${catNome}</div>` : ''}
        </section>

        <!-- Serviços realizados (só na OS): descrição livre do que foi feito.
             O valor segue por horas/valor fechado — este bloco é só descritivo. -->
        ${!isOrc && opts.detalhes && os.descricao_servico ? `
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Serviços realizados</div>
          <div class="doc-obs-texto">${Fmt.esc(os.descricao_servico)}</div>
        </section>` : ''}

        <!-- Dias trabalhados (só na OS executada; orçamento não tem sessões) -->
        ${opts.dias && linhas.length > 0 ? `
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Dias trabalhados</div>
          <table class="doc-table">
            <thead><tr><th>Data</th><th class="r">Horas</th></tr></thead>
            <tbody>
              ${linhas.map(l => `
                <tr><td>${l.data}</td><td class="r">${Fmt.hours(l.horas)}</td></tr>`).join('')}
              <tr class="doc-tr-total"><td>Total trabalhado</td><td class="r">${Fmt.hours(totalHoras)}</td></tr>
            </tbody>
          </table>
        </section>` : ''}

        <!-- Serviços (grupos): título + valor à direita + tópicos, como na proposta -->
        ${opts.detalhes && grupos.length > 0 ? `
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Serviços</div>
          ${grupos.map((i, idx) => { const g = OS.parseGrupo(i); return `
            <div class="doc-grupo">
              <div class="doc-grupo-head">
                <span class="doc-grupo-titulo">${idx + 1}. ${Fmt.esc(g.titulo)}</span>
                <span class="doc-grupo-leader"></span>
                ${opts.valores ? `<span class="doc-grupo-valor">${Fmt.currency(g.valor)}</span>` : ''}
              </div>
              ${g.servicos.length ? `<ul class="doc-grupo-lista">
                ${g.servicos.map(s => `<li>${Fmt.esc(s.desc)}${opts.valores && s.valor ? ` <span class="doc-grupo-serv-val">${Fmt.currency(s.valor)}</span>` : ''}</li>`).join('')}
              </ul>` : ''}
            </div>`; }).join('')}
        </section>` : ''}

        <!-- Itens / materiais avulsos -->
        ${opts.detalhes && simples.length > 0 ? `
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">${isOrc ? 'Itens e materiais' : 'Materiais e itens'}</div>
          <table class="doc-table">
            <thead><tr><th>Item</th><th class="r">Qtd</th>${opts.valores ? '<th class="r">Valor</th>' : ''}</tr></thead>
            <tbody>
              ${simples.map(i => `
                <tr>
                  <td>${Fmt.esc(i.descricao || i.nome || 'Item')}</td>
                  <td class="r">${i.quantidade || 1}</td>
                  ${opts.valores ? `<td class="r">${Fmt.currency(i.valor_total || 0)}</td>` : ''}
                </tr>`).join('')}
            </tbody>
          </table>
        </section>` : ''}

        <!-- Resumo de valores -->
        <section class="doc-resumo">
          ${opts.valores && maoObra > 0 ? `<div class="doc-row"><span>Mão de obra${!isOrc && totalHoras > 0 ? ` (${Fmt.hours(totalHoras)})` : ''}</span><span>${Fmt.currency(maoObra)}</span></div>` : ''}
          ${opts.valores && maoObra > 0 && totalItens > 0 ? `<div class="doc-row"><span>${isOrc ? 'Itens e serviços' : 'Materiais e itens'}</span><span>${Fmt.currency(totalItens)}</span></div>` : ''}
          <div class="doc-row doc-total"><span>${isOrc ? 'Total estimado' : 'Total'}</span><span>${Fmt.currency(total)}</span></div>
        </section>

        <!-- Observações — bloco dedicado, sai no PDF de orçamento E de OS -->
        ${opts.obs && os.observacoes ? `
        <section class="doc-bloco doc-obs-bloco">
          <div class="doc-bloco-titulo">Observações</div>
          <div class="doc-obs-texto">${Fmt.esc(os.observacoes)}</div>
        </section>` : ''}

        ${isOrc ? `<p class="doc-validade">${prazoDias > 0 ? `Prazo estimado: ${prazoDias} dia(s). ` : ''}Sujeito a confirmação após avaliação no local.</p>` : ''}

        ${_docFoot(emp)}
      </div>
    `;

    _abrir(html, `${titulo.toLowerCase()} ${os.numero || ''}`.trim());
  }

  // ─── Relatório financeiro (receitas / despesas de um período) ────
  // d: { periodoLabel, receitasList[], despesasList[], totalReceitas,
  //      totalDespesas, recebido, pago }
  async function relatorioFinanceiro(d) {
    const opts = await _opcoes({
      key: 'relfin',
      icone: '📊',
      titulo: 'Relatório financeiro',
      subtitulo: d.periodoLabel || 'Escolha o modelo',
      modelos: [
        { id: 'detalhado', icon: '📄', nome: 'Detalhado',
          desc: 'Resumo + lista de lançamentos',
          opts: { receb: true, pag: true, lancamentos: true } },
        { id: 'resumido', icon: '🧮', nome: 'Resumido',
          desc: 'Só o quadro de recebido / pago / saldo',
          opts: { receb: true, pag: true, lancamentos: false } },
      ],
      extras: [
        { id: 'lancamentos', label: 'Mostrar lançamentos detalhados' },
        { id: 'receb',       label: 'Incluir recebimentos' },
        { id: 'pag',         label: 'Incluir pagamentos' },
      ],
    });
    if (!opts) return;

    const cfg  = await Calculator.getConfig();
    const emp  = _empresa(cfg);
    const totReceb = opts.receb ? (d.totalReceitas || 0) : 0;
    const totPag   = opts.pag   ? (d.totalDespesas || 0) : 0;
    const resultado = totReceb - totPag;
    const corResult = resultado >= 0 ? '#1a7f37' : '#c81e1e';

    const catNome = (id) => { const n = App.categoriaNome(id); return (n && n !== '—') ? n : '—'; };
    const linhas = (arr) => arr.map(p => `
      <tr>
        <td>${Fmt.date(p.data_pagamento)}</td>
        <td>${p.descricao || '—'}</td>
        <td>${p.categoriaNome || catNome(p.categoria_id)}</td>
        <td class="r">${Fmt.currency(p.valor || 0)}</td>
      </tr>`).join('');

    const secao = (titulo, arr, total) => `
      <section class="doc-bloco">
        <div class="doc-bloco-titulo">${titulo}</div>
        ${arr.length ? `
        <table class="doc-table">
          <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="r">Valor</th></tr></thead>
          <tbody>
            ${linhas(arr)}
            <tr class="doc-tr-total"><td colspan="3">Total ${titulo.toLowerCase()} (${arr.length})</td><td class="r">${Fmt.currency(total)}</td></tr>
          </tbody>
        </table>` : '<p class="doc-cli-info">Nenhum lançamento no período.</p>'}
      </section>`;

    const html = `
      <div class="doc-page">
        ${_docHead(emp, 'RELATÓRIO FINANCEIRO', d.periodoLabel)}

        <section class="doc-resumo" style="margin-top:0;margin-bottom:14px">
          ${opts.receb ? `<div class="doc-row"><span>Recebimentos</span><span>${Fmt.currency(totReceb)}</span></div>` : ''}
          ${opts.pag ? `<div class="doc-row"><span>Pagamentos</span><span>${Fmt.currency(totPag)}</span></div>` : ''}
          <div class="doc-row doc-total"><span>Saldo do período</span><span style="color:${corResult}">${Fmt.currency(resultado)}</span></div>
        </section>

        ${opts.receb && opts.lancamentos ? secao('Recebimentos', d.receitasList || [], d.totalReceitas || 0) : ''}
        ${opts.pag && opts.lancamentos ? secao('Pagamentos', d.despesasList || [], d.totalDespesas || 0) : ''}

        ${_docFoot(emp)}
      </div>
    `;
    _abrir(html, `relatorio financeiro ${d.periodoLabel || ''}`.trim());
  }

  let _nomeArquivo = 'documento';

  // Nome do arquivo: sem acento/Ç, sem hífen, com espaços, mantendo a caixa.
  // Ex.: "OS-142 Mercado São Jorge" → "OS 142 Mercado Sao Jorge". Puro (testável).
  function slugNome(nome) {
    return (nome || 'documento')
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos e o cedilha (ã→a, ç→c, é→e)
      .replace(/[^a-zA-Z0-9]+/g, ' ')                    // separadores (hífen, espaço…) → um espaço
      .trim().replace(/\s+/g, ' ') || 'documento';
  }

  // Mostra o documento em overlay com ações (Baixar / Enviar / Fechar)
  function _abrir(html, nome) {
    _nomeArquivo = slugNome(nome);
    let ov = qs('#doc-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'doc-overlay';
      document.body.appendChild(ov);
    }
    // Mostra "Enviar" só onde o aparelho suporta compartilhar arquivos (celular)
    const podeCompartilhar = !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }));
    ov.innerHTML = `
      <div class="doc-bar">
        <button class="btn btn-outline btn-sm" onclick="Doc.fechar()">✕</button>
        <span class="doc-bar-title">Documento</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-outline btn-sm" onclick="Doc.baixar()">⬇ Baixar</button>
          ${podeCompartilhar ? `<button class="btn btn-primary btn-sm" onclick="Doc.compartilhar()">📤 Enviar</button>` : ''}
        </div>
      </div>
      <div id="doc-scroll">${html}</div>
    `;
    ov.classList.add('open');
    document.body.classList.add('doc-open');
  }

  // Gera o PDF (Blob) a partir do HTML do documento — funciona em PC e celular.
  async function _gerarBlob() {
    const src = qs('#doc-scroll .doc-page');
    if (!src || typeof html2pdf === 'undefined') throw new Error('PDF indisponível');
    // Renderiza a partir de um CLONE fora do #doc-scroll, com largura fixa.
    // No celular o html2canvas cortava o documento (capturava só a 1ª "tela")
    // porque a .doc-page fica dentro de um container com altura fixa + overflow.
    // Clonar num container solto captura o documento INTEIRO e ainda deixa o
    // PDF com layout consistente, sem depender da largura do aparelho.
    const holder = document.createElement('div');
    // absolute em (0,0) atrás do overlay (z abaixo do #doc-overlay). Offset
    // negativo (left:-10000) QUEBRAVA a captura do html2canvas — por isso fica
    // em 0,0, invisível por trás do documento aberto.
    holder.style.cssText = 'position:absolute;left:0;top:0;width:760px;background:#fff;z-index:1;';
    const clone = src.cloneNode(true);
    clone.style.maxWidth = 'none';
    clone.style.width = '100%';
    holder.appendChild(clone);
    document.body.appendChild(holder);
    // Mede o clone JÁ renderizado e trava a captura EXATAMENTE nesse retângulo.
    // No Safari desktop (janela larga ~1440px) o html2canvas capturava uma região
    // mais larga que o documento (760px) e o conteúdo saía espremido na metade
    // esquerda da folha. Fixar width/height + window*/x/y = 0 remove esse "chute"
    // de largura e vale igual em PC e celular. windowWidth<=760 também mantém as
    // media queries mobile (<=560px) FORA do clone (PDF sempre no layout completo).
    const cw = clone.offsetWidth  || 760;
    const ch = clone.offsetHeight || clone.scrollHeight || 0;
    const opt = {
      margin:      [10, 10, 12, 10],
      filename:    _nomeArquivo + '.pdf',
      image:       { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff',
        width: cw, height: ch, windowWidth: cw, windowHeight: ch, x: 0, y: 0, scrollX: 0, scrollY: 0 },
      jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
      // Pagina entre linhas (sem cortar uma linha no meio) e cria as folhas
      // seguintes sozinho — documentos longos não são mais truncados.
      pagebreak:   { mode: ['css', 'legacy'], avoid: 'tr' },
    };
    try {
      return await html2pdf().set(opt).from(clone).outputPdf('blob');
    } finally {
      holder.remove();
    }
  }

  async function baixar() {
    try {
      Loading.show();
      const blob = await _gerarBlob();
      Loading.hide();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = _nomeArquivo + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { Loading.hide(); Toast.error('Não foi possível gerar o PDF'); }
  }

  async function compartilhar() {
    try {
      Loading.show();
      const blob = await _gerarBlob();
      const file = new File([blob], _nomeArquivo + '.pdf', { type: 'application/pdf' });
      Loading.hide();
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: _nomeArquivo });
      } else {
        baixar(); // fallback
      }
    } catch (e) {
      Loading.hide();
      if (e && e.name === 'AbortError') return; // usuário cancelou
      Toast.error('Não foi possível compartilhar o PDF');
    }
  }

  function fechar() {
    const ov = qs('#doc-overlay');
    if (ov) ov.classList.remove('open');
    document.body.classList.remove('doc-open');
  }

  // ─── Helpers compartilhados dos documentos do cliente ───────
  function _docHead(emp, tipo, num) {
    const hoje = new Date().toLocaleDateString('pt-BR');
    const logo = 'assets/img/logo-app.png?v=3.5.6';
    return `
      <header class="doc-head">
        <img src="${logo}" class="doc-logo" alt="" onerror="this.style.display='none'">
        <div class="doc-emp">
          <div class="doc-emp-nome">${emp.nome}</div>
          <div class="doc-emp-sub">${emp.sub}</div>
          <div class="doc-emp-contato">${[emp.doc, emp.telefone, emp.cidade].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="doc-meta">
          <div class="doc-tipo">${tipo}</div>
          ${num ? `<div class="doc-num">${num}</div>` : ''}
          <div class="doc-data">${hoje}</div>
        </div>
      </header>`;
  }

  function _clienteBloco(cliente) {
    return `
      <section class="doc-bloco">
        <div class="doc-bloco-titulo">Cliente</div>
        <div class="doc-cli-nome">${cliente?.nome || '—'}</div>
        <div class="doc-cli-info">${[cliente?.endereco, cliente?.telefone].filter(Boolean).join(' · ') || ''}</div>
      </section>`;
  }

  function _docFoot(emp) {
    return `
      <footer class="doc-foot">
        <div class="doc-foot-slogan">${emp.slogan}</div>
        <div>${emp.nome}${emp.telefone ? ' · ' + emp.telefone : ''}</div>
      </footer>`;
  }

  // ─── Resumo de várias OS (compacto, 1 linha por OS) ─────────
  // linhas: [{ numero, nome, horas, maoObra, materiais, total, recebida }]
  async function resumoOS(cliente, linhas, opts = {}) {
    const sel = await _opcoes({
      key: 'resumo',
      icone: '🧾',
      titulo: 'Resumo de serviços',
      subtitulo: cliente?.nome || 'Escolha o modelo',
      modelos: [
        { id: 'completo', icon: '📋', nome: 'Completo',
          desc: 'Detalhe + status + já recebido / a receber',
          opts: { detalhe: true, status: true, recebido: true } },
        { id: 'simples', icon: '🧮', nome: 'Simples',
          desc: 'Só o nº da OS e o total',
          opts: { detalhe: false, status: false, recebido: false } },
      ],
      extras: [
        { id: 'detalhe',  label: 'Mostrar detalhe', hint: '(horas · mão de obra · materiais)' },
        { id: 'status',   label: 'Mostrar status', hint: '(Recebida / A receber)' },
        { id: 'recebido', label: 'Mostrar já recebido / a receber' },
      ],
    });
    if (!sel) return;

    const cfg = await Calculator.getConfig();
    const emp = _empresa(cfg);
    const desconto      = Number(opts.desconto || 0);
    const totalGeral    = linhas.reduce((s, l) => s + Number(l.total || 0), 0);
    const totalRecebido = linhas.filter(l => l.recebida).reduce((s, l) => s + Number(l.total || 0), 0);
    const totalFinal    = Math.max(0, totalGeral - desconto);
    const totalAReceber = Math.max(0, totalFinal - totalRecebido);

    const html = `
      <div class="doc-page">
        ${_docHead(emp, 'RESUMO DE SERVIÇOS', '')}
        ${_clienteBloco(cliente)}
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Ordens de serviço</div>
          ${linhas.map(l => `
            <div style="display:flex;justify-content:space-between;gap:10px;padding:9px 2px;border-bottom:1px solid #eef2f9">
              <div style="min-width:0">
                <div style="font-weight:700">${l.numero}${l.nome ? ` · ${l.nome}` : ''}
                  ${sel.status ? `<span style="font-size:.7rem;font-weight:700;color:${l.recebida ? '#1a7f37' : '#b45309'};white-space:nowrap">• ${l.recebida ? 'Recebida' : 'A receber'}</span>` : ''}
                </div>
                ${sel.detalhe ? `<div style="font-size:.76rem;color:#6b7a92;margin-top:2px">${l.horas ? Fmt.hours(l.horas) + ' · ' : ''}Mão de obra ${Fmt.currency(l.maoObra || 0)}${l.materiais > 0 ? ` · Materiais ${Fmt.currency(l.materiais)}` : ''}</div>` : ''}
              </div>
              <div style="font-weight:800;white-space:nowrap">${Fmt.currency(l.total || 0)}</div>
            </div>`).join('')}
        </section>
        <section class="doc-resumo">
          ${desconto > 0 ? `
            <div class="doc-row"><span>Subtotal (${linhas.length} OS)</span><span>${Fmt.currency(totalGeral)}</span></div>
            <div class="doc-row"><span>Desconto</span><span>− ${Fmt.currency(desconto)}</span></div>` : ''}
          <div class="doc-row doc-total"><span>Total${desconto > 0 ? '' : ` (${linhas.length} OS)`}</span><span>${Fmt.currency(totalFinal)}</span></div>
          ${sel.recebido && totalRecebido > 0 ? `<div class="doc-row"><span>Já recebido</span><span style="color:#1a7f37">${Fmt.currency(totalRecebido)}</span></div>` : ''}
          ${sel.recebido ? `<div class="doc-row"><span>A receber</span><span style="color:#b45309;font-weight:700">${Fmt.currency(totalAReceber)}</span></div>` : ''}
        </section>
        ${_docFoot(emp)}
      </div>`;
    _abrir(html, `resumo ${cliente?.nome || ''}`.trim());
  }

  // ─── Recibo de pagamento (total recebido OU pagamento avulso) ─
  // d: { valor, referencia, pagamentos?: [{data, descricao, valor}] }
  async function recibo(cliente, d = {}) {
    const temPagamentos = !!(d.pagamentos && d.pagamentos.length);
    const sel = await _opcoes({
      key: 'recibo',
      icone: '🧾',
      titulo: 'Recibo',
      subtitulo: cliente?.nome || '',
      modelos: [
        { id: 'detalhado', icon: '📄', nome: 'Detalhado',
          desc: 'Com a tabela de pagamentos incluídos',
          opts: { tabela: true } },
        { id: 'simples', icon: '📝', nome: 'Simples',
          desc: 'Só o texto do recibo e o valor total',
          opts: { tabela: false } },
      ],
      extras: temPagamentos ? [{ id: 'tabela', label: 'Incluir tabela de pagamentos' }] : [],
    });
    if (!sel) return;

    const cfg = await Calculator.getConfig();
    const emp = _empresa(cfg);
    const valor = Number(d.valor || 0);
    const hojeStr = new Date().toLocaleDateString('pt-BR');

    const html = `
      <div class="doc-page">
        ${_docHead(emp, 'RECIBO', '')}
        <section class="doc-bloco" style="margin-top:14px">
          <p style="font-size:.95rem;line-height:1.7;margin:0">
            Recebemos de <strong>${cliente?.nome || '—'}</strong> a quantia de
            <strong>${Fmt.currency(valor)}</strong>${d.referencia ? `, referente a <strong>${d.referencia}</strong>` : ''}.
          </p>
        </section>
        ${sel.tabela && temPagamentos ? `
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Pagamentos incluídos</div>
          <table class="doc-table">
            <thead><tr><th>Data</th><th>Descrição</th><th class="r">Valor</th></tr></thead>
            <tbody>
              ${d.pagamentos.map(p => `<tr><td>${p.data ? Fmt.date(p.data) : '—'}</td><td>${p.descricao || '—'}</td><td class="r">${Fmt.currency(p.valor || 0)}</td></tr>`).join('')}
              <tr class="doc-tr-total"><td colspan="2">Total</td><td class="r">${Fmt.currency(valor)}</td></tr>
            </tbody>
          </table>
        </section>` : ''}
        <p class="doc-cli-info" style="margin-top:18px">${emp.cidade ? emp.cidade + ', ' : ''}${hojeStr}.</p>
        <div style="margin-top:44px;text-align:center">
          <div style="border-top:1px solid #333;width:60%;margin:0 auto;padding-top:6px">${emp.nome}${emp.doc ? ' · ' + emp.doc : ''}</div>
        </div>
        ${_docFoot(emp)}
      </div>`;
    _abrir(html, `recibo ${cliente?.nome || ''}`.trim());
  }

  // ─── Extrato de valores em aberto (a receber pendente) ──────
  // d: { itens: [{descricao, vencimento, valor, atrasada}] }
  async function valoresEmAberto(cliente, d = {}) {
    const sel = await _opcoes({
      key: 'aberto',
      icone: '💸',
      titulo: 'Valores em aberto',
      subtitulo: cliente?.nome || 'Escolha o modelo',
      modelos: [
        { id: 'completo', icon: '📅', nome: 'Completo',
          desc: 'Com vencimento e atrasadas destacadas',
          opts: { venc: true, atraso: true } },
        { id: 'simples', icon: '📝', nome: 'Simples',
          desc: 'Só descrição e valor',
          opts: { venc: false, atraso: false } },
      ],
      extras: [
        { id: 'venc',   label: 'Mostrar vencimento' },
        { id: 'atraso', label: 'Destacar cobranças atrasadas' },
      ],
    });
    if (!sel) return;

    const cfg = await Calculator.getConfig();
    const emp = _empresa(cfg);
    const itens = d.itens || [];
    const total = itens.reduce((s, i) => s + Number(i.valor || 0), 0);

    const html = `
      <div class="doc-page">
        ${_docHead(emp, 'VALORES EM ABERTO', '')}
        ${_clienteBloco(cliente)}
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Cobranças a receber</div>
          ${itens.length ? `
          <table class="doc-table">
            <thead><tr><th>Descrição</th>${sel.venc ? '<th>Vencimento</th>' : ''}<th class="r">Valor</th></tr></thead>
            <tbody>
              ${itens.map(i => { const atrasada = sel.atraso && i.atrasada; return `<tr>
                <td>${i.descricao || '—'}${atrasada ? ' <span style="color:#c81e1e;font-weight:700;font-size:.72rem">• atrasada</span>' : ''}</td>
                ${sel.venc ? `<td${atrasada ? ' style="color:#c81e1e;font-weight:700"' : ''}>${i.vencimento ? Fmt.date(i.vencimento) : '—'}</td>` : ''}
                <td class="r">${Fmt.currency(i.valor || 0)}</td>
              </tr>`; }).join('')}
              <tr class="doc-tr-total"><td${sel.venc ? ' colspan="2"' : ''}>Total a receber (${itens.length})</td><td class="r">${Fmt.currency(total)}</td></tr>
            </tbody>
          </table>` : '<p class="doc-cli-info">Nenhum valor em aberto. 🎉</p>'}
        </section>
        ${_docFoot(emp)}
      </div>`;
    _abrir(html, `em aberto ${cliente?.nome || ''}`.trim());
  }

  return { gerar, relatorioFinanceiro, resumoOS, recibo, valoresEmAberto, baixar, compartilhar, fechar, slugNome };
})();

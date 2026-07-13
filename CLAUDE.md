# Saretta Gestão

App **mobile-first** de gestão de serviços (elétrica/manutenção): OS, sessões de trabalho, orçamentos, financeiro, estoque, fiado/ficha dos sócios. PWA offline-first.

## Stack & deploy
- **Vanilla HTML/CSS/JS, sem build/bundler.** Cada `assets/js/*.js` é um IIFE `const X = (() => { … return {…} })()` que expõe um global. Carregados em ordem no `index.html` (api → utils → … → **app.js por último**). Sem `import`.
- **Backend = Google Apps Script** (`apps-script/Code.gs`) lendo/gravando uma planilha Google. Uma sheet por entidade; **`SHEET_HEADERS` no Code.gs é a fonte de verdade das colunas**.
- **PWA**: `sw.js` faz cache do app-shell. **A cada deploy de frontend, suba a versão** em `sw.js` (`CACHE_NAME`) **e** nos `?v=` do `index.html` (ficam em lockstep; hoje `3.8.x`) — senão o usuário pega JS velho.
- **Deploy = push no `main`.** O Action `.github/workflows/deploy-pages.yml` (on: push branches:[main]) publica o GitHub Pages. Ou seja: "manda pro main que sobe automático".
- **Prefira mudanças frontend-only** reusando colunas que já existem. Criar sheet/coluna nova exige **republicar o Apps Script + rodar `initializeSheets`/`initDB`** (o dono faz; precisa do token). Segredos (SPREADSHEET_ID real, API token) **vivem só no Apps Script ao vivo / Script Properties — NUNCA commitar**; o repo mantém `SPREADSHEET_ID=''`.

## Mapa dos arquivos (`assets/js/`)
`api.js` comunicação com o Apps Script + cache/offline · `utils.js` helpers globais (Fmt, DateUtil, Calculator, Modal, ActionSheet, LocalConfig…) · `outbox.js` caderneta offline (fila de escritas) · `notif.js` central de notificações · `home.js` dashboard · `agenda.js` agenda · **`os.js` OS + sessões + fechamento + orçamento + fechamento em lote (o maior, ~2.7k linhas)** · `financeiro.js` contas a receber/pagar · `clientes.js` · `estoque.js` (Itens/Compras/Lista/Mov/Relatório) · `compras.js` · `fiado.js` ficha dos sócios · `insights.js` painel de análise · `config.js` · `pdf.js` gera PDFs (OS/orçamento/recibo) · `app.js` roteador + boot.

## Dados (sheets principais)
`os` (tem `tipo` horas|valor, `registro` os|orcamento, `orcado_valor`, `status`, `data_acerto`) · `os_itens` (material|servico) · `diarias` (**sessões**; fonte de verdade = `blocos_json`; sessão ativa = bloco `aberta:true`, pausada = `{aberta:true,pausada:true}`) · `fechamentos`/`fechamento_dias`/`fechamento_os` (lote) · `parcelas` (financeiro; `origem` os|os_lote|compra|recorrente|…) · `clientes` · `categorias` · `contas` · `estoque`(+`estoque_movimentacoes`) · `compras`(+`compras_itens`) · `fiado_mov` · `recorrentes` · `compromissos`. Colunas exatas: ver `SHEET_HEADERS` no `Code.gs`.

## API / offline
- `API.db.read/create/update/delete/batch` + ações custom (`fecharOS`, `registrarCompra`, `registrarMovEstoque`, `acertarFiado`…). Cache memória+localStorage com **SWR** (serve stale na hora, refetch em background após ~1min).
- **Offline**: `REFERENCE_SHEETS` (clientes/categorias/contas/estoque) e `OFFLINE_WORK_SHEETS` (os/diarias/os_itens) têm TTL de 30 dias e são pré-aquecidas no boot (`app.js loadGlobals`). Escritas `create/update` de sheets na whitelist do `outbox.js` entram na **caderneta** offline e sobem depois. **Ações custom check-then-write (fecharOS, registrarMovEstoque) NÃO são enfileiráveis** → completam só com rede.
- URL do backend + token ficam em `localStorage.saretta_config` (`LocalConfig` no api.js).

## Rodar & verificar
- **Testes**: `node tests/run.js` (sem framework; roda o utils/api/outbox/Code.gs REAIS em `node:vm`). **Prefira testar lógica aqui** — rápido e determinístico. Adicione casos ao fechar uma feature.
- **Preview local com backend mock** (configs no **`~/.claude/launch.json` GLOBAL**, não no `.claude/launch.json` do repo):
  1. `preview_start` **`saretta-mock-backend`** (porta 5502) — roda `tests/mock-server.js` = Code.gs real + Sheet fake em memória, com seeds. `GET /__state` dumpa as sheets; `GET /__down` alterna "rede caída".
  2. `preview_start` **`saretta-gestao-alt`** (porta 5501, estático). Use 5501 (não 5500) pra evitar cache teimoso do SW.
  3. Aponte o app pro mock: `localStorage.saretta_config = {"apps_script_url":"http://localhost:5502"}`, limpe `caches`/unregister do SW, e recarregue. Teste em viewport mobile (375).
  - **Valide escritas pelo `/__state` do mock**, não só pela tela.

## Gotchas
- **SWR mostra STALE logo após uma escrita**, principalmente num reload muito rápido (o persist do localStorage é debounced ~400ms). Não é bug — confere pelo `/__state`; some no próximo refetch/escrita.
- No preview, **clicar por coordenada de screenshot falha** (escala DPI) — use refs de `read_page`.
- Histórico profundo, IDs de deploy/clasp e a saga do token estão na **memória privada** (`project_saretta.md`), não aqui.

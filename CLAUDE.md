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
- **Como o app sabe que está sem rede** (3 sinais, do mais barato ao mais caro): `navigator.onLine === false` (só pega "sem rede nenhuma" — sinal fraco/Wi-Fi sem internet passam por "online"); **memória da última falha** (`JANELA_FORA`, 60s — falhou de rede? escrita enfileirável vai direto pra caderneta sem pagar o timeout de novo; medido: 15,1s → 0s); e a fila não-vazia (`Outbox.pendentes() > 0`). Um fetch que volta (mesmo 500 = servidor respondeu) desarma a memória; erro de aplicação **não** conta como rede fora. O `flush()` em background é a sonda que descobre a volta sem travar ninguém.
- URL do backend + token ficam em `localStorage.saretta_config` (`LocalConfig` no api.js).

## Rodar & verificar
- **Testes**: `node tests/run.js` (sem framework; roda o utils/api/outbox/Code.gs REAIS em `node:vm`). **Prefira testar lógica aqui** — rápido e determinístico. Adicione casos ao fechar uma feature.
- **Preview local com backend mock** (configs no **`~/.claude/launch.json` GLOBAL**, não no `.claude/launch.json` do repo):
  1. `preview_start` **`saretta-mock-backend`** (porta 5502) — roda `tests/mock-server.js` = Code.gs real + Sheet fake em memória, com seeds. `GET /__state` dumpa as sheets; `GET /__down` alterna "rede caída".
  2. `preview_start` **`saretta-gestao-alt`** (porta 5501, estático). Use 5501 (não 5500) pra evitar cache teimoso do SW.
  3. Aponte o app pro mock: `localStorage.saretta_config = {"apps_script_url":"http://localhost:5502"}`, limpe `caches`/unregister do SW, e recarregue. Teste em viewport mobile (375).
  - **Valide escritas fora do browser**: `curl "localhost:5502/exec?action=read&sheet=X"` (roda o Code.gs real, é a fonte de verdade). O `/__state` dumpa **linhas cruas** (arrays, 1ª linha = header) — não são objetos, `d.campo` é undefined.
  - **⚠️ O SW envenena o preview**: o `sw.js` é cache-first pra tudo que não seja `script.google.com` (ver o fetch handler) — e o mock é `localhost`, então **o SW cacheia as respostas da API e serve leitura fantasma pra sempre**. Em produção não acontece (lá a API é script.google.com). Pior: `unregister()` **não solta a página já aberta**, e todo reload re-registra (skipWaiting+claim). Sintoma: o app/`fetch` do browser mostra um estado e o `curl` mostra outro; escritas (POST) passam direto e chegam, só as leituras mentem. Saída: `caches.keys()` → `caches.delete()` **antes de cada leitura**, e confira por `curl`.

## Gotchas
- **SWR mostra STALE logo após uma escrita**, principalmente num reload muito rápido (o persist do localStorage é debounced ~400ms). Só na tela, some no próximo refetch. Mas cuidado: **lógica que DECIDE sobre `allDiarias`/`allOS` (encerrar sessão, fechar OS) tem que operar sobre estado fresco** — decidir sobre stale grava dado errado em silêncio.
- **Epoch do cache (api.js)**: todo POST incrementa `_cacheEpoch`; refetch que parte num epoch e volta em outro **não cacheia**. Existe porque um refetch em voo devolvia o estado PRÉ-escrita com `ts` novo e mascarava a gravação por até 30 dias (TTL das sheets de trabalho) — o app voltava a enxergar o estado velho. Se mexer no cache, preserve isso (tem teste que falha sem).
- No preview, **clicar por coordenada de screenshot falha** (escala DPI) — use refs de `read_page`.
- Histórico profundo, IDs de deploy/clasp e a saga do token estão na **memória privada** (`project_saretta.md`), não aqui.

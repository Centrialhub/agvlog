# Validação de prontidão — AGVLog produção

Data da execução: 28/29 de agosto de 2026 (America/Sao_Paulo)  
Ambiente: `https://agvlogistica.vercel.app`  
Escopo: operador, motorista, autenticação, responsividade, segurança de publicação e cruzamentos operacionais.  
Restrição respeitada: nenhuma emissão, transmissão ou cancelamento fiscal foi executado.

## Conclusão executiva

O código local está tecnicamente saudável, mas o ambiente publicado **não está pronto para uma validação operacional completa nem para ser tratado como release candidate**.

Os dois maiores bloqueios são:

1. o acesso fornecido como “operador” é identificado como perfil privilegiado e fica bloqueado pelo cadastro obrigatório de MFA; sem concluir o segundo fator não é possível abrir nenhum módulo interno;
2. no perfil motorista, duas cargas aparecem como atribuídas e “em trânsito”, mas os dois vínculos de viagem são inacessíveis. O aplicativo lista a carga e o ID da viagem, porém a tela de paradas informa “Nenhuma viagem ativa” e o navegador registra erro recorrente na consulta de `dispatch_trips`.

Há também divergência comprovada entre o repositório e produção: o bundle remoto é diferente do build local, textos e componentes não correspondem, e os cabeçalhos configurados em `vercel.json` não estão presentes na resposta publicada (exceto HSTS).

## Evidências executadas

### Regressão local

- 57 arquivos de teste aprovados.
- 468 testes aprovados.
- Cobertura: 92,61% statements/lines; 81,81% functions; 61,76% branches.
- TypeScript aprovado.
- ESLint sem erros.
- 39/39 arquivos de Edge Functions aceitos pela checagem sintática.
- Contrato do lockfile aprovado.
- Baseline de qualidade aprovado.
- Build de produção aprovado.
- Verificação de bundle aprovada.
- Artefato local sem source maps ou marcadores reconhecidos de segredo.
- Instalação auditou 628 pacotes e reportou 0 vulnerabilidades conhecidas.

Observação: o runtime disponível para a execução foi Node 24, enquanto o projeto declara Node 22. A suíte passou, mas CI e produção devem continuar fixados em Node 22 para eliminar variação ambiental.

### Ambiente publicado — público/autenticação

- `/loads` sem sessão redireciona para `/auth`.
- Não existe botão de cadastro na interface.
- Login inválido é recusado.
- O erro de login é exibido em inglês (`Invalid login credentials`).
- O diálogo do erro gera aviso de acessibilidade por falta de descrição/`aria-describedby` no bundle publicado.
- O endpoint público de configuração do Auth reporta `disable_signup=false` e login por e-mail habilitado, divergindo da promessa “somente por convite”. Não foi enviado um signup de prova, para não criar uma identidade sem garantia de limpeza.
- A conta apresentada como operador chega ao gate de MFA de owner/admin e não acessa rotas internas sem cadastrar/confirmar TOTP.

### Ambiente publicado — motorista

- Login e redirecionamento para `/driver`: aprovado.
- Rotas de operador (`/loads`, `/clients`, `/billing`, `/team`, `/driver-settlements`) redirecionam o motorista para `/driver`: aprovado.
- Todas as rotas principais do motorista renderizam sem tela fatal: início, cargas, paradas, entregas, ocorrências, jornada, despesas, checklist, eventos e chat.
- Layout móvel em 390 × 844: sem overflow horizontal nas telas críticas; navegação inferior visível.
- Duas cargas atribuídas aparecem com veículo, pallets e peso.
- Falha crítica: as duas cargas “em trânsito” possuem botão de acesso à viagem, mas ambos os IDs levam a “Nenhuma viagem ativa”.
- O console registra repetidamente `[useActiveTrip] Trips query error`.
- A home mostra simultaneamente “Nenhuma carga atribuída” e “Existem 2 cargas vinculadas”, evidenciando divergência entre consultas/estados.
- Paradas, entregas e jornada ficam indisponíveis apesar das cargas em trânsito.
- Checklist apresenta caixas editáveis sem viagem, mas não mostra ação de salvar nem explica que os dados não podem ser persistidos.
- Formulários de despesa e ocorrência abrem e validam campos obrigatórios; não foram submetidos porque não há viagem ativa e o operador está bloqueado para conferência/limpeza.
- Chat renderiza; nenhuma mensagem foi enviada para evitar comunicação operacional sem confirmação específica.

### Publicação e segurança

- Frontend responde HTTP 200.
- Bundle remoto: `/assets/index-C49W2c7b.js`.
- Bundle do build local: `/assets/index-OyxDulyS.js`.
- `Last-Modified` remoto observado: `Fri, 28 Aug 2026 22:44:48 GMT`.
- HSTS presente.
- Ausentes na resposta publicada: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` e `Permissions-Policy`.
- O bundle remoto não contém marcador de source map nem segredo reconhecido.
- A URL `.js.map` responde 200 com o fallback HTML da SPA, não com um source map real. O script atual de smoke trata qualquer HTTP 200 como vazamento e, portanto, gera falso positivo.

## Matriz de prontidão

| Área | Estado | Evidência / bloqueio |
|---|---|---|
| Build, tipos e lint | Pronto | Todas as checagens locais aprovadas |
| Testes unitários/contratuais | Pronto com lacunas | 468 aprovados; faltam provas reais do grafo operacional em produção |
| Login e proteção de rotas | Parcial | Redirecionamento e isolamento do motorista funcionam; signup hospedado está configurado como habilitado |
| Aplicativo motorista — navegação | Pronto | Todas as rotas principais renderizam e mobile está estável |
| Aplicativo motorista — operação real | Não pronto | Carga → viagem → parada falha para 2/2 cargas em trânsito |
| Aplicativo operador | Não validado/bloqueado | Conta exige ativação MFA |
| Cruzamento operador ↔ motorista | Não pronto para homologação | Sem viagem ativa não há como validar parada, POD, ocorrência, despesa e checklist ponta a ponta |
| Segurança de publicação | Não pronto | Cabeçalhos locais não chegaram à produção; política invite-only não está alinhada no Auth |
| Fiscal | Fora do ensaio | Nenhuma emissão foi executada, conforme restrição |
| Integrações externas | Não validado | Exige credenciais/ambientes próprios e não deve ser confundido com regressão local |

## Problemas e planos de resolução

### P0 — Carga atribuída não resolve viagem/paradas para o motorista

**Sintoma:** duas cargas em trânsito mostram “Acessar Viagem”, mas os dois IDs retornam “Nenhuma viagem ativa”; `useActiveTrip` falha no console.

**Hipóteses a provar no banco:**

- `loads.driver_id` difere de `dispatch_trips.driver_id`;
- `tenant_id` diverge entre carga, `dispatch_trip_loads`, viagem e paradas;
- vínculo existe em `dispatch_trip_loads`, mas a política RLS permite o embed usado em `DriverLoads` e bloqueia a consulta direta usada em `DriverStops`;
- a viagem está em status incompatível ou sem paradas apesar da carga estar `in_transit`;
- a seleção expandida `DRIVER_TRIP_SELECT` falha em alguma relação mesmo quando a viagem simples é visível.

**Plano:**

1. executar auditoria SQL somente leitura para as duas cargas: carga → vínculo → viagem → motorista → veículo → paradas, comparando `tenant_id`, status e IDs;
2. testar separadamente a leitura simples de `dispatch_trips` e a seleção expandida para identificar qual relação/RLS quebra;
3. impedir transição da carga para `in_transit` sem viagem canônica, motorista compatível e ao menos uma parada válida;
4. fazer o backend retornar erro estruturado (`trip_graph_inconsistent`) em vez de permitir estado parcial;
5. corrigir o gate da tela: só mostrar “Acessar Viagem” quando a mesma consulta que alimenta `/driver/stops` for autorizada e resolvível;
6. adicionar teste E2E real que cria uma carga, despacha, entra como motorista, abre a viagem, marca chegada e confirma o reflexo no operador;
7. critério de aceite: 100% das cargas ativas exibidas ao motorista abrem a mesma viagem e as mesmas paradas vistas pelo operador.

### P0 — Produção não corresponde ao release validado

**Sintoma:** hash do bundle, textos, MFA e comportamento de alertas diferem do código local; cabeçalhos de `vercel.json` não aparecem em produção.

**Plano:**

1. identificar commit SHA e projeto Vercel responsáveis pelo domínio;
2. bloquear deploy se `npm run check` falhar;
3. publicar explicitamente o commit atual usando Node 22;
4. expor SHA/versão em endpoint ou metatag de build para rastreabilidade;
5. rodar smoke remoto imediatamente após deploy e guardar o SHA testado;
6. critério de aceite: bundle/versão publicados correspondem ao commit aprovado e os seis cabeçalhos de segurança são retornados.

### P0/P1 — Invite-only divergente no Auth hospedado

**Sintoma:** interface diz somente convite; configuração pública reporta `disable_signup=false`.

**Plano:**

1. confirmar se o gatilho server-side de autorização de convite está ativo no projeto correto;
2. desabilitar signup público na configuração hospedada;
3. em staging descartável, executar signup sem convite e provar rejeição sem deixar usuário residual;
4. executar convite administrativo válido e provar criação/autorização de uso único;
5. adicionar monitor diário de `disable_signup` e teste de regressão com limpeza garantida;
6. critério de aceite: UI, GoTrue e gatilho do banco rejeitam cadastro público, e convite válido continua funcional.

### P1 — MFA bloqueia a homologação do operador e regenera segredo no reload

**Sintoma:** a conta fornecida cai como owner/admin, não como operador simples; cada carregamento completo inicia um novo enrollment não verificado.

**Plano:**

1. confirmar o papel real da conta e disponibilizar uma conta `operator` não privilegiada para QA;
2. concluir o MFA do owner/admin em sessão controlada pelo usuário;
3. reutilizar ou remover com segurança fatores TOTP não verificados antes de criar outro;
4. impedir que refresh/navegação gere fatores órfãos;
5. criar testes para enrollment, challenge, refresh durante enrollment e recuperação;
6. critério de aceite: operador comum acessa sem gate privilegiado; owner/admin exige MFA e mantém a mesma configuração durante o enrollment.

### P1 — Estado de erro tratado como “vazio” no bundle publicado

**Sintoma:** erro de consulta de viagem aparece no console, enquanto a UI comunica “Nenhuma viagem ativa”.

**Plano:**

1. publicar a versão que separa `isError` de lista vazia;
2. mostrar mensagem acionável com correlação e botão de retry;
3. registrar o erro real sem PII no endpoint de telemetria;
4. critério de aceite: falha de backend nunca aparece como ausência legítima de dados.

### P1 — Cabeçalhos de segurança ausentes

**Plano:**

1. confirmar que o domínio usa o projeto Vercel que contém `vercel.json`;
2. revisar precedência de headers/rewrites e redeploy;
3. validar CSP em modo report-only se algum recurso legítimo for bloqueado;
4. automatizar checagem de CSP, HSTS, nosniff, frame deny, referrer e permissions policy;
5. critério de aceite: todos os headers configurados aparecem em HTML e assets aplicáveis.

### P2 — Login não localizado e alerta inacessível

**Plano:** mapear erros do Supabase para mensagens em português, manter código técnico apenas na telemetria e garantir título + descrição acessível em todos os alertas. Adicionar teste Axe específico para login inválido.

### P2 — Checklist editável sem possibilidade de persistência

**Plano:** quando não houver viagem ativa, desabilitar os checkboxes e mostrar “Checklist disponível após a liberação da viagem”; alternativamente permitir rascunho local explicitamente identificado. Nunca apresentar edição silenciosamente descartável.

### P2 — Smoke de source map com falso positivo

**Plano:** no `smoke-deployment.mjs`, considerar source map exposto apenas quando a resposta 200 tiver conteúdo JSON de source map (`version`, `sources`, `mappings`) e tipo compatível. Resposta HTML de fallback deve ser classificada como “não exposto”.

## Ordem recomendada de execução

### Onda 0 — recuperar um release verificável

- alinhar projeto/domínio Vercel, commit e banco;
- corrigir invite-only e headers;
- publicar o commit atual;
- criar conta QA `operator` e concluir MFA controlado para contas privilegiadas.

### Onda 1 — reparar o grafo operacional

- auditar e corrigir carga → viagem → paradas → motorista → veículo;
- criar invariantes no banco/RPC para impedir novos estados inconsistentes;
- reparar os registros existentes;
- validar as duas cargas atuais no app motorista.

### Onda 2 — homologação cruzada operador/motorista

Em staging isolado, executar uma jornada completa e reversível:

1. operador cria/seleciona carga de QA;
2. atribui motorista e veículo;
3. gera viagem e paradas;
4. motorista vê a mesma carga, inicia viagem e marca chegada;
5. motorista salva checklist, registra despesa e ocorrência de QA;
6. operador vê cada atualização em tempo real;
7. motorista finaliza entrega com POD de teste;
8. operador, rastreabilidade e portal exibem o mesmo status e os mesmos vínculos;
9. limpeza dos dados de QA por RPC auditada.

### Onda 3 — endurecimento e release candidate

- E2E desktop/tablet/mobile para operador e motorista;
- Axe sem violações sérias/críticas;
- testes reais de RLS/IDOR entre dois tenants;
- falhas de rede com retry e sem estados vazios falsos;
- observabilidade por correlação;
- smoke pós-deploy e promoção somente após evidências verdes.

## Critério para declarar “pronto”

O sistema só deve ser considerado pronto quando:

- a versão publicada for identificável e igual à validada;
- operador e motorista completarem a jornada cruzada no mesmo conjunto de dados;
- nenhuma carga ativa puder existir sem grafo operacional coerente;
- signup público estiver rejeitado no servidor;
- headers de segurança estiverem ativos;
- testes E2E passarem em desktop, tablet e mobile;
- não houver erro sério/crítico de acessibilidade;
- nenhuma etapa fiscal tiver sido acionada fora de ambiente homologado.

---

## Reteste pós-deploy — 29/08/2026

### Versão e escopo

- Produção validada: `https://agvlogistica.vercel.app`.
- Commit publicado: `af802aa3577fb0932fdca0281884e3397c91c19e`.
- Deployment Vercel: `dpl_9oZS7Zdi5L4QKfdGvuY3APF9quFw`, estado `READY`.
- Perfis usados: motorista e owner/admin fornecidos para QA.
- Nenhuma emissão fiscal, início de viagem, chegada, checklist, mensagem, despesa, ocorrência ou outra mutação operacional foi executada.

### Resultado executivo atualizado

| Área | Estado após o reteste | Evidência |
|---|---|---|
| Deploy e artefato | Pronto | Versão nova publicada; HTML usa `index-OyxDulyS.js`; build local e verificações de artefato aprovados |
| Cabeçalhos de segurança | Pronto | CSP, HSTS, `nosniff`, `DENY`, Referrer-Policy e Permissions-Policy presentes em produção |
| Suíte automática | Pronto | 57 arquivos e 468 testes aprovados; 92,61% de linhas; tipos, lint, 39 Edge Functions e build aprovados |
| Motorista — autenticação e navegação | Pronto para leitura | Login, início, cargas, paradas, entregas, eventos, ocorrências, jornada, despesas, checklist e chat carregaram sem erros de console ou rede |
| Motorista — responsividade | Pronto com melhoria de acessibilidade | 390×844 sem overflow horizontal em início, paradas e entregas |
| Motorista — autorização | Pronto | Tentativas de abrir `/loads`, `/clients`, `/billing` e `/team` redirecionaram para `/driver` |
| Grafo operacional da carga 1012 | Pronto para leitura | Início, viagem, veículo, 1 parada, 0/1 entrega, pedido e 103 notas convergem para a mesma viagem |
| Grafo operacional da carga 1003 | Precisa correção/explicitação | Aparece “em trânsito” e com “Iniciar Viagem” em Cargas, mas não integra a única viagem ativa nem Paradas/Entregas |
| Operador — segurança MFA | Pronto | URLs diretas de cargas, faturamento e equipe não contornam o segundo fator |
| Operador — funções internas | Bloqueado para homologação | Falta o código TOTP atual; não houve bypass, enrollment ou alteração do fator |
| Cruzamento operador ↔ motorista | Parcial | Cruzamento interno do motorista para a carga 1012 passou; o reflexo nas telas do operador não pôde ser observado por causa do MFA |
| Cadastro somente por convite | Não pronto | Configuração pública do Auth continua retornando `disable_signup=false`, divergindo do texto da interface |
| Acessibilidade | Não pronto | Axe encontrou 2 regras violadas: contraste sério (8 nós na tela do motorista) e zoom móvel desabilitado |
| Observabilidade Vercel | Pronto para este ensaio | Nenhum cluster de erro de runtime nas 2 horas que abrangeram os testes |
| Fiscal | Fora do ensaio | Nenhuma emissão ou tentativa de emissão foi realizada |

### Correções comprovadas em relação ao ensaio anterior

1. A carga 1012 agora resolve uma viagem ativa e suas paradas; a falha de `useActiveTrip` não reapareceu.
2. Paradas e Entregas deixaram de mostrar estado vazio incorreto: ambas apresentam a mesma parada pendente e a entrega 0/1.
3. Todas as consultas Supabase observadas nesses fluxos responderam 200, inclusive `dispatch_trips`, `dispatch_stops`, documentos, eventos, mensagens e motorista atual.
4. O deployment validado corresponde ao commit aprovado e os cabeçalhos definidos no projeto chegaram ao domínio de produção.
5. O MFA privilegiado permanece obrigatório mesmo quando o usuário tenta navegar diretamente para uma rota interna.

### Problemas remanescentes e planos de resolução

#### P1 — Carga 1003 em trânsito fora do grafo da viagem ativa

**Sintoma:** o motorista vê duas cargas em trânsito, 1012 e 1003, ambas com ação “Iniciar Viagem”; porém o início informa apenas uma viagem ativa e Paradas/Entregas resolvem somente a carga 1012.

**Plano:**

1. auditar, somente leitura, `loads` → `dispatch_trip_loads` → `dispatch_trips` → `dispatch_stops` para a carga 1003;
2. determinar se 1003 é uma carga órfã, uma carga adicional da mesma viagem ou um registro cujo status ficou adiantado;
3. impedir `in_transit` sem vínculo canônico com viagem ativa, motorista e tenant compatíveis;
4. na lista do motorista, trocar “Iniciar Viagem” por um estado explicativo quando a carga não for iniciável;
5. critério de aceite: toda carga em trânsito mostrada ao motorista aparece na viagem/paradas correspondentes, ou exibe explicitamente por que está fora da viagem ativa.

#### P1 — Homologação do operador depende do TOTP atual

**Diagnóstico:** não é falha de segurança; o bloqueio está funcionando. É uma limitação de cobertura do ensaio.

**Plano:**

1. disponibilizar o código TOTP atual em uma sessão acompanhada pelo usuário, ou criar uma conta QA com papel `operator` não privilegiado;
2. repetir a matriz de dashboard, cargas, clientes, rotas, monitoramento, ocorrências, despesas, equipe e faturamento;
3. cruzar a carga 1012 e a carga 1003 com os dados vistos no motorista;
4. critério de aceite: operador e motorista apresentam os mesmos IDs, status, paradas, documentos e eventos para a mesma viagem.

#### P1 — Política “somente convite” divergente no Supabase Auth

**Evidência:** a interface afirma que o acesso é criado por convite, mas `/auth/v1/settings` retorna `disable_signup=false`.

**Plano:** desabilitar signup público no projeto hospedado, manter o fluxo administrativo de convite e validar em staging descartável que signup sem convite é rejeitado e convite válido continua funcionando.

#### P1 — Acessibilidade WCAG AA

**Evidência Axe 4.12.1:**

- contraste abaixo de 4,5:1 em textos secundários, botão Sair e navegação inferior do motorista (8 nós; impacto sério);
- `<meta name="viewport">` contém `maximum-scale=1`, impedindo zoom (impacto moderado).

**Plano:** escurecer o token `text-muted-foreground` ou elevar peso/tamanho nos elementos afetados; remover `maximum-scale=1`; adicionar Axe às rotas autenticadas em desktop e mobile. Critério de aceite: zero violações sérias ou críticas WCAG 2 A/AA.

#### P2 — E2E isolado não executável nesta estação

**Motivo:** não existe `.env.test` com backend local e Docker/Podman não está instalado. A configuração Playwright recusou corretamente qualquer backend remoto sem autorização explícita, evitando testes destrutivos em produção.

**Plano:** provisionar Supabase local ou staging descartável, aplicar as migrations, semear dois tenants e contas QA e então executar `npm run e2e` nos projetos desktop, tablet e mobile. Nunca apontar essa suíte para produção.

### Parecer do reteste

A versão nova está tecnicamente implantada e o aplicativo do motorista está utilizável para a jornada vinculada à carga 1012. O sistema ainda não deve ser declarado integralmente homologado: falta explicar/corrigir a carga 1003 fora do grafo ativo, concluir a validação funcional do operador após MFA, alinhar o signup somente por convite e corrigir as violações de acessibilidade.

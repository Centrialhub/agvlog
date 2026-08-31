# Avaliação de prontidão para beta — versão local

Data: 30/08/2026. Escopo confirmado pelo usuário: árvore local de `F:/agvlog-main`, ainda não publicada. Auditoria sem alteração de código da aplicação, migrações ou dados de produção.

## Parecer

**Ainda não recomendo liberar esta candidata para beta operacional amplo pelo cliente. Recomendo avançar para homologação interna integrada.** A base técnica é consistente e passou na regressão; faltam evidências do funcionamento integrado e há uma limitação concreta de recuperação no aplicativo motorista.

Um beta assistido, em ambiente isolado e com dados de teste, pode ser liberado após os critérios abaixo. Não é necessário eliminar toda a dívida técnica nem exigir maturidade de produção para esse beta. O cliente deve avaliar o produto, sem ser o primeiro a descobrir incompatibilidades básicas entre interface, Auth, APIs, banco e Storage.

A ausência de publicação não foi tratada como defeito da candidata local. As verificações do backend existente servem apenas para orientar a preparação do ambiente que receberá a versão.

## Evidência produzida nesta avaliação

| Verificação | Resultado | Limite da evidência |
|---|---|---|
| Gate de oito etapas de `npm run check` | Última execução aprovada: 2.045 testes em 167 arquivos | Node 22.23.2/npm 10.9.4. Execução inicial: 2.041/166 em Node 24.19.0/npm 11.17.0 |
| TypeScript, lint de erros e lint crítico | Aprovados | Não comprovam fluxos autenticados |
| Lockfile e baseline estrutural | Aprovados | Baseline admite dívida preexistente: 113 avisos de `any` |
| Sintaxe das Edge Functions | 40/40 arquivos aprovados | Não equivale a typecheck/executar o runtime Deno completo |
| Cobertura configurada | 93,03% linhas; 65,83% branches; 81,81% funções | Inclui apenas cinco arquivos de regras/utilitários, não toda a aplicação |
| Build e inspeção de artefatos | Aprovados; maior chunk 488,3 KiB, limite 500 KiB | Scanner não encontrou source maps ou marcadores conhecidos de segredos; não é auditoria exaustiva |
| Auditoria de dependências | Zero vulnerabilidades reportadas | Resultado do `npm audit --audit-level=high`, sujeito à base de avisos disponível |
| PostgreSQL nativo 17.11 | 237 testes aprovados | Concorrência, integridade, privacidade e recuperação com fixtures; executor Node 24.19.0. Não é a pilha Supabase completa |
| Navegação pública do build local | `/loads` redirecionou a `/auth`; formulário e aviso de convite presentes; nenhum erro de página listado | Smoke anônimo, sem login; não atesta operador/motorista/portal |
| Acessibilidade do login local | Quatro regras com violações; contraste classificado como sério em dois textos | Axe 4.12.1 via navegador isolado; não é auditoria de todas as telas |
| Supabase completo + E2E autenticado | Não executado nesta avaliação | Docker/stack local e `.env.test.local` não disponíveis; o `.env` atual aponta ao backend hospedado |

Os testes nativos foram executados em cluster descartável, encerrado ao final. Nenhum teste desta auditoria lançou emissão fiscal, pagamento externo, mensagem ou mutação em produção. Não foi usado o script completo de smoke hospedado, pois ele inclui uma tentativa de cadastro.

## Achados e prioridade

### 1. P1 — Falta de validação do fluxo integrado antes do cliente

**Evidência:** `src/test/helpers/deliveryDatabase.ts:44` define uma fixture mínima; `src/test/rlsCrossTenant.test.ts:3` simula políticas em TypeScript. Outros testes executam SQL e componentes reais, mas substituem o transporte Supabase. Os próprios relatórios recentes distinguem esse resultado de E2E HTTP/Auth/Storage.

**Risco:** login e claims, permissões de API, uploads, geolocalização ou efeitos entre módulos podem falhar mesmo com 2.041 testes verdes. Os registros anteriores de falha em `test-results` não foram classificados como falhas atuais, pois não foram reexecutados.

**Para liberar:** aplicar a cadeia de migrações em stack isolada completa, executar contratos SQL/pgTAP e E2E com operador, motorista e cliente, em desktop e móvel. Comprovar pelo menos uma operação completa de cada cenário da matriz abaixo. Este é um bloqueio de evidência, não a alegação de que todos esses fluxos estão quebrados.

### 2. P1 para beta em campo — Entrega não tem recuperação durável após recarga

**Evidência:** `src/lib/driver/driverDeliverySubmission.ts:30` explicita recuperação em memória; a chave é criada em `:53`. `src/pages/driver/DriverDeliveries.tsx:130` guarda a submissão em `useRef` e os anexos/formulário em estado React.

**Risco:** se o servidor confirmar a entrega e a resposta se perder, a mesma montagem consegue reenviar o pedido original. Após recarga, fechamento da aba ou descarte da página pelo celular, a chave e o conteúdo não são recuperados por esse fluxo. O motorista perde a recuperação automática de confirmação e anexos; pode precisar de conciliação pela operação. Isso não prova duplicação financeira ou de entrega — existem proteções no banco.

**Para liberar:** persistir pedido e anexos necessários de maneira segura, isolados por empresa/usuário, ou restringir explicitamente o primeiro beta a sessões assistidas com rede estável e procedimento de conferência. Para uso real em rota, testar interrupção, recarga e retomada sem perda da confirmação nem reenvio com identidade diferente.

### 3. P1 de preparação — A candidata precisa de um backend compatível e isolado

**Evidência:** o `.env` local aponta ao projeto hospedado existente. Consulta somente leitura confirmou que `apply_client_invoice_command` e os contextos novos de fatura ainda não existem nesse destino; `driver_record_delivery_outcome` e `driver_record_delivery_note` existem, mas não permitem execução por `authenticated`. As telas locais usam essas APIs em `src/hooks/useClientInvoiceLifecycle.ts:17` e `src/lib/driver/driverDeliverySubmission.ts:108`.

**Risco:** disponibilizar apenas o frontend local deixa operações indisponíveis. Testar a interface local com o `.env` atual também não constitui um ambiente isolado.

**Para liberar:** preparar o banco de homologação e publicar/aplicar backend e frontend em ordem compatível, incluindo permissões e atualização de clientes antigos. Não aplicar indiscriminadamente toda a árvore local ao banco em uso. A revisão do backend publicado não foi usada para reprovar a qualidade do código local.

### 4. P1 se incluído no escopo — Fiscal e financeiro real ainda exigem homologação específica

**Evidência:** `docs/qa/FATURAS-CICLO-AUDITADO-2026-08-30.md:30` registra pendências de elegibilidade fiscal e retenções; `:50` lista caminhos financeiros restantes. Os testes fiscais de handler usam provedor simulado. A documentação de correções ainda registra pendência de reconciliação de resultados fiscais incertos.

**Risco:** aprovação de testes de integridade não comprova regras comerciais, todos os status fiscais elegíveis, integrações bancárias ou resposta de provedores.

**Para liberar:** manter emissões em produção, SSX e movimentações externas fora do primeiro beta, com bloqueio efetivo das capacidades. Exercitar financeiro com dados sintéticos; incluir fiscal apenas em homologação própria, depois de validar rejeição, resultado incerto e reconciliação. Não afirmar que todo o financeiro está defeituoso: o núcleo transacional foi fortemente testado.

### 5. P2 — GPS pode interromper a chegada sem procedimento operacional validado

**Evidência:** `src/lib/driverLocation.ts:16` exige localização do dispositivo. A migração `20260830003721_require_driver_arrival_geolocation.sql:23` exige precisão de até 150 m e raio de 500 m acrescido da precisão; `:110` recusa parada sem coordenadas. `src/test/driverArrivalBackendContract.test.ts` verifica principalmente o texto do SQL.

**Risco:** permissão negada, sinal ruim ou cadastro sem coordenadas impedem o fluxo. A restrição protege a operação; a lacuna é não ter demonstrado o procedimento de correção/exceção e o comportamento real com PostGIS e celular.

**Para liberar beta motorista:** validar permissões concedidas/negadas, GPS impreciso, ponto incorreto, parada sem coordenadas e retomada. Definir quem corrige o cadastro e se haverá exceção auditada, sem simplesmente desativar a proteção.

### 6. P2 — Contraste e semântica do login

**Evidência reproduzida:** `src/pages/Auth.tsx:23` e `:50` renderizam textos com contraste medido de 4,0:1 e 4,18:1; o Axe exige 4,5:1 para esses textos. Também apontou salto de heading, ausência de landmark principal e conteúdo fora de landmarks. São quatro regras, não quatro bugs críticos.

**Correção:** ajustar o token de cor com verificação nos temas, usar `main` e hierarquia de títulos coerente, e incluir `/auth` na checagem de acessibilidade. O E2E atual em `e2e/accessibility-critical.spec.ts` cobre áreas autenticadas e não o login. Defeito de UX a corrigir cedo; sozinho não impede um beta assistido de escopo restrito.

### 7. P2 — Smoke de publicação pode reprovar fallback HTML como source map

**Evidência:** `scripts/smoke-deployment.mjs:36` trata qualquer HTTP 200 em `.js.map` como vazamento. Foi observado 200 com `text/html` no ambiente Vercel, não um mapa real. `:51` também aceita qualquer resposta não-2xx do signup como prova de bloqueio.

**Risco:** falso bloqueio no release; um erro genérico ou rate limit pode ser confundido com política invite-only válida.

**Correção:** validar conteúdo/formato de source map e código específico de recusa de cadastro. Ensaio de signup somente em ambiente isolado autorizado, com limpeza garantida. Não confundir o valor público `disable_signup=false` com prova de bypass: o backend também pode ter restrições adicionais.

### 8. P3 — Dívida estrutural, sem exigir refatoração geral antes do beta

Inventário de `src`, sem arquivos de testes: 102 arquivos acima de 300 linhas e 55 acima de 500. Descontando `src/integrations/supabase/types.ts`, gerado, são **101 e 54**. Lista integral em `BETA-LOCAL-ARQUIVOS-GRANDES-2026-08-30.md`.

Exemplos: `OperationalEvents.tsx` (2.187), `CteEmissionPreviewDialog.tsx` (1.935), `Ingestion.tsx` (1.752), `RoutePlanning.tsx` (1.100) e `driver/DriverDeliveries.tsx` (1.001). Na tela de entregas, consulta, estado de formulários, mutações e renderização permanecem concentrados, embora o envio já tenha sido extraído parcialmente.

**Risco:** maior esforço para revisar e corrigir regressões. **Ação:** extrair gradualmente consultas, fluxo de submissão e seções de formulário, preservando os testes. Não refatorar tudo como pré-condição do beta. Não foi feita varredura semântica exaustiva de duplicação/dead code em todas as áreas, nem auditoria de segurança integral de cada função SQL.

## Matriz mínima de aceite antes do convite ao cliente

| Cenário | Evidência de aprovação esperada |
|---|---|
| Login e isolamento | Operador, motorista e cliente entram; troca de empresa e acesso por ID de outra empresa não expõem dados; logout encerra acesso |
| Operação normal | Preparar documentos → compor carga → planejar → despachar → iniciar viagem → chegar → entregar; estados coerentes nas três interfaces |
| Entrega e anexos | Foto e assinatura realmente sobem, permanecem vinculadas e são exibidas só ao público autorizado |
| Falhas e reenvio | Duplo clique, queda de rede antes/depois do commit, recarga da página e reabertura não causam perda silenciosa, duplicação ou resultado contraditório |
| Exceções logísticas | Entrega parcial, recusa, correção auditada e reentrega preservam comprovantes e histórico |
| Financeiro sintético | Fechamento → fatura → recebimento parcial → estorno/cancelamento; mesmos saldos e histórico nos módulos relacionados |
| Celular | Fluxos críticos em aparelho real com câmera/GPS; erros compreensíveis e recuperação possível |
| Ambiente e suporte | Versão identificada, dados de teste separados, integrações excluídas bloqueadas, responsável por incidentes e procedimento de recuperar/resetar o ambiente |

Critério sugerido: nenhuma falha crítica de integridade/isolamento, fluxos do escopo concluídos por completo e repetição dos cenários críticos sem falha. Três repetições já estão previstas em `npm run e2e:critical:3`.

## Decisão por modalidade

- **Homologação interna integrada:** pode começar agora.
- **Beta assistido com cliente e dados sintéticos:** liberar após o ensaio integrado e a preparação do ambiente; documentar claramente exclusões e limitações de conectividade.
- **Beta operacional amplo, motorista em campo, fiscal/financeiro real:** ainda não liberar.

## Rastreabilidade

Logs desta execução: `node_modules/.cache/beta-readiness-20260830/`. Arquivos principais: `check.log`, `npm-audit.json`, `native-postgres.log`, `a11y-auth.json` e `auth-mobile.png`. O diretório de cache não substitui anexos de CI; preservar evidências relevantes junto da candidata que vier a ser publicada.

A árvore contém alterações locais e arquivos ainda não versionados. Este parecer avalia esse conteúdo, não apenas o HEAD nem as publicações existentes. Antes de liberar, identificar o conjunto exato de frontend/Edge/migrações e repetir as verificações sobre essa candidata.

Confirmação no runtime suportado: **aprovada**, Node 22.23.2/npm 10.9.4, oito etapas do gate, código de saída zero, 2.045 testes em 167 arquivos. Log: `gate-node22-complete.log`. As etapas foram chamadas sequencialmente pelo npm CLI existente porque seu shim no cache não resolvia o próprio caminho. Uma tentativa anterior foi interrompida pela reinicialização do ambiente de ferramentas e não foi contada como aprovação.

**A árvore continuou recebendo alterações durante a avaliação.** A diferença confirmada entre as execuções inclui `src/test/expenseReviewLegacy.test.ts`, com quatro testes novos; também foi observado `expenseReviewDatabase.test.ts` posteriormente, fora da coleta dessa execução. A comparação de hashes também detectou alteração de `supabase/migrations/20260830203548_audit_driver_expense_reviews.sql` após o manifesto intermediário. Não se atribui aprovação automaticamente a esses arquivos novos ou alterados. O manifesto `candidate-manifest.json` registra hashes de uma observação intermediária, não um release congelado. Congelar a candidata e repetir o gate/E2E é condição de liberação.


# Revisão total do sistema e testes end-to-end

> Documento histórico. A recomendação de MFA desta revisão foi rejeitada por
> decisão de produto em 28/08/2026. O contrato vigente usa fator único e mantém
> autorização obrigatória por tenant e papel.

> **Documento-base da auditoria.** O estado após a execução das correções está em
> [`system-readiness-2026-08-26.md`](./system-readiness-2026-08-26.md); os defeitos e
> percentuais abaixo representam o momento anterior às correções.

**Data:** 26 de agosto de 2026  
**Escopo:** aplicação interna, aplicativo do motorista, portal do cliente, frontend, backend Supabase, Edge Functions, banco de dados, integrações, segurança, qualidade estrutural, dependências e processo de entrega.  
**Ambiente funcional testado:** build de produção local servido em `http://127.0.0.1:4173`, conectado ao backend configurado no projeto.  
**Natureza desta execução:** auditoria e testes não destrutivos. Nenhuma carga, emissão fiscal, despesa, ocorrência, usuário, comprovante ou registro operacional foi criado, alterado, cancelado ou excluído.

## Parecer executivo

O sistema **ainda não está pronto para produção** dentro do escopo atual. A base técnica melhorou de forma importante: compilação, testes unitários, build, RLS, isolamento entre tenants, índices de chaves estrangeiras, permissões anônimas e consistência estrutural de diversos vínculos passaram nos controles executados. A maior parte das telas internas abre e consulta dados reais sem falha de renderização.

Entretanto, existem bloqueadores que afetam operações centrais:

1. A integração SSX está inoperante por credenciais inválidas e não fornece telemetria atual.
2. O fluxo principal do motorista quebra ao resolver a relação entre viagem e carga (`PGRST201`), impedindo paradas, entregas, POD e jornada.
3. Existe documento fiscal preso em `transmitting` há aproximadamente 12,9 dias, sem limite de tentativas ou fila morta efetiva.
4. Há risco de exposição de tokens ou respostas sensíveis em logs de integração e payloads fiscais no frontend.
5. O frontend executa atualizações diretas de estado de carga e inserções em `load_items`, contrariando o contrato de dados documentado.
6. A auditoria de dependências encontrou 25 vulnerabilidades, incluindo uma crítica, 18 altas e uma dependência de produção sem correção publicada no registro usado (`xlsx@0.18.5`).
7. O portal do cliente não pôde ser homologado de ponta a ponta porque nenhuma das contas fornecidas possui papel de cliente; o bloqueio de acesso funciona, mas as dez telas internas do portal continuam sem prova funcional autenticada.

Até que os itens P0 e os critérios de homologação descritos neste documento sejam atendidos, a recomendação é **não promover o sistema a produção operacional**.

## Resumo de prontidão

| Área | Estado | Parecer |
|---|---|---|
| TypeScript, testes unitários e build | Verde | Gates concluídos sem erro |
| Aplicação interna em desktop | Amarelo | Ampla cobertura de leitura, com falhas de UX, desempenho e telemetria |
| Aplicação interna em celular | Vermelho | Sidebar fixa comprime o conteúdo para cerca de 166 px em 390 px de largura |
| Aplicativo do motorista | Vermelho | Viagem ativa não é resolvida; fluxo operacional principal bloqueado |
| Portal do cliente | Cinza | Controle de acesso validado; conteúdo não homologado por falta de conta cliente |
| Supabase/RLS/isolamento | Verde-amarelo | Controles básicos fortes; excesso de funções `SECURITY DEFINER` ainda requer redução |
| Integração SSX | Vermelho | Credencial inválida e dados obsoletos |
| Integração fiscal | Vermelho | Documento preso, callbacks sem inbox durável e reconciliação incompleta |
| Segurança de dependências | Vermelho | Vulnerabilidades crítica/altas e `xlsx` sem correção no pacote atual |
| Manutenibilidade | Vermelho | Arquivos e funções muito grandes, alta complexidade e 1.076 avisos de lint |
| CI/CD e regressão | Amarelo | Gates básicos existem; não há E2E, cobertura mínima ou auditoria de dependências |

## Metodologia e divisão em três subagentes

O trabalho foi separado exatamente em três frentes paralelas, além da consolidação feita pelo agente principal:

1. **Sistema interno:** inventário de rotas, navegação autenticada, estados vazios, consultas reais, responsividade, acessibilidade e smoke test do build de produção.
2. **Motorista e portal:** autenticação, guards, telas móveis, seleção de carga, viagem ativa, paradas, entregas, jornada, eventos, chat e controle de acesso do portal.
3. **Backend/Supabase:** schema, RLS, funções, RPCs, Edge Functions, storage, crons, filas, integrações SSX/fiscais, logs, migrações e integridade multi-tenant.

O agente principal executou ainda typecheck, suíte Vitest, build, orçamento de bundle, lint, auditoria de dependências, inspeção estrutural, smoke test final no artefato de produção e consolidação cruzada dos resultados.

## Cobertura executada

### Inventário de rotas

O roteador contém **94 declarações de rota**. A cobertura foi organizada em:

- 70 telas/endereços internos, considerando a raiz e 69 rotas internas explícitas;
- 11 rotas do motorista, incluindo uma rota dinâmica de detalhe de evento;
- 10 telas do portal do cliente;
- autenticação, alias `/routes` e fallback 404.

Foram abertas **69 das 70 rotas internas** com sessão autenticada. A única exceção foi `/occurrences/:id/return-sheet`, pois não havia ocorrência existente e a auditoria não criou dados apenas para obter um identificador.

Três rotas dinâmicas internas foram testadas com IDs reais:

- `/vehicles/:vehicleId`;
- `/loads/:id`;
- `/traceability/:docId/pod`.

No motorista, as dez rotas estáticas foram abertas. `/driver/events/:id` não pôde ser validada com dado real porque a conta não possuía eventos. O acesso não autorizado a rotas internas e ao portal foi bloqueado corretamente.

### Gates automatizados e técnicos

| Verificação | Resultado |
|---|---|
| TypeScript | Aprovado, sem erro |
| Vitest | 42 arquivos e 360/360 testes aprovados |
| Build de produção | Aprovado, 4.488 módulos processados |
| Orçamento de bundle | Aprovado; maior chunk JavaScript com 468,2 KiB, abaixo de 500 KiB |
| ESLint padrão | 0 erros e 1.076 avisos `no-explicit-any` em 131 arquivos |
| Imports/variáveis não usados, com regra habilitada para auditoria | 248 ocorrências em 84 arquivos |
| Auditoria npm | 25 vulnerabilidades: 1 baixa, 5 moderadas, 18 altas e 1 crítica |
| Auditoria npm apenas produção | 15 vulnerabilidades: 3 moderadas e 12 altas |
| E2E automatizado no repositório | Ausente |
| Metadados Git | Indisponíveis; a pasta entregue não contém `.git` utilizável |

O aviso de Browserslist informa base de navegadores 14 meses desatualizada. O CI executa Node 22 e Bun 1.1.34, mas não executa E2E, auditoria de dependências nem limiar mínimo de cobertura.

## Análise funcional das telas

### Operações internas

As telas de dashboard, operações, ordens de coleta, ingestão, eventos, ocorrências, checklists, produtividade, monitoramento de motoristas, devolução de pallets, controle de cargas, relatórios de ingestão e auditoria de dados abriram sem crash.

Dados observados durante a auditoria incluem 98 notas pendentes em ingestão, seis devoluções de pallets, duas cargas, 61 lotes/1.365 documentos no relatório de ingestão e ausência de eventos/incidentes/ocorrências. O relatório de ingestão levou cerca de cinco segundos para apresentar os dados, merecendo instrumentação de tempo e paginação.

### Cargas e rotas

`/loads` apresentou duas cargas e o detalhe real abriu 106 linhas. O alias `/routes` redireciona corretamente para `/corridors`. Planejamento de rotas e realocação carregam, mas o volume de elementos no detalhe de carga é excessivo: cerca de 984 botões e 128 inputs foram encontrados na árvore de acessibilidade. Isso compromete desempenho, teclado e clareza operacional.

### Fiscal e faturamento

CT-e Hub, busca de CT-e, NFS-e, ORT, consistência, MDF-e provisório, documentos fiscais, faturamento e monitor de CT-e abriram. Foram observados 5 registros elegíveis no Hub, 34 NFS-e, 90 MDF-e provisórios, 281 documentos fiscais e 190 itens em faturamento.

Há dois defeitos visíveis relevantes:

- `/cte-monitor` e `/cte-search` exibem uma frase de depuração em português que descreve uma quebra após correção de busca por NF;
- o Hub de CT-e mostra inicialmente zero e, cerca de 2,5 segundos depois, mostra cinco registros, sem estado de carregamento suficientemente claro.

No backend, existe um documento preso em `transmitting` há aproximadamente 309,6 horas, com 1.238 polls e sem `sefaz_status`.

### Rastreabilidade

Rastreabilidade, rastreabilidade de produtos, histórico, auditoria de extração, resumo de notas importadas e POD abriram. A rota real de POD apresentou timeline. As maiores listas observadas foram 266 itens de auditoria, 156 de produtos e 103 no resumo de notas; precisam de paginação ou virtualização.

### Financeiro

As telas financeira, contas a receber, contas a pagar, faturas de clientes, EDI, relatórios de fechamento, aprovação de despesas, conciliação bancária, folha e centros de custo abriram. Grande parte estava vazia. A liquidação de motoristas exibiu dois registros. Como a execução foi não destrutiva, aprovações, pagamentos, conciliações e fechamentos não foram disparados.

### Cadastros

Clientes, colaboradores, veículos, detalhes de veículo, motoristas, ativos, rotas operacionais, fretes, regiões, clientes rurais e pedidos abriram. Foram observados 505 clientes, 51 veículos, 23 motoristas e 20 rotas operacionais. Clientes renderiza centenas de linhas e botões de uma só vez.

### Manutenção e estoque

Ordens de manutenção, estoque e inventário abriram, em estados vazios. Criação, movimentação e encerramento não foram executados por alterarem dados reais.

### Monitoramento

Controle de operações, mapa da frota, alertas, corredores, geofences e relatórios abriram. Os indicadores são inconsistentes entre telas:

- dashboard raiz: 0 alertas e 16 veículos offline;
- controle de operações: 1 alerta crítico;
- mapa da frota: 51 veículos, sendo 16 offline e 35 sem dados;
- outra leitura do dashboard de monitoramento classifica os 51 como offline.

É necessário definir uma única fonte, janela de atualização, classificação e glossário para todos os KPIs.

### Administração e integrações

Equipe mostrou 14 membros após cerca de 1,5 segundo; antes disso, exibiu zero. O diálogo de convite foi aberto e cancelado sem mutação. Saúde de integrações e configurações abriram.

A integração SSX mostra `invalid_credentials` e `Decryption failed`. A posição mais nova estava aproximadamente 5,5 dias atrasada, não havia veículo online e dezenas de falhas de login estavam registradas. Ao mesmo tempo, a tela de pipeline mostrava poll recente e zero erros, pois mede sucesso HTTP do cron em vez de sucesso de negócio.

### Aplicativo do motorista

O login do motorista funciona e redireciona para `/driver`. A conta possui duas cargas em trânsito, identificadas na interface como 1012 e 1003.

Ao abrir uma carga real, a navegação vai para `/driver/stops?trip=<uuid>`, mas a tela informa simultaneamente `0 parada(s)` e `Nenhuma viagem ativa`. O console e a API confirmaram erro PostgREST HTTP 300, código `PGRST201`, causado por duas relações possíveis entre `dispatch_trips` e `loads`:

- `loads_trip_id_fkey`: `dispatch_trips(id)` para `loads(trip_id)`;
- `dispatch_trips_load_id_fkey`: `dispatch_trips(load_id)` para `loads(id)`.

O erro ocorre nas consultas de `useCurrentDriver`, `DriverHome` e `DriverStops`. Como o contrato de dados define `dispatch_trip_loads` como vínculo canônico, a correção deve consultar a relação canônica ou uma RPC dedicada, e não apenas escolher silenciosamente uma das FKs legadas.

O hook transforma o erro em `null`, fazendo a interface mostrar estado vazio em vez de erro técnico com opção de tentar novamente. O resultado é bloqueio de paradas, entregas, POD e jornada. Despesas, ocorrências e checklist continuam visualmente acionáveis mesmo sem viagem resolvida, mas tendem a falhar ou manter estado apenas local.

As dez rotas estáticas do motorista abriram no build de produção em viewport 390×844 sem overflow horizontal. As proteções de rota funcionam: o motorista é redirecionado ao tentar abrir telas administrativas, e usuário deslogado volta para `/auth`.

### Portal do cliente

As duas contas fornecidas não possuem acesso de cliente. Todas as rotas do portal negaram acesso corretamente, o que valida o guard, mas não valida dashboard, remessas, detalhes, faturas, documentos, relatórios, perfil e demais conteúdos.

A inspeção estática encontrou riscos que precisam de teste autenticado:

- erros de RPC podem ser convertidos em “sem acesso” ou zeros, ocultando falhas técnicas;
- linhas e cartões clicáveis não são focáveis por teclado;
- exportação CSV não neutraliza fórmulas iniciadas por `=`, `+`, `-` ou `@`;
- cancelamento usa `window.confirm`.

## Falhas e riscos priorizados

### P0 — bloqueadores de produção

#### P0.1 — SSX inoperante e telemetria obsoleta

**Evidência:** conta SSX em `invalid_credentials`, falha de descriptografia, posição mais recente com aproximadamente 5,5 dias e zero veículos online.  
**Impacto:** monitoramento operacional não representa a frota real; alertas e decisões ficam incorretos.  
**Correção:** recadastrar o segredo pelo fluxo criptográfico atual, sincronizar unidades, executar poll manual controlado, validar posição com menos de cinco minutos e manter soak de 24 horas com alerta por idade e erro de negócio.

#### P0.2 — fluxo do motorista bloqueado por relação ambígua

**Evidência:** `PGRST201` ao carregar viagem ativa; duas relações entre carga e viagem.  
**Impacto:** motorista vê cargas, mas não consegue operar paradas, entregas, POD ou jornada.  
**Correção:** centralizar resolução em `dispatch_trip_loads`/RPC, remover consultas ambíguas, propagar erro para a UI, adicionar retry e teste integrado para motorista com carga, múltiplas paradas e entrega.

#### P0.3 — documento fiscal preso sem política de terminalidade

**Evidência:** um documento em `transmitting` há 309,6 horas e 1.238 polls.  
**Impacto:** estado fiscal falso, custo de polling, risco de dupla ação e operação sem reconciliação.  
**Correção:** reconciliar manualmente o registro, implantar teto por tentativas/idade, backoff, fila morta, alerta acima de 15 minutos e ação segura de reprocessamento.

#### P0.4 — resposta potencialmente sensível em logs

**Evidência:** `ssx-login/index.ts` registra até 200 caracteres da resposta de autenticação; `_shared/ssx-utils.ts` registra previews de autenticação/operação; fluxos fiscais do frontend registram respostas e payload completo.  
**Impacto:** exposição de token, credencial, CPF/CNPJ, chave fiscal ou conteúdo comercial em console/plataforma de logs.  
**Correção:** remover corpo de respostas, usar allowlist de metadados não sensíveis, revisar retenção e acesso, pesquisar logs históricos e rotacionar credenciais/tokens se houver qualquer exposição.

#### P0.5 — mutações contrárias ao contrato canônico de dados

**Evidência:** `LoadDetail` usa atualização genérica direta de `loads.status`; `useLoadItems` e `Ingestion` fazem inserções/remoções diretas, enquanto `docs/data-contract.md` determina RPCs e `dispatch_trip_loads`/`load_items` como fontes canônicas.  
**Impacto:** estados inválidos, perda de auditoria, divergência entre espelhos e comportamento diferente entre telas.  
**Correção:** criar RPC de transição de estado com máquina de estados e auditoria; revogar atualização direta de campos protegidos; mover composição de carga para RPCs transacionais; alinhar documentação e implementação; adicionar testes SQL/E2E do contrato.

#### P0.6 — vulnerabilidades críticas/altas de dependências

**Evidência:** 25 vulnerabilidades totais; entre as diretas estão Vitest crítica, React Router alta, Vite alta, PostCSS alta e `xlsx@0.18.5` alta sem correção publicada para essa linha no registro auditado.  
**Impacto:** leitura/execução arbitrária em servidor de testes, redirects/XSS, exposição por servidor de desenvolvimento e risco em importação de planilhas.  
**Correção:** atualizar Vitest, Vite e PostCSS; migrar e testar React Router para uma versão sem o conjunto de advisories; substituir `xlsx` por biblioteca/distribuição mantida ou processador isolado; limitar tamanho/tipo e processar arquivos em Worker; executar auditoria no CI.

#### P0.7 — homologação funcional incompleta do portal e das mutações críticas

**Evidência:** ausência de conta cliente e execução deliberadamente não destrutiva no ambiente conectado.  
**Impacto:** não há prova E2E de portal, emissão CT-e/NFS-e/MDF-e, criação/edição/cancelamento, POD, upload ou pagamentos.  
**Correção:** criar ambiente de staging isolado com massa controlada e contas admin, motorista e cliente; automatizar jornadas críticas e executar homologação de efeitos no banco, storage, fila e callbacks.

### P1 — alta prioridade

1. **Ledger de migrações divergente:** quatro versões remotas não correspondem aos nomes locais de migrações de extensões, índices, revogações e permissões. Reparar a trilha em ambiente descartável antes de qualquer `db push` e atualizar `supabase/BASELINE.md`.
2. **Callbacks fiscais sem inbox durável/idempotência:** callbacks podem responder 200 para documento desconhecido, falha de espelho ou erro parcial. Implementar inbox transacional, hash/ID único, retry, dead-letter e transição monotônica.
3. **Layout duplicado em `/merchandise-shortages`:** a página monta `AppLayout` dentro de `ProtectedRoute`, produzindo duas sidebars, dois navs e dois mains.
4. **Responsividade interna:** em 390×844, a sidebar de 224 px permanece fixa e deixa cerca de 166 px para o conteúdo.
5. **Paginação/virtualização ausente:** clientes, documentos fiscais, auditoria, faturamento, produtos, MDF-e e detalhe de carga renderizam centenas de elementos.
6. **Acessibilidade:** muitos botões apenas com ícone não têm nome acessível; atalhos/cards do motorista usam `div onClick` sem `role`/`tabIndex`; diálogos não possuem descrição; auth não informa `autocomplete`.
7. **Estados falsamente vazios:** erros e carregamento são frequentemente convertidos em zero, “sem acesso” ou “nenhuma viagem ativa”. Padronizar `loading/error/empty/success`.
8. **KPIs de monitoramento inconsistentes:** alinhar fonte, definição de offline, janela, atualização, timezone e freshness.
9. **Privilégios de funções:** 146 funções `SECURITY DEFINER` são executáveis por `authenticated`; 26 não tiveram consumidor identificado. Criar matriz, revogar as não usadas e mover helpers para schema privado.
10. **Storage sem limites:** buckets privados e políticas por tenant existem, mas faltam limite de tamanho, allowlist MIME/extensão, validação de assinatura, varredura e retenção.
11. **Autenticação:** proteção contra senhas vazadas está desabilitada e 14 usuários não usam MFA. Habilitar proteção e exigir MFA para perfis privilegiados.
12. **Reconciliação fiscal:** existem emissões sem vínculo local completo, autorizadas sem `last_synced_at`, seis CT-e com erro e cancelamentos rejeitados. Criar fila e painel de reconciliação.
13. **Metadados de integração acessíveis ao motorista:** restringir a admins ou publicar somente view de saúde mínima.
14. **Cadastro público:** `/auth` expõe criação de conta e administração cria senha inicial. Confirmar a política B2B; preferir convite e definição de senha pelo usuário com expiração e rate limiting.

### P2 — melhoria planejada

1. Remover frases de debug de CT-e e `console.log` de payloads.
2. Substituir 13 usos de `window.prompt`/`window.confirm` por diálogos consistentes, acessíveis e auditáveis.
3. Traduzir o 404, remover `console.error` para navegação esperada e decidir indexação em `robots.txt`.
4. Tornar explícita a configuração de `cte-status-poll`.
5. Fixar uma versão única de `@supabase/supabase-js` nas Edge Functions e usar import map.
6. Restringir/centralizar CORS atualmente aberto em pelo menos 15 funções.
7. Regenerar tipos Supabase; os tipos locais indicam PostgREST 14.4 enquanto o remoto usa 14.17 e ainda referenciam extensões movidas.
8. Reduzir privilégios padrão futuros de `supabase_admin`.
9. Avaliar PWA/offline para o aplicativo de campo; hoje não há manifest ou service worker.
10. Expor `/driver/deliveries` a partir da parada atual ou consolidar a jornada, pois a tela está praticamente órfã.

## Segurança e integridade do backend

### Controles aprovados

- 186/186 tabelas públicas possuem RLS.
- 4/4 views usam `security_invoker`.
- Nenhuma extensão permanece no schema público.
- Não foram encontradas FKs sem índice no inventário atual.
- Nenhuma função possui `SECURITY DEFINER` sem `search_path` fixo.
- `anon` não consegue selecionar/escrever dados nem executar funções.
- As 105 RPCs referenciadas no frontend existem e aceitam execução autenticada.
- As 17 Edge Functions referenciadas pelo frontend existem.
- Os três buckets usados pelo frontend existem, são privados e possuem políticas por caminho/tenant.
- Não foram encontrados vínculos fiscais/carga ou viagem/carga cruzando tenants nos testes realizados.
- Os crons usam segredos do Vault; não foram encontrados segredos em claro nas definições inspecionadas.
- Banco com aproximadamente 350 MB, 18/60 conexões, cache hit de 99,99% e zero deadlocks no recorte analisado.

### Alertas de arquitetura

Há 275 funções, das quais 256 usam `SECURITY DEFINER`. A configuração de `search_path` e as revogações anônimas estão corretas, mas a superfície autenticada continua grande. O advisor oficial do Supabase trata funções autenticadas com `SECURITY DEFINER` como item a revisar: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

A proteção contra credenciais vazadas deve ser habilitada conforme a orientação oficial: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Sucesso HTTP de cron não deve ser usado sozinho como saúde da integração. Foram observadas 3.365 execuções em 24 horas sem falha HTTP, mesmo com SSX funcionalmente quebrado.

## Qualidade estrutural e manutenibilidade

A auditoria estrutural, excluindo tipos Supabase gerados e testes, encontrou:

- 436 arquivos analisados;
- 96 arquivos acima de 300 linhas;
- 49 acima de 500;
- 7 acima de 1.000;
- 3 acima de 1.500;
- 289 funções com complexidade acima de 15;
- 28 ocorrências de profundidade acima de 4;
- 150 funções acima de 150 linhas.

Maiores arquivos:

| Arquivo | Linhas |
|---|---:|
| `src/pages/OperationalEvents.tsx` | 2.108 |
| `src/components/billing/CteEmissionPreviewDialog.tsx` | 1.857 |
| `src/pages/Ingestion.tsx` | 1.678 |
| `src/pages/BillingPage.tsx` | 1.300 |
| `src/pages/Traceability.tsx` | 1.194 |
| `src/pages/driver/DriverDeliveries.tsx` | 1.131 |
| `src/pages/RoutePlanning.tsx` | 1.049 |

Funções mais complexas incluem `buildCtePayload` (160), `buildMdfePayload` (129), `buildNFSeEmitPayload` (120), trecho principal de Traceability (119) e `toBuildInput` do preview de CT-e (116).

O plano de refatoração deve começar pelos builders fiscais e fluxos de motorista, extraindo validação, mapeamento, estados e efeitos para unidades puras testáveis. Depois, dividir páginas por caso de uso, tabela, filtros, diálogos e hooks. Não é recomendável uma refatoração ampla antes de cobrir os fluxos críticos com testes de contrato e E2E.

## Plano de correção

### Onda 0 — stop-ship

1. Restaurar SSX e comprovar telemetria fresca por 24 horas.
2. Corrigir relação viagem/carga pela fonte canônica e validar a jornada completa do motorista.
3. Reconciliar o documento fiscal preso e implantar terminalidade, backoff e dead-letter.
4. Remover logs sensíveis, revisar histórico e rotacionar segredos se necessário.
5. Bloquear atualizações diretas dos campos protegidos e implantar RPCs de transição/composição.
6. Corrigir vulnerabilidades crítica/altas; substituir `xlsx` ou isolar completamente seu processamento.
7. Criar staging e credencial cliente para concluir portal e mutações críticas.

### Onda 1 — confiabilidade e segurança

1. Implantar inbox idempotente para callbacks fiscais e reconciliação automática.
2. Reparar o ledger de migrações em ambiente descartável e ensaiar restauração.
3. Reduzir superfície `SECURITY DEFINER`, habilitar senha vazada e MFA privilegiado.
4. Aplicar limites e validação a uploads; restringir CORS.
5. Unificar estados `loading/error/empty`, KPIs e freshness.
6. Corrigir layout duplicado, navegação móvel interna e acessibilidade bloqueante.

### Onda 2 — desempenho, UX e testes

1. Paginar/virtualizar listas grandes e medir p50/p95 de consultas/telas.
2. Automatizar E2E das jornadas admin, fiscal, motorista e cliente em staging.
3. Adicionar axe, navegação por teclado e viewports móveis ao E2E.
4. Adicionar auditoria de dependências e cobertura mínima ao CI.
5. Atualizar Browserslist, Bun e dependências com testes de regressão.
6. Remover estados e rotas legadas ou documentar sua finalidade no menu.

### Onda 3 — manutenibilidade

1. Reduzir builders fiscais e páginas acima de 1.000 linhas.
2. Eliminar `any` progressivamente por domínio e reativar regra de código não usado.
3. Padronizar query keys, tratamento de erro, dialogs e componentes de tabela.
4. Criar testes de contrato para RPCs, RLS, transições e espelhos.
5. Regenerar tipos e fixar versões/import maps das Edge Functions.

## Critérios objetivos de aceite para produção

O sistema só deve receber parecer favorável quando todos os itens abaixo tiverem evidência anexada:

- SSX sem `invalid_credentials`, posição mais recente abaixo de cinco minutos e soak de 24 horas sem perda.
- Motorista consegue: login → selecionar carga → abrir viagem → ver paradas → iniciar/finalizar entrega → enviar POD → concluir jornada, sem `PGRST201` e com persistência validada.
- Nenhum documento permanece `transmitting` por mais de 15 minutos sem alerta e ação automática; retry possui limite e dead-letter.
- Logs não contêm token, senha, cookie, payload fiscal completo ou dado pessoal desnecessário.
- Atualizações de status e composição de carga passam apenas por RPCs transacionais auditáveis.
- Zero vulnerabilidade crítica e zero vulnerabilidade alta sem exceção formal, compensação e prazo; biblioteca de planilha vulnerável removida ou substituída.
- Ledger de migrações local/remoto alinhado e restauração ensaiada em ambiente limpo.
- Portal validado com conta cliente real de teste em todas as dez telas e isolamento entre dois tenants.
- Navegação interna utilizável em 390 px, sem conteúdo comprimido por sidebar fixa.
- Listas grandes paginadas/virtualizadas e tempos p95 definidos.
- E2E automatizado executado no CI para jornadas admin, fiscal, motorista e cliente; falha bloqueia promoção.
- Testes de RLS confirmam zero leitura/escrita cross-tenant e `anon` sem acesso.
- Auditoria de dados não apresenta item crítico e reconciliação fiscal está zerada ou formalmente tratada.

## Casos E2E a automatizar

### Administração/operação

1. Login, recuperação de sessão e logout.
2. Criar ordem de coleta em staging, ingerir documento, compor carga via RPC e consultar rastreabilidade.
3. Alterar carga somente por transição permitida e rejeitar transição inválida.
4. Filtrar/paginar clientes, veículos, documentos e cargas.
5. Verificar isolamento entre tenant A e B.

### Fiscal

1. Preparar documento, transmitir a sandbox, receber callback, atualizar espelho e reconciliar.
2. Callback duplicado e fora de ordem não deve regredir estado nem duplicar registro.
3. Timeout deve aplicar backoff, limite e dead-letter.
4. Cancelamento/rejeição deve manter histórico e mensagem operacional.

### Motorista

1. Login com carga ativa e com múltiplas cargas.
2. Resolução canônica de viagem e paradas.
3. Início/chegada/finalização, ocorrência, checklist, despesa, upload e POD.
4. Offline/reconexão caso PWA entre no escopo.
5. Teclado, leitor de tela e viewport de celular real.

### Portal

1. Dashboard e remessas com dados do próprio tenant.
2. Detalhe, documentos, faturas, relatórios e exportação CSV neutralizada.
3. Erro de RPC exibido como erro, não como zero ou “sem acesso”.
4. Tentativa de ID de outro tenant retorna negação sem vazamento.

## Limitações desta auditoria

- As contas fornecidas cobrem administrador e motorista, mas não cliente.
- Não havia ocorrência nem evento de motorista com ID real para testar as duas rotas dinâmicas correspondentes.
- A execução não alterou dados reais; por isso, criação, edição, cancelamento, emissão, pagamento, upload e POD precisam de staging.
- Headers e comportamento da hospedagem final não foram testados em domínio publicado; o smoke foi feito com `vite preview` sobre o build de produção.
- A pasta entregue não contém histórico Git utilizável, então não foi possível comparar as correções com commits anteriores.
- Testes manuais confirmam o comportamento observado, mas não substituem uma suíte E2E reproduzível no CI.

## Artefatos e observações operacionais

- O diretório `dist` foi reconstruído com o código atual e passou no smoke de produção.
- `package-lock.json` foi gerado exclusivamente para a auditoria npm, embora o projeto use Bun.
- `.codex-build-audit` foi criado como saída temporária de build durante a inspeção.
- A remoção dos dois artefatos temporários não foi feita porque a política do ambiente exige autorização separada para exclusão. Eles não fazem parte de correções do produto.

## Conclusão

A aplicação interna possui boa amplitude funcional de leitura e uma base de segurança de banco consideravelmente mais sólida. Porém, os dois fluxos mais sensíveis à operação — telemetria SSX e jornada do motorista — não estão funcionais, e o fiscal ainda não possui garantias suficientes de terminalidade, idempotência e reconciliação. Somados às vulnerabilidades de dependências e às mutações fora do contrato canônico, esses fatos sustentam o parecer **não pronto para produção**.

A ordem mais segura é: restaurar integrações e jornada do motorista, proteger logs e contratos de escrita, eliminar vulnerabilidades, homologar o portal/mutações em staging e somente então atacar desempenho e refatorações estruturais com cobertura automatizada.

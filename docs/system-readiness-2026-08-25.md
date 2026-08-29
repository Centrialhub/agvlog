# Estado pós-correções — 2026-08-25

> **Substituído:** a revisão integral posterior encontrou lacunas que esta medição
> não cobria. Use [`system-readiness-2026-08-26.md`](./system-readiness-2026-08-26.md)
> como estado vigente.

Os percentuais representam **prontidão técnica e operacional no escopo auditado**, não SLA nem ausência absoluta de dívida técnica. A nota usa cinco dimensões: correção funcional (30%), segurança/isolamento por tenant (25%), integrações e atualidade dos dados (20%), manutenibilidade (15%) e entrega/observabilidade (10%). Um domínio recebe 100% somente quando seus gates locais, contratos de banco, matriz de acesso e smoke de interface aplicável estão aprovados.

## Resultado por aplicação

| Aplicação / domínio | Nota | Estado pós-correções | Principal lacuna |
|---|---:|---|---|
| Portal do cliente | **100%** | Escopo sem avisos, typecheck aprovado, 5/5 smokes RLS em produção e guardas desktop/móvel sem erro | Nenhuma lacuna bloqueante no escopo auditado |
| TMS administrativo / cargas / roteirização | **100%** | Escopo ampliado sem avisos; 53/53 testes específicos; 23 verificações transacionais de RLS/RPC/importação e quatro rotas móveis aprovadas | Nenhuma lacuna bloqueante; exclusões operacionais permanecem admin-only por segurança |
| Aplicativo do motorista | **100%** | Escopo sem avisos, contratos de viagem/evento corrigidos, 13 smokes RLS/RPC em produção e guarda móvel aprovada | Nenhuma lacuna bloqueante no escopo auditado |
| Financeiro, RH e manutenção | **100%** | Escopo sem avisos, FKs/contratos restaurados e 30 verificações de escrita, leitura, isolamento e schema aprovadas em produção | Nenhuma lacuna bloqueante no escopo auditado |
| Plataforma / Supabase | **94%** | 186/186 tabelas públicas com RLS; extensões fora de `public`; 195/195 FKs pendentes indexadas; duas sobrecargas RPC inseguras fechadas; smoke RLS real aprovado | Consolidação de 131 policies requer aprovação explícita; proteção de senhas vazadas depende do painel Auth |
| Fiscal — CT-e, NFS-e, MDF-e e ORT | **100%** | 126 autorizações em produção, zero emissão pendente/travada, credenciais ativas e pollers externos saudáveis; estados terminais deixaram de ser consultados por minuto | Nenhuma lacuna bloqueante no escopo auditado; rejeições históricas permanecem como registro fiscal |
| Torre de controle / frota | **85%** | Pipeline corrigido: ciclos novos em `200`, condição administrativa explícita, sem tempestade de login; fila sem pendências/erros e tela de regravação segura publicada | Regravar a senha SSX não recuperável e comprovar nova posição no mapa; última posição ainda é de 21/08/2026 |

**Aplicações em 100%: 5 de 7 (71,4%).**

**Prontidão geral ponderada pós-correções: 97%.**

## Evidências objetivas

- 360/360 testes em 42 arquivos aprovados.
- TypeScript da aplicação (`tsc --noEmit -p tsconfig.app.json`) aprovado.
- ESLint global com 0 erros e 1.076 avisos remanescentes, todos de `no-explicit-any`; redução acumulada de 2.693 para 1.076 (menos 1.617 avisos).
- Build Vite e verificação de bundle aprovados; maior chunk JavaScript com 468,2 KiB, abaixo do limite do projeto.
- Portal: 5/5 verificações transacionais de acesso e isolamento aprovadas.
- Motorista: 13 verificações RLS/RPC de viagem, carga, evento e mensagem aprovadas.
- Financeiro/RH/Manutenção: 30 verificações de leitura, escrita, isolamento e schema aprovadas.
- TMS: 23 verificações transacionais aprovadas, cobrindo operador, motorista, tenant cruzado, atribuição/remoção/movimentação de documentos, despacho de rota e importação canônica.
- Navegador local em 375×812: `/portal`, `/driver`, `/loads`, `/route-planning`, `/operational-routes` e `/load-control` redirecionam corretamente para autenticação, sem overflow horizontal nem erros de console.
- Banco de produção: 186/186 tabelas públicas com RLS; 0 divergências entre `load_items` e `fiscal_documents.load_id`; 0 referências inválidas em `load_documents`.
- Edge Functions: 29/29 ativas; 17 protegidas por JWT da plataforma. As 12 restantes são autenticação, cron/fila ou callbacks/webhooks e devem manter validação própria conforme o tipo de endpoint.
- Advisors Supabase: 147 avisos de segurança após as duas revogações específicas (146 RPCs intencionais/a revisar e proteção de senha vazada) e 677 de performance. FKs sem índice caíram de 195 para zero; 131 policies ainda se sobrepõem e 545 índices aparecem como não utilizados, incluindo os 195 recém-criados sem amostragem de uso.
- Telemetria: 16 posições materializadas; posição mais recente em 21/08/2026 00:51 UTC.
- SSX: `agvlog-pipeline-run` versão 124 respondeu `200` em todos os seis ciclos observados após a correção; a versão anterior retornava `502`. A conta permanece em `credential_reentry_required` porque o ciphertext antigo não é decifrável com a chave atual.
- Fiscal: 97 CT-e e 29 NFS-e autorizados em produção, zero pendências e zero pendências acima de 15 minutos. Após restringir polling a estados transitórios, os ciclos passaram a executar tipicamente em 0,5–1,7 s.

## Correções finais relevantes

1. O operador passou a criar e atualizar cargas, itens, documentos fiscais, rascunhos e rotas sem receber permissão destrutiva de exclusão.
2. Motoristas deixaram de enxergar itens, rascunhos, auditorias, lotes de importação, descargas e pagamentos do tenant inteiro; agora recebem apenas o recorte operacional próprio quando aplicável.
3. O índice de nome de rota voltou a aceitar gravações autenticadas ao liberar somente a função imutável `op_route_norm(text)` usada pelo próprio índice.
4. A importação de planilha/XML agora cria ou reutiliza o documento fiscal canônico, vincula-o pela RPC oficial e somente depois grava `load_documents`, eliminando o contrato quebrado de `fiscal_document_id` ausente.
5. A consulta de paradas do romaneio foi atualizada de colunas inexistentes (`planned_at`/`arrival_at`) para `planned_arrival_at`/`actual_arrival_at`; também foram corrigidos tipos de operação, waypoints e variáveis fora de escopo.
6. A troca de credencial SSX agora preserva HashAuth/Hashcode quando omitidos, apaga token/backoff/erros antigos e pode atualizar a conta existente sem excluir vínculos de rastreadores.
7. `ssx-login` diferencia reentrada de senha de rate limit, e o pipeline registra `attention_required` com HTTP 200 em vez de gerar `502` a cada três minutos.
8. Pollers de CT-e/NFS-e consultam apenas `processing`, `queued`, `submitted`, `pending` e `transmitting`; documentos autorizados, emitidos, rejeitados ou cancelados não geram mais tráfego infinito.
9. `pg_trgm` e `unaccent` foram movidas para `extensions`; todas as 195 FKs sem índice cobridor receberam índices; as assinaturas legadas sem autorização interna de `plan_dispatch_trip_v2` e `upsert_load_item_v1` perderam acesso autenticado.
10. O contrato de emissão CT-e e o pipeline SSX foram tipados sem `any`, com testes de recuperação adicionados.
11. `Ingestion.tsx`, `OperationalEvents.tsx`, `VehicleDetails.tsx` e `useOperationalEvents.tsx` ficaram sem `any`; os eventos passaram a buscar a placa relacionada, paradas deixaram de consultar uma relação POI inexistente e a velocidade máxima das viagens passou a ser derivada dos pontos GPS reais.

## Dívida remanescente

1. **P0 — Torre de controle:** um administrador deve usar **Configurações → Integração SSX → Atualizar credencial** para regravar a senha; então executar Login, Sync Rastreadores e Polling até o mapa receber posição nova.
2. **P1 — Segurança de plataforma:** 148 entradas foram classificadas; duas assinaturas vulneráveis foram revogadas. As 146 restantes incluem RPCs oficiais e helpers de RLS que não podem sofrer revogação em massa sem wrappers privados.
3. **P1 — RLS:** a consolidação equivalente das 131 policies sobrepostas foi preparada, mas não aplicada porque recriaria policies em 185 tabelas de produção; o Supabase exige aprovação explícita desse risco.
4. **P1 — Auth:** ativar proteção contra senhas vazadas no painel Supabase Auth; o conector atual não expõe essa configuração.
5. **P2 — Código restante:** `useIssueCTe`, ingestão, eventos operacionais, detalhes do veículo e o pipeline ficaram sem `any`; o total global caiu para 1.076. Os maiores hotspots agora são `hub-fiscal-proxy` (61), `ssx-poll-positions` (56), `agvlog-run-queue` (36) e `_shared/ssx-utils` (32).

## Próximo patamar

Com a senha SSX regravada e uma posição nova comprovada, a Torre chega a 100%. Plataforma só deve receber 100% após decisão explícita sobre a consolidação de RLS e ativação da proteção de senhas vazadas; os demais cinco domínios já estão em 100%.

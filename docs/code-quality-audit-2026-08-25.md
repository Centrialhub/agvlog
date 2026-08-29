# Auditoria estrutural — 2026-08-25

> Atualização final de 28/08/2026: os 200 diagnósticos de símbolos mortos, os 73
> de `noImplicitAny` e os 167 de `strictNullChecks` foram eliminados. As quatro
> regras passaram a integrar o gate normal. Também foram ativadas doze barreiras
> compatíveis com o código atual:
> casing consistente, `noFallthroughCasesInSwitch`, `noImplicitOverride`,
> `noImplicitReturns`, bloqueio de código inalcançável/labels inválidos/imports
> laterais não resolvidos, `noImplicitThis`, checagens estritas de funções,
> retorno de iteradores e `catch` como `unknown`. Typecheck com 16 barreiras
> adicionais, ESLint bloqueante, 37/37 arquivos Edge, 422/422 testes e
> build/bundle passaram. O ESLint completo registra 385 avisos, todos usos
> explícitos de `any`; 491 avisos (56,1%) foram eliminados no acumulado.
> Os fluxos endurecidos entraram no gate `lint:critical-types` com zero aviso.
> O escopo atual tem 484 arquivos de runtime, 114 acima de 300 linhas, 59 acima
> de 500 e 12 acima de 1.000, excluindo testes e tipos gerados.
>
> Atualização de 27/08/2026: nova auditoria somente leitura executada com o
> Supabase indisponível e SSX explicitamente adiado. O escopo atual tem 108
> arquivos de runtime acima de 300 linhas e 55 acima de 500, excluindo testes e
> tipos gerados. Nos dez maiores módulos frontend, o ESLint com limites
> diagnósticos de complexidade 10/profundidade 4 encontrou 79 violações. O
> TypeScript com `noUnusedLocals` e `noUnusedParameters` temporariamente
> habilitados encontrou 200 diagnósticos: 190 `TS6133`, nove `TS6192` e um
> `TS6196`. A configuração normal ainda mantém essas barreiras desabilitadas.
>
> Prioridade atual, sem refatoração automática nesta auditoria:
>
> 1. **P0 — remover símbolos mortos em lotes pequenos.** Começar por
>    `Financial.tsx` (13), `ValidationStep.tsx` (12),
>    `OperationsCenter.tsx` (12), `LoadDetail.tsx` (8),
>    `Traceability.tsx` (7) e `Ingestion.tsx` (6). Depois habilitar
>    `noUnusedLocals/noUnusedParameters` gradualmente para impedir regressão.
> 2. **P0 — extrair regras puras de alta complexidade antes de dividir JSX.**
>    Os piores pontos medidos são `Traceability.tsx:507` (complexidade 119),
>    `CteEmissionPreviewDialog.tsx:325` (116), `DriverDeliveries.tsx:99`
>    (85), `Ingestion.tsx:1235` (82), `Ingestion.tsx:706` (74) e
>    `BillingPage.tsx:218` (67). Esses trechos devem ganhar testes
>    caracterizadores antes da extração.
> 3. **P1 — separar data access dos God Components.** `OperationalEvents`,
>    `Ingestion`, `Traceability`, `DriverDeliveries`, `RoutePlanning`,
>    `TeamManagement` e `Settings` fazem consulta/mutação Supabase, regras
>    e renderização no mesmo arquivo.
> 4. **P1 — centralizar duplicações de baixo risco.** Existem 11 helpers locais
>    de mensagem de erro, dezenas de normalizações `replace(/\\D/g, '')` e
>    formatadores BRL repetidos. A política de upload já é uma exceção positiva:
>    limite/tipos/nome seguro estão centralizados em `uploadPolicy.ts`.
> 5. **P2 — remover hardcodes operacionais repetidos.** A URL SSX padrão aparece
>    no frontend e na Edge de upsert; o template OpenStreetMap aparece em vários
>    mapas apesar do utilitário Leaflet já existente. URLs de provedores
>    externos devem ficar em constantes/configuração com fallback testado.
> 6. **P3 — nomenclatura.** A estrutura `pages/components/hooks/lib` é legível.
>    Kebab-case está concentrado nos primitivos shadcn e não requer migração.
>    O problema real é a mistura de pastas camelCase em `src/lib` e hooks sem
>    JSX mantidos como `.tsx`; padronizar apenas quando cada domínio for tocado.
>
> Registro histórico: naquele momento o gate normal permanecia verde com
> `noUnusedLocals` e `noUnusedParameters` desabilitados. Essas duas lacunas e os
> 200 diagnósticos foram resolvidos em 28/08. Naquele corte, `strict` e
> `noImplicitAny` ainda eram migração futura; `noImplicitAny` e a parcela crítica
> `strictNullChecks` também foram ativados no mesmo dia.
>
> Atualização de 26/08/2026: uma nova varredura somente leitura, excluindo tipos
> gerados e testes, encontrou 481 arquivos, 108 acima de 300 linhas, 55 acima de
> 500 e 10 acima de 1.000. O ESLint está com 0 erros e 1.067 avisos, todos
> `no-explicit-any`; 402/402 testes e o build passam. Desde a auditoria original,
> CORS e dependências Edge foram centralizados/fixados, diálogos nativos foram
> eliminados, oito listas críticas foram paginadas e a política de frescor da
> telemetria foi unificada. A relação de arquivos abaixo permanece como registro
> histórico da medição de 25/08; o parecer atualizado está em
> `docs/system-readiness-2026-08-26.md`.

Escopo: arquivos TypeScript/TSX em `src` e `supabase/functions`. A auditoria orienta priorização; ela não substitui testes funcionais nem profiling de produção.

## Resumo

- 115 arquivos acima de 300 linhas; 60 acima de 500 e 13 acima de 1.000.
- Excluindo o arquivo gerado `src/integrations/supabase/types.ts`: 114, 59 e 12, respectivamente.
- ESLint: 0 erros e 385 avisos, todos `no-explicit-any`. A camada `src/lib`, o fluxo fiscal web de CT-e/NFS-e e os fluxos incluídos em `lint:critical-types` estão com 0 erros/avisos; os alertas de hooks, Fast Refresh, blocos vazios, escapes, imports CommonJS e expressões condicionais/constantes foram eliminados.
- Gate funcional atual: 422 testes, typecheck endurecido, lint de erros, sintaxe
  Edge e build/bundle aprovados.

## Achados priorizados

1. **P1 — God Components.** `OperationalEvents.tsx:1`, `CteEmissionPreviewDialog.tsx:1`, `Ingestion.tsx:1`, `BillingPage.tsx:1`, `Traceability.tsx:1` e `DriverDeliveries.tsx:1` combinam consulta/mutação, regras de negócio, estado de formulário e renderização. Isso aumenta regressões e dificulta análise automatizada. Extrair primeiro hooks de caso de uso, schemas/transformações e componentes de seção.
2. **P1 — Edge Functions monolíticas.** `ssx-poll-positions/index.ts:1`, `agvlog-run-queue/index.ts:1` e `hub-fiscal-proxy/index.ts:1` misturam autenticação, transporte externo, persistência, retry e normalização. O proxy fiscal agora tem isolamento multi-tenant explícito, mas cresceu para 1.110 linhas; separar adaptadores de provedor, validação, repositórios e orquestradores com testes unitários.
3. **P1 — Tipagem permissiva, parcialmente resolvida.** `noImplicitAny` e
   `strictNullChecks` agora estão ativos e zerados. Restam 385 usos explícitos
   de `any` em componentes, hooks e Edge Functions. A rodada tipou devoluções de
   pallets, centro de operações, resumo de notas, relatórios de ingestão,
   faturamento, tabelas de frete, histórico de produto, veículos, dashboard,
   pedidos, checklists e estoque, incluindo seus hooks associados.
4. **Resolvido nesta rodada — Hooks potencialmente obsoletos.** Os 27 alertas `react-hooks/exhaustive-deps` foram eliminados com callbacks/memos estáveis e dependências explícitas. Manter a regra ativa como barreira contra regressões.
5. **P1 — Superfície SECURITY DEFINER, parcialmente resolvida.** Oito dos 16
   helpers de política foram movidos para o schema não exposto `private` após
   ensaio transacional e smoke RLS com um motorista ativo. A produção agora
   possui 139 avisos desse tipo, incluindo RPCs do produto e helpers ainda
   compartilhados por frontend, RPCs PL/pgSQL ou centenas de políticas. Quatro
   RPCs legados adicionais foram revogados de `authenticated`, e três mutações
   tenant-scoped receberam gates e validações cruzadas.
   `anon` não executa nenhum deles. Não revogar em massa; os oito helpers
   restantes exigem migração coordenada dos corpos de função e cobertura E2E.
6. **P2 — Índices e RLS.** A rodada de 26/08 eliminou as 20 combinações remanescentes de políticas permissivas sobrepostas. O catálogo final tem 187/187 tabelas públicas sob RLS, 719 políticas, 993 índices, 430 FKs validadas e zero constraint não validada. Cinco duplicatas detectadas após o novo grafo de monitoramento foram removidas; o advisor lista 560 índices sem uso observado, que não devem ser removidos sem janela representativa de tráfego e análise de planos.
7. **P2 — Lógica/valores duplicados, parcialmente resolvido.** A configuração Leaflet e o ajuste automático de enquadramento foram centralizados para os seis mapas. CORS/respostas/auth ainda se repetem nas Edge Functions; status/labels ainda aparecem espalhados.
8. **Resolvido nesta rodada — Dead code silencioso.** Os treze blocos vazios agora documentam explicitamente o comportamento best-effort ou registram falhas de integração com contexto sanitizado.
9. **Resolvido nesta rodada — Expressão constante.** O bloco inalcançável em `TeamManagement.tsx` e as expressões condicionais usadas apenas para mutação foram removidos ou convertidos em fluxo explícito.
10. **P3 — Nomenclatura/estrutura.** A divisão `pages/components/hooks/lib` é reconhecível, mas componentes de domínio muito grandes e hooks em `.tsx` sem JSX tornam fronteiras inconsistentes. Padronizar hooks puros em `.ts` e organizar por domínio à medida que os módulos forem extraídos.

## Todos os arquivos acima de 300 linhas

| Linhas | Arquivo |
|---:|---|
| 17422 | `src/integrations/supabase/types.ts` |
| 2158 | `src/pages/OperationalEvents.tsx` |
| 1929 | `src/components/billing/CteEmissionPreviewDialog.tsx` |
| 1709 | `src/pages/Ingestion.tsx` |
| 1369 | `src/pages/BillingPage.tsx` |
| 1282 | `supabase/functions/ssx-poll-positions/index.ts` |
| 1256 | `src/pages/Traceability.tsx` |
| 1176 | `src/pages/driver/DriverDeliveries.tsx` |
| 1157 | `supabase/functions/agvlog-run-queue/index.ts` |
| 1095 | `src/pages/RoutePlanning.tsx` |
| 1020 | `src/pages/TeamManagement.tsx` |
| 1110 | `supabase/functions/hub-fiscal-proxy/index.ts` |
| 979 | `src/pages/OperationsCenter.tsx` |
| 1004 | `src/components/nfse/NFSeFromInvoicesDialog.tsx` |
| 945 | `src/pages/LoadReallocation.tsx` |
| 956 | `src/components/loads/NewLoadDialog.tsx` |
| 940 | `src/pages/MdfeProvisional.tsx` |
| 931 | `supabase/functions/_shared/ssx-utils.ts` |
| 908 | `src/components/financial/DriverSettlementDrawer.tsx` |
| 896 | `src/components/loads/LoadNotesPanel.tsx` |
| 857 | `src/lib/fiscal/cteBuilder.ts` |
| 837 | `src/pages/Loads.tsx` |
| 832 | `src/pages/Settings.tsx` |
| 791 | `src/pages/BankReconciliation.tsx` |
| 771 | `src/pages/VehicleDetails.tsx` |
| 775 | `supabase/functions/ssx-sync-units/index.ts` |
| 771 | `src/pages/Financial.tsx` |
| 738 | `src/pages/PalletReturns.tsx` |
| 702 | `src/components/loads/LoadRomaneioTabs.tsx` |
| 689 | `src/components/loads/BatchReimportDialog.tsx` |
| 687 | `src/components/ingestion/GroupingStep.tsx` |
| 674 | `src/pages/ClosingReports.tsx` |
| 668 | `src/pages/FreightTables.tsx` |
| 653 | `src/components/ingestion/ORTReviewStep.tsx` |
| 643 | `src/pages/CteSearch.tsx` |
| 641 | `src/pages/CteMonitor.tsx` |
| 637 | `src/components/ui/sidebar.tsx` |
| 634 | `src/pages/Drivers.tsx` |
| 626 | `src/components/ingestion/ResultsStep.tsx` |
| 618 | `supabase/functions/agvlog-process-vehicle/index.ts` |
| 606 | `src/hooks/useNFSe.tsx` |
| 606 | `src/components/loads/LoadItemsPanel.tsx` |
| 635 | `src/components/nfse/NFSeFormDialog.tsx` |
| 592 | `src/components/clients/ClientFormDialog.tsx` |
| 578 | `src/pages/ImportedNotesSummary.tsx` |
| 574 | `src/components/ingestion/ValidationStep.tsx` |
| 571 | `src/pages/MerchandiseShortages.tsx` |
| 565 | `src/pages/Geofences.tsx` |
| 565 | `src/pages/ClientInvoices.tsx` |
| 555 | `src/hooks/useDriverSettlements.tsx` |
| 555 | `src/pages/LoadDetail.tsx` |
| 555 | `src/pages/ClientRegions.tsx` |
| 545 | `src/pages/Employees.tsx` |
| 543 | `src/components/ingestion/RoutingStep.tsx` |
| 536 | `src/components/settings/EmittersSettings.tsx` |
| 536 | `src/lib/ingestionValidator.ts` |
| 532 | `src/pages/FreightSimulator.tsx` |
| 538 | `src/pages/BillingEdi.tsx` |
| 507 | `src/pages/DriverMonitoring.tsx` |
| 503 | `src/hooks/useDriverMonitoring.tsx` |
| 500 | `src/components/pickup/NewManualOrtDialog.tsx` |
| 497 | `src/pages/OccurrenceReports.tsx` |
| 491 | `src/pages/LoadControl.tsx` |
| 481 | `src/hooks/useLoadControl.tsx` |
| 477 | `src/pages/Payroll.tsx` |
| 474 | `src/lib/documentParsers.ts` |
| 464 | `src/components/loads/PendingDocsGrouping.tsx` |
| 487 | `src/lib/fiscal/mdfeBuilder.ts` |
| 433 | `src/pages/Payables.tsx` |
| 428 | `src/hooks/useClosingReports.tsx` |
| 424 | `src/pages/Orders.tsx` |
| 421 | `src/pages/FiscalDocuments.tsx` |
| 413 | `src/hooks/usePalletReturns.tsx` |
| 405 | `src/pages/IngestionReports.tsx` |
| 404 | `src/pages/Alerts.tsx` |
| 400 | `supabase/functions/ssx-diagnostic/index.ts` |
| 399 | `src/hooks/usePayroll.tsx` |
| 398 | `src/pages/Vehicles.tsx` |
| 398 | `src/components/loads/ManifestPanel.tsx` |
| 398 | `src/pages/driver/DriverIssues.tsx` |
| 393 | `src/hooks/useBilling.tsx` |
| 392 | `src/pages/driver/DriverHome.tsx` |
| 387 | `src/pages/NFSe.tsx` |
| 380 | `src/pages/PodHistory.tsx` |
| 377 | `src/components/loads/CTeWorkbench.tsx` |
| 372 | `supabase/functions/agvlog-pipeline-run/index.ts` |
| 371 | `src/pages/ProductHistory.tsx` |
| 370 | `src/lib/closingReports/closingReportBuilder.ts` |
| 363 | `src/hooks/useCteMonitor.tsx` |
| 361 | `src/pages/Incidents.tsx` |
| 356 | `supabase/functions/agvlog-compute-state/index.ts` |
| 334 | `src/pages/FleetMap.tsx` |
| 352 | `src/hooks/useRuralClients.tsx` |
| 351 | `src/hooks/useIssueCTe.tsx` |
| 350 | `src/pages/ProductTraceability.tsx` |
| 347 | `src/test/cteBuilder.test.ts` |
| 345 | `src/hooks/useImportedNotesSummary.tsx` |
| 344 | `src/components/layout/AppLayout.tsx` |
| 344 | `src/pages/Dashboard.tsx` |
| 340 | `src/hooks/useOccurrenceReports.tsx` |
| 339 | `src/hooks/useBankReconciliation.tsx` |
| 336 | `src/components/fiscal/OrtGeracaoTab.tsx` |
| 330 | `src/hooks/useFreightCalculator.tsx` |
| 329 | `src/pages/CostCenters.tsx` |
| 328 | `src/pages/LoadExtractionAudit.tsx` |
| 324 | `supabase/functions/ssx-login/index.ts` |
| 321 | `src/components/ingestion/ClientContactPicker.tsx` |
| 319 | `src/pages/RuralClients.tsx` |
| 318 | `src/pages/OperationsDashboard.tsx` |
| 317 | `src/pages/driver/DriverExpenses.tsx` |
| 406 | `src/lib/fiscal/nfseBuilder.ts` |
| 311 | `src/pages/IntegrationHealth.tsx` |
| 310 | `supabase/functions/update-trip-live-status/index.ts` |
| 303 | `src/components/ui/chart.tsx` |

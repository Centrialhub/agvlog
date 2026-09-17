# Auditoria integral do sistema — 2026-09-16

## Escopo e critério

Auditoria de frontend, backend Supabase, contratos de integração, segurança de escrita, rotas, build e dependências. O portal do cliente foi mantido fora do critério de conclusão funcional, conforme solicitado; nenhum comportamento de negócio do portal foi declarado pronto por esta auditoria.

O repositório já continha alterações locais extensas. Elas foram preservadas. A execução-base de `npm run check` passou antes das correções, permitindo distinguir regressões introduzidas nesta auditoria.

## Fontes de verdade verificadas

| Domínio | Fonte canônica | Escrita autorizada | Espelhos/leitura |
| --- | --- | --- | --- |
| Composição de carga | `load_items` | RPCs de composição | `fiscal_documents.load_id` é espelho |
| Vínculo viagem–carga | `dispatch_trip_loads` | RPCs de despacho | `loads.trip_id` é espelho |
| Documento por parada | `dispatch_stop_documents` | RPCs de entrega/realocação | projeções de desfecho são derivadas |
| Estado de parada | `dispatch_stops.status` + `public.stop_terminal_statuses()` | comandos de operação/motorista | `src/lib/status/stopStatus.ts` é o único espelho frontend |
| Geocerca de entrega | destino verificado da parada | automação de despacho | somente leitura em `/geofences` |
| Geocerca de frota | `geofences` | `upsert_geofence_v4` e `mutate_fleet_geofence_v1` | tabela sem escrita direta para `authenticated` |
| Comandos críticos | ledger e RPCs idempotentes por tenant/ator/request | funções canônicas | UI apenas dispara e reconcilia respostas |

As buscas estáticas não encontraram escrita direta no frontend para `load_items`, `dispatch_trip_loads` ou `dispatch_stop_documents`. O contrato de release confirma 448 migrações ordenadas e 47 Edge Functions.

## Achados corrigidos

1. **P1 — paradas encerradas reapareciam como pendentes no motorista.** Dois conjuntos locais divergiam do catálogo canônico; `cancelled` e, em um ponto, `skipped` eram tratados como próximos destinos. Ambos agora usam `isStopTerminal`, e o alias legado em `loadStatus.ts` referencia a mesma constante.
2. **P1 — geocercas contornavam o comando canônico.** Ativar/desativar e excluir usavam `UPDATE`/`DELETE` direto. A migração `20260916123000_canonical_fleet_geofence_commands.sql` cria comando idempotente, vinculado a tenant e ator, registra auditoria, rejeita cercas de entrega e revoga escrita direta de `authenticated`.
3. **P1 — injeção de HTML no romaneio.** Campos de XML/notas eram interpolados em `document.write`. O renderizador agora escapa todos os textos importados e foi centralizado; a duplicação em `GroupingStep` foi removida.
4. **P2 — smoke test de rotas incompleto.** Sete rotas registradas não estavam no teste integral: resolução de endereços, comprovantes, custódia, MDF-e provisório e três rotas do motorista. Um teste de contrato agora impede nova divergência.
5. **P2 — diálogo financeiro sem descrição acessível.** A baixa em lote recebeu `DialogDescription`, removendo o aviso do Radix e associando descrição ao diálogo.
6. **P2 — abertura insegura de comprovantes assinados.** Links externos em devolução de paletes e folha de ocorrência agora usam `noopener,noreferrer`.
7. **P2 — cadeia de testes vulnerável.** Vitest e coverage foram atualizados de 3.2.7 para 4.1.11. Os tipos de mocks afetados foram adaptados e `npm audit --audit-level=moderate` passou com zero vulnerabilidades.
8. **P3 — lógica de impressão duplicada.** A análise geral e por rota agora compartilham agrupamento, ordenação, totais, estilo e escape, reduzindo duas implementações para uma fonte.
9. **P1 — replay de geocerca existia no banco, mas não sobrevivia à perda de resposta no navegador.** Ativar/desativar e excluir geravam um `request_id` novo a cada clique. As duas ações agora usam o outbox durável canônico por tenant, ator, ação, entidade e payload; somente uma resposta com o mesmo `request_id` confirma e remove a pendência. A migração pendente também consolida as sete policies sobrepostas de `geofences` em uma única policy de leitura do tenant ativo.

## Auditoria Supabase conectada

Inspeção remota executada pelo plugin Supabase no único projeto conectado, `PROJETO AGV LOG` (`qcvnsdrbcchaxvawcngk`), região `sa-east-1`, estado `ACTIVE_HEALTHY`, PostgreSQL 17.6. Nenhuma linha de negócio foi criada, alterada ou removida durante a inspeção.

### Catálogo e fronteiras

- Produção registra 722 migrações, com última versão `20260916045352`. A migração local `20260916123000_canonical_fleet_geofence_commands.sql` não está aplicada; o RPC `public.mutate_fleet_geofence_v1(jsonb)` ainda não existe e `authenticated` ainda possui `INSERT`, `UPDATE` e `DELETE` diretos em `geofences`.
- As 324 tabelas públicas têm RLS habilitado. As 11 views públicas usam `security_invoker`.
- Existem 405 funções públicas `SECURITY DEFINER`; 186 são RPCs autenticadas, nenhuma é executável por `anon`, nenhuma usa ACL implícita e nenhuma está sem `search_path` fixo. As 14 que não continham marcador textual de autorização no corpo público foram rastreadas até validadores delegados de portal, tenant, workspace ou operação.
- Os 45 avisos de RLS sem policy correspondem a relações backend-only. Nas 11 tabelas do schema `public`, `anon` e `authenticated` não têm privilégio efetivo de tabela nem de coluna; a ausência de policy é negação por padrão, não exposição.
- O Advisor também reporta proteção de senha vazada desabilitada e opções insuficientes de MFA. São configurações do Auth e não foram ativadas automaticamente porque mudam política de autenticação e exigem decisão operacional.
- Os avisos de desempenho atuais são 195 FKs sem índice, 16 policies com `auth.*` sem initplan, uma tabela polimórfica sem PK, 671 índices ainda não observados em uso e 19 grupos de policies permissivas. Eles não foram convertidos em alterações em massa: índice não usado não é evidência suficiente para remoção, e índices/PKs novos exigem análise de carga e ensaio em staging. O caso funcional de `geofences` foi corrigido na migração pendente.

### Edge Functions e fonte de verdade

- Produção possui 46 Edge Functions ativas. O repositório possui as mesmas 46 mais `finance-image-runtime-benchmark`, artefato privado de benchmark que permanece intencionalmente não publicado.
- Foram comparadas 283 instâncias de arquivos empacotados, normalizando CRLF/LF. O único drift real era `fiscal-certificate-manage`, que carregava uma revisão anterior de `_shared/tax-registry.ts`; todos os entrypoints já coincidiam.
- `fiscal-certificate-manage` foi republicada isoladamente na versão 18, preservando `verify_jwt=true`. O hash normalizado do módulo compartilhado passou a coincidir com o checkout e um smoke sem credencial recebeu HTTP 401, confirmando que a fronteira JWT continua ativa.
- A migração de geofence não foi aplicada isoladamente: revogar o DML antes de publicar o frontend novo quebraria os botões da versão atualmente hospedada. O gate correto é banco primeiro e frontend imediatamente depois, com smoke autenticado e rollback coordenado.

## Verificação executada

- `npm run check` antes das mudanças: aprovado.
- Testes focados de status, impressão, diálogo, geocercas e outboxes: 14 arquivos / 51 testes aprovados.
- Teste de banco PGlite do novo comando: replay exato, isolamento de tenant, proteção de geocerca de entrega e ACL direta aprovados.
- Reteste focado após a auditoria conectada: 3 arquivos / 11 testes aprovados, incluindo persistência e ACK do replay de geocerca; `npm run typecheck` aprovado.
- `npm run typecheck`: aprovado após a atualização do Vitest.
- `npm audit --audit-level=moderate`: zero vulnerabilidades.
- `npm run check` final, reexecutado após a auditoria Supabase e o ajuste de replay: aprovado. A cobertura executou 893 arquivos (892 aprovados, 1 ignorado) e 6.029 testes (6.028 aprovados, 1 ignorado), seguida de 90/90 arquivos Edge aceitos, build de produção e inspeção do artefato público sem source maps ou material secreto reconhecido.
- Cobertura final: 88,2% statements, 75% branches, 93,93% functions e 91,3% lines.

O teste E2E Playwright dependente do Supabase local não pôde ser executado nesta máquina porque Docker e Podman não estão instalados. A configuração rejeita corretamente backends remotos por padrão, portanto nenhum ambiente remoto foi usado como substituto inseguro. Rotas e contratos afetados continuam cobertos por testes estáticos/unitários e pelo build; o E2E real permanece um gate de CI com Docker.

## Dívida estrutural

O baseline passa e não houve novo arquivo acima de 500 linhas, mas a base mantém muitos módulos grandes. Isso não é uma falha funcional imediata; é risco de manutenção, testes frágeis e contexto excessivo para mudanças futuras. Os itens abaixo são o inventário completo de arquivos de aplicação acima de 300 linhas, excluindo testes, tipos gerados e vendor.

Legenda de ação recomendada: **página** = separar consulta/estado, seções visuais e diálogos; **fluxo** = separar etapas e estado da máquina; **builder** = separar validação, transformação e serialização; **hook** = separar leitura, comandos e projeções; **UI-base** = manter próximo do upstream e alterar apenas com testes visuais.

### Críticos: acima de 500 linhas

| Linhas | Arquivo | Papel / ação recomendada |
| ---: | --- | --- |
| 2185 | `components/billing/CteEmissionPreviewDialog.tsx` | diálogo fiscal multifase; dividir por etapas, hooks e painéis |
| 2145 | `pages/OperationalEvents.tsx` | página operacional; extrair consultas, filtros, tabela e drawers |
| 1706 | `pages/Ingestion.tsx` | orquestrador de ingestão; extrair máquina de fluxo e etapas |
| 1416 | `pages/BillingPage.tsx` | página fiscal; separar ações, listagem, downloads e diálogos |
| 1342 | `components/nfse/NFSeFromInvoicesDialog.tsx` | wizard NFS-e; dividir etapas e contrato de submissão |
| 1261 | `pages/Traceability.tsx` | rastreabilidade; separar timeline, filtros e evidências |
| 1080 | `pages/RoutePlanning.tsx` | planejamento; separar autosave, mapa e composição |
| 1066 | `pages/Settings.tsx` | agregador de configurações; dividir por domínio |
| 1029 | `pages/TeamManagement.tsx` | equipe e acesso; separar membros, convites e papéis |
| 957 | `components/nfse/NFSeFormDialog.tsx` | formulário fiscal; separar schema, seções e envio |
| 948 | `lib/fiscal/cteBuilder.ts` | builder CT-e; separar validação, normalização e payload |
| 941 | `components/loads/NewLoadDialog.tsx` | criação de carga; separar composição, metadados e comando |
| 886 | `pages/LoadReallocation.tsx` | realocação; separar seleção, prévia e confirmação |
| 882 | `pages/Loads.tsx` | página de cargas; separar filtros, kanban/lista e ações |
| 843 | `pages/VehicleDetails.tsx` | detalhe de veículo; separar telemetria, manutenção e documentos |
| 747 | `pages/Drivers.tsx` | motoristas; separar lista, vínculo e formulários |
| 744 | `pages/PalletReturns.tsx` | devoluções; separar consultas, workflow e comprovantes |
| 725 | `components/loads/LoadRomaneioTabs.tsx` | abas do romaneio; extrair cada aba e estado compartilhado |
| 722 | `pages/LoadDetail.tsx` | detalhe de carga; separar cabeçalho, composição e histórico |
| 702 | `components/loads/BatchReimportDialog.tsx` | reimportação; dividir prévia, validação e execução |
| 683 | `pages/FreightTables.tsx` | tabelas de frete; separar filtros, grade e edição |
| 683 | `components/settings/EmittersSettings.tsx` | emissores; separar credenciais, certificados e cadastro |
| 675 | `components/clients/ClientFormDialog.tsx` | cadastro de cliente; separar endereço, fiscal e contatos |
| 673 | `components/financial/DriverSettlementDrawer.tsx` | acerto; separar resumo, movimentos e comandos |
| 661 | `pages/CteMonitor.tsx` | monitor CT-e; separar polling, tabela e ações de arquivo |
| 660 | `components/ingestion/ORTReviewStep.tsx` | revisão ORT; separar validação, contatos e confirmação |
| 649 | `pages/CteSearch.tsx` | pesquisa CT-e; separar critérios, resultados e detalhes |
| 648 | `pages/LoadControl.tsx` | controle de carga; separar projeções e ações |
| 644 | `components/loads/LoadNotesPanel.tsx` | notas; separar edição, desfechos e metadados |
| 637 | `components/ui/sidebar.tsx` | UI-base; manter alinhado ao upstream |
| 636 | `pages/DriverMonitoring.tsx` | monitoramento; separar mapa, lista e alertas |
| 627 | `components/ingestion/ResultsStep.tsx` | resultado de ingestão; separar resumos e ações |
| 613 | `lib/ingestionValidator.ts` | validador; separar parsers, regras e agrupamento |
| 598 | `hooks/useDriverMonitoring.tsx` | hook agregado; separar queries, realtime e projeção |
| 598 | `components/loads/LoadItemsPanel.tsx` | composição; separar lista, seleção e comandos |
| 596 | `pages/ImportedNotesSummary.tsx` | resumo fiscal; separar filtros, tabela e mutações |
| 596 | `hooks/useNFSe.tsx` | hook fiscal; separar leitura, comandos e arquivos |
| 573 | `pages/MerchandiseShortages.tsx` | faltas; separar filtros, relatório e workflow |
| 572 | `pages/ClientRegions.tsx` | regiões; separar mapa, regras e edição |
| 570 | `components/ingestion/ValidationStep.tsx` | validação; separar regras, erros e correções |
| 568 | `lib/fiscal/mdfeBuilder.ts` | builder MDF-e; separar validação e payload |
| 556 | `pages/BillingEdi.tsx` | EDI; separar upload, processamento e histórico |
| 554 | `pages/Employees.tsx` | funcionários; separar lista, cadastro e vínculos |
| 547 | `components/ingestion/GroupingStep.tsx` | agrupamento; impressão já extraída, continuar separando análise e atribuição |
| 543 | `components/ingestion/RoutingStep.tsx` | roteirização; separar mapa, atribuição e persistência |
| 532 | `pages/FreightSimulator.tsx` | simulador; separar entrada, cálculo e resultado |
| 520 | `components/loads/ManifestPanel.tsx` | manifesto; separar formulário, lifecycle e arquivos |

### Observação: 300–500 linhas

Todos são candidatos a divisão incremental, sem justificar refatoração em massa durante uma auditoria corretiva:

| Linhas | Arquivo | Categoria |
| ---: | --- | --- |
| 500 | `components/pickup/NewManualOrtDialog.tsx` | fluxo/dialog |
| 499 | `pages/driver/DriverDeliveries.tsx` | página motorista |
| 499 | `pages/FiscalDocuments.tsx` | página fiscal |
| 498 | `pages/OccurrenceReports.tsx` | página/relatório |
| 497 | `pages/driver/DriverHome.tsx` | página motorista |
| 489 | `pages/NFSe.tsx` | página fiscal |
| 482 | `pages/Geofences.tsx` | página/mapa |
| 481 | `pages/driver/DriverIssues.tsx` | página motorista |
| 480 | `lib/documentParsers.ts` | parser/builder |
| 461 | `components/financial/ReceivableAgreementDialog.tsx` | fluxo/dialog |
| 454 | `pages/Vehicles.tsx` | página |
| 451 | `hooks/useDriverSettlements.tsx` | hook |
| 450 | `hooks/useFiscalDocuments.tsx` | hook |
| 449 | `lib/driver/driverDeliverySubmission.ts` | comando/offline |
| 438 | `pages/Orders.tsx` | página |
| 437 | `pages/BankReconciliation.tsx` | página financeira |
| 436 | `pages/OperationsCenter.tsx` | página operacional |
| 434 | `pages/driver/DriverStops.tsx` | página motorista |
| 432 | `pages/driver/DriverCargoCustody.tsx` | página motorista |
| 432 | `hooks/usePalletReturns.tsx` | hook |
| 429 | `pages/IngestionReports.tsx` | página/relatório |
| 424 | `hooks/useFreightCalculator.tsx` | hook/cálculo |
| 419 | `components/loads/PendingDocsGrouping.tsx` | fluxo/composição |
| 418 | `pages/Alerts.tsx` | página |
| 408 | `pages/IntegrationHealth.tsx` | página/observabilidade |
| 404 | `lib/fiscal/hubFiscalClient.ts` | cliente de integração |
| 402 | `hooks/useBilling.tsx` | hook |
| 392 | `pages/ProductHistory.tsx` | página/histórico |
| 391 | `lib/fiscal/nfseBuilder.ts` | builder |
| 383 | `hooks/useImportedNotesSummary.tsx` | hook |
| 379 | `components/loads/CTeWorkbench.tsx` | fluxo fiscal |
| 376 | `pages/Incidents.tsx` | página |
| 371 | `lib/closingReports/closingReportBuilder.ts` | builder/relatório |
| 368 | `hooks/useLoadControl.tsx` | hook |
| 367 | `lib/deliveryReceipts/deliveryReceiptOperations.ts` | comandos |
| 365 | `lib/driver/driverOfflineOutbox.ts` | outbox |
| 357 | `pages/Dashboard.tsx` | página |
| 355 | `pages/FleetMap.tsx` | página/mapa |
| 350 | `hooks/useRuralClients.tsx` | hook |
| 345 | `components/fiscal/OrtGeracaoTab.tsx` | fluxo fiscal |
| 344 | `components/financial/NewInvoiceWizard.tsx` | fluxo/wizard |
| 342 | `lib/driver/driverDeliveryOfflineStore.ts` | store offline |
| 341 | `hooks/useCteMonitor.tsx` | hook |
| 340 | `lib/driver/receiptScan.ts` | scanner/parser |
| 340 | `hooks/useOccurrenceReports.tsx` | hook |
| 339 | `pages/LegacyCostCenters.tsx` | página legada |
| 338 | `pages/ClosingReports.tsx` | página/relatório |
| 337 | `lib/driver/driverOperationalOffline.ts` | store offline |
| 335 | `hooks/useAuthorizedCteList.ts` | hook |
| 335 | `pages/DeliveryReceipts.tsx` | página |
| 332 | `pages/LoadExtractionAudit.tsx` | página/auditoria |
| 331 | `components/ingestion/ClientContactPicker.tsx` | seletor |
| 322 | `pages/Inventory.tsx` | página |
| 318 | `hooks/useBankReconciliation.tsx` | hook |
| 316 | `hooks/usePayroll.tsx` | hook |
| 313 | `pages/OperationsDashboard.tsx` | página |
| 308 | `pages/Receivables.tsx` | página financeira |
| 303 | `components/ui/chart.tsx` | UI-base |
| 302 | `hooks/useOperationalEvents.tsx` | hook |

Prioridade de decomposição recomendada: primeiro módulos acima de 900 linhas e com fronteira fiscal/financeira; depois páginas operacionais acima de 700; por fim hooks e componentes entre 300–500 conforme forem modificados.

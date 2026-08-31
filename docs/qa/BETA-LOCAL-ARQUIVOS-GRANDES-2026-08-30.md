# Inventário estrutural da candidata local

30/08/2026. Arquivos TS/TSX de src, excluindo testes. Métrica de tamanho, não lista de bugs. O arquivo de tipos gerados está sinalizado e não é contado como dívida de componente. Sugestões abaixo são triagem por localização; não representam análise semântica exaustiva de cada arquivo.

| Arquivo | Linhas | Triagem |
|---|---:|---|
| `src/integrations/supabase/types.ts` | 17919 | Tipos gerados; separar por gerador/domínio somente se necessário |
| `src/pages/OperationalEvents.tsx` | 2187 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/billing/CteEmissionPreviewDialog.tsx` | 1935 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/Ingestion.tsx` | 1752 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/BillingPage.tsx` | 1386 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/Traceability.tsx` | 1259 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/RoutePlanning.tsx` | 1100 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/TeamManagement.tsx` | 1045 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/nfse/NFSeFromInvoicesDialog.tsx` | 1009 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/driver/DriverDeliveries.tsx` | 1001 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/OperationsCenter.tsx` | 987 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/MdfeProvisional.tsx` | 986 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/loads/NewLoadDialog.tsx` | 957 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/components/financial/DriverSettlementDrawer.tsx` | 947 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/Settings.tsx` | 943 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/LoadReallocation.tsx` | 885 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/Loads.tsx` | 873 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/lib/fiscal/cteBuilder.ts` | 854 | Biblioteca de regras/utilitários; separar responsabilidades por domínio |
| `src/pages/VehicleDetails.tsx` | 815 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/BankReconciliation.tsx` | 806 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/Financial.tsx` | 757 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/PalletReturns.tsx` | 744 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/loads/LoadRomaneioTabs.tsx` | 733 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/Drivers.tsx` | 714 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/loads/BatchReimportDialog.tsx` | 702 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/components/ingestion/GroupingStep.tsx` | 686 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/FreightTables.tsx` | 681 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/nfse/NFSeFormDialog.tsx` | 680 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/components/ingestion/ORTReviewStep.tsx` | 660 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/CteSearch.tsx` | 650 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/CteMonitor.tsx` | 648 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/loads/LoadNotesPanel.tsx` | 643 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/hooks/useNFSe.tsx` | 638 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/components/ui/sidebar.tsx` | 637 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/LoadDetail.tsx` | 628 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/ingestion/ResultsStep.tsx` | 626 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/components/clients/ClientFormDialog.tsx` | 612 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/hooks/useLoadControl.tsx` | 604 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/components/loads/LoadItemsPanel.tsx` | 598 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/ImportedNotesSummary.tsx` | 588 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/Geofences.tsx` | 572 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/MerchandiseShortages.tsx` | 571 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/ingestion/ValidationStep.tsx` | 570 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/ClientRegions.tsx` | 570 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/Employees.tsx` | 560 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/settings/EmittersSettings.tsx` | 558 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/BillingEdi.tsx` | 551 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/hooks/useDriverMonitoring.tsx` | 550 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/components/ingestion/RoutingStep.tsx` | 543 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/hooks/useDriverSettlements.tsx` | 538 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/lib/ingestionValidator.ts` | 534 | Biblioteca de regras/utilitários; separar responsabilidades por domínio |
| `src/pages/FreightSimulator.tsx` | 531 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/layout/AppLayout.tsx` | 525 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/components/pickup/NewManualOrtDialog.tsx` | 514 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/DriverMonitoring.tsx` | 509 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/lib/fiscal/mdfeBuilder.ts` | 500 | Biblioteca de regras/utilitários; separar responsabilidades por domínio |
| `src/pages/FiscalDocuments.tsx` | 499 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/LoadControl.tsx` | 497 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/OccurrenceReports.tsx` | 497 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/Payroll.tsx` | 491 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/lib/documentParsers.ts` | 476 | Biblioteca de regras/utilitários; separar responsabilidades por domínio |
| `src/pages/driver/DriverHome.tsx` | 469 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/loads/PendingDocsGrouping.tsx` | 445 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/IngestionReports.tsx` | 444 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/hooks/useFiscalDocuments.tsx` | 443 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/pages/Orders.tsx` | 443 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/Payables.tsx` | 436 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/hooks/usePalletReturns.tsx` | 432 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/pages/driver/DriverIssues.tsx` | 429 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/hooks/useFreightCalculator.tsx` | 424 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/hooks/useBilling.tsx` | 421 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/pages/Vehicles.tsx` | 418 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/Alerts.tsx` | 414 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/lib/fiscal/nfseBuilder.ts` | 406 | Biblioteca de regras/utilitários; separar responsabilidades por domínio |
| `src/pages/NFSe.tsx` | 405 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/loads/ManifestPanel.tsx` | 403 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/ProductHistory.tsx` | 392 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/hooks/useImportedNotesSummary.tsx` | 381 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/pages/PodHistory.tsx` | 380 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/loads/CTeWorkbench.tsx` | 378 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/Incidents.tsx` | 374 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/hooks/useCteMonitor.tsx` | 373 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/lib/closingReports/closingReportBuilder.ts` | 371 | Biblioteca de regras/utilitários; separar responsabilidades por domínio |
| `src/pages/ProductTraceability.tsx` | 357 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/hooks/usePayroll.tsx` | 355 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/hooks/useRuralClients.tsx` | 350 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/components/fiscal/OrtGeracaoTab.tsx` | 345 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/components/financial/NewInvoiceWizard.tsx` | 343 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/hooks/useIssueCTe.tsx` | 342 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/pages/ClosingReports.tsx` | 342 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/Dashboard.tsx` | 342 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/hooks/useOccurrenceReports.tsx` | 340 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/pages/driver/DriverExpenses.tsx` | 340 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/CostCenters.tsx` | 338 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/IntegrationHealth.tsx` | 333 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/FleetMap.tsx` | 332 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/ingestion/ClientContactPicker.tsx` | 331 | Componente; avaliar extração de formulários, regras e subcomponentes |
| `src/pages/LoadExtractionAudit.tsx` | 331 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/pages/RuralClients.tsx` | 321 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/hooks/useBankReconciliation.tsx` | 314 | Hook de acesso/estado; separar consultas e mutações por caso de uso |
| `src/pages/OperationsDashboard.tsx` | 313 | Página; avaliar extração de consultas, regras e seções da interface |
| `src/components/ui/chart.tsx` | 303 | Componente; avaliar extração de formulários, regras e subcomponentes |

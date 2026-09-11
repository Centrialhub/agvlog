# App Motorista — manifesto de homologação hospedada

Data de corte: 10/09/2026. Projeto principal observado: `qcvnsdrbcchaxvawcngk`.

Este documento é um manifesto de **branch de homologação**, não uma autorização
para alterar produção. O histórico remoto mudou em paralelo e já contém parte das
fundações de workspace/SSX; por isso a execução deve comparar versões e aplicar
somente arquivos ausentes.

## Estado remoto observado

- projeto `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.084;
- nenhuma branch de desenvolvimento;
- histórico remoto até `20260910221838_harden_dispatch_planned_route`, com
  implantação seletiva e lacunas entre versões;
- SSX poll/telemetry/units, dispatcher e fila geral estão publicados;
- geocodificação, canhotos, e-mail, OCR e portais do App Motorista não estão publicados;
- entidades canônicas de canhoto, conflito/snapshot fiscal, carga, geocodificação
  e lotes de e-mail não existem no banco remoto.

## Migrations candidatas ausentes

Executar na ordem abaixo somente na branch, deixando cada precondition/postcondition
falhar fechada. Se a branch mostrar uma dependência ausente fora desta lista, parar
e revisar o grafo em vez de aplicar uma migration de outro módulo por aproximação.

1. `20260910131419_driver_delivery_receipt_foundation.sql`
2. `20260910132149_require_driver_arrival_gps_cutover.sql`
3. `20260910134223_physical_driver_journeys.sql`
4. `20260910134820_enforce_one_running_trip_per_driver.sql`
5. `20260910134948_finance_canonical_trip_cost_settlement.sql`
6. `20260910141902_add_delivery_receipt_pdf_access.sql`
7. `20260910142606_driver_trip_cargo_custody_cycle.sql`
8. `20260910142613_driver_geocoding_geofence_tracking.sql`
9. `20260910143355_driver_physical_journey_payload.sql`
10. `20260910143433_add_delivery_receipt_email_batches.sql`
11. `20260910154758_driver_operational_offline_commands.sql`
12. `20260910154811_complete_delivery_receipt_operations.sql`
13. `20260910154838_address_resolution_tracking_operations.sql`
14. `20260910160603_preserve_delivery_receipt_scan_integrity.sql`
15. `20260910170631_add_delivery_receipt_supplier_pdf_profiles.sql`
16. `20260910170901_harden_delivery_geofence_scope.sql`
17. `20260910174335_add_delivery_receipt_ocr_queue.sql`
18. `20260910181353_add_delivery_receipt_quality_policies.sql`
19. `20260910181420_add_delivery_receipt_supplier_channels.sql`
20. `20260910182124_enforce_driver_delivery_gps_and_refusal_evidence.sql`
21. `20260910182454_auto_arrive_driver_stop_from_delivery_geofence.sql`
22. `20260910182855_complete_delivery_receipt_physical_return_workflow.sql`
23. `20260910183025_extend_delivery_receipt_operational_filters.sql`
24. `20260910190649_enforce_driver_delivery_receipt_evidence.sql`
25. `20260910190950_harden_geofence_tracking_completion.sql`
26. `20260910191008_harden_trip_cargo_custody_integrity.sql`
27. `20260910191452_support_nfse_only_delivery_receipts.sql`
28. `20260910192455_complete_address_geocoding_automation.sql`
29. `20260910192744_canonicalize_delivery_receipt_email_filename.sql`
30. `20260910193642_driver_app_observability.sql`
31. `20260910194438_complete_trip_cargo_seal_lifecycle.sql`
32. `20260910194846_harden_fleet_geofence_editing.sql`
33. `20260910195852_preserve_geofence_fast_pass.sql`
34. `20260910203617_ssx_mapping_conflict_review.sql`
35. `20260910204500_delivery_receipt_email_history.sql`
36. `20260910204602_ensure_nfse_only_delivery_receipt.sql`
37. `20260910211000_canonical_destination_geocoding_idempotency.sql`
38. `20260910211200_driver_delivery_fiscal_snapshot_gate.sql`
39. `20260910211800_canonical_trip_cargo_close_gate.sql`
40. `20260910213021_reconcile_legacy_cargo_gate_and_service_delivery_adapters.sql`
41. `20260910213156_quarantine_legacy_settlements_until_cargo_close.sql`
42. `20260910220847_finance_cargo_expense_active_movements.sql`
43. `20260910221301_decouple_ssx_dispatcher_from_address_tracking.sql`
44. `20260910223000_harden_ssx_mapping_conflict_active_tenant.sql`

A comparação deve usar a versão numérica, não apenas a maior migration remota,
porque o histórico atual é seletivo. Migrations financeiras fora do grafo acima
não pertencem automaticamente ao App Motorista.

## Edge Functions

Publicar na branch:

- `geocode-address`;
- `process-address-resolution-queue`;
- `send-delivery-receipts`;
- `delivery-receipt-email-webhook`;
- `process-delivery-receipt-ocr`, mantendo o adaptador desativado até decisão;
- `process-delivery-receipt-portals`, mantendo sem caminho de sucesso até existir
  adaptador homologado;
- versões locais alteradas de `ssx-poll-positions`, `ssx-sync-telemetry`,
  `ssx-sync-units`, `agvlog-run-queue` e `agvlog-ssx-dispatcher`.

`verify_jwt=false` só é aceitável para workers/webhooks que validem internamente
segredo, assinatura ou invocação privilegiada. Essa propriedade deve ser verificada
função por função na branch.

## Gates da branch

1. Todas as migrations candidatas aplicadas uma vez e replay sem efeito duplicado.
2. Testes de RLS com `anon`, `authenticated`, tenant ativo incorreto e
   `service_role`.
3. Testes multissessão dos locks fiscais e de carga, incluindo SQLSTATE `40001`.
4. NF-e, NFS-e, misto e ausência de CT-e no writer real.
5. Upload, PDF, download auditado, e-mail, webhook, bounce e reenvio.
6. Worker de geocodificação, endereço ambíguo, correção por mapa e rematerialização.
7. SSX paginado, fast-pass, histerese, tracker ambíguo e saúde indisponível.
8. Advisors de segurança/desempenho comparados com o baseline anterior.
9. Build HTTPS apontado apenas à branch e E2E do motorista/operacional.

Somente depois desses gates a mesma cadeia pode ser proposta para produção, em
janela controlada e com plano de rollback forward-only.

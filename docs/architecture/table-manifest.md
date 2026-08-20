# Manifesto Versionado de Tabelas AGVLog
**Versão:** 1.0.0
**Data:** 2026-08-20

Este manifesto classifica cada tabela do banco de dados pública de acordo com seu papel arquitetural.

## Tabelas Canônicas (SoT Operacional)
*   `clients`: Cadastro central de clientes (CNPJ/CPF).
*   `cost_centers`: Centros de custo para rateio.
*   `dispatch_stops`: Paradas operacionais em rota.
*   `dispatch_stop_documents`: Relação NF x Parada.
*   `dispatch_trips`: Viagens operacionais (despacho).
*   `dispatch_trip_loads`: Vínculo Carga x Viagem.
*   `drivers`: Cadastro de motoristas.
*   `employee_contracts`: Contratos de RH.
*   `employees`: Cadastro de funcionários.
*   `financial_obligations`: Base de contas a pagar/receber.
*   `fiscal_documents`: Documentos fiscais recebidos/processados.
*   `geofences`: Cerca eletrônica para monitoramento.
*   `load_items`: Composição real da carga (Itens/NFs).
*   `loads`: Cabeçalho da carga.
*   `operational_events`: Ocorrências e log de status.
*   `operational_routes`: Cadastro de rotas.
*   `payables`: Contas a pagar efetivadas.
*   `payroll_periods`: Períodos de folha de pagamento.
*   `proof_of_delivery`: Comprovações de entrega (POD).
*   `receivables`: Contas a receber efetivadas.
*   `vehicles`: Cadastro de frota.

## Tabelas de Integração (Externas)
*   `bank_transactions`: Dados importados de extrato.
*   `cte_documents`: Espelho de CT-es (SEFAZ/Hub).
*   `hub_fiscal_emissions`: Logs de transmissão Hub Fiscal.
*   `nfse_documents`: Notas de serviço emitidas.

## Tabelas de Telemetria e Monitoramento
*   `events`: Eventos brutos de rastreador.
*   `positions_raw`: Posições GPS brutas.
*   `telemetry_observations`: Sinais processados.
*   `trips`: Fragmentos de movimento GPS.
*   `vehicle_events`: Ignição, velocidade e sensores.

## Tabelas Espelho e Projeções
*   `client_regions`: Projeção de clientes por zona.
*   `metrics_daily`: Agregados diários para dashboard.
*   `positions_last`: Última posição conhecida (Cache).
*   `vehicles_state`: Estado atual consolidado da frota.

## Tabelas de Sistema e Auditoria
*   `entity_audit_log`: Log de auditoria de mutações.
*   `profiles`: Perfis de usuário (Auth metadata).
*   `tenants`: Isolamento multi-tenant.
*   `tenant_memberships`: Controle de acesso por tenant.

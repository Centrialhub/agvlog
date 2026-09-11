# Ensaio integrado do bloco financeiro013543–132406 — 2026-09-10

Resultado final:1teste de integração PGlite aprovado,2,99s/exit0. Lint passou antes do último alinhamento dos helpers reais de autorização (sem alteração das interfaces TS). Arquivos src/test/helpers/financeForwardBlockDatabase.ts e src/test/financeForwardBlockIntegration.test.ts. Manifesto completo com62arquivos eSHA256: finance-forward-block-integration-manifest-2026-09-10.json. Não houve PostgreSQL nativo, TSC ou escrita remota.

## Cobertura efetivamente executada

Preparação usa cadeia operacional real dos helpers até183929, instala192908 inteiro, revisões/criação de despesas, DDLbaseline real de folha/pagáveis e funções legadas reais que serão aposentadas. Autorizadores internos são definições reais atuais extraídas164442, sem executar sua migração global. Ajustes usam rollout compatível ao hash682f, seguido das fronteiras financeiras reais e policy interna semmotoristas. Foundation, custos, extratos, pagáveis e fiscal são scripts reais completos.

O intervalo solicitado tem29arquivos financeiros; TODOS foram aplicados em ordem, semcap ouseleção por sucesso.011121 usa rolloutversionado20260910231716 e025658 usa20260910232134, ambos cópias exatas dos compatíveis testados. Chega até132406, sem instalar correções posteriores que poderiam ocultar problema intermediário.

Após instalar: gera fatura por apply_client_invoice_command vigente, registra recebimento, corrige alocação, reutiliza a MESMAentrada. Snapshot apresenta recebido1000centavos sem requires_reconciliation; finance_movements continua1. Executa generate_payroll_period real com período sem empregados, alcança dedup132406 e flush das constraints diferidas. Não afirma provar folha remuneratória populada nesta rodada.

## Falhas encontradas durante construção

- Faltavam _recalc_payable_paid e create_manual_expense e demais writers aposentados na fixture. Foram instaladas definições baseline reais, sem funções que retornem sucesso artificial.
- Faltavam tabelas payroll_generation_issues/employee_contracts/employee_incident_actions lidas pelo gerador. Instalado DDLbaseline real.
- createFinancialScenario antigo chamava generate_client_invoice_from_closing aposentado por192908. Guard recusou corretamente. Troca do teste para createInvoiceScenario atual usa comando auditado real; nenhuma permissão foi reaberta.

Nenhuma falha adicional de produto foi reproduzida no caminho final acima. Compilação de PL/pgSQL não executa todos os ramos; não equivale a homologar todos os comandos do bloco.

## Limites explícitos

Não é ensaio da cadeia integralSupabase. Cinco arquivos operacionais existentes no intervalo ficam fora:125751workspace,131125activecontext,131419driverreceipt,132033RLS e132149GPS. São de outra frente/remoto e não foram fingidos como aplicados. A fixture herda Auth/Storage sintéticos e subconjuntos de constraints baseline; não testa provider, StorageAPI, cron real ou UI.

Worker12756 foi instalado integralmente. Sem schema cron, segue seu caminho explícito de NOTICE; não há cron.schedule falso, não executamos serviço nem job. O teste não comprova política de agendamento/pausa em produção. Financecan_access real está habilitado somente nafixture para exercer comandos; não provaativação do remoto. Nenhuma rotina de reset/remoto foi executada.

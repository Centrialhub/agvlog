# Fluxo de descargas — suplemento PostgreSQL nativo

2026-09-10: **3 casos passaram em PostgreSQL 17.11**, sessão 85640 saída 0, servidor descartável encerrado. Nenhum SQL de produto alterado e nenhum acesso remoto.

- Migration 203516 SHA256 `12b288b8809da09d3dda8e3ee2c323b32e4defcc5650af25b6cc915ba436a2ae`, conferido antes da instalação.
- Pacote 193723 SHA256 `685ce9177c4e3b5202d7ac9e6eb13cd4f5963db001a14c16204b23290b624adf`.
- Runner: `scripts/test-finance-period-unloading-native-cases.mjs`.
- Comando: `PG_QA_SUITE=finance-period-unloading node --experimental-strip-types scripts/test-delivery-concurrency.mjs`.
- Log: `node_modules/.cache/qa-postgres/finance-period-unloading-native-2026-09-10.log`.

## Provas

1. Contexto real da entrega e record_finance_unloading geram descarga 150 e título do fornecedor. Movimento PIX 300 recebe alocação 100 da descarga e 200 de frete por comandos reais. A parcela de frete é inicialmente 150 e depois acrescida de 50: revisão do fluxo muda, mantendo inalterado o total recebido da descarga. Assim um claim de outro título no mesmo movimento entra no controle global, não apenas linhas do fornecedor.
2. Extrato sintético, conciliação, abertura, aprovação de cobertura, revisão do corte e **close_finance_account_period real** produzem fechamento bancário. Parser periodMoneyPackageSchema comprova entrada 300; periodUnloadingFlowSchema comprova origem 150 e recebido 100, um money_link de 300 com allocated_event_cents 100 e closure_id exato. Reabertura real muda revisão e remove money_covered, preservando recebimento 100 registrado.
3. Tenant estrangeiro e papel misto motorista são rejeitados. Após obter revisão, revogar acesso atual impede a consulta de página posterior com aquela revisão.

## Limites

O runner reutiliza as funções e adaptação da factory `unloadingBankPackageDatabase.ts`, incluindo corpos reais dos comandos de recebimento e os helpers reais de fechamento. A entrega/NF e metadados do recibo são sintéticos locais, mas a determinação de fornecedor e criação da charge ocorrem pelo writer real. Nenhum fechamento fictício ou guard desativado produz os resultados positivos.

A plataforma Supabase completa, Storage e autenticidade do extrato não são demonstrados: tabela Storage/evidência bancária pertencem à fixture restrita. Algumas FKs operacionais externas foram omitidas na base dessa fixture. Não é ensaio de instalação integral, upgrade remoto ou visão histórica de saldo a receber.

Suplemento deliberadamente pequeno: não repete as 1005 origens, devoluções e casos de correção já exercitados pelo autor em PGlite. Verifica a ponte central entre origem, alocação e dinheiro congelado, a dependência de outro título e a reabertura real.

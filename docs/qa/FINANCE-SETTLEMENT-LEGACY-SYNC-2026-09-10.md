# Integração com sincronização legada de obrigações

2026-09-10. Teste local: `src/test/financeSettlementLegacySync.test.ts`.

## Dependências exercitadas

O teste parte do helper do comando canônico e instala formatos, defaults e constraints reais da baseline para bank_transactions, receivables, driver_expenses e financial_obligations, incluindo índice único de origem da obrigação. Instala as definições reais de sync_financial_obligations e seus triggers de acerto, pagamento, pagável e despesa. Aplica a mesma proteção financeira da migration 235237 especificamente à rotina sync; evita reexecutar wrappers antigos sobre os wrappers de folha mais novos já instalados pelo helper.

A migration 124258 conserva expressamente sync_financial_obligations para esses triggers. Não foi substituída por stub. O comando, vínculos, reversões, lifecycle e cutoff são os mesmos instalados no helper integrado.

## Resultado material: saldo legado defasado no pagamento parcial

Reprodução mínima: acerto aprovado de R$ 500; saída canônica de R$ 500; registrar parcela de R$ 300.

| Registro | Resultado observado |
| --- | --- |
| driver_settlements | total_paid_amount = 300; payment_balance = 200; status = approved |
| financial_obligations | amount_matched = 0; open_balance = 500; status = pending; matching_status = unmatched |
| finance_movements | Uma saída original de R$ 500 |
| driver_settlement_payments | Um pagamento de R$ 300 |
| bank_transactions | Nenhuma linha |

O AFTER INSERT do pagamento chama sync antes de o comando atualizar os totais do acerto. O AFTER UPDATE do acerto só refaz sync quando status ou driver_payable_amount mudam; total_paid_amount isolado não atende a condição. Como uma parcela mantém approved, a obrigação legada continua no valor anterior. Replay não corrige essa projeção, pois corretamente retorna o comando já confirmado sem repetir efeitos.

Evidência de código: baseline `sync_financial_obligations` começa na linha 7860 e lê total_paid_amount; `_tg_sync_obligations_from_settlement` começa na linha 8787 e condiciona a sincronização a status/dívida; `_tg_sync_obligations_from_settlement_payment` começa na linha 8805. Nenhuma alteração em 33421 foi feita nesta revisão.

## Outras conclusões verificadas

- Pagamento integral de R$ 500 produz obrigação legada paid/matched sem qualquer extrato bancário. Esse matched continua sendo heurística histórica; não é confirmação bancária do módulo novo.
- Sync faz upsert por origem e não duplica a obrigação em replay. Não cria caixa ou custo canônico.
- Correção/reversão de vínculo preserva pagamento, movimentação, total pago do acerto e obrigação legada; replay do pagamento mantém a resposta histórica.
- Sync pode projetar também recebíveis, pagáveis e despesas da mesma janela. No cenário testado não modifica os títulos de origem nem cria outro pagamento ou outra despesa.
- Não ocorreu rejeição por schema/status nas fixtures válidas com constraints reais da obrigação.

## Verificação e encaminhamento

Cinco testes SQL de caracterização passaram em PGlite. O teste de defasagem documenta um defeito reproduzido; seu resultado verde não afirma que essa inconsistência está corrigida.

O coordenador foi informado antes de qualquer correção. A solução deve atualizar ou aposentar a projeção legada sem promover matched a prova bancária, preservando dinheiro e histórico. Evitar simplesmente tratar como saldo de extrato. Este teste não substitui ensaio da cadeia completa de implantação ou concorrência nativa integrada.

## Correção escolhida após inventário de consumidores

Migration `20260910135125_finance_retire_bulk_obligation_projection.sql`, criada pela CLI. A correção foi retirar a projeção em lote do caminho operacional, preservando sua história, em vez de perpetuar o matched baseado apenas em pagamento interno.

Inventário local realizado em src, supabase/functions e migrations:

- `useFinancialObligations` e o join de sugestões em `useBankReconciliation.tsx` são usados pela seção **Histórico anterior** de `BankReconciliation.tsx`; essa seção já informa que os status antigos não certificam conciliação.
- Demais referências de hooks são invalidações de cache. Nenhum consumidor de frontend/Edge chama sync_financial_obligations.
- A revisão de despesas ainda precisa de financial_obligations por ID de origem, para impedir alterar/rejeitar uma despesa já projetada. Essa dependência é preservada. A migration 20260830203548 já substituiu o trigger de despesa por uma inserção unitária da despesa aprovada da empresa, sem sincronização em lote e sem inferir pagamento/conciliação.
- O catálogo remoto foi consultado somente para leitura. A referência textual a sync aparece em quatro callbacks da baseline: despesa, pagável, acerto e pagamento. Na cadeia candidata, o callback de despesa já é unitário; restam os outros três.
- O catálogo também expõe approve_financial_obligation_v1 e reverse_financial_obligation_v1, sem consumidores encontrados em src/Edge. Esses comandos históricos e a tabela não são removidos nesta alteração. O inventário textual não prova ausência de clientes externos ou SQL dinâmico.

A migration substitui o corpo dos três callbacks de lote por retorno sem projeção e desativa chamadas diretas ao synchronizer com erro específico e revogação de execução. Preserva OIDs, assinaturas, defaults, ligações dos triggers e todas as linhas existentes. Não altera 33421, dinheiro, pagamentos, títulos, despesa, painel frontend ou o writer unitário de despesa.

Pré-condições impedem retirar uma dependência sem substituição: o writer de despesa precisa já conter a proteção por review_command_id e não pode chamar bulk sync; qualquer outra rotina dependente não inventariada provoca erro de migration. Assim uma instalação ainda só na baseline não recebe esta retirada isoladamente.

## Verificação posterior à correção

Nove testes SQL passaram, incluindo os cinco de caracterização anteriores e quatro de aposentadoria integrada. Confirmam preservação de OIDs e triggers, igualdade do histórico antes/depois da migration, pagamento + replay + reversão sem mudar o histórico, ausência de novas obrigações para pagamentos novos e manutenção da obrigação unitária de despesa (unmatched) com rejeição de alteração indevida. Uma dependência de teste desconhecida impede a retirada; o callback antigo de despesa sem substituição também impede. ESLint e TypeScript passaram.

As obrigações antigas não são recalculadas nem apagadas: a seção histórica mantém seus valores como história, enquanto acertos e títulos canônicos seguem como fontes operacionais. A revisão de despesas continua protegida por suas obrigações explícitas. Ensaio integral de deployment e eventual migração desse último consumidor operacional continuam pendentes.

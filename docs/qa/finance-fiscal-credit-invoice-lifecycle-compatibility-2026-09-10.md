# Compatibilidade de créditos fiscais com ciclo de faturas192908

10/09/2026. Falha original011121: finance_credit_snapshot_contract_changed, transação desfeita no remoto conforme coordenador. Causa não é wrapper235237:192908 move o cálculo monetário do snapshot para _receivable_ledger_evidence e já trata open_cents0 no cancelamento. Reaplicar soma inline183929 apagaria esse contrato mais recente.

Artefato completo local: supabase/rollouts/finance_fiscal_cancellation_credits_invoice_lifecycle.sql. SHA25624858ffa8ab16a1dae0a4e51d7249561e89f2975dacc8f82bd2797bc2a53a6a3. Não é migrationoriginal editada, nem aplicado por este agente. Root criará versão final viaCLI se necessário.

A única alteração estrutural do011121 está no patch do snapshot: verifica sourceMD5 exato516278d4049bbadeed1f2b94e4f020b9 do ledger e7e78a142d1eabad9c5e503c198f38fa5 do snapshot192908, ambos invoker e semEXECUTEauthenticated/anon/service. O root confirmou os dois no remoto. Exclusão de créditos modifica somente sumNET no ledger; mantém count, validação de valores/conta/evidência/créditos e reversões existentes. Snapshot recebe credit_id no histórico e mantém todas as regras atuais de grafo/cancelamento. DDL/RLS/ACL, recalc/guard e processador de crédito são os originais restantes.

Testes próprios em financeFiscalInvoiceLifecycleCompatibility.test.ts:2PGlite passaram20:16:46, saída0. Fixture usa183929 real e instala ledger+snapshot reais192908; instalaçãofiscal004550/005509/010034/compat011121/012152. CT-e autorizado gera título pelo processador real; comando real recebe10; cancelamento confirmado+replay mesmaobservação cria1crédito sem excluir pagamento e mantém1banktransaction. Ledgernet0/paymentcount1/validtrue; snapshotreceived/open0/can_receivefalse/semdivergência. Segundo caso recusa reaplicação e verifica helperprivado semgrant. ESLint dosdoisarquivos passou. Não é ensaio de todoDDL192908 nem sessãohosted; limites dafixtureoperacional herdada permanecem.

012152 foi aplicado completo nafixture sem adaptação. Próximo025658 também pressupõe suminline antigo: bancoagente prepara sua compatibilidade separada no mesmoledger, preservando exclusãocredits; não aplicar025658original semessa revisão.

Nenhum PGnativo,TSC ou escritor remoto por este agente; nenhum processo ativo.

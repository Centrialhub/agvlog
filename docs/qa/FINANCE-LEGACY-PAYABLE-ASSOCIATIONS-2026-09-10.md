# Associação de pagamentos antigos de pagáveis

Core: `20260910143833_finance_legacy_payable_associations.sql`, criada pela CLI. Sem aplicação remota, geração de dinheiro, novo pagamento ou alteração da baixa legada. Consulta de seleção `43920` pertence à integração do root; UI e ensaio nativo têm relatórios próprios.

## Contrato de comandos

`associate_finance_legacy_payable_payment({_payload:{version:1,tenant_id,request_id,payment_id,movement_id,revision,reason}})`.

Revision obrigatória de 32 hex é obtida da consulta/helper `finance_private.legacy_payable_source_revision(tenant,payment)`. Representa snapshot determinístico de payment + payable + bank_transaction. Depois dos locks o comando exige revisão igual, impedindo associar um valor ou origem alterados desde a seleção do usuário. Alteração retorna `finance_legacy_payment_changed` (40001), sem writes parciais. Não inclui heurística por valor/data: esses campos validam a seleção explícita por IDs.

Retorno: `version,tenant_id,request_id,payment_id,payable_id,movement_id,link_id,amount_cents` string, `bank_transaction_id` UUID ou null, `origin:legacy_adoption,cash_created:false,payment_created:false,confirmed:true`.

`reverse_finance_legacy_payable_association({_payload:{version:1,tenant_id,request_id,link_id,reason}})` retorna `version,tenant_id,request_id,link_id,payment_id,payable_id,movement_id,reversal_id,released_cents` string, `origin:legacy_adoption,cash_changed:false,payment_changed:false,confirmed:true`.

Payloads estritos, motivo 10–2000 caracteres. Autoria vem da sessão, nome/motivo/tempo persistidos; motorista e perfil misto negados. Replay compara ator/ação/payload e retorna o resultado original antes de consultar estado mutável, sem refazer associação/reversão.

## Validações e preservação

- Payment e título no tenant, conta identificada no tenant, amount positivo/finito e centavos integrais até 99999999999999, data finita.
- Movimento existente de saída, sem natureza transfer, conta e dia de São Paulo iguais ao pagamento. Driver do título, quando preenchido, deve coincidir. Quantia integral do pagamento alocada, podendo compartilhar uma saída maior com outros usos válidos.
- Bank transaction legado, quando não null, permanece no pagamento. Exige tenant/conta/debit/valor/dia coerentes. Null é preservado e não é tratado como prova bancária ausente preenchida automaticamente.
- Bank transaction também referenciado por outro pagamento de pagável, recebível, devolução, carga ou vínculo canônico de recebível é ambíguo e bloqueado; não inferir rateio entre fontes.
- Título cancelado com pagamento real pode receber associação; não altera status/custo ou transforma o dinheiro em obrigação nova. Histórico canônico de pagamento não é elegível para adoção, inclusive depois de reversão canônica.
- Finance lock → título → payment → bank transaction; reautorização após esperas. UPDATE/DELETE de bank transaction adotada fica bloqueado, inclusive depois de reverter a associação; histórico permanece íntegro. Guard legado usa try-lock para evitar espera em ordem invertida, retornando concorrência retryable quando finance está ocupado.

## Capacidade e reversões distintas

Reusa `finance_payable_movement_links`, acrescentando origin canonical (default histórico) ou legacy_adoption, reason, actor_name e source_snapshot. A capacidade continua pelo mesmo `movement_used_cents` consumido por despesas/pagáveis/acertos; não acrescenta uma segunda reserva fora desse livro.

Unique global payment_id foi substituído por unicidade ativa sob finance guard. Histórico canônico nunca permite associação por outra origem. Legacy permite reassociação apenas após reversão da associação ativa, mantendo todas as linhas.

`active_payable_payments` passa a retirar somente pagamentos com reversão de link canonical. Reverter legacy libera apenas a capacidade do movimento; pagamento/título/caixa continuam intactos, incluindo agregados de folha e adiantamentos. A reversão canônica recusa origin legacy e a dedicada recusa canonical.

`get_finance_payable_payment_history` preserva uma linha por payment e paginação/total anteriores, selecionando link ativo ou último por lateral. Acrescenta `link_origin` para UI escolher ação correta. O histórico completo de associações é exposto pela nova consulta de adoção; não somar cada associação histórica como pagamento adicional.

Inventário `legacy_adoption_candidates` exclui a fonte exata enquanto associação legacy estiver ativa; após reversão a pendência reaparece. Links canônicos continuam excluindo o pagamento também após reversão, pois nesses casos o pagamento é uma alocação anulada, não dinheiro antigo não adotado. Soma de pagamentos de adiantamento desconsidera somente reversões canonical, preservando dinheiro legado já pago.

Eventos manuais: `legacy_payable_associated`, `legacy_payable_association_reversed`. Ambos entram no filtro manual; pagamento, título, bank transaction e recibo antigos não são atualizados. Source snapshot contém os dados antigos para auditoria.

## Erros para integração

Além de `finance_access_denied`, `finance_invalid_payload` e `finance_request_conflict`:

- `finance_legacy_payment_changed` — refazer seleção por revisão desatualizada.
- `finance_legacy_payment_not_found`, `finance_legacy_payable_not_found`.
- `finance_legacy_payment_amount_invalid`, `finance_legacy_payment_date_invalid`, `finance_legacy_payment_account_invalid`.
- `finance_legacy_payment_not_eligible`, `finance_legacy_payment_already_associated`, `finance_payment_already_linked`.
- `finance_legacy_bank_source_mismatch`, `finance_legacy_bank_source_ambiguous`.
- `finance_invalid_payment_movement`, `finance_legacy_movement_mismatch`, `finance_movement_overallocated`, `finance_payment_link_mismatch`.
- `finance_legacy_association_not_found`, `finance_legacy_association_already_reversed`, `finance_legacy_association_requires_own_reversal`.
- `finance_adopted_bank_source_immutable`, `finance_bank_source_concurrent_change` (40001).

## Verificação

`src/test/financeLegacyPayableAssociations.test.ts`: 15 testes SQL passaram com fixture compartilhada `src/test/helpers/legacyPayableAssociationDatabase.ts`. Usa tabelas baseline reais, comandos reais de pagamentos/reversões e agregados; FKs não relevantes dos recebíveis são omitidas. O ensaio nativo separado instala o cutoff real e semeia antigos antes dele.

Cobertura SQL: preservação completa de fonte/título/recibo/caixa, replay/auditoria, reversão e reassociação sem duplicar histórico, canonical vs legacy, pagamento de título cancelado, banco null, tenant/perfis, data UTC vs São Paulo, banco divergente, imutabilidade após reversão, NaN/zero/negativo representáveis na baseline, banco compartilhado entre fontes, revisão alterada, rollback de falha de auditoria e adiantamento após reversão. Numerics baseline com typmod rejeitam Infinity/overflow ou arredondam escala na própria entrada; comando ainda valida finitude/centavos antes de converter.

ESLint e TypeScript: exit0. Regressões independentes de deduplicação da folha (17) e comando de acerto (26) passaram. A fixture antiga de histórico de pagável precisou da atualização de contrato link_origin feita na integração de UI/root, pois originalmente terminava antes desta migration.

SHA256 core após adicionar revision e ambiguidade entre fontes: `2948e859d766cbff838a170ab288b543bf0d133412e9ba526d1f7fdb3125e529`.

O [ensaio nativo independente](finance-legacy-payable-association-native-2026-09-10.md) passou 12 testes no hash final acima, incluindo concorrência com os três escritores de capacidade, replay/reautorização e erro 40001 após fonte alterada durante espera comprovada. Processo exit0 e cluster descartável encerrado.

Limites: essa associação resolve exclusivamente um payment ID selecionado. Não declara adoção global concluída, não reconcilia extrato, não certifica conta/período, não regulariza recebíveis/fiscal/fontes com conta desconhecida. Novos writers de referências legadas devem preservar a mesma disciplina de serialização e revisão; não há autorização para criar transações bancárias.

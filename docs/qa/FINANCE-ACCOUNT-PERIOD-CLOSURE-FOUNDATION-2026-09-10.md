# Fechamento bancário: foundation e guardas reais

Implementação local em `20260910162807_finance_account_period_closure_foundation.sql` e `20260910163109_finance_account_period_closed_source_guards.sql`. Nenhuma aplicação remota. O produtor de snapshot/preview 62958 pertence à integração principal; classificador/revisão de legado 63116 e ensaio integrado pertencem à validação independente.

## Foundation

Tabelas append-only de fechamentos, reaberturas e dependências, com RLS financeira e sem DML para papéis da aplicação. Fechado significa ausência de reabertura. Snapshot e revisão não são sobrescritos. Uma nova conclusão após reabertura aponta `previous_closure_id`; períodos subsequentes apontam `predecessor_id` e preservam a mesma abertura.

O primeiro período começa exatamente em `effective_from` da abertura ativa da mesma conta/empresa. O seguinte começa no dia posterior ao fechamento ativo mais recente. O banco rejeita sobreposição, lacunas e reabertura de predecessor com descendente ativo. Datas são dias ISO finitos, intervalo terminado, até 366 dias inclusivos. Comandos não processam fiscal, folha ou acerto.

`can_close_account_period` compõe `can_access` com membership ativa owner/admin. Operador pode consultar, motorista/perfil misto fica excluído. A integração 62958 concede leitura da capacidade como booleano para authenticated. Autorização é repetida após trava financeira e após espera nas contas. Replay exige ator/ação/payload iguais e acesso atual, inclusive depois de uma reabertura.

`close_finance_account_period`: payload versão/empresa/request/conta/from/to/revision/motivo. Recalcula snapshot sob finance, exige revisão atual, eligible=true, todos os guards instalados e dependência da abertura; grava fechamento/dependências/evento/comando atomicamente. Tickets internos de uso único vinculam INSERT ao comando, transação e ator.

`reopen_finance_account_period`: versão/empresa/request/closure_id/revision/motivo. Revisão é a do snapshot fechado, não a prévia atual que pode estar bloqueada. Insere reabertura e evento; sem cascata, sem modificar dinheiro ou snapshot.

## Matriz dos guardas 63109

| Família | Proteção aplicada |
|---|---|
| finance_movements | Conta/dia real; captura comandos indiretos e impede retroatividade em dia fechado. |
| finance_bank_entries | Conta/data bancária e importação de origem. |
| finance_statement_imports/rows | Intervalo monetário declarado e referências reais import/entrada; novas linhas retroativas são bloqueadas. |
| finance_statement_verifications | Dependências/import usado; período nativo e âncora efetiva do report são verificados, não se presume que todo period_start-1 seja âncora bancária. |
| identity_reviews/review_reversals | Resolve linha/entrada/revisão original; a data da reversão não esconde evidência fechada. |
| reconciliation_groups/reversals | Todos os IDs dos movimentos e entradas bancárias, ou grupo original. |
| coverage_approvals/reversals; period_evidence_reviews | Intervalo e evidência/decisão original. |
| account_openings/reversals | Abertura usada, conta e intervalo afetado; descendentes continuam dependendo dela. |
| bank_accounts | Identidade e exclusão da conta fechada; também nova identidade duplicada na empresa. Nome/rótulo pode mudar. |
| bank_transactions | OLD e NEW conta/data, além de dependências explícitas. |
| receivables/payables/settlement payments, closing/load payments | Conta/data de dinheiro e referências bancárias; desconhecidos retroativos exigem revisão, não são distribuídos entre contas. |
| receivable_payment_reversals | Nova perna pelo effective_at/bank_transaction; devolução futura não modifica nem bloqueia por si a referência ao recebimento antigo. |
| employee_advances | Fonte efetivamente paga; adiantamento pendente sem paid_at não é tratado como saída realizada. |
| payroll_entry_items | Somente nature already_paid; remuneração/composição comum permanece editável. Guard ainda conservador para projeção monetária histórica. |
| transfers/departures | Perna real e vínculo. Chegada posterior permitida quando saída em trânsito já estava identificada na dependência congelada, destino exato e chegada posterior ao corte. |
| legacy_cut_reviews | Trigger instalado pela migration 63116; revisão nova de período fechado exige reabertura. |
| storage.objects | Retenção real já existente de originais e recibos. guards_ready exige ambos os triggers ativos; reabertura não libera exclusão. |

Triggers residuais usam try-lock financeiro e erro 40001 em vez de esperar com ordem inversa. UPDATE verifica OLD e NEW. Dependências congeladas são resolvidas por tabela/ID, excluindo papel `composition_snapshot` da proibição genérica.

## Extrato do mês seguinte

Importação com intervalo monetário futuro é permitida. A verificação nativa bloqueia declaração de intervalo retroativo. Se houver âncora na borda fechada, ela só é aceita como informação corroborativa quando data é exatamente period_end, centavos são idênticos ao closing_cents congelado, banco/agência/conta/tipo são exatos, moeda BRL, fuso -180 e leitura/hash/identidade nativa foram verificados. Âncora contraditória exige reabertura. O snapshot fechado não é reescrito.

## Verificação concluída nesta frente

`accountPeriodClosedGuards.test.ts`: **10 testes passaram**, ESLint código 0. Fixture usa snapshots históricos inseridos explicitamente com ticket para isolar os guards. Isso não substitui o teste de elegibilidade/fechamento positivo real.

Provas: comando real de movimento retroativo bloqueado e futuro permitido; abertura e identidade protegidas/rótulo editável; extrato/verificação do mês seguinte; âncora igual aceita e contraditória rejeitada; reabertura real com evento/replay; operador e inserção sem ticket rejeitados; transferência real em trânsito chega posteriormente sem alterar saída; OLD/NEW de lançamento legado; predecessor protegido; resolução da perna futura de devolução.

O caso de devolução exercita diretamente o resolver com perna bancária real; não afirma executar o escritor completo de devolução fiscal. Os testes de fechamento positivo, saldo conciliado, classificador durável e concorrência nativa estão sendo integrados separadamente. `eligible=false` por falta desses componentes não é considerado conclusão do trabalho.

## Limites de homologação

O desenho preserva composição posterior e não congela toda a folha. Revisões que alteram dinheiro ou evidência bancária exigem reabertura. A fixture local não substitui banco Supabase completo/Storage nem ensaio de upgrade. Regras não cobertas por fontes conhecidas falham explicitamente em resolução, sem marca de fechamento por clique.

# Aprovação auditada da cobertura de extratos

Migration local `20260910142143_finance_statement_coverage_approvals.sql`, criada pela CLI. Nenhuma aplicação remota. Não altera `statement_period_evidence`, abertura bancária `140010` ou caixa `41240`; apenas estende o filtro manual da auditoria existente, mediante coordenação.

## Significado e limites

A aprovação é conferência humana da origem declarada e completude dos arquivos, com evidência técnica necessária. Não é autenticação criptográfica, certificação do banco nem fechamento. `review_method=reviewed_by_user`, `authenticity_status=not_attested`, `can_close=false` em todas as respostas pertinentes. Não existe caminho que produza `attested_by_bank`.

Exige originais explicitamente declarados como obtidos do banco e período completo; ambas as declarações devem ser boolean JSON exatamente true. Isso não substitui as condições técnicas: conta bancária ativa checking/savings, identidade nativa exata/única, fontes verificadas, dias inteiros cobrindo o intervalo, fuso -180, âncoras únicas, equação de saldo igual e ausência de identidade pendente. O fim precisa ser anterior ao dia atual em São Paulo. Não aprova dia em andamento, cobertura parcial ou saldos contraditórios por mero clique.

Política interna vigente `can_access` se aplica; motoristas, inclusive perfis mistos, excluídos. Ator vem da sessão, nome/motivo e horário são persistidos. Não inventa exigência de segunda pessoa.

## API exata

`get_finance_statement_coverage_review({_tenant_id:uuid,_account_id:uuid,_from:date,_to:date})` retorna:

```text
{
 version:1, tenant_id, account_id, from, to,
 revision:string,
 evidence: StatementPeriodEvidence existente,
 dependencies: objeto de snapshot descrito abaixo,
 blocking_reasons: string[], can_approve:boolean,
 status:'not_approved'|'approved'|'needs_review'|'reversed', current:boolean,
 approval:null|Approval, history:Array<Approval & {reversal:null|Reversal}>,
 review_method:'reviewed_by_user', authenticity_status:'not_attested', can_close:false
}
```

`Approval`: `id,tenant_id,bank_account_id,period_start,period_end,actor_id,actor_name,reason,revision,snapshot,declarations,created_at`. Snapshot é o assessment técnico anterior à incorporação de approval/history/status: envelope, evidence, dependencies, razões, elegibilidade e revision. Declarations contém exatamente `{originals_obtained_from_bank:true,complete_period_confirmed:true}`.

`Reversal`: `id,tenant_id,approval_id,actor_id,actor_name,reason,created_at`.

`current=true` somente se há aprovação não revertida, revision igual à avaliação atual e condições técnicas ainda elegíveis. Dependência alterada torna `needs_review`; é preciso reverter a aprovação ativa antes de renovar. `can_approve=false` enquanto existe aprovação ativa, mesmo com `blocking_reasons=[]`. Ausência de aprovação é `not_approved`; histórico somente revertido é `reversed`. Histórico ordenado por data/ID decrescentes.

`record_finance_statement_coverage_approval({_payload:{version:1,tenant_id,request_id,account_id,from,to,revision,reason,originals_obtained_from_bank:true,complete_period_confirmed:true}})`.

Payload estrito: versão numérica, UUIDs, datas ISO, motivo string com 10–2000 caracteres. Retorno `version,tenant_id,request_id,approval_id,revision,review_method:'reviewed_by_user',authenticity_status:'not_attested',confirmed:true,can_close:false`.

`reverse_finance_statement_coverage_approval({_payload:{version:1,tenant_id,request_id,approval_id,reason}})` retorna `version,tenant_id,request_id,approval_id,reversal_id,confirmed:true,can_close:false`.

Mesma chave/ator/ação/payload retorna o resultado original, inclusive após alteração posterior da evidência. Replay não reafirma validade atual: a consulta determina current. Reversão permanece append-only; nova aprovação mantém o histórico anterior. Nenhuma operação cria ou apaga dinheiro.

## Diagnósticos para UI

| Código | Explicação |
|---|---|
| period_not_finished | Fim é hoje ou futuro em São Paulo. |
| bank_account_required | Conta inativa ou não é checking/savings. |
| coverage_gaps | Há dias sem cobertura declarada integral. |
| timezone_conflict | Divergência de fusos entre intervalos/âncoras. |
| missing_anchors | Saldo inicial/final com marco exigido ausente. |
| conflicting_anchors | Valores/fusos concorrentes no mesmo marco. |
| balance_mismatch | Abertura + entradas - saídas não reproduz fechamento. |
| timezone_not_sao_paulo | Evidência usada não apresenta offset -180. |
| source_account_unverified | Identidade da conta nativa não é exata/unívoca ou fonte não verificada. |
| source_integrity_issue | Linhas fora do período declarado ou IDs repetidos na fonte. |
| unsupported_source_format | Import relevante não é native-ofx-v1; aprovação dedicada ainda não suporta esse conjunto misto. |
| unverified_source | Import relevante sem última verificação rows_match. |
| unresolved_identity | Linha ambígua/conflitante sem decisão ativa. |

Erros: `finance_coverage_evidence_changed` (preview antigo, 40001); `finance_coverage_not_eligible` (23514, detail é array JSON de razões); `finance_coverage_approval_exists`; `finance_invalid_coverage_declaration`; `finance_invalid_payload`; `finance_coverage_approval_not_found`; `finance_coverage_already_reversed`; autorização/conflito seguem núcleo financeiro. Datas inválidas também podem produzir erro de formato PostgreSQL antes de uma decisão.

## Dependências e concorrência

Snapshot inclui identidade/estado da conta; imports relevantes com hashes/caminhos/datas/parser (sem duplicar source_snapshot volumoso); linhas originais e classificações; última verificação completa por import; entradas com IDs, valores, datas e status ativo; decisões/reversões de identidade. Usa intervalos declarados, âncoras do diagnóstico, datas de entradas e linhas para localizar imports. O arquivo original continua preservado pelo intake.

Revisão dedicada inclui essas dependências, não apenas o net bancário: inserir +500 e -500 muda revision, mesmo deixando saldo e aritmética iguais. Nova verificação com mesmo valor também muda revision. Mudança de identidade da conta ou duplicação de seu cadastro é detectada pelo assessment nativo. Aprovação guarda snapshot exato e não o reescreve depois.

Comandos usam a trava tenant:finance existente, reautorizam após espera, verificam replay e recapturam evidência sob lock. Uma aprovação ativa por conta/intervalo é validada no comando serializado; DML de tabelas é revogado para browser/service-role. Triggers de imutabilidade protegem UPDATE/DELETE. Autoria manual foi incluída no filtro da auditoria.

## Validação

- `src/test/financeStatementCoverage.test.ts`: 16 testes SQL PGlite, migrations reais sobre fixture estreita. Aceite completo, declarações exatas, replay/novo payload, stale preview, reversão/renovação, gaps/missing/conflicting/arithmetic, dia atual, permissões/imutabilidade, IDs compensatórios, conta duplicada/cash, identidade pendente/reversão, fuso e rollback integral quando auditoria falha.
- `scripts/test-finance-coverage-approvals-native-cases.mjs`: 6 testes PG17.11 descartável: replay concorrente, chaves distintas, revogação durante espera, nova verificação, entradas compensatórias e reversão seguida de nova aprovação. Todas as esperas comprovadas por `pg_blocking_pids` via contested, sem sleep como evidência.
- Selector opt-in `PG_QA_SUITE=finance-coverage-approvals`; log `node_modules/.cache/qa-postgres/finance-native-coverage-approvals-2026-09-10.log`. 6/6 passaram, processo exit0 e cluster encerrado.
- ESLint do teste e TypeScript: exit0.
- SHA256 migration testada: `cc8bea0528ceef3155cb1447a4cfeff9adf4cc09441aaa38e56beb896e0e1166`.

Pendências externas: adoção do legado, conciliação integral, guards de fechamento/reabertura e homologação dos extratos reais continuam necessários. Root corrigiu separadamente a revalidação posterior à espera do worker `record_statement_verification` na migration `20260910142923`; esta migration de cobertura não altera esse worker. O [ensaio dedicado](FINANCE-VERIFICATION-REAUTH-NATIVE-2026-09-10.md) passou em seis cenários nativos, incluindo revogação durante espera e replay.

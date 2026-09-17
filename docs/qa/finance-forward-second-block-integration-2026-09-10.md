# Segundo bloco integrado e compatibilidade do lifecycle de folha — 2026-09-10

Rollout CLI (dataUTC11): supabase/rollouts/20260911024907_finance_payroll_lifecycle_wrapper_compat.sql. SHA25622c9e3e29a8c713a939478d0ae36a1a8988d3c5727a3a2406c65eaf92aa51b75. Original133352 intacto. Sem escrita remota, TSC ou PostgreSQLnativo.

## Falha de produto reproduzida

235237 envolve writers com label finance_entry_guard.133352 antepunha finance_payroll_previous_body diretamente antes do label já existente. PL/pgSQL rejeita os dois labels contíguos (syntax error at or near <<). O teste específico reproduz original e comprova rollback, sem helperlifecycle residual.

Compat remove somente esse label decorativo sem referências internas. Preserva o bloco finance_entry_guard inteiro, o novo finance_payroll_lifecycle_guard, escopo, locks e revalidação. Novo preflight requer seteprosrc/config/SECURITY DEFINER/ACL exatos; assinatura ausente e grantanoninesperado são rejeitados antesDDL. Comparação readonlyremota confirmou seisprosrc; generate remoto ainda pré132406, esperado final050629f9ccda3098cc0df8920f4c4ea0 obtido da cadeia real após132406. Não autorizar rollout antes desse predecessor.

## Ensaio executado

financeForwardSecondBlockIntegration.test.ts instala TODOSos9financeiros132411→140010 sobre29anteriores e dependências62arquivos anteriores, com133352 substituída pelo rollout exato. Manifesto finance-forward-second-block-manifest-2026-09-10.json captura os bytes atuais lidos. Outras migrations operacionais não são sobrescritas.

Builderreal da cadeia de tentativas conserva driver_settlement_v3_attempts_finance_costs. Registra lote custo150, reconstrói acerto duas vezes e mantém um item derivado e um pagável complementar. Remuneração200 do acerto gera somente crédito200nafolha. Registra saída200e pagamento de acerto público real; replay mantém1movement/1payment/1itemalready_paid. Pagável complementar150 permanece idêntico. Aprovação de folha real ocorre sem duplicar obrigações. Misto/revogado/tenantforeign são negados; regenerar período aprovado é bloqueado. Flush das constraints diferidas conclui.

Rodada conjunta anterior+novo:2PASS5,44s/exit0. Teste negativo de compat:1PASS2,74s/exit0. Lint dos arquivos novos/helper passou. Sem teste concorrente nativo de locks nesta rodada; a execução comprova integração e guards síncronos, não disputa de sessões.

## Limites e fresh install

Fix necessários nafixture: baseline real de writers register_driver_settlement_payment/v2 e sincronizadores de obrigações ausentes, para que as migrations de aposentadoria os encontrem. Nenhum stub de sucesso foi adicionado. Auth/Storage herdados de testes; cron ausente toma branchNOTICEreal. Não é stackSupabase completa ou homologaçãoSSX/workspace.

O fresh reset literal continua afetado pelo original133352: uma migration aditiva posterior não pode reparar uma cadeia que já abortou antes. Executor de implantação/ensaio deve mapear explicitamente133352ao rollout24907, ou a política de manutenção da cadeia fresh deve resolver seu predecessor. Nenhum arquivo histórico foi alterado para esconder essa diferença. Este relatório não declara resetfresh original corrigido.

## Correção fresh autorizada após relatório inicial

O coordenador autorizou corrigir o arquivo original133352 ainda pendente de aplicação pelo nome original, mantendo cópia de evidência. Arquivo anterior imutável registrado em docs/qa/20260910133352_finance_payroll_lifecycle_serialization.before-wrapper-fix.sql SHA d596834f30bdfddcd8b2410c9ba3c1a7318129cebd1c3fc1185c40d1f7506311. Original133352atual SHA2dbc81ea2638980cb3f9c5bd0ec5c8668807bb1a818288191a724d549aa52b6b; única alteração remove labeldecorativo redundante. RebaselineJSON finance-payroll-lifecycle-fresh-rebaseline-2026-09-10.json. Rolloutprod24907 não mudou.

Teste negativo agora lê arquivoarquivado para reproduzir erro antigo; depois instala freshcorrigido e verifica presença dos dois blocosfinance_entry_guard e finance_payroll_lifecycle_guard. Esse teste+26casosfinanceSettlementPaymentRecording passaram27/4,12s/exit0, provando compatibilidade com fixture wrapped e fixturebaseline usada pelo comando de pagamento.

## Inventário fresh restante (não alterado nesta tarefa)

- 20260910011121_finance_fiscal_cancellation_credits.sql ainda pressupõe agregado inline no _receivable_financial_snapshot.192908 moveu soma para _receivable_ledger_evidence. Sua cadeia freshliteral continua incompatível nesse ponto. Rollout já testado20260910231716 aplica exclusão de créditos no ledger e história no snapshot, com preflight exato. Não confundir cópia emrollouts com correção automática da migrationfresh.
- 20260910025658_finance_receipt_allocation_corrections.sql também procura filter(where rv.id is null no snapshot; depois de192908 e crédito delegado deve aplicar exclusão de correções no ledger. Rollout20260910232134 preserva crédito e histórico, mas migrationfresh continua pendente de decisão/correção. Não alterei011121nem025658.

Assim fresh133352 foi resolvida; não declaramos que toda cadeiafresh foi corrigida enquanto os dois pontos acima persistem.

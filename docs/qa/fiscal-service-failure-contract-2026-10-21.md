# Falha comprovada antes da transmissão — contrato AGVLOG/Hub

Tarefa `fiscal-service-failure-20261021`, owner `CodexFiscalIncident`, base
`0da8bf35c624cd2032fb86633531a3cf13f43f3e`. Alteração local; sem publicação,
emissão real, reenvio, cancelamento ou correção de dados produtivos.

## Contrato recebido de Thomaz em 21/10/2026

| Estado | HTTP ao cliente | Tratamento |
| --- | --- | --- |
| `error` com comprovação de não transmissão | 502 | Encerrar pendência, mostrar erro, sem retry automático |
| `rejected` | 422 | Encerrar pendência e permitir correção |
| `processing` | 202 | Aguardar atualização |
| `provider_unknown` | 202 | Manter bloqueio e conciliar |
| `authorized` | 200 | Concluir faturamento |

Revisado contra `F:/fiscalhub/docs/submission-outcome-contract.md` fornecido por
Thomaz. `success` é sucesso da operação HTTP: GET usa true e callback pode omitir.
O recibo definitivo exige os booleanos JSON `processing=false`, `terminal=true`,
`requiresReconciliation=false`; documento `status=error` com `id` e `idIntegracao`;
erro estruturado `submissionOutcome=not_submitted`, `automaticRetry=false`.
Fatos podem estar na raiz ou no documento; se repetidos, precisam concordar.
Diagnósticos variáveis não são usados como prova de não envio.

Não inferir a ausência de transmissão por HTTP 502, texto de indisponibilidade,
expiração de prazo ou consulta sem registros. A referência precisa coincidir com
a operação persistida. Ambiente/CNPJ, quando presentes, também devem coincidir.
Comprovação contraditória com chave/protocolo de autorização não libera a faixa.

## Implementação

- Migração incremental `20261021122925_classify_confirmed_submission_failures.sql`:
  classificador com EXECUTE apenas para service_role; recibo confirmado vira
  `hub_fiscal_emissions.status=error, dispatch_state=recorded`; projeções locais
  encerram em `error`, limpando os marcadores de emissão das fontes. O CHECK do
  catálogo CT-e é ampliado preservando os valores anteriores. Tenant, identidade,
  locks, versionamento e proteção de autorização continuam ativos.
- `prepare_cte_issue` permite uma nova preparação pelo usuário depois desse erro
  confirmado. O claim antigo permanece sem novo POST: apenas GET do documento
  existente. Histórico e identidade da tentativa anterior são preservados.
- Rejeição canônica com HTTP 422 não depende dos detalhes legados de exceção do
  ManagerSaaS; exige referência compatível.
- Dispatch e consulta/sync retornam os HTTPs e flags do contrato a partir do estado
  **confirmado no banco**. Uma resposta HTTP antiga não sobrepõe callback mais novo.
- Cliente preserva erro, terminalidade, necessidade de conciliação e ausência de
  retry automático, inclusive quando Supabase retorna erro HTTP não-2xx.
- Migração aditiva `20261021124814_align_fiscal_submission_outcome_channels.sql`
  alinha SQL e Edge para GET/callback e campos no documento. Não altera migrations
  anteriores nem dados. Erros terminais são reconhecidos pelo lote; sync/recuperação
  invalidam as consultas em onSettled, mesmo quando a persistência termina em 422/502.
- Erro legado sem comprovação permanece incerto. GET simplificado não reabre um
  erro terminal já comprovado. Nenhum reparo em lote ou conversão por mensagem.

## Verificação local

Dependências instaladas com `npm ci`, lockfile preservado. Testes e TypeScript
executados com Node 22 via `npm exec --package=node@22` (o Node padrão do host é 24).
Banco de teste: PostgreSQL/WASM PGlite, dados sintéticos, sem serviço fiscal externo.

Suítes selecionadas: fiscalServiceFailureDatabase, fiscalSubmissionOutcome,
hubFiscalClientOutcome, hubFiscalProxyRuntime, fiscalProviderRejectionDatabase,
fiscalPreflightFailureDatabase, fiscalCallbackOrderingDatabase,
fiscalEmitterSerializationDatabase, cteIssueOutcome, hubFiscalClientErrors,
fiscalCommitReview e fiscalOutcomeHooks.

Cobrem resposta mínima fornecida pelo usuário, liberação de emitente e fontes,
nova preparação manual com payload igual, replay sem POST, erro com identidade
errada/incompleta, resultado incerto, callbacks atrasados, autorização preservada,
falha ao confirmar espelho e recuperação GET-only, HTTPs e metadados no cliente.

Também verificar TypeScript da aplicação, ESLint dos módulos/testes modificados,
sintaxe Edge e `git diff --check`. Resultados finais registrados na nota de sessão.

## Promoção e operação pendentes

Não aplicar o baseline nem executar `db push`. Comparar as definições publicadas
com a base deste delta antes de promover a migração estreita. Os patches de
preparação/espelho recusam contratos inesperados. Ordem: migração aprovada →
contrato SQL → Edge `hub-fiscal-proxy` com os shared modules → frontend → validação
autenticada do contrato final. A versão pública do Hub e o recibo de GET/callback
precisam refletir o contrato fornecido.

O documento fornecido relata que a operação 424 foi reparada no Hub e no espelho
AGV, com callback entregue e histórico preservado. Esse reparo não foi repetido
nesta tarefa; a adaptação genérica continua necessária para casos futuros.
Este pacote não altera registros produtivos nem demonstra homologação fiscal real.

Retorno: preservar migração/recibos e retirar o novo cliente/Edge apenas de forma
coordenada; cliente antigo pode tratar falha HTTP como erro genérico, mas não
deve reinterpretar terminalidade persistida. Não restaurar registros antigos ou
reabrir tentativas por downgrade de dados. Preparar compensação SQL específica
caso um retorno de banco seja necessário; não executar automaticamente.

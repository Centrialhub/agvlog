# Retorno compatível de `ssx-sync-rule-violations`

## Objetivo e limite

Preparar uma fonte reproduzível de retorno, baseada no bundle publicado v13, que preserve os prazos de espera gravados pelo candidato. A v13 literal reconhece apenas `rate_limited`; o candidato também grava `rate_limited:<segundos>`. Restaurar o leitor antigo durante um prazo estendido permite consultar o provedor cedo demais.

Este pacote mantém a lógica de ingestão da v13 e conserva as proteções necessárias para ler e gravar os dois formatos, reconhecer HTTP 429 e interromper a execução se a leitura do cursor falhar. É uma versão adaptada para retorno. Não desfaz eventos já ingeridos, mudanças SQL ou as demais funções SSX. Sua preparação local não aprova uma publicação.

A revisão final captura status e `Retry-After` antes de ler o corpo da resposta. Se a leitura falhar, mantém o 429 e o prazo conhecido. O helper resultante coincide com o helper candidato; essa proteção é conservada no retorno.

## Proveniência

- Função observada: `ssx-sync-rule-violations`, v13, ID `056d068e-e4e2-4f60-b1aa-3268afd5d416`, atualização em 23/09/2026 às 17:56:33.147 UTC.
- Os sete arquivos fonte coincidem com o commit publicado `17a7592dca01f31b1aa7b63340fbaf28bb116347` após normalizar CRLF para LF. O gerador fixa esse ancestral da branch principal, preservado também quando o PR é integrado por squash; não depende de um commit exclusivo da branch candidata.
- Os hashes e a identidade do bundle observado constam no [manifesto de reconciliação](edge-reconciliation-2026-09-26.json).
- O [manifesto do pacote preparado](ssx-violations-compatible-rollback-manifest-2026-09-26.json) registra os hashes resultantes: cinco fontes preservadas e duas adaptadas. Compare uma nova geração com esse registro antes do ensaio; diferença exige revisão.
- O gerador [prepare-ssx-violations-rollback.mjs](../../scripts/prepare-ssx-violations-rollback.mjs) confere a fonte antes de aplicar o patch. Não baixa versões alternativas quando o commit está ausente.

## Preparação local

Em um checkout do candidato com o commit de origem disponível no Git:

```sh
node scripts/prepare-ssx-violations-rollback.mjs
npm run test -- src/test/ssxRuleViolationsRollbackRuntime.test.ts
```

A saída fica em `.codex-build-audit/edge-compatible-rollback-2026-09-26/ssx-sync-rule-violations-v13/`:

- `supabase/functions/`: entrypoint e dependências do pacote de retorno.
- `supabase/config.toml`: configuração local mínima da função, com `verify_jwt = false`, igual ao bundle observado. A autenticação interna do handler permanece exigida.
- `manifest.json`: origem, hashes dos arquivos gerados e alterações intencionais.

O diretório é ignorado pelo Git. Preserve o manifesto e o pacote como evidência do release antes de uma promoção; o archive do worktree não preserva arquivos ignorados. A fonte fixada no histórico permite regenerar o pacote. O job de testes carrega o histórico do Git para que o teste não dependa de um cache existente neste computador.

## Evidências exigidas antes do uso

1. Reconfirmar a versão ativa da função e o contrato do banco alvo. Mudanças posteriores à observação de 26/09 exigem nova revisão.
2. Gerar o pacote, conferir o manifesto e executar os testes do handler gerado com seu helper HTTP. Registrar comando, SHA do gerador, hashes, horário UTC e resultado no [log do release](release-log-template.md).
3. Ensaiar em staging com cursor legado e estendido: nenhuma consulta nem avanço antes do prazo; consulta após expiração; falha de leitura do cursor sem chamada externa; novo 429 preservando a espera informada, inclusive quando o corpo da resposta falha após os headers. Conferir também autenticação e efeitos persistidos.
4. Registrar a identidade do pacote aprovado e o alvo antes de publicar apenas essa função. Conferir a versão e o bundle resultantes, preservação do cursor e comportamento após o retorno.

Os testes locais usam banco e provedor simulados. Ainda são necessários o ensaio hospedado e a observação do comportamento real. O gerador não publica, não altera cursores e não suspende agendamentos.

## Restrições permanentes

- Não apagar `last_error_code`, reduzir `updated_at` ou normalizar prematuramente o código para viabilizar o retorno.
- Não restaurar v13 literal enquanto existir cooldown estendido ativo. Suspender só o cron não impede invocações diretas autenticadas.
- O atraso continua entre 15 minutos e 24 horas. O mecanismo não fornece exclusão mútua entre chamadas concorrentes antes do primeiro registro de erro.
- Se a falha estiver nas próprias proteções conservadas neste pacote, preparar outra correção revisada; este retorno não remove essas proteções.
- Se fonte, hash, contexto do patch ou estado do diretório de saída divergirem, interromper a preparação e investigar. Não transformar a divergência em aviso ignorável.

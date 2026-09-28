# Correções encontradas no ensaio local — 28/09/2026

O [lote original de 13 forwards](baseline-candidate-manifest.json) e sua aprovação permanecem intactos. O [suplemento](baseline-followup-manifest.json) registra três correções descobertas depois de executar esse lote no baseline comparado. O suplemento fixa o hash do manifesto original e os hashes de cada arquivo novo; não constitui autorização automática para produção.

## Mudanças e evidências anteriores ao ensaio local

| Migração | Falha ou divergência confirmada | Mudança restrita | Verificação |
| --- | --- | --- | --- |
| `20260928182208` | O contrato detectou EXECUTE anônimo em oito funções internas de trigger | Revoga EXECUTE de PUBLIC e dos três papéis clientes somente nessas assinaturas; exige owner, retorno e vínculo de trigger esperados | 5 testes PGlite: invocação pelos triggers preservada, metadados/grants alheios intactos, repetição e rollback em divergências |
| `20260928182647` | Duas políticas permissivas SELECT no chat, sob a mesma fronteira restritiva | Remove somente a política antiga redundante, após confirmar políticas canônicas e helper STABLE | 9 testes PGlite: mesma visibilidade, negações, tenant, grants, writes e recusa diante de drift |
| `20260928183014` | Paletes: `WITH ORDINALITY cannot be used with a column definition list`; paginação financeira: `column "ordinal" does not exist` | Corrige apenas a expansão JSON de duas funções ativas, substituindo fragmentos reconhecidos dos corpos publicados | 6 testes PGlite: reproduzem os dois erros antes do patch, executam depois, conferem itens/páginas/ordem/totais/recibos, autorização, metadados, idempotência e rollback |

As oito funções de trigger não representam oito endpoints RPC utilizáveis. A política legada de chat também não demonstrava vazamento vigente: `(legado OR can_read) AND can_read = can_read`, porque a política restritiva já existia. As correções mantêm as regras do gate e eliminam divergências específicas sem ampliar acesso.

Os testes das duas operações JSON executam as funções históricas completas e o hotfix posterior de totais de recibos. Usam tabelas e helpers de membership mínimos, com escopo declarado. Isso comprova a correção SQL isolada; não substitui RLS integral, armazenamento físico ou o fluxo autenticado no Supabase local.

Revisões independentes dos três forwards não identificaram bloqueadores concretos. Os arquivos têm preflights que recusam assinaturas, corpos ou políticas inesperados. Aplicá-los somente como lote explícito e transacional após conferir os hashes, preservando logs e observando o resultado real do contrato. O [log](release-log-2026-09-28-local-staging.md) registra a execução quando concluída.

## Proteção para trabalhos posteriores

`npm run supabase:baseline-candidate:check` valida os 13 originais e os complementos separadamente. Recusa arquivo novo não listado, hash alterado, ausência, duplicidade, ordem inválida ou migração anterior ao lote original. `--write` não substitui um manifesto original existente e não gera aprovações de complementos. A comparação normaliza somente CRLF do JSON; bytes SQL exigem LF e hash exato.

Os testes de conteúdo de SQL e mocks de RPC continuam úteis como complemento, mas não aprovam execução. Este caso motivou a regra permanente em `AGENTS.md`: reproduzir o erro e executar a operação corrigida, conferindo efeitos e autorização. Mudanças futuras devem registrar novas evidências sem reescrever os lotes já ensaiados.

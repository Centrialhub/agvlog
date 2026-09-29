# Correções encontradas no ensaio local — 28/09/2026

O [lote original de 13 forwards](baseline-candidate-manifest.json) e sua aprovação permanecem intactos. O [suplemento](baseline-followup-manifest.json) registra sete correções descobertas depois de executar esse lote no baseline comparado. O suplemento fixa o hash do manifesto original e os hashes de cada arquivo novo; não constitui autorização automática para produção.

## Mudanças e evidências anteriores ao ensaio local

| Migração | Falha ou divergência confirmada | Mudança restrita | Verificação |
| --- | --- | --- | --- |
| `20260928182208` | O contrato detectou EXECUTE anônimo em oito funções internas de trigger | Revoga EXECUTE de PUBLIC e dos três papéis clientes somente nessas assinaturas; exige owner, retorno e vínculo de trigger esperados | 5 testes PGlite: invocação pelos triggers preservada, metadados/grants alheios intactos, repetição e rollback em divergências |
| `20260928182647` | Duas políticas permissivas SELECT no chat, sob a mesma fronteira restritiva | Remove somente a política antiga redundante, após confirmar políticas canônicas e helper STABLE | 9 testes PGlite: mesma visibilidade, negações, tenant, grants, writes e recusa diante de drift |
| `20260928183014` | Paletes: `WITH ORDINALITY cannot be used with a column definition list`; paginação financeira: `column "ordinal" does not exist` | Corrige apenas a expansão JSON de duas funções ativas, substituindo fragmentos reconhecidos dos corpos publicados | 6 testes PGlite: reproduzem os dois erros antes do patch, executam depois, conferem itens/páginas/ordem/totais/recibos, autorização, metadados, idempotência e rollback |

As oito funções de trigger não representam oito endpoints RPC utilizáveis. A política legada de chat também não demonstrava vazamento vigente: `(legado OR can_read) AND can_read = can_read`, porque a política restritiva já existia. As correções mantêm as regras do gate e eliminam divergências específicas sem ampliar acesso.

O primeiro ensaio das três correções foi recusado atomicamente às 18:40 UTC: o corpo de paletes capturado diferia do histórico usado pela fixture. Nenhuma alteração desse ensaio persistiu. O candidato de ordinality, ainda não aplicado nem publicado, foi corrigido para reconhecer também o corpo capturado; seu hash mudou de `18dbd1debc36cb282db1ccd5237d5ac5992a371e1a363c9ad736324dab8e93c1` para `6455b4bdc2ae6a9afdf008f202b534771a12721e9b7ff2db773a779182926163`. O log preserva a tentativa anterior. As duas correções de segurança foram aplicadas separadamente às 18:42 UTC, com o contrato aprovado antes do COMMIT.

As fixtures agora incluem definições completas capturadas, com procedência explícita. Os 9 testes de ordinality cobrem as variantes histórica e capturada. Usam tabelas e helpers de membership mínimos, com escopo declarado; não substituem RLS integral, armazenamento físico ou o fluxo autenticado no Supabase local.

## Complementos após confronto com a fonte capturada

| Migração | Defeito reproduzido e correção | Evidência isolada |
| --- | --- | --- |
| `20260928183948` | Expansão JSON de waypoints inválida e fallback `stop` ausente no enum; preserva wrapper, revisões e idempotência, usando o valor vigente `checkpoint` | 6 testes PGlite com helper e wrapper capturados, ordenação, repetição, revisão obsoleta, tenant e ACL |
| `20260928184134` | Poll CT-e tentava gravar campos fiscais em tabela de telemetria; usa o helper de auditoria de entidade existente e normaliza evento JSON null | 12 testes PGlite: três resultados CT-e, rollback, tenant/source, eventos ausentes, ACL e preservação de NFS-e |
| `20260928184443` | Quantidades fracionárias eram arredondadas, permitindo total diferente da soma dos itens; valida inteiros, nulos e overflow antes de qualquer gravação | Parte dos 15 testes PGlite de contratos capturados: reprodução, atomicidade, metadados, repetição e recusa de drift |
| `20260928184444` | A função financeira capturada não retornava resumo integral de comprovantes do snapshot; inclui contagens independentes da página | Mesma suíte de 15 testes, comparando quatro páginas e preservando os demais campos |

Os dois últimos forwards exigem os corpos resultantes do ordinality corrigido. Seus preflights conferem o corpo inteiro e os metadados, preservando owner, ACL, configuração, volatilidade e contexto de execução. A revisão independente dos cinco forwards pendentes não identificou bloqueadores. O ensaio nativo e seus resultados devem constar no log antes de aprovar o lote.

Revisões independentes dos três forwards não identificaram bloqueadores concretos. Os arquivos têm preflights que recusam assinaturas, corpos ou políticas inesperados. Aplicá-los somente como lote explícito e transacional após conferir os hashes, preservando logs e observando o resultado real do contrato. O [log](release-log-2026-09-28-local-staging.md) registra a execução quando concluída.

## Proteção para trabalhos posteriores

`npm run supabase:baseline-candidate:check` valida os 13 originais e os complementos separadamente. Recusa arquivo novo não listado, hash alterado, ausência, duplicidade, ordem inválida ou migração anterior ao lote original. `--write` não substitui um manifesto original existente e não gera aprovações de complementos. A comparação normaliza somente CRLF do JSON; bytes SQL exigem LF e hash exato.

Os testes de conteúdo de SQL e mocks de RPC continuam úteis como complemento, mas não aprovam execução. Este caso motivou a regra permanente em `AGENTS.md`: reproduzir o erro e executar a operação corrigida, conferindo efeitos e autorização. Mudanças futuras devem registrar novas evidências sem reescrever os lotes já ensaiados.

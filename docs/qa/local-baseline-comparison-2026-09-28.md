# Comparação do baseline local — 28/09/2026

**Parecer antes dos forwards:** a comparação comprovou equivalência do catálogo da aplicação no escopo capturado, após classificar diferenças de representação. As diferenças de plataforma estão explicitadas abaixo. O baseline pode ser usado como entrada do ensaio local dos 13 forwards revisados; a aplicação e a versão pública continuam sem homologação.

Este parecer complementa a [captura autoritativa](authoritative-schema-capture-2026-09-28.md), a [revisão da montagem](local-baseline-review-2026-09-28.md) e a [evidência de restauração](local-baseline-restore-evidence-2026-09-28.json). Não modifica o histórico de migrações nem substitui os gates do [roteiro de estabilidade](production-stability-playbook-2026-09-26.md).

## Corte e integridade da comparação

| Evidência | Resultado |
| --- | --- |
| Fonte de produção | PostgreSQL 17.6; 896 versões de migração; máximo `20260924155758` |
| Restauração local | Concluída em 18:01:25.934 UTC, checkout `4850412c19bec6cc4134fb48e1f9e3b4c1ee65fd` |
| Estado restaurado | 327 tabelas públicas, todas com RLS; oito buckets; zero jobs de cron, segredos Vault e itens na fila HTTP |
| Consulta local anterior aos forwards | 18:06:41.369 UTC; PostgreSQL 17.6; somente leitura |
| Fonte com chaves completas | 18 categorias, 20.728 registros de catálogo; zero colisões |
| Integridade da coleta | Todas as 18 listas recompõem os agregados de 17:58:15.692 e 18:07:35.171 UTC; conferência independente em 18:08:11.594 UTC |
| Identificação dos objetos | `object_key` do tipo `text`; chaves de até 354 bytes |
| Consulta versionada | SHA-256 `d537a4ac6e96d6b1e11b8f680038f00a997fa15da165a3ba0035b7d2ba703aac` |
| Mutações durante a comparação | Nenhuma; consultas em transação somente de leitura, com `search_path=pg_catalog` e timeout |

A [consulta de catálogo](../../supabase/verify/staging_catalog_fingerprint.sql) foi corrigida para converter o primeiro ramo do `UNION` explicitamente em `text`. A versão anterior convertia chaves compostas para `name`, truncando-as em 63 bytes. As evidências anteriores foram preservadas; a decisão deste parecer usa a recaptura corrigida nos dois ambientes.

O comparador considera todas as categorias esperadas, inclusive uma categoria inteiramente ausente, e conserva a multiplicidade de chaves repetidas. Não descarta linhas ao construir mapas. Quatro verificações semânticas cobriram categoria ausente, multiplicidade diferente, ordem equivalente e categoria extra.

## Resultado das 18 categorias

Contagens referem-se aos registros definidos pelo verificador, incluindo objetos gerenciados no seu escopo. “Igual” significa mesmas chaves e hashes brutos, sem normalização.

| Categoria | Produção | Local | Classificação |
| --- | ---: | ---: | --- |
| Schemas e ACLs | 13 | 13 | Três representações de ACL equivalentes; demais iguais |
| Relações | 2.135 | 2.135 | 82 representações de ACL equivalentes; demais iguais |
| Colunas | 9.122 | 9.120 | Posições físicas de `geofences` equivalentes; duas colunas gerenciadas de Storage ausentes |
| Constraints | 2.248 | 2.245 | Oito CHECKs equivalentes; três checks gerenciados de Storage ausentes |
| Índices | 1.743 | 1.740 | Quatro índices de Storage só na fonte e um só no local; demais iguais |
| Views | 14 | 14 | Igual |
| Rotinas | 1.678 | 1.678 | Igual, incluindo definição, owner e ACL |
| Políticas | 1.336 | 1.336 | Igual |
| Triggers | 636 | 633 | Três triggers gerenciados de Storage ausentes; demais iguais |
| Privilégios padrão | 6 | 6 | Igual |
| Papéis | 32 | 31 | Login temporário da captura excluído; demais atributos comparados iguais |
| Memberships | 22 | 25 | Membership temporário excluído e quatro vínculos locais de plataforma |
| Sequências | 6 | 6 | Igual |
| Tipos | 816 | 816 | Igual |
| Extensões | 10 | 10 | Versão de `pg_net` distinta; outras versões/schemas iguais |
| Event triggers | 7 | 7 | Evento de GraphQL da plataforma distinto; demais iguais |
| Buckets | 8 | 8 | Igual |
| Ledger | 896 | — | Referência externa preservada; não inserido artificialmente no banco local |

A comparação local contém 19.823 registros e exclui somente o ledger. Não afirmar que suas 896 migrações foram executadas localmente. As diferenças da tabela foram investigadas por objeto; igualdade agregada isolada não foi usada para aceitá-las.

## Equivalência comprovada da aplicação

### Permissões: 85 diferenças classificadas

A revisão de **82 relações e três schemas** confirmou os mesmos privilégios efetivos no escopo analisado:

- 80 relações e três schemas: ACL explícita do owner na fonte equivale ao padrão PostgreSQL representado por ACL nula no local.
- Duas relações: apenas a ordem dos itens do array de ACL difere.
- Zero diferenças de permissões da aplicação permaneceram sem classificação.

A prova expandiu as permissões com `aclexplode`, aplicou `acldefault` somente quando a ACL armazenada era nula e ordenou as tuplas completas de grantor, grantee, privilégio e possibilidade de concessão. Conservou o owner e todos os campos da relação que não eram ACL. O tipo do objeto foi respeitado ao calcular o padrão. A diferença bruta permaneceu registrada. [Funções oficiais de ACL](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-ACLITEM).

### Colunas de `public.geofences`

Produção tem 28 colunas ativas e uma posição física descartada, número 5; o banco restaurado tem as mesmas 28 colunas ativas, sem essa posição histórica.

A comparação por nome e ordem entre colunas ativas confirmou igualdade de tipo, nulabilidade, identidade, geração, armazenamento, compressão, default, ACL e descriptor de collation. Somente o número físico `attnum` foi desconsiderado nessa classificação específica. Isso explica uma chave ausente, uma extra e 23 hashes distintos dessa tabela; não representa perda ou reordenação de coluna ativa. [Catálogo de atributos](https://www.postgresql.org/docs/17/catalog-pg-attribute.html).

### Oito CHECK constraints

As oito diferenças pertencem a validações de coordenadas, planejamento de tamanho de anexos, geofences e caminho de evidência. Todas mantêm os mesmos flags, colunas referenciadas e estado validado. A definição produzida com apresentação legível pelo PostgreSQL também coincide.

A análise das árvores das expressões confirmou **oito pares equivalentes**, preservando funções, operadores, tipos, collations, argumentos e bits das constantes. Foram normalizados somente:

- Posições do texto SQL original e números físicos de coluna resolvidos pelos nomes capturados.
- Agrupamentos associativos do mesmo operador booleano, mantendo a ordem dos operandos.
- Indicação de apresentação de CAST explícito/implícito.
- Representação textual de cada byte constante com sinal ou sem sinal.

O PostgreSQL documenta que a indicação de apresentação do CAST não tem significado semântico; a serialização de constantes usa valores C `char` convertidos em inteiros. Os relatórios conservam as árvores brutas e os hashes antes/depois. Essa classificação não altera os CHECKs nem relaxa a consulta bruta. [CoercionForm no PostgreSQL 17.6](https://github.com/postgres/postgres/blob/REL_17_6/src/include/nodes/primnodes.h#L683-L701), [serialização de Datum](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/nodes/outfuncs.c#L313-L344).

## Locale do banco: conferência adicional

O descriptor de `pg_catalog.default` não basta para comparar a configuração do banco. Foram consultados os campos próprios de `pg_database`, sem alterar configurações: produção em **18:17:28.161 UTC**, local em **18:17:55.796 UTC**, ambos antes dos forwards.

| Metadado | Produção e local |
| --- | --- |
| PostgreSQL | 17.6 |
| Encoding | UTF8, código 6 |
| `datcollate` / `datctype` | `en_US.UTF-8` / `en_US.UTF-8` |
| `datlocprovider` | `i`, ICU |
| `datlocale` | `en-US` |
| Regras ICU adicionais | Nulas |
| Versão de collation gravada | `153.121` |
| Versão de collation efetiva | `153.121` |

**Nove de nove campos comparados coincidem**, e a versão gravada corresponde à efetiva em cada banco. Nenhuma divergência adicional de locale foi encontrada; isso não substitui testes de ordenação e comparação que façam parte dos fluxos da aplicação. Consulta SHA-256 `bd9963e754d56519bc1dd4e7b1c17270aeec6c15119a408278f445b0eb444d95`. [Catálogo PostgreSQL 17](https://www.postgresql.org/docs/17/catalog-pg-database.html).

## Diferenças de plataforma preservadas

A revisão detalhada registra 24 entradas de diferença ou exceção, incluindo três owners de extensões não cobertos pelo hash bruto dessa categoria:

- **Storage:** produção possui controles de ciclo de vida e um conjunto de índices de versionamento diferentes. As customizações da aplicação foram restauradas, mas não se transplantaram pedaços do esquema gerenciado. Testes locais de upload, bloqueio de sobrescrita, download assinado, exclusão e retenção continuam necessários; paridade de versionamento/ciclo de vida não está comprovada.
- **Auth e Realtime:** permanecem compatíveis com os serviços da imagem local. Objetos gerenciados novos e partições da plataforma não foram copiados integralmente. Triggers, policies e associações da aplicação foram tratados na [revisão de composição](local-baseline-review-2026-09-28.md#composição).
- **Papéis:** o login temporário da captura e seu membership não foram recriados. Quatro memberships próprios da plataforma local foram mantidos; testes autenticados devem conferir isolamento e Realtime nesse ambiente.
- **Extensões:** `pg_net` é 0.20.0 na fonte e 0.20.4 no pacote local. Três extensões preinstaladas mantêm owner local diferente. Rotinas e grants da aplicação foram comparados independentemente; integrações externas permanecem desativadas nesta fase.
- **GraphQL:** o event trigger gerenciado reage a uma categoria de DDL diferente. Owner, estado e função alvo coincidem. Não se conclui paridade do ciclo de DDL GraphQL.

Essas diferenças não exigiram corrigir os objetos da aplicação comparados. Elas limitam o que o ensaio local pode demonstrar sobre os serviços gerenciados em produção.

## Evidências privadas e continuidade

Os SQLs completos, definições e relatórios por objeto permanecem na área protegida de captura, fora do Git. Este documento contém apenas resultados, metadados e hashes.

| Relatório privado | SHA-256 |
| --- | --- |
| `live-fullkey-integrity-verification.json` | `11cfdaf417401240725594f78f52d5e59fa3a18dc1517f84cbee65a410edb62a` |
| `restored-fullkey-object-comparison.json` | `a6a2154377fbee4b014742aa3165ddd2a11999839a9317d7df904bf4185f55cb` |
| `columns-constraints-triage-report.json` | `1f18e099a6845862746cba5ea55b3e73233e883ea24d7aab94d14fd3038af6dd` |
| `constraint-tree-equivalence-report.json` | `5de6143bc3d53e69b1201bca8e0fd3c68dd3120fc849086bbca695da0d7b8548` |
| `restored-privilege-platform-classification.json` | `e9218c021fb12b93cd197e56364bfd713bf6a4ef414424e5a4e8b69e9e6d05e1` |
| `database-locale-comparison-report.json` | `d811f12ba34a7146a44e575c2919d98350356e713ae847303e2a22ae08d2bcee` |

Este é um retrato **anterior aos forwards**, com zero forwards aplicados no momento das coletas. A próxima etapa é ensaiar os 13 arquivos fixados no [manifesto do candidato](baseline-candidate-manifest.json), conferir o contrato resultante e executar as fixtures e os testes previstos. Registrar o novo SHA e as novas evidências no [log desta implantação](release-log-2026-09-28-local-staging.md), preservando esta comparação como ponto inicial.

O parecer não prova instalação pelo histórico antigo, reconciliação do ledger publicado, atualização com dados existentes, autorização efetiva entre empresas, sucesso das Edge Functions ou jornadas de importação, fiscal, financeiro e motorista. Essas aprovações dependem dos gates e testes correspondentes. Nenhuma publicação ou execução de migração em produção é autorizada por esta comparação.

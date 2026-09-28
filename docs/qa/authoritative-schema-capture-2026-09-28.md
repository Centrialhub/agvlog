# Captura autoritativa para o baseline de homologação

**Estado: esquema capturado; revisão e restauração em andamento. A aplicação ainda não está homologada.** Esta entrada atualiza a pendência de acesso registrada no [log do ambiente local](release-log-2026-09-28-local-staging.md). A produção permaneceu no corte de 896 migrações, até `20260924155758`.

## Acesso confirmado

Em 28/09 foi verificado que a CLI Supabase **2.116.0** já estava autenticada neste computador e tinha acesso ao projeto AGVLOG. O caminho anterior, que exigia disponibilizar uma DSN permanente ou um dump, era incompleto: a CLI oferece uma credencial temporária oficial. O Windows também conseguiu conectar diretamente ao PostgreSQL por IPv6/TLS.

O comando `db dump --linked --project-ref … --dry-run --keep-comments --agent yes` resolve essa autenticação antes de gerar seu script. Seu stdout contém uma senha temporária; foi redirecionado para arquivo privado, com herança de ACL desativada e acesso apenas do usuário e SYSTEM. Não usar esse comando com output público, `--debug`, ou em um log de CI compartilhado.

A CLI solicita um login temporário por `/v1/projects/{ref}/cli/login-role`; isso é uma ação administrativa de autenticação. As conexões de captura usaram `default_transaction_read_only=on`, TLS, timeout e `SET ROLE postgres` para ler o catálogo. Foram aceitas apenas as cinco variáveis literais de conexão esperadas; o script gerado não foi executado ou interpretado como shell. Referências da versão utilizada: [resolução da autenticação](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/legacy/shared/legacy-db-config.layer.ts), [implementação do dump/dry-run](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/legacy/commands/db/dump/dump.handler.ts) e [API oficial](https://supabase.com/docs/reference/api/v1-create-login-role).

## Artefatos e limites

O `pg_dump` nativo **17.11** capturou `--schema-only --quote-all-identifiers --role=postgres`, preservando owners e ACLs, do servidor **17.6**. A captura completa evita perder customizações em schemas gerenciados durante a revisão. **Não restaurar esse arquivo integralmente na stack local.** Auth, Storage e outros objetos da plataforma precisam ser classificados por dependência e versão.

| Artefato privado | Tamanho | SHA-256 |
| --- | ---: | --- |
| Esquema completo, sem dados | 7.452.972 bytes | `e8a1d0a202348a4fbbba22b3f81024c7a7ef867598cecf9f07ff6ebb6059bfce` |
| Papéis, com `--no-role-passwords` | 6.084 bytes | `f3e4ea127759351aa67b545a6629f506504dbac7e0229f78aa5d7c10f272ca37` |
| Ledger somente `version`/`name` | 78.709 bytes | `5232ee998330c1c7152084535e8d027a9cac651d71bfa600d4a4b472add5471c` |
| Catálogo antes e depois, hashes iguais | 851 bytes cada | `6515d5d169fdb1850f1ab330d7694045d9896752d79b7621cdf233caf8e470ba` |

Captura concluída em **2026-09-28T17:31:41.990Z**, no checkout limpo **813578468d3bca957d61f1da1ce1681088b46cb9**. O catálogo foi igual antes/depois nas 18 categorias verificadas. A inspeção anterior pelo conector também coincidiu com o retrato de 26/09 nas 18 categorias. Isso confirma o corte estrutural observado; não comprova os fluxos de negócio.

Não foram exportados registros de clientes, senhas de papéis ou a coluna `statements` do ledger. Mesmo assim, corpos de funções podem conter literais sensíveis; o SQL bruto permanece privado e ignorado pelo Git. A revisão deve anteceder qualquer cópia para baseline versionado ou artefato compartilhado. Configurações de oito buckets, extensões e publicações foram consultadas separadamente, sem objetos armazenados.

O arquivo com a credencial temporária foi removido após a captura; os processos de conexão foram encerrados. A validade informada pelo servidor para o login era **17:35:33.269021 UTC**. Não excluir o papel gerenciado `cli_login_postgres`, pois ele pode ser usado por outros processos da CLI. Sua expiração de senha não substitui o encerramento das sessões. [Ciclo de vida do papel](https://supabase.com/docs/guides/troubleshooting/permission-denied-when-deleting-the-cli_login_postgres-role-808bae).

## Próximas provas obrigatórias

1. Revisar literais, rotinas que chamam serviços externos, roles e configurações. Excluir segredos, jobs e dados reais; preservar o contrato da aplicação e registrar qualquer transformação.
2. Construir o baseline de teste fora de `supabase/migrations`, com origem, hashes, aprovação explícita e complementos gerenciados classificados. Não copiar o dump de papéis bruto nem o papel temporário.
3. Restaurar no banco local exclusivo; comparar hashes por objeto, owners, grants, RLS, triggers e dependências. Justificar diferenças da plataforma sem esconder divergências do aplicativo.
4. Só então aplicar os 13 forwards fixados no manifesto e executar contratos SQL, pgTAP, seed sintética, Auth/Edge e a matriz de fluxos críticos.

Captura concluída não equivale a baseline aprovado, teste aprovado ou publicação. O [plano de baseline](migration-baseline-plan-2026-09-26.md) e o [roteiro de estabilidade](production-stability-playbook-2026-09-26.md) continuam sendo os critérios de avanço.

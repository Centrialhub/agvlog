# Baseline privado no CI — requisitos de execução

Este documento prepara uma execução futura. Não transferiu artefatos, criou
credenciais/grants, configurou repositório remoto nem disparou workflow.
O fluxo local usa baseline revisado; o runner GitHub ainda não o recebe.

## Contrato já implementado

`quality.yml` chama `bash scripts/ci-reviewed-baseline.sh` em runner Linux efêmero.
O script exige checkout limpo, Docker local e ausência de qualquer container
`com.supabase.cli.project=agvlog-local-staging`; recusa reutilizar banco existente.
Cria rede com binding loopback e usa `.local-staging`, nunca o projeto remoto.

| Entrada | Exigência |
| --- | --- |
| AGVLOG_REVIEWED_BASELINE_DIRECTORY | Diretório absoluto fora do checkout, provisionado antes do step |
| AGVLOG_REVIEWED_BASELINE_SHA256 | Hash aprovado por revisão independente, 64 dígitos hexadecimais; nunca recalculado do download para se autoaprovar |
| Raiz do pacote | approval.json original e seus artefatos SQL |
| Revisões | revisions/<hash>/approval.json mais artefatos; cadeia supersedesApprovalSha256 verificada, máximo de 8 revisões |
| Artefatos permitidos | application-schema, managed-customizations, reviewed-roles, reviewed-extensions, synthetic-buckets; bytes e SHA-256 exatos |
| Escopo revisado | Sem dados de cliente/segredos de produção, jobs externos desativados, sem dump bruto de roles |

O pin final exercitado localmente é
`501f7c02e647c5c4e6e69267812067cb0a184524f44f9db2a4e5b1853152a649`.
Ele é evidência histórica para aquele pacote; qualquer revisão nova exige novo
pin/aprovação. O builder valida 13 forwards originais e sete suplementos antes de
executar SQL. Não reproduz 738 migrations históricas para construir o baseline.

## Decisões e autorizações ainda necessárias

1. Owner e revisor de banco escolhem o SHA imutável do candidato, revisam o diff
de workflow/scripts/dependências/testes que receberão o pacote e aprovam seu
escopo. PR3 atual/preview antigo não representa automaticamente esse candidato.
2. Aprovar destino privado existente ou mecanismo de entrega apropriado ao
runner, retenção, leitores e provenance do pacote sanitizado. Escolher mecanismo
não autoriza criar conta, credencial permanente, grant ou recurso pago.
3. Autorizar explicitamente a transferência dos bytes revisados e a configuração
das duas variáveis de CI. Caso o mecanismo exija credencial ou permissionamento,
essa alteração precisa de autorização própria e revisão de privilégio mínimo.
4. Autorizar execução remota no SHA revisado. Não disponibilizar o pacote a código
de fork/PR não revisado; o owner deve decidir como a entrega fica condicionada à
revisão, sem manter segredos dentro do checkout ou logs/artifacts públicos.

Não foi escolhida uma fonte pública de download nem um caminho privado fictício.
Sem mecanismo autorizado, definir apenas as vars não fornece o pacote ao runner.

## Preflight do runner autorizado

Depois da entrega autorizada, verificar hash/cadeia/arquivos e executar:

```sh
git status --porcelain
git rev-parse HEAD
node scripts/check-baseline-candidate.mjs
node scripts/prepare-ci-baseline-package.mjs
bash scripts/ci-reviewed-baseline.sh
```

Exigir 327 tabelas públicas/todasRLS, oito buckets, zero dados/cron/Vault/HTTPqueue
antes do seed. Seed e hook criam somente sete contas `.invalid` e dois tenants.
Chaves locais vêm do CLI; senha aleatória e service key são mascaradas, não
persistentes nem `VITE_*`. API deve ser exatamente `http://127.0.0.1:55321`.
`VITE_APP_RELEASE` recebe o SHA; build/release.json deve confirmar esse SHA e a
origem. E2E usa um worker/zero retries, evidências de full e critical em dirs distintos.

O Quality gate exige validate, todos os oito shards e database-and-e2e. O step de
lint SQL continua `--level error --fail-on error` e hoje reprova 31 achados; não
pular esse step para alcançar o navegador. As quatro falhas de motorista também
continuam explícitas, aguardando decisão. Baseline entregue não significa gate
aprovado. O entrypoint CI hospedado inteiro não foi executado nesta análise.

## Prova local e promoção futura

Projeto independente `agvlog-pristine-restore-20261001` comprovou restauração de
infraestrutura vazia, upgrade revisado, 175 pgTAP, retorno ao dump pré-upgrade e novo
upgrade. Isso valida o builder e a recuperação local, sem simular entrega de
artefato no GitHub nem rollback produtivo após novas escritas.

Antes de qualquer promoção: reconfirmar ledger/catálogo do alvo e bundles ativos
Edge; passar paridade; homologar serviços sandbox autorizados; testar o mesmo
candidato com backend de staging isolado. PR3 preview ligado à produção não é
staging. Publicar apenas mediante autorização final, na ordem SQL/contratos,
Edge e frontend, com versões anteriores, gatilhos de retorno e observação
operacional registrados. Rollback de frontend não desfaz dados/migrations.

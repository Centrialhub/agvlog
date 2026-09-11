# Pré-requisitos reais do ensaio integral — revalidação atual

2026-09-10. **O impedimento externo permanece comprovado. Não foi iniciado PostgreSQL nem repetido o preflight conhecido.** Nenhuma migration ou configuração remota foi alterada.

## Evidência atual

- CLI instalada: 2.116.0. `node_modules/.bin/supabase.cmd status` retorna `LegacyStatusDbInspectError`: Docker não encontrado e Podman não encontrado. Executado com acesso suficiente para a telemetria local da própria CLI, evitando confundir EPERM de sandbox com falta de runtime.
- `Get-Command docker,podman` não encontra executáveis. Docker Desktop não existe em `C:/Program Files/Docker/Docker/Docker Desktop.exe`. `wsl --status` informa que WSL não está instalado.
- PostgreSQL nativo17.11 instalado possui control/DLL de pgcrypto, uuid-ossp, pg_stat_statements, pg_trgm e unaccent. Não possui control nem biblioteca correspondente a postgis, pg_net, pg_cron ou supabase_vault. Não há instalador/daemon Docker, Podman ou gerenciador winget/choco/scoop encontrado no PATH nesta verificação.
- A captura atual inclui **333 arquivos SQL**, todos enumerados e hashados em `finance-full-sequence-prerequisites-current-2026-09-10.json`. Os manifestos antigos de259 e261 arquivos permanecem preservados como evidências datadas; não descrevem a sequência atual. Nenhum dos333 foi ensaiado integralmente nesta tarefa.

## Dependências efetivamente referenciadas

| Dependência | Referência concreta | Disponível agora / instalação real |
|---|---|---|
| postgis | baseline linha33 CREATE EXTENSION; linha1916 tipo extensions.geometry; funções ST_GeomFromGeoJSON/ST_Within e índice GiST | Ausente; não há pacote local para instalação. Não substituir geometry ou funções por stubs. |
| pg_net | baseline34; migration20260910154919 usa net.http_post | Ausente; exige extensão/worker real. Criar schema net não fornece serviço. |
| pg_cron | baseline35; migration20260829143948 usa cron.job/schedule/unschedule | Ausente; precisa biblioteca/configuração do worker, não somente SQL. |
| supabase_vault | baseline36 e12709 vault.decrypted_secrets | Ausente; extensão e bootstrap reais necessários. Não criar view fictícia. |
| pgcrypto / uuid-ossp / pg_stat_statements / pg_trgm / unaccent | baseline30–38 | Arquivos locais presentes; podem ser CREATE EXTENSION no PostgreSQL descartável. pg_stat_statements em operação também exige configuração de preload. Isso não resolve as quatro ausentes. |
| Auth | auth.users e auth.uid() já na baseline; auth.role(), auth.jwt() em segurança; versões/pagamentos capturam usuário real | Banco novo do runner não possui bootstrap. Deve vir da plataforma Supabase real, incluindo serviço/hook para ensaio integrado de autenticação. |
| Storage | baseline22249 storage.objects,22257 storage.foldername,23909 storage.buckets; recibos financeiros dependem dessas relações/políticas | Banco novo não possui bootstrap. Tabelas sintéticas das fixtures não equivalem à API/serviço Storage. |
| Papéis | anon, authenticated, service_role; migration20260910131125 concede a supabase_auth_admin | Podem ser criados tecnicamente em PG puro, mas papéis isolados não reproduzem Auth/Storage/RLS/JWT da plataforma. |
| Realtime | baseline23919 em diante altera supabase_realtime condicionalmente | Ausência pode ser silenciosamente ignorada pelo SQL; portanto ausência de erro de migration não prova Realtime funcional. |

O JSON lista cada ocorrência lexical com arquivo/linha. A ocorrência `auth.admin` nele é comentário da migration de convites, não dependência SQL adicional. A lista é evidência de referências estáticas, não resolução de pg_depend ou certificação de completude dinâmica.

## Limite concreto do harness anterior

`test-full-migration-sequence-native.mjs` cria banco novo com `CREATE DATABASE finance_full_sequence_qa` e verifica Auth/Storage nesse banco. Instalar bibliotecas no servidor ou apontar PG_QA_BIN para outro PostgreSQL não instala os schemas de plataforma nesse banco novo. O runner não tem bootstrap oficial nem parâmetro para usar banco Supabase já inicializado. Assim ele continua útil como preflight estrito, mas **não é hoje um substituto executável do reset da stack Supabase**. Não colocar schemas falsos em template1 para fazê-lo passar.

Também não usar ausência de erro do reset como prova de upgrade remoto: mapa anterior registra406 versões remotas, aliases e diferenças de bytes; baseline consolidada não deve ser aplicada em cima desse histórico.

## Próximo passo executável, condicionado a um único pré-requisito externo

É necessário disponibilizar **daemon Docker/Podman compatível e funcional** nesta máquina ou um executor Linux descartável com Docker (o job `database-and-e2e` existente usa ubuntu-latest). Instalar WSL/Docker exige provisionamento do host e pode exigir administração/reinício; essa alteração do host não foi realizada. Não há pacote local suficiente para montar a plataforma completa apenas com as ferramentas hoje encontradas.

Assim que o daemon existir, o caminho já implementado no repositório é:

```powershell
docker info --format '{{.ServerVersion}}'
node_modules/.bin/supabase.cmd start
node_modules/.bin/supabase.cmd db reset --local
node_modules/.bin/supabase.cmd db lint --local --level error
node_modules/.bin/supabase.cmd test db
```

Esses comandos devem rodar em workspace/stack local descartáveis; `db reset --local` apaga somente essa instância local. Não usar `--linked`, `db push`, URL remota ou repair. O workflow atual contém ainda verificação `supabase/verify/baseline_contract.sql`, login Auth real e E2E. Seu disparo não foi realizado.

Para retomar agora sem provisionar host, o blocker a encaminhar é: **disponibilizar executor descartável com Docker e permissão para baixar as imagens oficiais Supabase**. Reexecutar o PostgreSQL puro atual não produz nova evidência útil. Nenhuma conclusão de aprovação integral ou segurança de deploy foi emitida.

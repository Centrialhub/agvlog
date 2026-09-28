# Ambiente interno de homologação

## Decisão e estado

Em 28/09/2026 o responsável autorizou começar por um ambiente local isolado, com possibilidade de levar a configuração para um servidor interno. A primeira etapa usa Supabase CLI **2.116.0**, já fixada no projeto, e Docker Engine em Linux no WSL 2. Um ambiente compartilhado permanente deverá usar a distribuição oficial de self-hosting com Docker Compose, com versões e diferenças de plataforma revisadas.

**O ambiente ainda não está em execução.** Em 28/09 às 12:12 UTC, WSL 2.7.13 estava instalado e a ativação dos componentes Windows retornou sucesso, com **reinicialização obrigatória pendente**. Após o reinício, conferir WSL 2 antes de instalar Ubuntu e Docker. O [log desta implantação](release-log-2026-09-28-local-staging.md) registra as verificações e pendências. Não há branch Supabase Cloud criada por este procedimento.

## Separação dos ambientes

| Item | Homologação local |
| --- | --- |
| Identificador | `agvlog-local-staging` |
| Diretório gerado | `.local-staging/`, ignorado pelo Git |
| API | `http://127.0.0.1:55321` |
| PostgreSQL 17 | Porta `55322`; shadow reservado em `55320` |
| Studio | `http://127.0.0.1:55323` |
| Caixa de e-mail de teste | `http://127.0.0.1:55324`; sem entrega SMTP externa |
| Aplicação futura | `http://127.0.0.1:5175`; só iniciar após configurar backend e validar baseline |
| Dados | Sintéticos, contas `.invalid`, senha de teste aleatória |
| Integrações | Sem credenciais de produção; fiscal em homologação e SSX simulado inicialmente |

As URLs são destinos planejados; uma porta definida no arquivo não prova que o serviço esteja ativo ou restrito à interface local. A partida exige binding loopback comprovado. Não abrir portas da rede da empresa nem publicar um túnel para compensar a falta de configuração.

## 1. Habilitar o host Windows

O computador inspecionado tem Windows 11 Pro, aproximadamente 32 GB de RAM, virtualização de firmware habilitada e espaço livre suficiente. Docker não foi encontrado no PATH nem no caminho padrão do Docker Desktop. WSL estava ausente na primeira inspeção; o responsável instalou a versão 2.7.13 e o componente Windows foi ativado em seguida. Não repetir a instalação abaixo quando `wsl --version` já confirmar essa versão.

O responsável com acesso de administrador deve abrir **PowerShell como administrador** e instalar a versão verificada:

```powershell
winget install --id Microsoft.WSL --exact --version 2.7.13 --source winget
```

Depois, conferir `wsl --version` e `wsl --help`. Usar `wsl --install --no-distribution` para habilitar os componentes necessários, seguindo o resultado do instalador. Se o Windows solicitar reinicialização, salvar o trabalho e reiniciar em momento definido pelo usuário. Nenhum script deste projeto reinicia o computador.

Após WSL funcional, consultar `wsl --list --online`, instalar Ubuntu 24.04 se disponível nessa lista, conferir WSL 2 e concluir a criação do usuário Linux:

```powershell
wsl --install --distribution Ubuntu-24.04 --no-launch
wsl --list --verbose
wsl --distribution Ubuntu-24.04
```

Referências: [instalação do WSL](https://learn.microsoft.com/en-us/windows/wsl/install) e [comandos e opções](https://learn.microsoft.com/en-us/windows/wsl/basic-commands). A instalação pode exigir atuação do administrador e reinicialização; não considerar WSL disponível apenas porque `wsl.exe` existe.

## 2. Preparar Docker e ferramentas Linux

Dentro da distribuição Linux, instalar Docker Engine e Compose a partir do [repositório oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Registrar versões instaladas e verificar o daemon. Não expor o socket Docker por TCP. Não remover um runtime existente nem substituir sua configuração sem inspecioná-lo.

Para executar aplicação e testes dentro de Linux, usar checkout e dependências próprios nesse sistema: Node 22, npm 10.9.4 e `npm ci`. Não compartilhar `node_modules` do Windows, pois há binários específicos de plataforma. Transportar o candidato por Git após registrar as alterações em commit; conferir o mesmo SHA e diff. Um checkout diferente não pode ser apresentado como o candidato validado.

O preparo de arquivos pode ser executado já no Windows pelo comando da próxima seção. A partida dos containers e os testes completos dependem do runtime Linux disponível. Para servidor interno permanente, revisar Compose, DNS/HTTPS, acesso privado, armazenamento e backups; portar o contrato validado, sem presumir equivalência entre a stack da CLI e a distribuição self-hosted. Consultar as [diferenças e instalação oficial](https://supabase.com/docs/guides/self-hosting/docker).

## 3. Gerar somente a infraestrutura inicial

Na raiz do checkout candidato:

```text
npm run staging:local:prepare
npm run staging:local:check
```

O preparador cria configuração independente e manifesto em `.local-staging`. Não copia `.env`, vínculo remoto, histórico SQL, seed ou funções da produção. Migrações, seed e hook de Auth ficam desativados nesta etapa. O verificador confere os arquivos preparados; seu sucesso **não** comprova Docker disponível, banco iniciado ou aplicação homologada.

Não executar os atalhos antigos `npm run db:start` e `npm run db:reset:test` para este ambiente: eles apontam para o diretório Supabase histórico. O novo workdir ainda não contém baseline aprovado. Não usar `link`, `db push`, `db reset --linked`, reparo automático do ledger ou replay de todas as migrações para inicializá-lo.

O arquivo gerado descreve um bootstrap vazio. A ativação posterior do baseline exige uma revisão explícita do preparador e manifesto; não editar o arquivo gerado e aceitar a divergência como novo estado aprovado.

### Partida após disponibilizar o runtime

Sequência preparada, **ainda não executada**. Usar checkout Linux com ferramentas instaladas e confirmar `npx --no-install supabase --version` em 2.116.0. Exigir Docker Engine 28 ou superior para evitar a limitação de isolamento loopback em versões antigas descrita pela [documentação Docker](https://docs.docker.com/engine/network/port-publishing/).

Criar uma rede exclusiva com binding padrão local. Se o nome já existir, inspecionar driver, opções e containers conectados antes de reutilizar; não apagar nem substituir uma rede existente para fazer a sequência passar.

```sh
docker network create --driver bridge --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 agvlog-local-staging-loopback
docker network inspect agvlog-local-staging-loopback --format '{{.Driver}} {{json .Options}}'
```

Prosseguir somente se o driver for `bridge` e a opção `com.docker.network.bridge.host_binding_ipv4` for `127.0.0.1`. A CLI 2.116.0 aceita `--network-id` e publica portas sem IP explícito, usando o padrão da rede. Esse ajuste limita acesso de entrada; não bloqueia a saída dos containers para a internet. [Opções da rede bridge](https://docs.docker.com/engine/network/drivers/bridge/).

A conferência está vinculada ao tag `v2.116.0`, commit `997a1e69a4a83466964ed874d3a604c88a7b3866`: [construção das portas](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/legacy/shared/db-bootstrap/docker-create-args.ts), [seleção da rede](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/legacy/commands/start/start.handler.ts) e [preservação da rede existente](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/legacy/shared/db-bootstrap/container-lifecycle.ts). Revalidar ao atualizar a CLI. Manter o modo NAT padrão da bridge.

Após conferir o workdir preparado e ausência de vínculo remoto, iniciar somente a infraestrutura vazia:

```sh
npx --no-install supabase start --workdir .local-staging --network-id agvlog-local-staging-loopback
```

A CLI pode exibir chaves locais: não copiar esse output integral para logs versionados ou chat. Inspecionar as portas efetivamente publicadas em `NetworkSettings.Ports` para cada container deste projeto; exigir `HostIp=127.0.0.1` (ou `::1`) em todos os bindings. Se algum for `0.0.0.0`, `::` ou outro endereço, parar o projeto e corrigir antes de usar.

Listar apenas os containers pelo rótulo `com.supabase.cli.project=agvlog-local-staging`; inspecionar nomes/portas, sem extrair `.Config.Env`. O loopback é o do host Docker dentro do WSL. Verificar o acesso pelo Windows separadamente; não criar encaminhamento público para resolver eventual falha desse acesso.

O preparador e `staging:local:check` são verificadores **anteriores à partida**. Sua lista fechada também recusa metadados que a CLI possa criar depois, como `.temp`; isso não é um health check nem motivo para apagar esses arquivos. Após a partida, conferir saúde e identidade pelo runtime. A admissão desses metadados em uma próxima versão do verificador exige revisão específica; `project-ref` remoto continua proibido.

Para parar apenas esse projeto preservando os dados locais:

```sh
npx --no-install supabase stop --project-id agvlog-local-staging --workdir .local-staging
```

Não usar `--all` nem `--no-backup`. A rede exclusiva pode permanecer para a próxima inicialização. A aplicação segue indisponível até a etapa seguinte.

## 4. Restaurar o contrato publicado antes de testar o candidato

Seguir a [proposta de baseline](migration-baseline-plan-2026-09-26.md). Faltam uma DSN protegida com leitura suficiente ou um dump de esquema fornecido pelo responsável pelo banco. Credenciais devem ser disponibilizadas em armazenamento local/protegido, nunca no chat ou Git.

1. Reconfirmar versão PostgreSQL, schemas e ledger antes e depois da captura. O corte observado em 26/09 foi de 896 versões, máximo `20260924155758`; reconfirmar, pois esse registro é histórico.
2. Capturar somente esquema em área restrita. Revisar definições quanto a literais sensíveis antes de compartilhá-las. Não exportar os comandos SQL completos do ledger nem dados de clientes.
3. Completar e revisar customizações de Auth/Storage, buckets, extensões, grants, owners, políticas, triggers e publicações Realtime. Excluir segredos, jobs ativos e configurações reais de integrações.
4. Restaurar em banco descartável e comparar o catálogo anterior ao PR. Investigar diferenças de plataforma por objeto; hashes agregados são apenas triagem.
5. Aplicar os 13 forwards revisados em `baseline-candidate-manifest.json`, após executar `npm run supabase:baseline-candidate:check`. Preservar os hotfixes publicados.
6. Ativar hook de Auth e seed revisada somente após seus objetos e permissões estarem presentes. A seed atual desativa fiscal/SSX e precisa de massa adicional para validação financeira.
7. Preparar Edge e frontend com credenciais exclusivas. Conferir que `release.json.supabaseOrigin` e o backend esperado dos testes coincidam.

O baseline de teste fica fora de `supabase/migrations` do release e jamais é aplicado no banco de produção.

## 5. Aprovação e prevenção de regressões

Executar lint de banco, `supabase/verify/baseline_contract.sql`, pgTAP e a matriz do [roteiro de estabilidade](production-stability-playbook-2026-09-26.md). Importação, fiscal e financeiro precisam comprovar ação e efeito persistido, inclusive erro, repetição e concorrência.

A jornada do motorista altera fixtures compartilhadas e cria histórico imutável. Cada tentativa deve ter backend descartável exclusivo ou entidades completas independentes com ciclo de vida comprovado. Reduzir workers ou retirar retries não demonstra isolamento. Não reutilizar banco de homologação manual em testes que o reinicializem.

Registrar SHA, identidade do backend, versões de CLI/imagens, hash do baseline, forwards, horário UTC, comandos, resultados e pendências. Logs de falha incluem operação, código de erro e correlação, sem JWTs, senhas, XMLs ou dados pessoais. Os resultados só aprovam a versão e o ambiente efetivamente exercitados.

Estados permitidos no log: **arquivos preparados → infraestrutura iniciada → baseline restaurado/comparado → candidato testado → homologação aprovada**. Nenhuma etapa implica automaticamente a seguinte. A promoção pública continua sujeita ao gate completo e ao plano de retorno.

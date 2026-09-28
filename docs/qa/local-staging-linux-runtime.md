# Ferramentas da homologação no Ubuntu do WSL

O script `scripts/provision-local-staging-linux.sh` prepara **uma distribuição WSL 2 nova e dedicada**, Ubuntu 24.04 `noble`, arquitetura `amd64`, com systemd ativo. Executar como root somente após revisar o script e conferir a distribuição alvo. Ele não transporta o projeto, instala dependências da aplicação, inicia Supabase ou cria containers.

## Versões e fontes conferidas em 28/09/2026

| Componente | Versão fixada |
| --- | --- |
| Docker Engine e CLI | `5:29.8.1-1~ubuntu.24.04~noble` |
| containerd.io | `2.3.6-1~ubuntu.24.04~noble` |
| Docker Buildx | `0.37.1-1~ubuntu.24.04~noble` |
| Docker Compose | `5.5.1-1~ubuntu.24.04~noble` |
| Node | `22.23.2`, distribuição oficial Linux x64 |
| npm | `10.9.4`, pacote oficial separado |

O procedimento segue a [instalação oficial Docker para Ubuntu](https://docs.docker.com/engine/install/ubuntu/) com versões existentes no [índice oficial `noble/amd64`](https://download.docker.com/linux/ubuntu/dists/noble/stable/binary-amd64/Packages.gz). O Apt verifica a assinatura do repositório e a integridade dos pacotes. A chave ASCII também tem SHA-256 fixado no script: `1500c1f56fa9e26b9b8f42452a553675796ade0807cdce11975eb98170b3a570`.

O arquivo [Node Linux x64](https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz) é conferido contra SHA-256 `d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307`, publicado no [manifesto oficial](https://nodejs.org/dist/v22.23.2/SHASUMS256.txt). Esse Node inclui npm 10.9.8; por isso o script mantém um pacote npm 10.9.4 separado no prefixo exclusivo.

O [tarball npm 10.9.4](https://registry.npmjs.org/npm/-/npm-10.9.4.tgz) tem SHA-256 `4bfba8a0c823024d1926ec9d97a37a00eb60fd2adf44b3d34a686fc32e8f51e4`, calculado após conferir sua integridade SHA-512 contra os [metadados oficiais da versão](https://registry.npmjs.org/npm/10.9.4). Os dois arquivos são verificados antes da extração. O script não baixa nem executa instaladores por pipe.

## Efeitos e limites

- Instala `ca-certificates`, `curl`, `xz-utils` e `git` pelos repositórios Ubuntu; não executa atualização geral da distribuição.
- Configura a fonte Apt oficial Docker e instala apenas as versões Docker acima, usando `--no-remove` e `--no-install-recommends`.
- A instalação Ubuntu pode iniciar o daemon Docker padrão com socket Unix local. O script não configura acesso TCP, portas publicadas, túneis, redes adicionais ou cargas de trabalho.
- Recusa runtimes concorrentes, versões Docker divergentes, fontes/chaves Apt conflitantes, configuração customizada do daemon e destinos controlados por links. Não remove os pacotes conflitantes.
- Mantém Node/npm em `/opt/agvlog-staging-runtime`, sem alterar executáveis do sistema nem perfis. Registra versões e hashes em `manifest.txt`; nova execução exige correspondência desse manifesto e das versões.
- Cria `agvqa` sem senha, se ainda não existir, e `/home/agvqa/agvlog-main` com o proprietário correto. Não configura `sudoers`, não concede acesso ao grupo Docker e não muda configurações globais do WSL.
- Uma falha posterior à instalação pode deixar pacotes já instalados. A execução repetida aceita as mesmas versões; um conflito exige inspeção, sem limpeza automática de dados ou instalações existentes.

O diretório da aplicação pode permanecer vazio até a transferência Git. Em comandos Linux do projeto, usar explicitamente:

```sh
export PATH=/opt/agvlog-staging-runtime/bin:$PATH
node --version
npm --version
```

Esperado: `v22.23.2` e `10.9.4`. O usuário pode ser selecionado no Windows com `wsl --distribution Ubuntu-24.04 --user agvqa`; a ausência de senha não impede esse mecanismo. A eventual permissão ao grupo Docker deve ser uma ação separada, pois concede controle privilegiado sobre a distribuição.

Depois da preparação, conferir daemon/socket, versões, mesmo SHA Git, dependências Linux próprias e binding loopback da rede de homologação. Somente então seguir o [guia de homologação](local-staging-guide.md). Instalação das ferramentas não comprova banco, baseline ou aplicação homologados.

## Instalação executada em 28/09/2026

Após o reinício informado pelo responsável, foi instalada a distribuição `Ubuntu-24.04` (24.04.5 LTS), em WSL 2.7.13.0, kernel `6.18.33.2-microsoft-standard-WSL2`, PID 1 `systemd`. O script concluiu com código 0. Seu SHA-256 executado foi `c84562bfb0975abf881ae38c3ec1d636c60b64bc82986f7a2da9767550db1a17`.

Separadamente, foi concedido acesso Docker a `agvqa` pelo grupo `docker`. O daemon 29.8.1 ficou ativo apenas pelo socket Unix. O checkout `/home/agvqa/agvlog-main` foi clonado de bundle Git verificado, sem copiar dependências ou `.env` do Windows. `npm ci` concluiu com 620 pacotes instalados, 621 auditados e zero vulnerabilidades informadas. Consultar o [log](release-log-2026-09-28-local-staging.md) para SHA, identidade do bundle e evidências de runtime.

## Ciclo de vida no Windows

Serviços systemd não mantêm uma distribuição WSL ativa por si mesmos, conforme a [documentação Microsoft](https://learn.microsoft.com/en-us/windows/wsl/systemd). Nesta instalação, o encerramento do último comando WSL parou a distribuição; a invocação seguinte reiniciou os containers. Isso foi observado pelos horários de início dos serviços, sem falha de saúde persistente.

Durante os testes de 28/09, foi mantido um cliente WSL oculto em segundo plano, com distribuição e usuário explícitos:

```powershell
$stagingSession = Start-Process -FilePath "$env:WINDIR\System32\wsl.exe" -ArgumentList @('--distribution', 'Ubuntu-24.04', '--user', 'agvqa', '--exec', '/usr/bin/sleep', 'infinity') -WindowStyle Hidden -PassThru
$stagingSession | Select-Object Id, StartTime
```

Registrar PID, criação UTC e comando em arquivo local ignorado. Antes de iniciar outro cliente, conferir se a sessão registrada ainda é a mesma e está ativa. Esse processo não configura inicialização automática: reiniciar o PC, sair da sessão Windows ou encerrar WSL exige nova partida. Uma sessão de shell WSL mantida aberta também permite trabalhar com a distribuição ativa.

Para retomar depois do reinício:

1. Conferir `wsl --list --verbose`; iniciar a sessão da distribuição correta, mantendo-a ativa.
2. Entrar como `agvqa`, definir o PATH acima e acessar `/home/agvqa/agvlog-main`.
3. Conferir SHA/diff, Docker, CLI, configuração e rede conforme o [guia](local-staging-guide.md). Não reinstalar ferramentas nem criar outra rede se a existente estiver íntegra.
4. Executar a partida da stack com o workdir e a rede explícitos. O output pode conter chaves locais; mantê-lo fora de logs versionados.
5. Aguardar a saúde dos serviços e executar `npm run staging:local:health`. Conferir Studio no Windows em `http://127.0.0.1:55323` e repetir a verificação após um período ocioso; horários `startedAt` e `restartCount` ajudam a detectar reinícios.

Para encerrar, primeiro executar dentro do checkout Linux:

```sh
npx --no-install supabase stop --project-id agvlog-local-staging --workdir .local-staging
```

Depois, conferir **PID, horário de criação e comando completo** do cliente WSL registrado antes de encerrá-lo. Nunca usar um PID histórico sem essa comparação. Não usar `--all`, `--no-backup` ou `wsl --shutdown` para parar apenas esta homologação. Volumes e rede permanecem preservados. O procedimento de parada está documentado; os serviços foram mantidos ativos nesta sessão para continuar a preparação.

# F02 / F09 / F11 — correções locais do motorista

Task `driver-checklist-stops-f02-f09-f11-20261006`, owner `CodexChecklist`.
Worktree: `F:/AGVLOG/work/driver-checklist-stops-f02-f09-f11-20261006`.
Base de revisão congelada: `61adbbb997667396541244da147b224defb22e94`, tree `328f33f69c352720574b24deebaa9d19bde7faaf`.
Criada por `agvlog.mjs fork-review`; checks de dono, reservas, ancestralidade, fonte limpa e pin público passaram antes de edição/testes.
`integration/local` permanece `deda6fd1fa765648f8de1785a1a7693081ad11bb`; pin público observado pelo coordenador: `63278f7ef77dd1c4e0db7d9e7219ca48280ee18a`.

## Delta explícito

- `src/pages/driver/DriverChecklist.tsx`
- `src/pages/driver/DriverStops.tsx`
- `src/pages/driver/DriverIssues.tsx`
- `src/test/DriverAuxOfflineRoutes.test.tsx`
- `src/test/DriverStopsComponent.test.tsx`
- `src/test/DriverChecklistOfflineQueries.test.tsx` (claim adicional pelo coordenador)
- `docs/qa/driver-checklist-stops-f02-f09-f11-2026-10-06.md`

`src/test/DriverIssuesSeverity.test.tsx` foi reservado inicialmente, mas não foi criado; os casos de tradução estão em DriverAuxOfflineRoutes. Nenhum outro arquivo de produto, migration, manifesto ou configuração faz parte do delta.

## Comportamento

F02: após a leitura local terminar, consultas pausadas offline sem contexto completo não mantêm o loader indefinidamente. A página mostra indisponibilidade explícita e não monta controles de escrita. Um snapshot precisa corresponder a tenant, ator, viagem e motorista resolvido, além de conter as duas partes do checklist com índices/revisões/boundaries compatíveis. Erro de leitura local ou snapshot parcial também termina em aviso finito.

Com checklist disponível, a seção existente continua submetendo ao outbox o comando com revisão/boundary originais; não há novo transporte ou bypass de autenticação. Erros de autorização, identidade sem motorista ativo ou viagem negada bloqueiam a página mesmo com cache. Erro na atualização online bloqueia os controles. Carregamento incompleto sem snapshot também bloqueia escrita. Um resultado vivo vazio substitui marcações antigas; os campos usados vêm integralmente da fonte viva ou do checklist salvo, evitando combinar revisão viva com conteúdo antigo. Snapshot idêntico não é regravado a cada renderização.

F09: chegada e saída exibem dia/mês/ano e hora/minuto em pt-BR, no fuso padrão do navegador/aparelho, acompanhando o formato de data/hora já existente no detalhe. Datas separadas são formatadas a partir de cada timestamp; saída ausente não aparece.

F11: formulário e lista compartilham low→Baixa, medium→Média, high→Alta; valor desconhecido mostra Não informada. Map evita também lookup herdado para valores inesperados como __proto__. Valores persistidos e cores existentes permanecem com o contrato atual.

## Verificação local

Runtime final: Node `22.23.2`, npm `10.9.4`, Vitest `4.1.11`. Dependências copiadas para node_modules próprio do worktree; nenhum cache, serviço ou teste do revisor foi usado como ambiente de execução.

Comando focado, executado com TZ=UTC e depois TZ=America/Sao_Paulo:

```text
node node_modules/vitest/vitest.mjs run src/test/DriverAuxOfflineRoutes.test.tsx src/test/DriverStopsComponent.test.tsx src/test/DriverChecklistOfflineQueries.test.tsx src/test/driverOperationalOffline.test.ts --maxWorkers 1
```

Resultado final em cada fuso: quatro suites, 50/50 testes PASS. Typecheck completo (`tsc --noEmit -p tsconfig.app.json`), lint dos seis arquivos TS/TSX do delta com `--max-warnings 0`, e `git diff --check`: PASS.

Matriz inclui cache frio/aquecido/parcial; leitura local pendente/falha; link de outra viagem; troca de tenant/ator; reabertura; carregamento online; erro online; motorista revogado; checklist vivo vazio; fila com revisão/boundary; replay e isolamento; chegada/saída em dias e meses distintos; saída ausente; virada de ano em UTC/São Paulo; três severidades e fallback.

DriverChecklistOfflineQueries usa os hooks reais de identidade, viagem/jornada e checklist com TanStack onlineManager pausado e transporte Supabase simulado. Confirma status pending/fetchStatus paused sem chamadas ao transporte, reabertura, reconexão e remoção de controles após revogação confirmada. Não é execução nativa de RPC/RLS.

O teste de replay usa serviço/outbox reais em memória: persiste offline, reabre o serviço, ignora ator/tenant alheios, reutiliza request/payload, confirma uma vez e deixa a fila vazia em recuperação repetida. A resposta do servidor é fixture; idempotência do banco e concorrência nativa continuam com o revisor.

Datas de virada de ano testadas: `2027-01-01T01:30:00Z` e `2027-01-01T03:30:00Z` resultam em `31/12/2026, 22:30` e `01/01/2027, 00:30` em São Paulo; em UTC, `01/01/2027, 01:30` e `01/01/2027, 03:30`.

Rodadas iniciais no Node24 também passaram; a entrega usa as evidências finais repetidas no runtime Node22 obrigatório. Dois asserts iniciais de pontuação do loader foram corrigidos de ponto para reticências; nenhum teste foi removido/skipped ou teve uma negativa afrouxada.

Logs e pacote imutável: `C:/Users/Thomaz/Documents/Codex/2026-10-06/task-5/delivery/` (`final-utc.log`, `final-sao-paulo.log`, `runtime.log`, `typecheck.log`, `lint.log`, `candidate.json`, bundle e delta.patch). SHA/tree/delta/hashes finais constam em candidate.json após o commit pelo coordenador.

## Limites e handoff

Fonte 61ad limpa e preservada. main.tsx, SW/AuthContext, DriverCargoCustody, DriverDeliveries/sheets, transporte fiscal e SQL não foram alterados. Sem réplica compartilhada, dados reais, produção, push, deploy, enqueue ou integrate.

A entrega fica fixada no SHA/tree e bundle; não haverá edição posterior deste checkout após o handoff. O CLI agvlog.mjs atual não expõe congelamento independente de uma criação de fork. A marcação formal status=frozen no coordenador pertence à integração; este agente não altera state.json/coordenador nem cria uma nova task desnecessária para contornar essa ausência. Reteste nativo e validação do SHA combinado permanecem pendentes da integração/revisor exclusivo.

Fonte de escopo: triagem `F:/Vault/Main Vault/05 Sessoes/Correção AGVLOG/2026-10-06-0940-Codex-triagem-auditoria-candidato61adbbb9.md`; instruções F:/AGVLOG/AGENTS.md, README e AGENTS herdado; coordenação Vault lida. Nota própria será registrada no Main Vault; índice compartilhado preservado.

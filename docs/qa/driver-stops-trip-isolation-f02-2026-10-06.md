# F02/P2: isolamento da viagem solicitada em Paradas

Owner: CodexChecklist. Reserva: `driver-stops-trip-isolation-f02-20261006`.
Worktree próprio: `F:/AGVLOG/work/driver-stops-trip-isolation-f02-20261006`.
Base congelada: `ad5ff718cbc198d34e613a781731b5f832a727e3`; tree `c371d65861234179f99dc0a4a76e77b89f1f42a3`.
Reserva criada por `fork-review`; preflight do coordenador conferiu dono, branch, base, pin publicado e paths explícitos. A fonte congelada e a réplica do revisor não foram alteradas.

## Contraprova que motivou o delta

O readback nativo existente da base registra URL B, GET específico de B com HTTP 200 e array vazio, Query `success/idle/data=null`, mas DOM com cinco paradas da viagem A cerca de 45 segundos depois. Nenhum comando/upload foi enviado e nenhum controle de navegação foi clicado nessa captura.

Fontes preservadas:
- `C:/Users/Thomaz/Documents/Codex/2026-10-01/task-3/AD5FF718-INDEPENDENT-TECHNICAL-HOMOLOGATION-VERDICT.md`
- `C:/Users/Thomaz/Documents/Codex/2026-10-01/task-3/CURRENT-PARENT-F02-REQUESTED-TRIP-NATIVE-MISMATCH-HANDOFF-ad5ff718.json`
- `C:/Users/Thomaz/Documents/Codex/2026-10-01/task-3/subagents-ad5ff718/freight/F02-native-200empty-contraprova-readback.json`
- Captura original `subagents-ad5ff718/freight/F02-runs/2026-10-06T20-00-04-397Z-12916/evidence.json`; SHA-256 reconferido: `d2035955af1191cbff9c4098862bf72d85e4bc8fefc93c067eb978ca8f20be18`.

O status original `BLOCKED_OR_INCONCLUSIVE_NATIVE_OBSERVER` permanece preservado: o predicado global de leituras pendentes não terminou, embora a consulta específica B e o mismatch de identidade no DOM tenham evidência concreta. Esta correção não transforma aquela execução em aceite nativo geral nem aprova os 19 objetivos do candidato.

## Comportamento corrigido

Quando há `?trip=B`, a resolução e a busca de snapshot usam B, independentemente da viagem automática A. Resposta autorizada vazia termina em “Viagem indisponível”, sem paradas/ações/navegação de A. Erro online termina em estado de falha; cache não substitui a resolução online. Denial explícito (401/403/42501/PGRST301/PGRST302/PGRST116), identidade ausente/inativa ou viagem resolvida inexistente bloqueiam também o fallback offline.

As chaves das duas consultas locais incluem tenant, motorista, viagem e ator. Snapshots legados/operacionais conferem tenant, ator, viagem solicitada e motorista conhecido antes da renderização; efeitos descartam respostas tardias de leitura/persistência após mudança de rota/sessão. Overlays da fila conferem tenant e ator além da viagem. Uma leitura bem-sucedida de paradas vazias prevalece sobre snapshots antigos, inclusive ao ficar offline.

Offline, o snapshot próprio de B continua disponível mesmo sem `autoTrip` ou sem consulta online do motorista. Quando só A está salva, B mostra indisponibilidade finita e nenhum controle operacional. A mutação local de Paradas usa `networkMode: 'always'` para chegar ao serviço offline existente: o teste com `onlineManager=false` revelou que o padrão do TanStack pausava antes da persistência na fila. O serviço continua persistindo antes do transporte e usando request id estável para recuperação; não há configuração global, novo transporte, alteração de storage/SQL ou relaxamento das guardas de início/chegada/parada terminal.

## Delta exclusivo

- `src/pages/driver/DriverStops.tsx`: resolução, cache e fila com scope; estados finitos de indisponibilidade; mutação local offline.
- `src/test/DriverStopsTripIsolation.test.tsx`: 22 cenários com TanStack Query real, MemoryRouter, localStorage real, transporte mock e snapshot operacional em memória.
- `src/test/DriverStopsComponent.test.tsx`: fixtures existentes agora fornecem ator/motorista válido e objetos estáveis; assertions existentes preservadas.
- `docs/qa/driver-stops-trip-isolation-f02-2026-10-06.md`: esta nota.

## Verificação local concluída

Runtime Node 22.23.2; npm 10.9.4 disponível. Typecheck `tsc --noEmit -p tsconfig.app.json` PASS; lint dos três arquivos TypeScript com `--max-warnings 0` PASS; `git diff --check` PASS.

46 testes/4 arquivos PASS em UTC e novamente em America/Sao_Paulo: isolamento novo (22), componente existente (15), snapshots de rota (5) e serviço operacional offline (4). Hashes dos três arquivos conferidos antes/depois da execução final. Logs, comandos, timestamps, exits e hashes estão em `C:/Users/Thomaz/Documents/Codex/2026-10-06/task-5/stops-isolation-delivery/validation.json` e logs adjacentes.

Casos novos: A→B vazio, erro de transporte, 42501/403; B sem viagem automática; revogação/empty refresh com cache B anterior, seguida de offline; troca de ator/tenant com mesmos IDs de viagem/motorista; resposta tardia de A; cache próprio B operacional/legado offline; ausência de cache B; leitura tardia entre rotas/sessões; readback de outro ator; overlays incorretos rejeitados/correto preservado; resposta vazia de paradas não ressuscita dados; persistência tardia de A não substitui B. Os testes existentes do serviço verificam persistência antes do transporte, recuperação com request id original e tratamento de confirmação incompatível.

A validação interrompida pelo desligamento do executor não recebeu PASS presumido. Após reconexão, inspeção de processos não encontrou TypeScript/Vitest antigos ativos; types e suite final foram executados com logs novos. Os testes são locais com transporte/serviço em memória, não uma homologação nativa de RLS/RPC/IndexedDB/SW/reabertura do navegador.

## Entrega e limites

O SHA/tree/delta definitivo, bundle incremental verificado, hashes e nota própria do Main Vault ficam no `candidate.json` do diretório de evidências após o commit coordenado. Edições encerradas após esse commit; sem enqueue/integrate por esta frente. O freeze formal de metadata fica com o dono da integração, pois o coordenador atual não expõe operação standalone de freeze.

Reteste nativo do novo SHA/árvore combinada pertence ao revisor exclusivo, inclusive aceite de isolamento B, denial, offline/reabertura e replay no backend próprio. Esta aprovação local não herda nem amplia aceite do candidato combinado. Sem teste na réplica compartilhada, SQL, dados reais, produção, push ou deploy. Índice e notas de integração do Vault preservados.

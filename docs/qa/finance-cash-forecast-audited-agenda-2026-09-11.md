# Agenda auditada da previsão — núcleo privado local

Migração 94505, sem aplicação remota, grants públicos, UI, stage ou alteração dos arquivos históricos 82303/84618/90256. SHA no manifesto adjacente.

## Contrato

`cash_forecast_agenda_preview(tenant,cutoff,period_end,economic_key)` resolve a origem real pela coleta integral e retorna identidade, revisão global, origem, eligible e can_execute=false. `record_cash_forecast_agenda(jsonb)` aceita version/tenant_id/request_id/economic_key/action(set|clear)/expected_on/reason/expected_revision/cutoff/period_end. Datas de set devem ser finitas e atuais/futuras; clear exige null. A conta/data fiscal/vencimento/nominal não mudam. A origem precisa estar válida e possuir saldo restante; sua identidade vem da coleta, não de atributos livres.

Journal privado append-only guarda sequência, predecessor, ator/nome/motivo, pedido/hash, data e source_snapshot integral da origem consultada. Replay exato permanece igual; payload conflitante é recusado. Travas fiscal→finance e autorização repetida depois da espera e antes do retorno. Tabela com RLS sem grants e trigger de imutabilidade. CHECK liga identidades do source_snapshot e resultado à linha.

Coletor atual mantém OID via CREATE OR REPLACE; predecessor de corpo/ACL/config exatos é copiado para base privada. Overlay mostra original_expected_on/source e agenda com histórico; set aplica reviewed_date. Alteração posterior da revisão da origem torna a agenda stale, data indeterminada e issue por cenário. Clear restaura a data original atual sem apagar histórico. A coleta muda de revisão; capturas antigas não são reescritas. Projector recebe patch por fingerprint exato e valida metadados/cadeia antes de retirar apenas os extras das linhas projetadas; collection conserva o histórico. Contrato TS mantém campos novos opcionais para ler capturas antigas.

## Provas

24 testes integrados passaram em 06:52:45: 5 agenda + 19 regressões de coletor/adapter/projetor, incluindo 1005 origens. Após ajuste para preservar OID, 5 casos agenda passaram novamente em 06:53:36. Lint dos arquivos TS passou.

Agenda: origem a receber e a pagar reais; set/replay/clear, due_date/nominal intactos, nenhuma movimentação nova; captura original íntegra; paridade SQL/TS; revisão desatualizada/data passada/conflito recusados; mudança da origem diagnosticada; empresa/motorista misto/revogação no replay negados; rollback sem evento residual; histórico malformado e UPDATE do journal recusados.

## Limites e integração posterior

Somente PGlite com fixtures financeiras existentes, sem ensaio nativo de concorrência nesta entrega. Escrita continua privada: nenhuma promoção. Não executa pagamento nem modifica documento fiscal. Não define regras automáticas de vencimento, não parcela previsão, não escolhe conta futura. Identidades de frete usam o mesmo catálogo real do coletor, mas os positivos novos desta suíte são título a receber e a pagar; cenários de frete devem ser cobertos antes de UI específica. Revisões de dependências de promoção futura precisam usar o coletor/projetor atuais; 90256 não deve ser reaplicada com fingerprints antigos. Base privada não deve ganhar grants.


## Revisão final e integração atual

Candidata anterior SHA3121a9634f9390d3d6a44471dd06874afa5c38703196f47f1a1366a9a22da15e. Foram acrescentados locks FOR SHARE NOWAIT de memberships/drivers depois das travas fiscal/finance; conflito retorna40001. Evento central finance_events com actions cash_forecast_agenda_set/cash_forecast_agenda_cleared, e patch estrito do leitor audit_events pós94523 (MD5 0efd075f0793baa6e919d8551d34ba92) classifica ambas como intervenção manual. Replay não duplica evento. Alteração/removal permanecem privados.

Metadados agora verificam também last set ↔ expected_on/source, stale ↔ data null/unknown e clear ↔ data original. SQL e TS recusam contraprovas, além da sequência/IDs únicos do histórico.

Provas novas: 7 testes próprios passaram07:07:29; frete real R$125,50 (mercadoria R$999.999 distinta) só passa ao scheduled.unbilled após data revisada, sem entrada no confirmado, e clear retorna à falta de data; paridadeSQL/TS preservada. Central manual audit mostra ambos eventos, com histórico intacto. Teste independente cashForecastAgendaCurrentCosts.test.ts passou07:08:35 com core92319, boundary94310, leitor94523 e agenda94505: complemento nominal5000 agendado, extinção real retira título da previsão, reserva10000 e nominalcancelled5000 permanecem, evento de agenda continua. ESLint quatro arquivos saída0.

A primeira tentativa da fixture94523 rejeitou o predecessor incompleto local; foi instalado o corpo real capturado em docs/qa/finance-manual-audit-predecessor-2026-09-11.sql, como no teste da raiz, sem relaxar o guard. Primeiro teste de extinção enviou extras do preview no proposal estrito e foi recusado; payload do teste corrigido para campos públicos admitidos, sem mudar core. Esses ajustes são de fixture/teste, não reparos em produção.

Helper compartilhado src/test/helpers/cashForecastAgendaDatabase.ts exporta createCashForecastAgendaDatabase, installCashForecastAgenda(db), seedCashForecastAgendaReceivable(db). Native fará ensaio de autorização concorrente e boundary separada; esta entrega não reivindica esse resultado. A limitação anterior de ausência de positivo de frete foi resolvida nesta revisão.


Correção final de snapshot (revisão da raiz): preview e coleta-base agora são avaliados em uma única instrução SELECT, ambos STABLE. O comando não pode aceitar a revisão de uma fotografia e gravar origem de outra. Mudança depois dessa leitura conserva o source_revision capturado; a agenda fica stale na coleta seguinte. Não há bloqueio novo sobre o título/documento. Hash final3ab38431ac00ba1f1affd80caf59eaf8433fa5f6372eeead9a447f70819ea081, 8 testes passaram07:11:16. Native recebeu esta candidata para prova concorrente; nenhum resultado nativo reivindicado neste documento.

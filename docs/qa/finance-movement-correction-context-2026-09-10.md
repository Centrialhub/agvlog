# Contexto de correção de movimento — leitura e readiness

Migração local 20260910190516_finance_movement_correction_context.sql.
SHA-256 aefa6e937c708cf31e983c7bf6bdfef8a2e788ed68bcf0683a67b4c256367b32.
Factory movementCorrectionContextDatabase.ts SHA-256 12e84e1210cf395285af051dd31f0bea37391776e5867cac3d21091ce5a81bf1.

## Contrato

finance_private.movement_correction_context(tenant uuid,movement uuid) retorna version=1, operation=void, tenant_id, movement_id, revision, eligible, origin, void, dependencies, blockers, readiness, effects. Não expõe comando nem grant de aplicação. Root adiciona wrapper190635 com can_execute=false.

origin preserva integralmente movement_recording_origin185517. dependencies é mapa de tabela para arrays de linhas históricas; blockers contém code/source_table/source_ids. Referências de UUID dentro de JSON são normalizadas, incluindo maiúsculas e chaves, sem busca por substring. Dados inexistentes/de outro tenant lançam movement_not_found; acesso financeiro é obrigatório, inclusive exclusão de perfil motorista misto.

Efeitos são somente prospectivos: computation=prospective_invalidation, bank_money_transacted=false; saída retirada resulta em outflow_delta negativo e balance_delta positivo. Entrada retirada gera inflow_delta e balance_delta negativos. Se já corrigido, effects=null. Nunca significa dinheiro bancário enviado ou alteração já feita.

## Grafo e decisões

O grafo percorre arestas explícitas em ambos os sentidos quando necessário: alocações, custos/lote/título, pagamentos/links/reversões, recebíveis/command/banktx/aliases/refund/correção, acerto/itens, folha/adiantamento, descarga e origem/observação fiscal. Command de recebível que menciona o ID também inicia o grafo mesmo se seu link estiver ausente. Referências polimórficas exigem par source_table/source_id. Iteração converge ou bloqueia em32passagens; nenhuma truncagem silenciosa libera elegibilidade.

Qualquer histórico de alocação, baixa, conciliação (mesmo revertida), transferência, folha/acerto, descarga ou obrigação dependente impede esta primeira operação livre. Backlinks de duplicate/replacement também bloqueiam. Outros comandos/eventos além do registro original impedem autorização automática por ausência de links. O contexto preserva os IDs e a explicação; não desfaz nenhuma dessas relações.

Fechamentos e reaberturas integram a revisão. assert_closed_source_mutable real é invocado; somente SQLSTATE55000 vira blocker, nunca sucesso. Erros não previstos propagam. Um fechamento reaberto não permanece bloqueador por mera existência histórica. Registro de dependências por IDs também é lido.

## Readiness

Verifica identidade, tabela, tipo, habilitação, ausência de WHEN/argumentos e flags diferidas dos guards5links/3pagamentos/conciliador. Exige marcadores das versões ativas das8opções,3leituras de conciliação, projeções de período, provas e capacidade. O baseline privado imutável captura corpos/config/ACL/definer dessas funções, definitions dos triggers e definição/ACL/reloptions de active_movements; deriva posterior bloqueia.

Esse baseline detecta mudança após instalação; não é atestado de que qualquer implementação encontrada estava aprovada. A aprovação inicial depende do catálogo/revisão/testes da release. Can_execute permanece false no wrapper até um writer específico e seus guards residuais serem testados. Atualizações legítimas futuras dessas definições exigem nova revisão explícita do baseline.

## Evidência

9 testes próprios PGlite e4 testes root de wrapper+schema passaram juntos (13). ESLint passou. Testes próprios cobrem: registro manual real livre/deltas; baixa real de pagável preservada; histórico de grupo revertido; desabilitação/substituição de guard; mudança de reader para raw e reloptions da view; origem desconhecida/perfil misto; fechamento semeado→reabertura por comando real→elegibilidade com histórico; obrigação polimórfica; JSON UUID com maiúsculas/chaves; perna de transferência histórica.

A factory instala corpos reais: fechamento/caixa/provas, guards83506, recon83442/014238, período83438, record84213, origem85517,8 opções84543 e respectivas definições anteriores. Tabelas de origens fiscais usam DDL real com FKs externas omitidas; a suíte não executa emissão fiscal. Grupo/transferência/fechamento históricos foram semeados; não se afirma que esses comandos de criação foram executados. Nenhum stub de writer bem-sucedido foi acrescentado. Não houve TSC, banco remoto ou PostgreSQL nativo nesta entrega; execução nativa independente pertence ao agente bank_period_evidence.

## Residual para o writer

O contexto sozinho não resolve concorrência com novos dependentes. Além dos guards de links existentes, o writer precisa cobrir source_table/source_id de payables/financial_obligations/payroll_entry_items/driver_settlement_items, OLD e NEW; pernas de transferências e backlinks de correções também exigem guarda ativa. Ticket privado, INSERTguard de void, fingerprint de seus próprios guards e checagem final sob trava ainda são responsabilidade da próxima migração. Não há suporte a replacement/duplicate nem a corrigir movimento já pago nesta primeira operação.

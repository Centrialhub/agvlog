# Captura privada de previsão — candidato em integração

84626 implementa journal privado com RLS, sem grants diretos, imutável após inserção. O comando coleta no servidor e executa a projeção SQL; não aceita uma previsão monetária fornecida pelo cliente. A revisão esperada é conferida antes de salvar. O request_id conserva replay do resultado original mesmo quando títulos atuais mudam, mas revalida acesso antes de responder.

São preservados collection, projection, issues e content_hash. O leitor retorna o original sem recalcular pelas regras ou títulos atuais e confere vínculo com comando e evento. A transação grava captura, auditoria e comando juntas. Não cria título, pagamento, movimento bancário, reserva de crédito nem documento fiscal.

Teste src/test/cashForecastSnapshots.test.ts:5 casos passaram05:51:31, usando coletor82303 e projetor84618 reais sobre fixture com abertura bancária validada por extrato. Cobre histórico após alteração do título/replay, revisão obsoleta, rollback por falha injetada na auditoria, revogação/empresa alheia/raw ACL e imutabilidade/conflito de pedido. Lint focado0. TSC81338 terminou com saída0, sem diagnósticos.

Nenhuma candidata de previsão foi aplicada em produção; dependências seguem sendo aprimoradas pelos autores e estes hashes registram somente o estado observado agora, não um congelamento final. APIs públicas, listagem/histórico e interface ainda faltam; nenhuma previsão foi criada no banco do cliente.

{
  "20260911082303_finance_cash_forecast_private_collector": "e2733a0b69c6f14bc251233ae6be4d5c83ec2e8bcff94c492939d11ba2e72b7a",
  "20260911084618_finance_cash_forecast_pure_projection": "9dc624259e068cff21a3d56d191682e4fb380232cb9d13c5882958c22649eed6",
  "20260911084626_finance_cash_forecast_preserved_snapshots": "867d37ca89c4b05638644591faef6d80e1dae145c4b3c2b14f1654b425741513"
}


## Integração final 11/09

Snapshots e readers:7 testes reais aprovados (captura/replay, mudança de origem preservada, rollback, tenant/revogação, imutabilidade, histórico31 com paginação30+1/revisão obrigatória e fontes65 com páginas30+30+5). Fronteira pública90256:6 testes. Revisão independente dos readers:2 testes.

Rota /financial/cash-forecast criada e adicionada ao grupo Financeiro, sob o mesmo bloqueio de acesso. Navegação:6 testes, incluindo link oculto sem autorização e seleção correta. UI:15 testes com parser de RPC SQL real, preservação, recuperação e paginação.

92902 acrescenta identificação atual nas páginas de fontes (nome/descrição/documento), sempre com filtro tenant e rótulo current_identification. Não altera a captura ou seus valores. Dois testes reais confirmam que nome/descrição atuais podem mudar enquanto nominal/hash/revisão originais permanecem iguais, e que IDs de outra empresa não revelam nomes. Contrato frontend real parseia a página enriquecida.

O coletor foi instalado também sobre a cadeia publicada de custo regularizado/devoluções/complemento/aprovação. Teste real confirmou obrigação5000→2000→pago2000 mantendo a reserva original10000. Helper compartilhado foi extraído para reutilizar a instalação fiscal/coletor sem substituir funções por stubs. Não representa reset integral Supabase ou sessão autenticada hospedada.

Build27360 passou:4690módulos/19.10s e scan de artefato limpo. TSC final sob coordenação root. Nenhuma emissão fiscal foi executada.

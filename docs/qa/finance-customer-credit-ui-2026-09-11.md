# Crédito de clientes — frontend local, 2026-09-11

Entrada pela página Contas a Receber, botão **Créditos de clientes**. Consulta global mantém créditos sem disponibilidade/diagnóstico, busca por pagador e filtro opcional disponível. Catálogo de títulos é limitado pelo servidor ao mesmo pagador. Histórico apresenta ator, motivo, evento e vínculo fiscal, com liberação somente após prévia atual. Paginação de 30 registros com total integral, revisão e geração nova ao reiniciar após 40001; cache Infinity coberto.

Aplicar ou liberar usa somente os RPCs públicos03921, sem update genérico ou novo movimento monetário. Antes/depois previsto da liquidação, saldo do título e crédito disponível separados do dinheiro. Confirmação exige prévia fresca, can_execute, motivo e conferência explícita. Outbox tenant/actor persiste corpo antes do envio, usa WebLocks, repete request exato após incerteza, valida identidades/ação/valor no retorno. Liberação valida o ID da aplicação original. Primeiro erro definitivo limpa pedido; erro após resultado incerto preserva. Outro registro de aba nunca é sobrescrito ou apagado.

Invalidação compartilhada cobre catálogos, prévia, contexto/lista/carteira/histórico dos recebíveis, projeções de fatura/fechamento, auditoria e previsão/agenda atual. Snapshots preservados da previsão não são alterados. Resultado confirmado continua terminal quando atualização falha. Seleção nova não usa linhas escondidas por refetch/erro.

## Evidência

14 testes novos do comando:5 UI,4 outbox,3 cliente,2 contrato; todos passaram. Teste do cliente usa método de instância com this obrigatório, comprovando bind do Supabase SDK. Mais17 testes distintos dos consumidores descritos em finance-receivable-credit-presentation-2026-09-11.md; as8 regressões de página/carteira passaram novamente após integração. Lint focal de todos os arquivos próprios passou. Parser completo do contexto validado diretamente com RPC SQL real no teste receivableCreditContextDatabase; native confirmou os3 parsers de catálogo/prévia/resultado com5 testesSQL públicos e5 provas nativas próprias (evidência reportada pelo autor, sem reivindicar execução por este agente).

Allowlist de24 fontes/testes no JSON associado, sem SQL/refund04822/forecast02519. Não executado TSC global, build, deploy ou commit por este agente. Root coordena validação final e publicação conjunta. Fluxo não solicita emissão fiscal.

# Revisão independente — alternativa restrita de despesas e ajustes

10/09/2026. Sem aplicação remota. A alternativa anterior rejeitada não foi modificada nem reaplicada por este agente.

A política finance_expense_adjustment_internal_only_policy.sql (fedaf54088b6a912133340ff9f5eeee33d8f813cc82d865195b024e787b25e06) exige can_access/require_access e not_driver nos três helpers, além de membership interna atual. require_session também exige ator igualauth.uid. session_allowed é booleano sem dados e retornafalse no staged. CREATEORREPLACE mantém ACLs: require_session/authorize não concedidos; session_allowed somente authenticated. Private.apply/context usam authorize; apply repete autorização após lock e antes replay. As sete APIs de expense_creation_private têm require_session e serão envolvidas por235237; seus wrappers invoker não fornecem acesso alternativo.

## Dois defeitos concretos corrigidos para ensaio

1. get_driver_expense_review_context e list_driver_expenses_for_review não constam da lista235237. São definers que podem ignorar RLSnot_driver e não conferiam can_access. Nova migration criada viaCLI20260910230200_finance_expense_review_read_boundary.sql SHAaf47d1268b947f0eb117dba3f6a9314589ff0052b31e10750f5d7a86c3a5dcf2 envolve ambos com require_access. Guards de sourceMD5/linguagem/definer/volatilidade/ACL e argumento tenant; preserva corpos, defaults,OID e grants. Instalar depoisrequire_access existir.
2.235237 rejeita o alias apply_driver_settlement_adjustment porque seu destino se chama private.apply. Compatibilidade local finance_adjustment_legacy_wrapper_compat.sql SHAf42bbd33b3acd7d5a32f87f3409fdb97b5361683682a41d2d14cffbefa83170b converte apenas o wrapperSQLinvoker paraPLpgSQLinvoker preservando mesmo delegate e ACL. Guard sourceMD5bc05f8437a55e6aea99d15d827fc9744. Instalar depois233637 e antes235237, NA MESMA TRANSAÇÃO do boundary e política final. Não é migração histórica alterada nem permissão extra.

## Limite de afirmação staged

234654 é boundary not_driver em tabelas legadas, não can_access. Portanto não declarar que stagefalse esconde TODOSELECT legado para operador: políticas/grants anteriores ainda podem permitir leitura direta de driver_expenses/reviews/settlements. O novo patch fecha os doisRPCs esquecidos; a política de session_allowed fecha creations conformeRLS. O objetivo confirmado aqui é não liberar novasAPIs de despesas/ajustes nem identidades motoristas/mistas; zeroacesso de todosoperadores a todas tabelas exigiria boundary adicional e teste próprio.

Bancoagente recebeu ambos artefatos para teste integrado e montagem da alternativa. Ainda não há resultado novo de teste neste documento. Confirmar7APIs públicas e privadas,2readers,context/applyajustes,stagefalse,driver/mixed/crosstenant,grantsanon/service antes aprovar artefato combinado final. Nenhum PG/TSC ou processo por este agente.

Resultado posterior comunicado pelo bancoagente: 2 testes PGlite integrados passaram em4,43s; compat resolveu235237, hashes dos2readers conferiram, stagedfalse/mixed recusados, administrador autorizado na política final e falha tardia reverteu instalação integral. SQL destes dois artefatos não alterado. Esta é evidência do executor independente, não execução repetida por este agente.

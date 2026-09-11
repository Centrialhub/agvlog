# Fronteira pública do complemento em aberto

Migração raiz83307: `20260911083307_finance_unloading_open_complement_public_boundary.sql`. SHA-256 `901a6f1e06a03e738bb77395c90b1b7e7f16776b60fe664fd3a111e23c63848c`. Nenhuma migração foi modificada nesta revisão.

`src/test/unloadingOpenComplementPublicBoundary.test.ts`: 8 testes aprovados em11/09/2026,05:42:07 local; ESLint dos dois arquivos novos, saída0 sem diagnósticos.

- Prévia pública sob SET ROLE authenticated, identidade tenant/actor/charge/expense/payable e ausência real de `_evidence`, validada pelo schema de produção.
- Comando público corrige custo150 para120 e complemento50 para20 mantendo reserva100. Replay produz um único amendment; alteração da identidade do replay é rejeitada.
- APIs anônimas, helpers privados e journal não são acessíveis. Grants de helpers brutos permanecem negados também para service_role.
- Outro tenant, motorista e usuário com papel misto são negados. Revogação de membership nega o replay já confirmado.
- Remover EXECUTE do comando público torna can_execute=false na prévia.
- Instalação recusa o guard de mesma identidade com evento DELETE em vez de INSERT, WHEN false ou argumento inesperado. Não cria o writer público na falha.
- Regressão positiva da devolução real previamente implantada: após instalar81653+83307, uma entrada registrada10 é ligada à disposição do custo coberto150→120. Reserva150 e custo120 permanecem; residual histórico30, devolvido10, aberto20, entrada consumida10. Preview, resultado, cost origin e coverage passam nos schemas atuais.

Fixture própria `src/test/helpers/openComplementPublicDatabase.ts`, extraída do cenário real da candidata81653: writers de lote e pagamento reais, cadeia72557/72723/74203/74603/80545 instalada em ordem e obrigação parcialmente financiada nova antes81653. Construtor de acerto e recálculo de pagamento são corpos reais; não há stub de sucesso ou guard desabilitado. Cada caso roda em transação isolada e valida constraints diferidas nos positivos.

Este ensaio é PGlite local. Não constitui concorrência PostgreSQL nativo, browser/Auth hospedado ou aplicação remota. A etapa alvo menor/igual ao alocado permanece separada, com cancelamento coordenado da obrigação e disposição ainda necessários.

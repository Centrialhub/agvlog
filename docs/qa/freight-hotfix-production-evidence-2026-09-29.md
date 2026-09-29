# Publicação emergencial de frete — evidência final

- Autorização: após o pedido explícito de exceção aos gates pendentes, o usuário reiterou “publique o hotfix agora é crucial para produção”. Publicação emergencial limitada ao frontend.
- PR isolado: https://github.com/Centrialhub/agvlog/pull/4, integrado com sucesso.
- Código revisado: `7be7c2f5de2cb90fa0c60d5d6e7fcbd5bacd62f3`; merge publicado: `dc6696ebfc2d341aac511ed51cc0733fae7acd0d`.
- Deployment de produção: `dpl_HbFeNncTjT8dpmETjsRdc8VEaJDv`, READY, sem aliasError.
- URL imutável: https://agvlogistica-djl5lxjmg-centrialhubs-projects.vercel.app.
- URL pública: https://agvlogistica.vercel.app.
- Conferência HTTP em **2026-09-29T14:16:47.9286469Z**: release público corresponde ao merge, buildHash `8467fd6ed110c10b`; `/`, `/auth`, CSS e três scripts iniciais retornaram HTTP 200.
- Retorno disponível: `dpl_HSmXs2XdmKBJA6SxHEP15kosqzoo`, release anterior `17a7592dca01f31b1aa7b63340fbaf28bb116347`. Não apagar reservas fiscais ao retornar.

## Revisão de regressões

Encontrados e corrigidos antes da publicação: nova dependência de RPC inexistente no simulador; sobrescrita de base/valor ICMS editados durante carregamento assíncrono. NF-e preserva resolução automática por remetente. Simulação a partir de CT-e requer seleção explícita do fornecedor, sem confundir a transportadora com o remetente.

137 testes passaram em 27 arquivos, início 14:13:38 UTC, duração 10,71 s. Typecheck e lint dos arquivos revisados: exit 0. Build Vercel do código final e do merge: READY. A árvore `src` do merge foi comparada ao código testado sem diferenças. As correções adicionais foram copiadas para a branch de estabilidade para evitar sua perda no próximo release.

## Limites mantidos explícitos

Publicação de frontend; nenhuma migração ou Edge Function publicada. Não houve emissão fiscal real como teste. Smoke autenticado completo e Quality gate remoto não foram concluídos como condição desta promoção emergencial; autorização não significa estabilidade geral aprovada. RPCs preexistentes ausentes nos outros fluxos de criação/recálculo por carga continuam no trabalho de estabilidade SQL. Conferência HTTP não comprova o fluxo fiscal autenticado completo.

# Opções de vínculo usam movimentos ativos

184543 migra oito consultas de candidatos: gastos em lote, despesas avulsas, pagamento de título, recebimentos, associação legada de pagamentos/recebimentos e as duas opções de acerto. Cada definição revisada tem exatamente uma consulta a finance_movements, dentro do conjunto de candidatos. A migração exige essa condição antes de substituir pela view privada active_movements; pagamento, reserva, vínculo e histórico não são reescritos.

Três testes PGlite passaram usando uma instalação combinada, as oito APIs públicas sob authenticated e os parsers reais da interface. Cada consulta apresentou candidatos válidos antes das invalidações de teste e nenhum dos registros invalidados depois. Os pagamentos legados e de acerto permaneceram byte a byte iguais. O teste de paginação verifica31 candidatos ativos em duas páginas, excluindo um dos32 originais. Todas as oito consultas recusaram outra empresa e usuário administrativo com papel de motorista ativo.

As origens operacionais/fiscais e APIs vêm de definições reais; os movimentos são criados pelo RPC. Somente a invalidação é inserida pelo owner da fixture, porque seu comando público ainda não existe. Na primeira rodada, faltava o wrapper público da consulta manual no setup: a factory passou a instalar o bloco real com ACLs originais. Os testes não passaram a chamar a função privada para contornar essa falha.

ESLint aprovado. SHA256184543 `2220b56fd093ff7c47556ddb6d75a96aff19acfd750b87d757fa11de82590275`. A factory não instala183506 nem representa a cadeia integral de produção; os bloqueios de escrita possuem testes próprios. Limites adicionais estão em finance-active-movement-options-fixture-2026-09-10.md. Nenhuma alteração remota ou afirmação de comando de correção disponível.

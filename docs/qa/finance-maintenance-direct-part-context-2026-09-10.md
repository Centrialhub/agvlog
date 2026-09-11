# Consulta de compra direta de peça — 10/09/2026

Reader61828 depende de61702,60441 e auditoria. Consulta por ID de peça, com identificação da OS, quantidade e valores declarados, vínculos de catálogo/estoque, catálogo paginado de custos de manutenção, fornecedor cadastrado e documento de cada candidato. Busca literal por descrição/fornecedor/documento/UUID. A consulta não determina automaticamente que dois registros sejam a mesma compra.

Histórico e associação ativa são independentes dos filtros de custos. Associação/reversão também aparecem no filtro global de intervenções manuais; rótulos adicionados à auditoria. Invalidação global inclui o contexto da peça.

Três testes PGlite passaram em `maintenanceDirectPartContextDatabase.test.ts` após corrigida uma aspa no comando61702 pelo autor:31custos criados via lote real, schemas reais de UI, busca literal, quantidade/fornecedor/documento, associação e reversão com declaração explícita e autoria no histórico/auditoria, quantidade inválida visível e rejeição de motorista/contexto inválido. ESLint passou. A primeira rodada parou na compilação do core, antes de executar casos; não foi contada como validação.

Fixture restrita, sem prova da sequência integral de migrations. Concorrência e guards compartilhados labor/peça ainda em validação própria do core/nativo. Não há implantação remota nesta etapa. Consumo de estoque não está coberto pelo comando de compra direta.

Refinamento integrado: quarto teste verifica que claim da peça impede candidatura de mão de obra e altera sua revisão anterior. Rodada31testes em7arquivos passou (corepeça9,labor7,reader4,reviewUI4,cliente3,painel2,inventário2). Core61702 corrigiu guarda de alteração de tenant da OS usando OLD; teste próprio do autor comprova rejeição. Hashcorefinal a9c7a78cd4a0a3434332b4aa4b23f7f4a79d24c76209d10361c130c92e2a1adf. Nativo independente ainda em preparação.

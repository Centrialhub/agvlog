# Previsão de fretes — interface (2026-09-10)

A Financial consulta resumo completo no servidor e lista paginada de origens (30 por página). Filtros próprios de data/cliente, aplicados explicitamente, distinguem emissão da NF original e registro da tentativa em São Paulo. A lista começa em revisão; alterar estado ou página não altera o resumo.

Disponível, reservado, incerto, autorizado, revisão e cancelado têm rótulos distintos. Somente a parcela disponível entra na previsão; não há conversão de mercadoria em frete. Tentativas sem preço deixam totais indeterminados, nunca zero. Não há promessa de cobertura completa nem data esperada de recebimento. Identificadores da NF e tentativa permanecem disponíveis para rastreio.

Contratos validam escopo, contagens, somas em BigInt, nulificação global, identidade da origem e distinção de data. Atualização/falha oculta dados antigos. Fluxo somente leitura, sem baixa, aprovação ou transferência.

Validação: 8 testes UI/cliente/controller passaram. ESLint do escopo sem erros; warning já existente de any em usePollCteStatus.ts:17. Autor do banco confirmou 10 testes SQL contra os schemas reais. TypeScript integrado delegado ao coordenador, sem processo concorrente desta frente.

Invalidações explícitas incluídas nos hooks de CTe, NFS-e, consulta fiscal, faturamento e ciclo de fatura; helper compartilhado coordenado pelo root. A cobertura continua limitada às origens explicitamente modeladas no servidor.

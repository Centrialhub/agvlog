# Correção encontrada no gate completo — 19/10/2026

O gate nativo do candidato fa548e619f256ebe86dad5026059caf772847d51 encontrou uma violação séria de acessibilidade na atribuição do mapa em /driver. A inspeção posterior dos arquivos emitidos confirmou que a correção em @layer utilities não entrava no CSS final: as classes são produzidas pelo Leaflet em runtime. O link ficava com o estilo do fornecedor, sem sublinhado e com contraste insuficiente. O diagnóstico inicial apenas por precedência na cascata era incompleto.

O seletor de atribuição passa para fora da camada, com escopo explícito ao container Leaflet. Mantém a cor já aprovada e o sublinhado. Nenhuma API, permissão, dependência, regra financeira ou cadastro muda. O teste axe e suas exigências permanecem intactos.

Antes disso, os 12 checks de validate, auditoria high, lint SQL bruto sem achados, contrato do baseline e 261 assertions pgTAP passaram em fa548e61. O primeiro shard unitário também passou com 1.124 testes. Esses resultados são históricos; os executores restantes foram interrompidos para repetir os gates completos na fonte corrigida. A tentativa de interface e seus artefatos estão preservados externamente.

A comprovação final deve constar em F:/AGVLOG/checks/sql-compatibility-final-gates-20261019.json com SHA, árvore, horários e status. Esta nota não aprova antecipadamente a suíte completa nem declara publicação. O pacote PostGIS continua exigindo operação separada pelo dono da extensão em produção; não houve implantação ou alteração de dados reais.

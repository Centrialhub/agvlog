# Resumo dos títulos fiscais incorporados

Migration local `20260910152711_finance_fiscal_dashboard_summary.sql`. Consulta exclusivamente origens fiscais incorporadas ao financeiro, com período pela data de incorporação. Não representa todas as NFs históricas, previsão de frete não faturado, recebimento bancário ou fechamento.

Autorização atual é conferida contra a observação usada pela origem: estado, ambiente, identidade, documento de origem, tipo, protocolo, versões e hash do payload. A base exige `ready`, pagador consistente com o título e valores bruto/líquido/retenções equilibrados. Alteração da identidade mantendo status autorizado invalida o total ativo antes de processamento; após a origem ir para revisão, seu valor deixa o conjunto ativo e a contagem de revisão permanece visível. Cancelamento não apaga pagamentos.

Sete testes SQL com projeção fiscal real e parser da interface passaram: CT-e, NFS-e com retenção, cancelamento antes/depois de processamento, identidade desatualizada, pagador alterado, acesso e 1001 autorizações sem truncamento. CT-e usa a base de frete definida pelo projetor; não infere retenção da diferença entre campos de documento.

Jobs pendentes/revisão são contados por empresa inteira, com escopo explícito, independentemente do filtro de datas ou cliente. Uma soma dos títulos ativos não certifica completude de documentos sem origem incorporada. Totais inválidos retornam nulo; nenhuma falha é convertida em zero.

Rodada integrada: 43 testes passaram em nove arquivos de SQL, contratos, clientes e interface para fiscal, custos e carteira. ESLint do escopo root passou. Validação nativa fiscal ainda em andamento; não houve implantação remota ou homologação de navegador. Ver relatório de implementação para status final de TypeScript e integração.

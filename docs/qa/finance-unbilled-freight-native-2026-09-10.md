# Previsão de fretes — PostgreSQL nativo 2026-09-10

8 testes passaram em PostgreSQL 17.11 local descartável. Execução 68877 terminou exit 0 e servidor parado. Nenhuma alteração de SQL do produto nem implantação remota.

Suite: `scripts/test-finance-unbilled-freight-native-cases.mjs`; selector central `finance-unbilled-freight`. Log: `node_modules/.cache/qa-postgres/finance-unbilled-freight-native-2026-09-10.log`.

Migration 153731 SHA256: `fcc7dfe4f8d73ad0f4681a81b8b016887cf1f0339a8a72d7bfa2229b35135dc0`.

## Provas executadas

- 1.005 NFs com frete 1,01 e mercadoria 999.999 resultam em `101505` centavos previstos. Datas de recebimento permanecem desconhecidas; cobertura não é declarada completa.
- Lista percorre 34 páginas e compara igualdade exata entre os 1.005 IDs esperados do seed e os retornados, na ordem estável, sem perda/duplicação. Resumo e cada página passam pelos schemas reais da interface.
- Autorização, reserva e envio incerto ficam fora do montante disponível. Rejeição nunca autorizada libera disponibilidade.
- Cancelamento após autorização permanece em revisão mesmo após apagar a associação atual de NFs no catálogo do CT-e: vínculo da observação fiscal imutável preserva a evidência.
- Reserva por IDs exatos com envio in_flight fica incerta; rejeição registrada libera os 10.000 centavos. Nenhum movimento financeiro é criado.
- Claim comercial ativo exige revisão de alocação; sua liberação histórica restaura disponibilidade. Não refatura automaticamente o valor integral enquanto coberto pelo claim.
- Serviço devolvido e tentativa de reentrega aparecem como duas origens em revisão; tentativa sem preço mantém frete null, sem herdar o original.
- Frete desconhecido, data infinity, identidade fiscal duplicada e múltiplas autorizações permanecem diagnosticáveis.
- Serviço cancelado contribui zero. Tenant estrangeiro, motorista, perfil misto, cliente inválido e página zero são rejeitados.

## Fixture e limites

Reutiliza a cadeia fiscal/financeira real do teste nativo 152711, incluindo observações 04550 e associações 145616. A criação e preservação das observações fiscais são reais. Fontes fiscais usam recorte de campos do helper; tabelas de claims e tentativas são extraídas das migrations reais, retirando FKs para pais fora do cenário. A reserva usa a mesma tabela estreita da fixture do autor.

Claims, sua liberação e tentativas são semeados diretamente sob privilégios de QA. Este ensaio prova a leitura desses estados, não a execução auditada do comando de fechamento ou reentrega. Esses fluxos completos são exercitados separadamente pelos testes SQL/PGlite do autor; não são chamados aqui. Não foram medidos planos/latência desta consulta, nem concorrência. Não prova toda origem legada de frete, política de precificação nem data de recebimento. Coverage permanece false e revisão invalida o total global.

Reprodução PowerShell: `$env:PG_QA_SUITE='finance-unbilled-freight'; node --experimental-strip-types scripts/test-delivery-concurrency.mjs`.

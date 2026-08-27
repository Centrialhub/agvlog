# Diagnóstico das 7 falhas do Vitest (somente análise)

Comando: `bunx vitest run src/test/cteBuilder.test.ts src/test/importedNotesSummary.test.ts src/test/partyRegistry.test.ts`
Resultado: 3 arquivos falharam, 7 testes falharam, 37 passaram. `git status` limpo (nenhum arquivo alterado), HEAD `8c15ada2`.

## 1. cteBuilder — novos blocos > "serializa seguradora, tipo CTRC, carretas e composição de frete"
- Asserção: `src/test/cteBuilder.test.ts:103` — `expect(p.seguradora.nome).toBe('AKAD SEGUROS')`
- Esperado: `'AKAD SEGUROS'` | Recebido: TypeError `Cannot read properties of undefined (reading 'nome')`
- Causa: `src/lib/fiscal/cteBuilder.ts:729` publica o bloco da seguradora como `seguro` (objeto `seguroCarga`, linhas 578-595) e não existe chave `seguradora` no payload. O nome do grupo foi trocado para o canônico do layout CT-e.
- Classificação: **teste obsoleto** (renomeação intencional `seguradora` → `seguro`; o conteúdo — `nome`, `apolice`, `valorSeguro` — continua presente).

## 2. cteBuilder — ICMS embutido > "buildCtePayload: embutido=true soma ICMS ao FRETE PESO"
- Asserção: `src/test/cteBuilder.test.ts:182` — `expect(p.valorPrestacao.Comp).toEqual([...])`
- Esperado: `[{xNome:'FRETE PESO',vComp:154.83},{xNome:'ICMS',vComp:33.99}]` | Recebido: TypeError `Cannot read properties of undefined (reading 'Comp')`
- Causa: o grupo de componentes é emitido como `vPrest` (`cteBuilder.ts:791-797`); não há chave `valorPrestacao` no nível do payload (`valorPrestacao` existe apenas dentro de `valores`, linha 763, como número).
- Classificação: **teste obsoleto** (mesmo dado, nome canônico SEFAZ `vPrest`). Todas as asserções de ICMS embutido anteriores à linha 182 passaram, portanto o cálculo está correto.

## 3. cteBuilder — ICMS embutido > "buildCtePayload: por fora destaca ICMS sem somar ao valor a receber"
- Asserção: `src/test/cteBuilder.test.ts:235` — `expect(p.valorPrestacao.Comp).toEqual([{xNome:'FRETE PESO',vComp:1000}])`
- Esperado/Recebido: idem item 2 (TypeError em `Comp`).
- Causa: mesma renomeação `valorPrestacao` → `vPrest`. As asserções de `valores` e `componentes` (linhas até 233) passaram.
- Classificação: **teste obsoleto**.

## 4. cteBuilder — componentes do valor da prestação > "sempre inclui FRETE PESO e ICMS, e SEGURO quando cobrado"
- Asserção: `src/test/cteBuilder.test.ts:286` — `expect(p.seguradora.valorSeguro).toBe(33.99)`
- Esperado: `33.99` | Recebido: TypeError `Cannot read properties of undefined (reading 'valorSeguro')`
- Causa: idem item 1 (`seguro` em vez de `seguradora`; `cteBuilder.ts:593` popula `valorSeguro` dentro de `seguro`). Os nomes dos componentes (FRETE PESO/SEGURO/ICMS) passaram.
- Classificação: **teste obsoleto**.

## 5. cteBuilder — API v1 do Hub > "envia CFOP, dhEmi, inicio/fim, mercadoria e aliases de ICMS/valores"
- Asserção: `src/test/cteBuilder.test.ts:327` — `expect(p.CFOP).toBe('6352')`
- Esperado: `'6352'` | Recebido: `'5352'`
- Causa: `cteBuilder.ts:637-659` passou a derivar o prefixo do CFOP do trajeto (`ufIni` vs `ufFim`). O fixture `baseInput` não informa `emitter.address`, `origin` nem `destination`, logo `interstate = false` e o CFOP `6352` é ajustado para `5352` (com warning). Comportamento intencional, adotado para evitar "Rejeicao: CFOP informado invalido".
- Classificação: **teste obsoleto** (fixture sem endereços; não há defeito no cálculo).

## 6. importedNotesSummary > exportImportedNotesCsv > "gera CSV com BOM, ; separador e mesmas linhas"
- Asserção: `src/test/importedNotesSummary.test.ts:79` — `expect(lines[1].split(';').length).toBe(20)`
- Esperado: `20` | Recebido: `22`
- Causa: o cabeçalho em `src/hooks/useImportedNotesSummary.tsx:286-290` tem 22 colunas depois da inclusão da relação NF ↔ documento emitido (`Nº CT-e`, `Nº NFS-e`, `Chave CT-e`, `Tipo Documento`). BOM, separador `;` e contagem de linhas continuam corretos.
- Classificação: **teste obsoleto** (contagem fixa não atualizada quando as colunas foram adicionadas por pedido da usuária).

## 7. partyRegistry > "não marca changed quando nada falta"
- Asserção: `src/test/partyRegistry.test.ts:107` — `expect(fillPartyFieldsFromRegistry(item, idx).changed).toBe(false)`
- Esperado: `false` | Recebido: `true`
- Causa: o item do teste só define nome/CNPJ/IE/cidade/UF, mas `fillPartyFieldsFromRegistry` (`src/lib/fiscal/partyRegistry.ts:223-243`) também preenche endereço — `remitterStreet/Number/Neighborhood/Zip` e `recipientStreet/Number/Neighborhood/Zip/CityIbge`. O cliente `c1` do fixture tem `address_street 'Rua A'`, `address_number '10'`, `address_neighborhood 'Centro'`, `address_zip '60000000'`, então `set()` grava esses campos e marca `changed = true`.
- Classificação: **teste obsoleto** quanto à premissa "nada falta" (os campos de endereço, exigidos pelo Hub/MDF-e, realmente faltavam). Não é defeito: nenhum valor já preenchido foi sobrescrito (guarda na linha 219).

## Conclusão
As 7 falhas são de testes desatualizados em relação a mudanças fiscais deliberadas (renomeação de grupos para o layout SEFAZ, CFOP derivado do trajeto, novas colunas de CSV, preenchimento de endereço). Nenhum defeito de produção foi identificado nessas rotas.

## Correção proposta (apenas testes, se aprovado)
1. `cteBuilder.test.ts`: ler `p.seguro` (linhas 103-105 e 286-287) e `p.vPrest.Comp` (182, 235).
2. `cteBuilder.test.ts:327`: informar endereços (`emitter.address.state: 'MG'`, `destination.state: 'BA'`) no caso do CFOP `6352`, ou passar a esperar `5352` sem endereços.
3. `importedNotesSummary.test.ts:79`: esperar `22` colunas (ou derivar do cabeçalho).
4. `partyRegistry.test.ts:96-107`: incluir os campos de endereço no item para que realmente nada falte.

Nenhum arquivo de produção precisa mudar.

# Reparação da projeção de descarga — PostgreSQL nativo

2026-09-10: **5 casos passaram em PostgreSQL 17.11**, sessão12909 saída0, servidor encerrado. Nenhuma alteração de SQL de produto ou acesso remoto.

Hashes conferidos:
- 211156: `c0e71109be86c5f43bc799b506479c6fa7103e4db1b9a38b5a500c61fcd8f482`.
- 211740: `df7590dceae582bddf72f86008a62de2f083d2c41642a2ec3993155b0abd9e25`.

Runner `scripts/test-finance-unloading-projection-repair-native-cases.mjs`; seletor `PG_QA_SUITE=finance-unloading-projection-repair`; log `node_modules/.cache/qa-postgres/finance-unloading-projection-repair-native-2026-09-10.log`.

## Provas

Fixture usa seedUnloadingRepairSource(db,true): record_expense_batch real cria charge150, custo150 e pagável para prestador diferente do fornecedor devedor. Antes dos novos guards, alteração então permitida muda nominal do recebível para180, sem desligar triggers. Após instalação:

1. Título com row lock em outra sessão impede reparação imediatamente (assert de SQLSTATE55P03/40001), sem40P01 e sem ticket residual.
2. Finance lock em outra sessão faz UPDATE row-first falhar com40001, sem deadlock.
3. Reparação real seguida de rollback não deixa reparação/ticket e preserva nominal180. Reparação confirmada restaura150, consome ticket, registra exatamente uma intervenção; replay devolve o mesmo resultado. UPDATE direto posterior volta a ser negado. JSON integral dos custos/pagáveis permanece idêntico. Wrapper público passa pelo unloadingProjectionRepairContextSchema real e apresenta histórico exato, com can_execute=false.
4. Recebimento é rejeitado antes da restauração e não deixa payment; depois, comando real registra10 e recálculo mostra recebido10.
5. Writer privado não é executável por authenticated. Replay owner com auth.uid real espera finance; revogação atual durante a espera provoca42501 antes do replay.

## Limites

Writer continua **privado**, invocado exclusivamente pelo owner da fixture com auth.uid real, sem grant fictício. Esta prova não promove o comando para aplicação pública. Não foram fabricados tickets manualmente para obter sucesso; teste one-shot verifica consumo/ausência e retorno da negação direta após reparo.

Fixture combina corpos reais com grafo reduzido, plataforma/Storage sintéticos e algumas FKs externas omitidas. Não é upgrade integral ou autenticação remota. O suplemento não repete todas as recusas de materializações financeiras dos testes PGlite; concentra ticket/transação/concorrência e preservação do custo/pagável real.

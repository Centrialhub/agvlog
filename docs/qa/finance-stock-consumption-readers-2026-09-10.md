# Consumo: contexto, prévia e histórico

Migration `20260910171734_finance_stock_consumption_readers.sql` expõe contexto por peça/movimento e prévia autorizada no servidor. A peça deve apontar para o movimento pedido. As compras candidatas pertencem ao mesmo item e empresa; saldo considera todas as reservas, independentemente da página exibida. Valores inconsistentes não são convertidos em disponibilidade zero. A prévia usa o cálculo único do comando71503 e identifica as origens selecionadas.

O histórico preserva linhas, quantidade, centavos, saldos anteriores/posteriores e autoria. Consultar candidatos por outro filtro não esconde a atribuição ativa ou a contagem histórica. Reverter libera as reservas exatas e conserva as linhas anteriores. Associação e reversão aparecem no filtro global de intervenções manuais.

O mesmo leitor estende o contexto de aquisição com preço unitário decimal textual e política de total estendido arredondado a centavos. Isso evita apresentar preço unitário inferior a um centavo como desconhecido. Migration170539, previamente validada nativamente, permanece intacta; a extensão é posterior e explícita.

Quatro testes reais SQL/PGlite de consumo passaram: 31 candidatos em páginas diferentes e prévia de seleção combinada, atribuição/reversão por comandos reais, discrepância preservada e autorização. O teste de aquisição foi atualizado para a cadeia de consumo e tem cinco casos, incluindo preço unitário0.00333333/total1cent. As tabelas auxiliares mínimas de extrato atendem somente à apresentação da auditoria; não afirmam evidência bancária real.

Rodada coordenador:27 testes aprovados em seis arquivos, incluindo comandos, leitores, contratos, cliente e interface. ESLint próprio aprovado. TSC87942 concluído0, sem diagnósticos, segundo o agente da interface. Suite PostgreSQL nativa em execução; resultado não presumido nesta anotação. Nenhuma implantação remota.

Limites: atribuição gerencial de compras já registradas, sem novo custo global, pagamento ou movimentação física. Não implementa FIFO, custo médio ou certificação de saldo físico. Devoluções físicas e fontes sem aquisição identificada continuam a exigir tratamento explícito dentro do módulo.

Atualização nativa: oito casos passaram em PostgreSQL17.11, sessão18036 saída0, servidor parado. Coordenador conferiu log e hashes71503/71734 contra `finance-stock-consumption-native-2026-09-10.md`. A prova inclui comandos reais de aquisição/consumo/reversão,0/0/1centavo, múltiplas aquisições em ordem inversa, competição de capacidade, revogação e preservação de pagamentos/alocações preenchidos. Fontes físicas são fixtures explícitas; não houve ensaio da plataforma inteira.

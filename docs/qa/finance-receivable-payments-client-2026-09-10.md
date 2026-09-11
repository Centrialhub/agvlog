# Recebimentos paginados — contrato e integração

A tela financeira do título deixou de usar os 500 pagamentos do contexto como universo navegável ou como requisito de seleção para devolução. A consulta get_finance_receivable_payments_page retorna páginas de50, com contagem integral e revisão própria. A revisão financeira usada pelo comando de devolução continua vindo do contexto financeiro atual; ela não é substituída pela revisão da lista.

O contrato reutiliza a representação existente do pagamento e exige estado explícito de crédito e correção de vínculo. O cliente valida empresa, ator, título, página e revisão. Falhas de autorização/transporte não viram revisão desatualizada. Contagens incompatíveis, IDs repetidos e datas inválidas são recusados. A comparação de ordenação não descarta diferenças abaixo de milissegundos dos timestamps PostgreSQL.

Devoluções, correções e associações invalidam a consulta paginada. A seleção conserva a revisão financeira observada e é desfeita ao atualizar, bloquear ou mudar o contexto. A confirmação continua sujeita às guardas e à revisão do comando original. Apenas abrir a página não dispara uma consulta de associação para cada recebimento: os detalhes de vínculo são montados quando solicitados pelo operador.

## Verificação do coordenador

Quinze testes aprovados em três arquivos: seis SQL com parser real, cinco de contrato/cliente e quatro de interface. A prova SQL percorre505 pagamentos históricos em11 páginas e preservaIDs; casos adicionais usam comandos reais de recebimento/devolução, correção de alocação e cancelamento fiscal com crédito. A prova de volume semeada e os casos com comandos reais são distintos, conforme QA do backend.

ESLint passou para contrato/cliente, esquema financeiro compartilhado, invalidação central e integrações de correção/associação. TSC92727 concluiu com saída0, sem diagnósticos. O agente de interface está executando separadamente o fluxo completo com501 recebimentos criados por comandos reais; não se presume aprovação do executor antes de seu encerramento. Suplemento PostgreSQL nativo também aguarda encerramento final.

SQL congelada:20260910202421_finance_receivable_payments_page.sql, SHA256e0873d2419bb9663e6ddc2e3483e648c0366852ca5b0794fb38e7834557bdd7b.

O suplemento PostgreSQL14470 concluiu com saída0, três casos aprovados e servidor parado. O coordenador conferiu log/hash. Os51 recebimentos e a devolução foram registrados por comandos reais; a revisão muda após devolução mesmo preservando IDs e contagem de pagamentos, e replay não duplica dinheiro. Acesso por empresa e exclusão de motorista/papel misto foram comprovados novamente. Essa evidência não substitui a instalação integral da plataforma.

A regressão final da interface com banco, sessão37914, terminou com saída0:15 testes passaram, incluindo501 recebimentos reais e devolução de um pagamento comprovadamente ausente dos500 itens do contexto. As duas tentativas anteriores passaram nas asserções, mas terminaram com timeout de comunicação do runner; a preparação passou a ceder o event loop a cada25 comandos, preservando quantidade, comandos e asserções. O resultado final não apresentou esse erro. O agente de interface também aprovou cinco testes do painel e lint, incluindo o destaque permanente de ajuste manual. Ao todo:31 testes entre SQL, cliente e interface, além dos três nativos. TSC92727 antecedeu somente o destaque visual e a correção do executor do teste; nenhuma alteração posterior de contrato ou comando ocorreu.

Nenhuma escrita remota. Esta consulta não é histórico econômico as_of nem substitui a homologação da cadeia completa de migrations.

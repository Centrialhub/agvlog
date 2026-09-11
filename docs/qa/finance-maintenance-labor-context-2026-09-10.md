# Consulta da associação de mão de obra — 10/09/2026

Migration61129 fornece `get_finance_maintenance_labor_context`, dependente de60950,60441 e auditoria. Resposta paginada30 com fonte OS, candidatos do contexto manutenção/categoria serviço ou manutenção, fornecedor cadastrado do alvo, revisão individual, vínculo ativo e histórico de reversões. O vínculo ativo independe da busca/página do catálogo.

Busca literal por descrição, fornecedor cadastrado, documento e UUIDs do custo/lote, sem dedução automática da identidade. Nome textual na OS aparece separado do cadastro do fornecedor. Valores incompatíveis continuam como candidatos impedidos; comando determina a elegibilidade atual. A mão de obra não implica soma de peças ou do total da OS.

61129 também inclui eventos de associação/reversão no filtro global de intervenções manuais; os rótulos estão no contrato da auditoria. Helper de revisão financeira invalida ambos os contextos de manutenção.

Três testes PGlite passaram em `maintenanceLaborContextDatabase.test.ts`, com schemas reais da interface. Cobrem31custos criados pelo comando de lote, busca literal/IDs/fornecedor, contexto da OS, associação/reversão reais, autoria na auditoria manual e rejeição de motorista/consulta inválida. ESLint passou. Fixture restrita reutiliza baseline/comandos e dependências vazias de extrato para os left joins da auditoria; não é prova de aplicação integral nem conciliação bancária. Nativo independente ainda pendente.

Escopo atual é associação da mão de obra a custo já registrado. Não cria custo novo, pagamento ou obrigação. Peças, consumo de estoque e despesas avulsas fora de lote ainda precisam vínculos próprios; cobertura integral de manutenção não foi alcançada.

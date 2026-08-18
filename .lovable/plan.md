# Plano: Congruência de Emissão de MDF-e com Base em Manifesto Real

O objetivo é garantir que o sistema AGVLog envie todas as informações necessárias para a emissão de MDF-e, alinhando o `mdfeBuilder.ts` e a interface `MdfeProvisional.tsx` com o exemplo de manifesto real fornecido (DAMDF do motorista Cleber).

## Ajustes Técnicos

### 1. Refinamento do `mdfeBuilder.ts`
- **Seguro de Carga**: Garantir que o campo `nAv` (Averbação) aceite uma lista de strings ou null, e que o valor padrão seja consistente com a exigência do Hub.
- **Identificadores de Veículo**: Adicionar suporte para o campo `RENAVAM` no veículo de tração (observado no PDF: `00242294880`).
- **Proprietário do Veículo**: Adicionar o grupo `prop` (Proprietário) no modal rodoviário, caso o veículo não seja da própria transportadora (visto no PDF como um CNPJ diferente ou CPF).
- **Dados do Condutor**: Validar que o CPF e Nome estão sendo formatados corretamente.

### 2. Melhorias em `MdfeProvisional.tsx`
- **Interface de Pagamento**: Adicionar campo para CNPJ da ANTT (Vale-Pedágio), se disponível.
- **Seleção de Veículo**: Adicionar campo de RENAVAM na edição manual, para casos onde o cadastro no banco esteja incompleto.
- **Valores Totais**: Garantir que o peso bruto total (KG) seja calculado e enviado (visto no PDF: `3.682,63`). Atualmente o builder foca em `valCarga`.
- **Cidade de Origem**: Fixar o padrão observado (Montes Claros/MG) mas permitir conferência do IBGE.

### 3. Validação de Dados Originários
- Garantir que a relação de CT-e enviada no payload contenha os dados de seguro por item se a seguradora exigir averbação individual (embora no PDF a apólice seja global).

## User Review Required

> [!IMPORTANT]
> No manifesto exemplo, há um campo **CNPJ ANTT: 04898488000177** no grupo Vale-Pedágio. Devemos incluir este campo como opcional na tela de emissão ou ele deve vir fixo por emitente?

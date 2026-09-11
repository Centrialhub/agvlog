export const formatPayrollCurrency = (value: number) =>
  (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

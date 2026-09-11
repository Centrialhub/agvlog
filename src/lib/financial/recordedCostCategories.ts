import {expenseCategories} from './expenseBatchContract';
export const recordedCostCategoryLabels:Record<string,string>={...expenseCategories,payroll:'Remuneração da folha',supplier:'Fornecedor',driver_advance:'Adiantamento de motorista',insurance:'Seguro'};

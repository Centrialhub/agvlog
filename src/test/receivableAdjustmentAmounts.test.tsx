import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import {ReceivableAdjustmentAmounts} from '@/components/financial/ReceivableAdjustmentAmounts';
afterEach(cleanup);
const base={nominal:'100000',cash:'90000',credit:'0',discount:'0',loss:'0',settled:'90000',open:'10000'};
it('presents discount100 separately while preserving nominal1000 and cash900',()=>{
 render(<ReceivableAdjustmentAmounts current={base} proposed={{...base,discount:'10000',settled:'100000',open:'0'}}/>);
 expect(screen.getByRole('table')).toHaveAccessibleName('Valores da cobrança');
 for(const [label,value] of [['Valor nominal preservado','R$ 1.000,00'],['Dinheiro recebido','R$ 900,00']])expect(within(screen.getByRole('row',{name:new RegExp(label)})).getAllByText(value)).toHaveLength(2);
 expect(screen.getByRole('row',{name:/Descontos aplicados/})).toHaveTextContent(/0,00.*100,00/);expect(screen.getByRole('row',{name:/Perdas reconhecidas/})).toHaveTextContent(/0,00.*0,00/);
 expect(screen.getByRole('row',{name:/Saldo em aberto/})).toHaveTextContent(/100,00.*0,00/);
});
it('distinguishes loss from credit and preserves unavailable values without zero',()=>{
 render(<ReceivableAdjustmentAmounts current={{...base,cash:null,credit:'1000',loss:'5000',settled:null,open:null}}/>);
 expect(screen.getByRole('row',{name:/Dinheiro recebido/})).toHaveTextContent('Indeterminado');expect(screen.getByRole('row',{name:/Crédito aplicado/})).toHaveTextContent('10,00');expect(screen.getByRole('row',{name:/Perdas reconhecidas/})).toHaveTextContent('50,00');expect(screen.getByRole('row',{name:/Saldo em aberto/})).toHaveTextContent('Indeterminado');
 expect(screen.queryByRole('columnheader',{name:'Após o ajuste previsto'})).not.toBeInTheDocument();
});

import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {CashPeriodEvidenceSummary} from '@/components/financial/CashPeriodEvidenceSummary';
afterEach(cleanup);
it('shows the preserved cash denomination, author and signed difference',()=>{
 const snapshot={evidence_type:'cash_count_v1',count:{id:crypto.randomUUID(),tenant_id:crypto.randomUUID(),account_id:crypto.randomUUID(),period_end:'2026-08-31',evidence_type:'cash_count_v1',currency:'BRL',timezone:'America/Sao_Paulo',boundary:'end_of_day',counts:[{denomination_cents:100,quantity:80}],total_cents:'8000',custodian_name:'Maria',actor_id:crypto.randomUUID(),actor_name:'João',reason:'Contagem conferida no encerramento',request_id:crypto.randomUUID(),revision:'a'.repeat(32),created_at:'2026-09-01T12:00:00Z'},balances:{opening_cents:'10000',in_cents:'1000',out_cents:'2500',expected_closing_cents:'8500',counted_closing_cents:'8000',difference_cents:'-500'}};
 const movements=Array.from({length:1005},(_,index)=>({id:crypto.randomUUID(),description:`Gasto físico ${index}`,occurred_on:'2026-08-15',direction:'out',nature:'payment',amount_cents:100}));
 render(<CashPeriodEvidenceSummary snapshot={{...snapshot,facts:{movements}}}/>);
 expect(screen.getByText(/Saldo esperado/)).toHaveTextContent('85,00');expect(screen.getByText(/Saldo esperado/)).toHaveTextContent('5,00');expect(screen.getByText(/Registrada por João/)).toBeInTheDocument();expect(screen.getByRole('cell',{name:'80'})).toBeInTheDocument();
 expect(screen.getByText('1005 movimentos no registro preservado.')).toBeInTheDocument();expect(screen.getAllByText(/Gasto físico/)).toHaveLength(30);fireEvent.click(screen.getByRole('button',{name:'Próximos movimentos do caixa'}));expect(screen.getByText(/Gasto físico 30 ·/)).toBeInTheDocument();expect(screen.queryByText(/Gasto físico 0 ·/)).not.toBeInTheDocument();
});
it('does not manufacture zero balances for incomplete saved evidence',()=>{render(<CashPeriodEvidenceSummary snapshot={{evidence_type:'cash_count_v1'}}/>);expect(screen.getByRole('alert')).toHaveTextContent('incompleta');expect(screen.queryByText(/Saldo esperado/)).not.toBeInTheDocument();});

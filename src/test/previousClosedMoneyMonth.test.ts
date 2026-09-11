import {expect,it} from 'vitest';
import {previousClosedMoneyMonth} from '@/lib/financial/previousClosedMoneyMonth';
it('uses the last closed calendar month at year turnover in São Paulo',()=>{
 expect(previousClosedMoneyMonth(new Date('2027-01-01T02:59:00Z'))).toEqual({from:'2026-11-01',to:'2026-11-30'});
 expect(previousClosedMoneyMonth(new Date('2027-01-01T03:00:00Z'))).toEqual({from:'2026-12-01',to:'2026-12-31'});
});
it('preserves leap February as the complete closed month',()=>{
 expect(previousClosedMoneyMonth(new Date('2028-03-01T03:00:00Z'))).toEqual({from:'2028-02-01',to:'2028-02-29'});
});

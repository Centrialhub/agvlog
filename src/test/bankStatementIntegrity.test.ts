import {describe,expect,it} from 'vitest';
import {buildParsedRows,inspectParsedRows,normalizeBrNumber,normalizeDate,parseCsv} from '@/lib/bankStatementParser';
const mapping={date:'Data',description:'Descrição',amount:'Valor'};
describe('bank statement input integrity',()=>{
  it('preserves quoted separators, escaped quotes and multiline descriptions',()=>{
    const parsed=parseCsv('Data;Descrição;Valor\r\n01/01/2026;"PIX, ""Comércio""\nsegunda linha";-500,00');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]['Descrição']).toBe('PIX, "Comércio"\nsegunda linha');
    expect(buildParsedRows(parsed.rows,mapping,'account')[0].amount).toBe(-500);
  });
  it('rejects a truncated quoted CSV rather than treating its last row as complete',()=>{
    expect(()=>parseCsv('Data;Descrição;Valor\n01/01/2026;"PIX incompleto;-500,00')).toThrow('aspas não foram fechadas');
  });
  it('rejects embedded bare quotes that could otherwise change an amount during parsing',()=>{
    expect(()=>parseCsv('Data;Descrição;Valor\n01/01/2026;PIX;1"2"')).toThrow('aspas dentro');
    expect(()=>parseCsv('Data;Descrição;Valor\n01/01/2026;PIX;"12"34')).toThrow('conteúdo após');
  });
  it('never overwrites duplicate header names or drops an extra populated column',()=>{
    const parsed=parseCsv('Data;Valor;Valor;Valor (2)\n01/01/2026;1;2;3',0);
    expect(new Set(parsed.headers).size).toBe(4);expect(Object.values(parsed.rows[0])).toContain('3');
    expect(()=>parseCsv('Data;Valor\n01/01/2026;100;descartado',0)).toThrow('colunas sem cabeçalho');
  });
  it.each(['31/02/2026','29/02/2025','2026-13-01','01/01/26','01/01/2026 lixo'])('rejects invalid or ambiguous date %s',value=>{
    expect(normalizeDate(value)).toBeNull();
  });
  it('accepts a valid leap day and rejects the fictitious Excel leap day',()=>{
    expect(normalizeDate('29/02/2024')).toBe('2024-02-29T12:00:00.000Z');expect(normalizeDate(60)).toBeNull();
  });
  it.each([Infinity,NaN,'1.2.3,45','100,001','1e5','1.234'])('rejects non-finite or ambiguous precision %s',value=>{
    expect(normalizeBrNumber(value)).toBeNull();
  });
  it('accepts explicit BR and US grouping with at most two decimal places',()=>{
    expect(normalizeBrNumber('R$ 1.234,56')).toBe(1234.56);expect(normalizeBrNumber('1,234.56')).toBe(1234.56);
    expect(normalizeBrNumber('(500,00)')).toBe(-500);
  });
  it('reports every rejected record and blocks partial import',()=>{
    const rows=[{'Data':'01/01/2026','Descrição':'Válido','Valor':'100,00'},
      {'Data':'31/02/2026','Descrição':'Data inválida','Valor':'100'},
      {'Data':'01/01/2026','Descrição':'Valor inválido','Valor':'não informado'}];
    const report=inspectParsedRows(rows,mapping,'account');
    expect(report.rows).toHaveLength(1);expect(report.rejected.map(r=>r.row)).toEqual([2,3]);
    expect(()=>buildParsedRows(rows,mapping,'account')).toThrow('2 registro(s) inválido(s)');
  });
  it('does not net simultaneous debit and credit columns or ignore malformed balances',()=>{
    const row={Data:'01/01/2026',Descrição:'Ambíguo',Crédito:'500',Débito:'300',Saldo:'inválido'};
    expect(inspectParsedRows([row],{date:'Data',description:'Descrição',inflow:'Crédito',outflow:'Débito'},'account').rejected).toHaveLength(1);
    expect(inspectParsedRows([{...row,Valor:'500'}],{...mapping,balance:'Saldo'},'account').rejected).toHaveLength(1);
  });
  it('preserves two genuine identical rows instead of deduplicating by value and description',()=>{
    const row={Data:'01/01/2026',Descrição:'PIX',Valor:'-500'};
    expect(buildParsedRows([row,row],mapping,'account')).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseCsvOrders, parseExcelOrders } from '@/lib/documentParsers';

describe('CSV de pedidos da versão publicada', () => {
  it('rejeita paletes fracionários do bug 2189 antes de devolver pedidos para gravação', () => {
    const csv = 'pedido;cliente;destino;quantidade;paletes;peso\nPED-1;Cliente;Sul;10;1,5;100';

    expect(() => parseCsvOrders(csv))
      .toThrow('CSV inválido: paletes no registro 2 devem ser inteiros entre 0 e 2147483647');
  });

  it('mantém vírgulas decimais e peso em suas colunas com paletes válidos', () => {
    const [row] = parseCsvOrders(
      '\uFEFFPedido;Cliente;Destino;Quantidade;Paletes;Peso\nPED-2;Cliente;Sul;1,5;1;100,25',
    );

    expect(row).toMatchObject({
      orderNumber: 'PED-2', clientName: 'Cliente', destination: 'Sul',
      quantity: 1.5, palletCount: 1, weightKg: 100.25,
    });
  });

  it('preserva ponto e vírgula, aspas escapadas e quebra de linha entre aspas', () => {
    const [row] = parseCsvOrders(
      'pedido;cliente;produto;quantidade;paletes;peso\r\n'
      + 'PED-3;"Loja; Sul";"Caixa ""A""; frágil\nsegunda linha";10;1;100',
    );

    expect(row).toMatchObject({
      orderNumber: 'PED-3', clientName: 'Loja; Sul',
      items: 'Caixa "A"; frágil\nsegunda linha',
      quantity: 10, palletCount: 1, weightKg: 100,
    });
  });

  it('mantém CSV separado por vírgula e rejeita desalinhamento de colunas', () => {
    const [row] = parseCsvOrders('pedido,cliente,quantidade,paletes,peso\nPED-4,"Loja, Centro",10,1,120.5');
    expect(row).toMatchObject({
      orderNumber: 'PED-4', clientName: 'Loja, Centro',
      quantity: 10, palletCount: 1, weightKg: 120.5,
    });

    expect(() => parseCsvOrders('pedido;cliente;quantidade;paletes;peso\nPED-5;Cliente;10;1;100;extra'))
      .toThrow(/registro 2 tem 6 colunas; o cabeçalho tem 5/);
    expect(() => parseCsvOrders('pedido;cliente;quantidade;paletes;peso\nPED-5;Cliente;10;1'))
      .toThrow(/registro 2 tem 4 colunas; o cabeçalho tem 5/);
  });

  it('rejeita aspas malformadas e números inválidos', () => {
    expect(() => parseCsvOrders('pedido;cliente;quantidade\nPED-6;"Cliente;10'))
      .toThrow(/aspas.*não foi fechado/);
    expect(() => parseCsvOrders('pedido;cliente;quantidade\nPED-6;Cliente;1"2"'))
      .toThrow(/aspas dentro/);
    expect(() => parseCsvOrders('pedido;cliente;quantidade\nPED-6;Cliente;dez'))
      .toThrow(/quantidade no registro 2/);
  });

  it('preserva o parser de planilhas do commit publicado', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Pedido', 'Cliente', 'Quantidade', 'Paletes', 'Peso'],
      ['PED-7', 'Cliente', 10, 1, 100],
    ]), 'Pedidos');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

    expect(parseExcelOrders(buffer)[0]).toMatchObject({
      orderNumber: 'PED-7', quantity: 10, palletCount: 1, weightKg: 100,
    });
  });
});

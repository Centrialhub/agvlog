import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContractorCteSelector from '@/components/billing/ContractorCteSelector';
import { subcontractingFixture } from './helpers/subcontractingFixture';
import type { CteSubcontractingSelection } from '@/lib/fiscal/cteSubcontracting';
const mocks=vi.hoisted(()=>({ data:[] as unknown[], isError:false, refetch:vi.fn() }));
vi.mock('@/hooks/useContractorCteSources',()=>({useContractorCteSources:()=>({...mocks,isLoading:false,isFetching:false})}));
const selected=subcontractingFixture();
afterEach(()=>{cleanup();mocks.isError=false;mocks.data=[];});
function Panel(){const [value,onChange]=useState<CteSubcontractingSelection|null>(selected);return <ContractorCteSelector tenantId={selected.source.tenant_id} disabled={false} value={value} onChange={onChange}/>;}
describe('seleção do CT-e original',()=>{
  it('mostra tomador/trajeto e exige nova conferência após editar o município',()=>{
    render(<Panel/>);
    expect(screen.getByText(/Tomador:/)).toHaveTextContent(selected.source.document.issuer_name);
    expect(screen.getByRole('checkbox')).toBeChecked();
    fireEvent.change(screen.getByLabelText(/Município de início/),{target:{value:'OUTRO NOME'}});
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
  it('não mostra uma seleção antiga ao trocar de empresa',()=>{
    render(<ContractorCteSelector tenantId="outra-empresa" disabled={false} value={selected} onChange={vi.fn()}/>);
    expect(screen.queryByText(/Tomador:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('oferece apenas fontes de produção da empresa ativa',async()=>{
    mocks.data=[selected.source,{...selected.source,id:'other',tenant_id:'outra'}, {...selected.source,id:'sandbox',environment:'homologation'}];
    const onChange=vi.fn();
    render(<ContractorCteSelector tenantId={selected.source.tenant_id} disabled={false} value={null} onChange={onChange}/>);
    fireEvent.keyDown(screen.getByRole('combobox'),{key:'ArrowDown'});
    const option=await screen.findByRole('option',{name:/CT-e 123\/1/});
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(option,{key:'Enter'});
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({source:selected.source,confirmed:false}));
  });
  it('expõe falha de consulta e permite atualizar',()=>{
    mocks.isError=true;render(<Panel/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Falha ao consultar');
    fireEvent.click(screen.getByRole('button',{name:'Atualizar documentos'}));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});

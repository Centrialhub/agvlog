import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AddressResolutionPicker } from '@/components/maps/AddressResolutionPicker';
import type { GeocodingCandidate } from '@/lib/geocoding';

vi.mock('react-leaflet',()=>({
  MapContainer:({children}:{children:React.ReactNode})=><div>{children}</div>,
  Marker:()=>null,
  TileLayer:()=>null,
  useMap:()=>({flyTo:vi.fn()}),
  useMapEvents:()=>null,
}));

const candidate=(label:string,latitude:number):GeocodingCandidate=>({
  label,latitude,longitude:-43.9,confidence:0.8,accuracy_m:50,bounds:null,provider:'nominatim',provider_type:'road',
});
afterEach(cleanup);

it('announces the selected suggestion and supports exact keyboard coordinate adjustments',()=>{
  const confirm=vi.fn(),change=vi.fn();
  render(<AddressResolutionPicker address="Rua Exemplo, 12" subjectLabel="Cliente A"
    candidates={[candidate('Opção 1',-19.9),candidate('Opção 2',-19.8)]}
    onSelectionChange={change} onConfirm={confirm}/>);

  const first=screen.getByRole('button',{name:/Opção 1/});
  const second=screen.getByRole('button',{name:/Opção 2/});
  expect(first).toHaveAttribute('aria-pressed','true');
  expect(second).toHaveAttribute('aria-pressed','false');
  fireEvent.click(second);
  expect(first).toHaveAttribute('aria-pressed','false');
  expect(second).toHaveAttribute('aria-pressed','true');
  expect(change).toHaveBeenCalledTimes(1);

  fireEvent.change(screen.getByRole('spinbutton',{name:'Latitude do ponto para Cliente A'}),{target:{value:'-19.81'}});
  expect(change).toHaveBeenCalledTimes(2);
  const submit=screen.getByRole('button',{name:'Confirmar endereço selecionado para Cliente A'});
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Aplicar coordenadas'}));
  expect(screen.getByRole('button',{name:'Confirmar ponto ajustado para Cliente A'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Confirmar ponto ajustado para Cliente A'}));
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
    latitude:-19.81,longitude:-43.9,selection_kind:'manual_map',previous_lat:-19.8,previous_lng:-43.9,
  }));
  expect(change).toHaveBeenCalled();
});

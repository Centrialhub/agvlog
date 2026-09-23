import { useEffect, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Check, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { GeocodingCandidate } from '@/lib/geocoding';
import '@/lib/maps/leaflet';
import 'leaflet/dist/leaflet.css';

export type AddressResolutionSelection = {
  latitude: number;
  longitude: number;
  provider: string;
  accuracy_m: number | null;
  confidence: number | null;
  label: string;
  selection_kind: 'assisted_candidate' | 'manual_map';
  previous_lat: number | null;
  previous_lng: number | null;
};

type Props = {
  address: string;
  subjectLabel: string;
  candidates: GeocodingCandidate[];
  disabled?: boolean;
  onSelectionChange?: () => void;
  onConfirm: (selection: AddressResolutionSelection) => void;
};

const fromCandidate = (candidate: GeocodingCandidate): AddressResolutionSelection => ({
  latitude: candidate.latitude,
  longitude: candidate.longitude,
  provider: candidate.provider,
  accuracy_m: candidate.accuracy_m,
  confidence: candidate.confidence,
  label: candidate.label,
  selection_kind: 'assisted_candidate',
  previous_lat: null,
  previous_lng: null,
});

function MapFocus({ selection }: { selection: AddressResolutionSelection }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([selection.latitude, selection.longitude], 17, { duration: 0.35 });
  }, [map, selection.latitude, selection.longitude]);
  return null;
}

function MapAdjustment({ disabled, selection, onChange }: {
  disabled: boolean;
  selection: AddressResolutionSelection;
  onChange: (latitude: number, longitude: number) => void;
}) {
  useMapEvents({ click: (event) => { if (!disabled) onChange(event.latlng.lat, event.latlng.lng); } });
  return <Marker position={[selection.latitude, selection.longitude]} draggable={!disabled}
    eventHandlers={{ dragend: (event) => {
      const point = event.target.getLatLng();
      onChange(point.lat, point.lng);
    } }} />;
}

export function AddressResolutionPicker({ address, subjectLabel, candidates, disabled = false, onSelectionChange, onConfirm }: Props) {
  const [selection, setSelection] = useState<AddressResolutionSelection | null>(() => candidates[0] ? fromCandidate(candidates[0]) : null);
  const [latitudeDraft,setLatitudeDraft]=useState(()=>String(candidates[0]?.latitude??''));
  const [longitudeDraft,setLongitudeDraft]=useState(()=>String(candidates[0]?.longitude??''));
  const [coordinateError,setCoordinateError]=useState('');

  const chooseCandidate=(candidate:GeocodingCandidate)=>{
    const next=fromCandidate(candidate);
    setSelection(next);setLatitudeDraft(String(next.latitude));setLongitudeDraft(String(next.longitude));
    setCoordinateError('');onSelectionChange?.();
  };

  const adjust = (latitude: number, longitude: number) => {setSelection((current) => current ? {
    ...current,
    latitude,
    longitude,
    provider: 'leaflet_map',
    accuracy_m: null,
    confidence: null,
    label: `Ponto ajustado no mapa para ${address}`,
    selection_kind: 'manual_map',
    previous_lat: current.previous_lat ?? current.latitude,
    previous_lng: current.previous_lng ?? current.longitude,
  } : null);setLatitudeDraft(String(latitude));setLongitudeDraft(String(longitude));setCoordinateError('');onSelectionChange?.();};

  const applyCoordinates=()=>{
    const latitude=Number(latitudeDraft),longitude=Number(longitudeDraft);
    if(!latitudeDraft.trim()||!longitudeDraft.trim()||!Number.isFinite(latitude)||!Number.isFinite(longitude)
      ||latitude < -90||latitude > 90||longitude < -180||longitude > 180){
      setCoordinateError('Informe latitude entre -90 e 90 e longitude entre -180 e 180.');return;
    }
    adjust(latitude,longitude);
  };

  if (!selection) return null;
  const coordinatesPending=latitudeDraft!==String(selection.latitude)||longitudeDraft!==String(selection.longitude);
  return <div className="space-y-3" aria-label="Conferência da localização no mapa">
    <div className="space-y-2" role="group" aria-label={`Opções encontradas para ${subjectLabel}`}>
      {candidates.map((candidate, index) => <Button
        key={`${candidate.provider}:${candidate.latitude}:${candidate.longitude}:${candidate.label}:${index}`}
        type="button"
        variant={selection.selection_kind === 'assisted_candidate' && selection.latitude === candidate.latitude
          && selection.longitude === candidate.longitude ? 'secondary' : 'ghost'}
        aria-pressed={selection.selection_kind === 'assisted_candidate' && selection.latitude === candidate.latitude
          && selection.longitude === candidate.longitude}
        className="h-auto w-full justify-start whitespace-normal border px-3 py-2 text-left text-xs"
        onClick={() => chooseCandidate(candidate)} disabled={disabled}>
        <MapPin className="mr-2 h-4 w-4 shrink-0 text-primary" />
        <span>{candidate.label}<span className="mt-1 block text-muted-foreground">
          Precisão estimada: {Math.round(candidate.accuracy_m)} m
        </span></span>
      </Button>)}
    </div>
    <div className="h-64 overflow-hidden rounded-md border" aria-label={`Mapa para ajustar endereço de ${subjectLabel}`}>
      <MapContainer center={[selection.latitude, selection.longitude]} zoom={17} className="h-full w-full z-0">
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapFocus selection={selection} />
        <MapAdjustment disabled={disabled} selection={selection} onChange={adjust} />
      </MapContainer>
    </div>
    <p className="text-xs text-muted-foreground">
      Clique no mapa, arraste o marcador ou informe as coordenadas da portaria. O ajuste manual fica registrado na auditoria.
    </p>
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="space-y-1 text-xs">Latitude<Input type="number" min={-90} max={90} step="any"
        aria-label={`Latitude do ponto para ${subjectLabel}`} value={latitudeDraft}
        onChange={event=>{setLatitudeDraft(event.target.value);onSelectionChange?.();}} disabled={disabled}/></label>
      <label className="space-y-1 text-xs">Longitude<Input type="number" min={-180} max={180} step="any"
        aria-label={`Longitude do ponto para ${subjectLabel}`} value={longitudeDraft}
        onChange={event=>{setLongitudeDraft(event.target.value);onSelectionChange?.();}} disabled={disabled}/></label>
      <Button type="button" variant="outline" size="sm" onClick={applyCoordinates} disabled={disabled}>Aplicar coordenadas</Button>
    </div>
    {coordinateError&&<p role="alert" className="text-xs text-destructive">{coordinateError}</p>}
    {coordinatesPending&&<p className="text-xs text-muted-foreground">Aplique as coordenadas antes de confirmar.</p>}
    <Button type="button" size="sm" aria-label={`${selection.selection_kind === 'manual_map' ? 'Confirmar ponto ajustado' : 'Confirmar endereço selecionado'} para ${subjectLabel}`}
      onClick={() => onConfirm(selection)} disabled={disabled||coordinatesPending}>
      <Check className="mr-2 h-4 w-4" />
      {selection.selection_kind === 'manual_map' ? 'Confirmar ponto ajustado' : 'Confirmar endereço selecionado'}
    </Button>
  </div>;
}

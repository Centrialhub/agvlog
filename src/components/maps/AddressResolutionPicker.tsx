import { useEffect, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Check, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  candidates: GeocodingCandidate[];
  disabled?: boolean;
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

export function AddressResolutionPicker({ address, candidates, disabled = false, onConfirm }: Props) {
  const [selection, setSelection] = useState<AddressResolutionSelection | null>(() => candidates[0] ? fromCandidate(candidates[0]) : null);

  useEffect(() => {
    setSelection(candidates[0] ? fromCandidate(candidates[0]) : null);
  }, [candidates]);

  const adjust = (latitude: number, longitude: number) => setSelection((current) => current ? {
    ...current,
    latitude,
    longitude,
    provider: 'leaflet_map',
    accuracy_m: null,
    confidence: null,
    label: `Ponto ajustado no mapa para ${address}`,
    selection_kind: 'manual_map',
    previous_lat: current.latitude,
    previous_lng: current.longitude,
  } : null);

  if (!selection) return null;
  return <div className="space-y-3" aria-label="Conferência da localização no mapa">
    <div className="space-y-2" aria-label="Opções encontradas">
      {candidates.map((candidate) => <Button key={`${candidate.latitude}:${candidate.longitude}`} type="button"
        variant={selection.selection_kind === 'assisted_candidate' && selection.latitude === candidate.latitude
          && selection.longitude === candidate.longitude ? 'secondary' : 'ghost'}
        className="h-auto w-full justify-start whitespace-normal border px-3 py-2 text-left text-xs"
        onClick={() => setSelection(fromCandidate(candidate))} disabled={disabled}>
        <MapPin className="mr-2 h-4 w-4 shrink-0 text-primary" />
        <span>{candidate.label}<span className="mt-1 block text-muted-foreground">
          Precisão estimada: {Math.round(candidate.accuracy_m)} m
        </span></span>
      </Button>)}
    </div>
    <div className="h-64 overflow-hidden rounded-md border" aria-label="Mapa para ajustar endereço">
      <MapContainer center={[selection.latitude, selection.longitude]} zoom={17} className="h-full w-full z-0">
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapFocus selection={selection} />
        <MapAdjustment disabled={disabled} selection={selection} onChange={adjust} />
      </MapContainer>
    </div>
    <p className="text-xs text-muted-foreground">
      Toque no mapa ou arraste o marcador para a portaria correta. O ajuste manual fica registrado na auditoria.
    </p>
    <Button type="button" size="sm" onClick={() => onConfirm(selection)} disabled={disabled}>
      <Check className="mr-2 h-4 w-4" />
      {selection.selection_kind === 'manual_map' ? 'Confirmar ponto ajustado' : 'Confirmar endereço selecionado'}
    </Button>
  </div>;
}

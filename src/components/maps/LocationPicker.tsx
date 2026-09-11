import { useEffect, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Loader2, MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { geocodeAddress, locationFromCandidate, locationFromMap, type GeocodingCandidate, type ResolvedLocation } from '@/lib/geocoding';
import '@/lib/maps/leaflet';
import 'leaflet/dist/leaflet.css';

interface Props {
  tenantId: string;
  idPrefix?: string;
  address: string;
  value: ResolvedLocation | null;
  onAddressChange: (address: string) => void;
  onChange: (location: ResolvedLocation) => void;
  disabled?: boolean;
}

const BRAZIL_CENTER: [number, number] = [-14.235, -51.9253];

function MapClickHandler({ address, onChange }: Pick<Props, 'address' | 'onChange'>) {
  useMapEvents({
    click: (event) => onChange(locationFromMap(event.latlng.lat, event.latlng.lng, address)),
  });
  return null;
}

function MapFocus({ value }: { value: ResolvedLocation | null }) {
  const map = useMap();
  useEffect(() => {
    if (value) map.flyTo([value.latitude, value.longitude], 16, { duration: 0.4 });
  }, [map, value]);
  return null;
}

export function LocationPicker({ tenantId, idPrefix = 'location', address, value, onAddressChange, onChange, disabled }: Props) {
  const [candidates, setCandidates] = useState<GeocodingCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    try {
      const found = await geocodeAddress(tenantId, address);
      setCandidates(found);
      if (found.length === 0) setError('Nenhum endereço encontrado. Complete rua, número, cidade e UF ou marque o ponto no mapa.');
      if (found.length === 1) onChange(locationFromCandidate(found[0], address));
    } catch (failure) {
      setCandidates([]);
      setError(failure instanceof Error ? failure.message : 'Não foi possível pesquisar o endereço.');
    } finally {
      setLoading(false);
    }
  }

  return <div className="space-y-3">
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-address`}>Endereço</Label>
      <div className="flex gap-2">
        <Input id={`${idPrefix}-address`} value={address} disabled={disabled || loading}
          onChange={(event) => onAddressChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }}
          placeholder="Rua, número, bairro, cidade - UF, CEP" />
        <Button type="button" variant="outline" onClick={() => void search()} disabled={disabled || loading || address.trim().length < 8}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="sr-only">Pesquisar endereço</span>
        </Button>
      </div>
    </div>

    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    {candidates.length > 1 ? <div className="max-h-32 space-y-1 overflow-y-auto" aria-label="Resultados de endereço">
      {candidates.map((candidate) => <Button key={`${candidate.latitude}:${candidate.longitude}`} type="button"
        variant="ghost" className="h-auto w-full justify-start whitespace-normal px-2 py-1 text-left text-xs"
        onClick={() => onChange(locationFromCandidate(candidate, address))}>
        <MapPin className="mr-2 h-3.5 w-3.5 shrink-0" />{candidate.label}
      </Button>)}
    </div> : null}

    <div className="h-64 overflow-hidden rounded-md border" aria-label="Mapa para selecionar localização">
      <MapContainer center={value ? [value.latitude, value.longitude] : BRAZIL_CENTER}
        zoom={value ? 16 : 4} className="h-full w-full z-0">
        <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapClickHandler address={address} onChange={onChange} />
        <MapFocus value={value} />
        {value ? <Marker position={[value.latitude, value.longitude]} draggable={!disabled}
          eventHandlers={{ dragend: (event) => {
            const point = event.target.getLatLng();
            onChange(locationFromMap(point.lat, point.lng, address));
          } }} /> : null}
      </MapContainer>
    </div>
    <p className="text-xs text-muted-foreground">
      Pesquise o endereço e selecione o resultado. Se o acesso real for diferente, toque no mapa ou arraste o marcador até o ponto exato.
    </p>
    {value ? <p role="status" className="text-xs text-success">
      Local definido por {value.source === 'address_geocoded' ? 'endereço pesquisado' : 'seleção no mapa'}
      {value.accuracy_m ? ` · precisão estimada ${Math.round(value.accuracy_m)} m` : ''}.
    </p> : null}
  </div>;
}

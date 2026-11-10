export function GeocodingAttribution({providers}:{providers:Array<string|null|undefined>}){
 if(!providers.includes('geoapify'))return null;
 return <p className="text-xs text-muted-foreground">Powered by <a className="underline" href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a>
  {' · '}© <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></p>;
}

import {render,screen} from '@testing-library/react';
import {it,expect} from 'vitest';
import {GeocodingAttribution} from '@/components/maps/GeocodingAttribution';
it('credits the new provider and OpenStreetMap with fixed follow links when Geoapify data is shown',()=>{
 const view=render(<GeocodingAttribution providers={['nominatim',null]}/>);expect(view.container).toBeEmptyDOMElement();
 view.rerender(<GeocodingAttribution providers={['geoapify']}/>);
 expect(screen.getByRole('link',{name:'Geoapify'})).toHaveAttribute('href','https://www.geoapify.com/');
 expect(screen.getByRole('link',{name:'Geoapify'}).getAttribute('rel')).not.toContain('nofollow');
 expect(screen.getByRole('link',{name:'OpenStreetMap contributors'})).toHaveAttribute('href','https://www.openstreetmap.org/copyright');
});

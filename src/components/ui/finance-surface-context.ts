import { createContext, useContext } from 'react';

// React context crosses Radix portals, keeping finance styles out of other modules.
export const FinanceSurfaceContext = createContext(false);
export const useFinanceSurface = () => useContext(FinanceSurfaceContext);

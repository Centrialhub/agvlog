import {useDriverMessages} from './useDriverMessages';
// Event messages share the authenticated, paginated recovery contract.
export function useEventMessages(eventId:string|null|undefined){return useDriverMessages(null,eventId??undefined);}

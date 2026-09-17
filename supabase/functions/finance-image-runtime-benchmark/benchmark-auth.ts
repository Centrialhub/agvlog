// No fallback to platform keys or user JWTs. Root provisions and removes this temporary token.
export function hasBenchmarkToken(authorization:string|null,token:string|undefined):boolean{
 return typeof token==='string'&&token.length>=32&&authorization===`Bearer ${token}`;
}
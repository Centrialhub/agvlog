/**
 * Compatibility export. The deletion policy and implementation live in
 * `useNFSe` so both screens cannot drift to different allowed statuses again.
 */
export { useDeleteNFSe as useDeleteFailedNFSe } from './useNFSe';

import {fmtDateSafe} from './utils/formatDate';

/** Formats a database DATE as a civil date, without interpreting it as UTC. */
export const formatBillingIssueDate=(value:string|null,fallback='')=>fmtDateSafe(value,fallback);

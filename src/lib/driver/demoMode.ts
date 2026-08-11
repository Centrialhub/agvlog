/**
 * Driver demo mode is only available in local development.
 * In production or homologation, the driver app must never render fake data.
 */
export const canUseDriverDemo = import.meta.env.DEV && !import.meta.env.PROD;
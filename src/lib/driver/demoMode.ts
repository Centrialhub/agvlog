// Driver demo mode is only available in development builds. In production
// the driver app must never render fake data — show empty/unbound states instead.
export const canUseDriverDemo = import.meta.env.DEV;
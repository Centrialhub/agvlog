export const FEATURE_FLAGS = {
  DRIVER_WORKSPACE: false,
  CLIENT_PORTAL: false,
  OPERATIONAL_LEDGER: false,
  DATA_QUALITY_CENTER: false,
  LOGISTICS_CONSOLIDATION_V2: true, // Nucleus is active
  HR_CORE: false, // Core HR CRUD operations via RPC
};

export type FeatureKey = keyof typeof FEATURE_FLAGS;

export const isFeatureEnabled = (key: FeatureKey): boolean => {
  return FEATURE_FLAGS[key] || false;
};

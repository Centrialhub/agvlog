export const FEATURE_FLAGS = {
  DRIVER_WORKSPACE: false,
  CLIENT_PORTAL: false,
  OPERATIONAL_LEDGER: false,
  DATA_QUALITY_CENTER: true,
  LOGISTICS_CONSOLIDATION_V2: false, // Nucleus deactivated, reconstruction started
  HR_CORE: false, // Core HR CRUD operations via RPC (temporarily false for transition validation)
  LOAD_CONTROL: false, // Under reconstruction
};

export type FeatureKey = keyof typeof FEATURE_FLAGS;

export const isFeatureEnabled = (key: FeatureKey): boolean => {
  return FEATURE_FLAGS[key] || false;
};

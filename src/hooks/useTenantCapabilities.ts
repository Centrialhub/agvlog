import { useQuery } from "@tanstack/react-query";

import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";

export type IntegrationCapability = "ssx" | "fiscal";

export interface TenantCapabilities {
  ssx: boolean;
  fiscal: boolean;
  ssxKillSwitch: boolean;
  fiscalKillSwitch: boolean;
}

const FAIL_CLOSED_CAPABILITIES: TenantCapabilities = {
  ssx: false,
  fiscal: false,
  ssxKillSwitch: false,
  fiscalKillSwitch: false,
};

export function useTenantCapabilities() {
  const { currentTenant } = useTenant();
  const query = useQuery({
    queryKey: ["tenant-integration-capabilities", currentTenant?.id],
    enabled: Boolean(currentTenant?.id),
    staleTime: 30_000,
    queryFn: async (): Promise<TenantCapabilities> => {
      const { data, error } = await supabase
        .from("tenant_feature_policy")
        .select("feature_key, enabled")
        .eq("tenant_id", currentTenant!.id)
        .in("feature_key", [
          "ssx_enabled",
          "fiscal_enabled",
          "ssx_kill_switch",
          "fiscal_kill_switch",
        ]);

      if (error) throw error;
      const values = new Map((data ?? []).map((row) => [row.feature_key, row.enabled]));
      const ssxKillSwitch = values.get("ssx_kill_switch") === true;
      const fiscalKillSwitch = values.get("fiscal_kill_switch") === true;

      return {
        ssx: values.get("ssx_enabled") === true && !ssxKillSwitch,
        fiscal: values.get("fiscal_enabled") === true && !fiscalKillSwitch,
        ssxKillSwitch,
        fiscalKillSwitch,
      };
    },
  });

  const capabilities = query.data ?? FAIL_CLOSED_CAPABILITIES;
  return {
    ...query,
    capabilities,
    isEnabled: (capability: IntegrationCapability) => capabilities[capability],
    operationalStatus: query.error ? "degraded" as const
      : query.isLoading ? "loading" as const
        : "ready" as const,
  };
}

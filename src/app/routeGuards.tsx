import { lazy, Suspense, type PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";

import AppLayout from "@/components/layout/AppLayout";
import DriverLayout from "@/components/layout/DriverLayout";
import { useAuth } from "@/hooks/useAuth";
import { TenantProvider, useTenant } from "@/hooks/useTenant";
import { useTenantCapabilities, type IntegrationCapability } from "@/hooks/useTenantCapabilities";
import Auth from "@/pages/Auth";
import { IntegrationUnavailable } from "@/components/integrations/IntegrationUnavailable";
import { PrivilegedMfaGate } from "@/components/auth/PrivilegedMfaGate";

const OperationsCenter = lazy(() => import("@/pages/OperationsCenter"));

const INTERNAL_ROLES = new Set(["owner", "admin", "operator"]);
const CLIENT_PORTAL_ROLES = new Set(["client", "owner", "admin", "operator"]);

type ProtectedRouteProps = PropsWithChildren<{
  gate?: "internal" | "any";
}>;

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">Carregando...</span>
      </div>
    </div>
  );
}

function FullPageLoader() {
  return (
    <div className="flex h-screen items-center justify-center text-muted-foreground">
      Carregando...
    </div>
  );
}

function RequireInternalRole({ children }: PropsWithChildren) {
  const { currentRole, loading } = useTenant();

  if (loading) return <PageLoader />;
  if (!currentRole) {
    return <div className="p-6 text-sm text-muted-foreground">Sem acesso a este tenant.</div>;
  }
  if (!INTERNAL_ROLES.has(currentRole)) {
    if (currentRole === "driver") return <Navigate to="/driver" replace />;
    if (currentRole === "client") return <Navigate to="/portal" replace />;
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function RequireDriverRole({ children }: PropsWithChildren) {
  const { currentRole, loading } = useTenant();

  if (loading) return <PageLoader />;
  if (currentRole !== "driver") return <Navigate to="/" replace />;

  return <>{children}</>;
}

export function RequireClientPortalAccess({ children }: PropsWithChildren) {
  const { currentRole, loading } = useTenant();

  if (loading) return <PageLoader />;
  if (!currentRole || !CLIENT_PORTAL_ROLES.has(currentRole)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">Sem acesso ao portal</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Sua conta não possui permissão de portal de cliente. Solicite ao administrador do tenant a
          criação de um acesso em <strong>Equipe → Acessos do Portal</strong>.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

export function CapabilityGate({
  capability,
  children,
}: PropsWithChildren<{ capability: IntegrationCapability }>) {
  const { isLoading, error, isEnabled, refetch } = useTenantCapabilities();

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <IntegrationUnavailable
        capability={capability}
        degraded
        onRetry={() => { void refetch(); }}
      />
    );
  }
  if (!isEnabled(capability)) return <IntegrationUnavailable capability={capability} />;
  return <>{children}</>;
}

function ProtectedContent({ children, gate }: Required<ProtectedRouteProps>) {
  const { loading, currentRole } = useTenant();

  if (loading) return <FullPageLoader />;

  const isDriver = currentRole === "driver";
  if (isDriver && gate === "internal") return <Navigate to="/driver" replace />;

  const Layout = isDriver ? DriverLayout : AppLayout;
  const content = (
    <Suspense fallback={<PageLoader />}>
      {gate === "internal" ? <RequireInternalRole>{children}</RequireInternalRole> : children}
    </Suspense>
  );

  return (
    <PrivilegedMfaGate>
      <Layout>
        {content}
      </Layout>
    </PrivilegedMfaGate>
  );
}

export function ProtectedRoute({ children, gate = "internal" }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <TenantProvider>
      <ProtectedContent gate={gate}>{children ?? null}</ProtectedContent>
    </TenantProvider>
  );
}

export function DriverRoute({ children }: PropsWithChildren) {
  const { user, loading } = useAuth();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <TenantProvider>
      <DriverLayout>
        <Suspense fallback={<PageLoader />}>
          <RequireDriverRole>{children}</RequireDriverRole>
        </Suspense>
      </DriverLayout>
    </TenantProvider>
  );
}

export function ClientRoute({ children }: PropsWithChildren) {
  const { user, loading } = useAuth();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <TenantProvider>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </TenantProvider>
  );
}

export function RoleRouter() {
  const { currentRole, loading } = useTenant();

  if (loading) return <FullPageLoader />;
  if (currentRole === "driver") return <Navigate to="/driver" replace />;
  if (currentRole === "client") return <Navigate to="/portal" replace />;

  return <OperationsCenter />;
}

export function AuthRoute() {
  const { user, loading } = useAuth();

  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to="/" replace />;

  return <Auth />;
}

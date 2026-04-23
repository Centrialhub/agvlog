import { lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { TenantProvider, useTenant } from "@/hooks/useTenant";
import AppLayout from "@/components/layout/AppLayout";
import DriverLayout from "@/components/layout/DriverLayout";
import Auth from "@/pages/Auth";

// Admin / Operations pages
const OperationsCenter = lazy(() => import("@/pages/OperationsCenter"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Vehicles = lazy(() => import("@/pages/Vehicles"));
const Drivers = lazy(() => import("@/pages/Drivers"));
const FleetMap = lazy(() => import("@/pages/FleetMap"));
const VehicleDetails = lazy(() => import("@/pages/VehicleDetails"));
const Alerts = lazy(() => import("@/pages/Alerts"));
const Geofences = lazy(() => import("@/pages/Geofences"));
const Reports = lazy(() => import("@/pages/Reports"));
const RoutesPage = lazy(() => import("@/pages/Routes"));
const IntegrationHealth = lazy(() => import("@/pages/IntegrationHealth"));
const Clients = lazy(() => import("@/pages/Clients"));
const Orders = lazy(() => import("@/pages/Orders"));
const FiscalDocuments = lazy(() => import("@/pages/FiscalDocuments"));
const Inventory = lazy(() => import("@/pages/Inventory"));
const Loads = lazy(() => import("@/pages/Loads"));
const LoadDetail = lazy(() => import("@/pages/LoadDetail"));
const Traceability = lazy(() => import("@/pages/Traceability"));
const OperationsDashboard = lazy(() => import("@/pages/OperationsDashboard"));
const OperationalEvents = lazy(() => import("@/pages/OperationalEvents"));
const Ingestion = lazy(() => import("@/pages/Ingestion"));
const ProductivityReports = lazy(() => import("@/pages/ProductivityReports"));
const Settings = lazy(() => import("@/pages/Settings"));
const ExpenseApproval = lazy(() => import("@/pages/ExpenseApproval"));
const TeamManagement = lazy(() => import("@/pages/TeamManagement"));
const ClientRegions = lazy(() => import("@/pages/ClientRegions"));
const FreightTables = lazy(() => import("@/pages/FreightTables"));
const ClientPortal = lazy(() => import("@/pages/ClientPortal"));
const RoutePlanning = lazy(() => import("@/pages/RoutePlanning"));
const Receivables = lazy(() => import("@/pages/Receivables"));
const Financial = lazy(() => import("@/pages/Financial"));
const OperationalRoutesPage = lazy(() => import("@/pages/OperationalRoutesPage"));
const Employees = lazy(() => import("@/pages/Employees"));
const Incidents = lazy(() => import("@/pages/Incidents"));
const AssetsPage = lazy(() => import("@/pages/Assets"));
const MaintenanceOrders = lazy(() => import("@/pages/MaintenanceOrders"));
const StockPage = lazy(() => import("@/pages/Stock"));
const Checklists = lazy(() => import("@/pages/Checklists"));
const LoadReallocation = lazy(() => import("@/pages/LoadReallocation"));
const NotFound = lazy(() => import("@/pages/NotFound"));

// Driver pages
const DriverHome = lazy(() => import("@/pages/driver/DriverHome"));
const DriverStops = lazy(() => import("@/pages/driver/DriverStops"));
const DriverDeliveries = lazy(() => import("@/pages/driver/DriverDeliveries"));
const DriverIssues = lazy(() => import("@/pages/driver/DriverIssues"));
const DriverJourney = lazy(() => import("@/pages/driver/DriverJourney"));
const DriverExpenses = lazy(() => import("@/pages/driver/DriverExpenses"));
const DriverChecklist = lazy(() => import("@/pages/driver/DriverChecklist"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,      // 2 min — evita refetch ao navegar entre páginas
      gcTime: 1000 * 60 * 10,         // 10 min — mantém cache em memória
      refetchOnWindowFocus: false,     // não refaz ao voltar à aba
      retry: 1,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">Carregando...</span>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Carregando...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return (
    <TenantProvider>
      <AppLayout>
        <Suspense fallback={<PageLoader />}>{children}</Suspense>
      </AppLayout>
    </TenantProvider>
  );
}

function DriverRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Carregando...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return (
    <TenantProvider>
      <DriverLayout>
        <Suspense fallback={<PageLoader />}>{children}</Suspense>
      </DriverLayout>
    </TenantProvider>
  );
}

function RoleRouter() {
  const { currentRole, loading } = useTenant();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Carregando...</div>;
  if (currentRole === 'driver') return <Navigate to="/driver" replace />;
  if (currentRole === 'client') return <Navigate to="/portal" replace />;
  return <OperationsCenter />;
}

function ClientRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Carregando...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return (
    <TenantProvider>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </TenantProvider>
  );
}

function AuthRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Carregando...</div>;
  if (user) return <Navigate to="/" replace />;
  return <Auth />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<AuthRoute />} />

            {/* Role-based home */}
            <Route path="/" element={<ProtectedRoute><RoleRouter /></ProtectedRoute>} />

            {/* Admin / Operations routes */}
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/vehicles" element={<ProtectedRoute><Vehicles /></ProtectedRoute>} />
            <Route path="/drivers" element={<ProtectedRoute><Drivers /></ProtectedRoute>} />
            <Route path="/fleet-map" element={<ProtectedRoute><FleetMap /></ProtectedRoute>} />
            <Route path="/vehicles/:vehicleId" element={<ProtectedRoute><VehicleDetails /></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
            <Route path="/geofences" element={<ProtectedRoute><Geofences /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/corridors" element={<ProtectedRoute><RoutesPage /></ProtectedRoute>} />
            <Route path="/clients" element={<ProtectedRoute><Clients /></ProtectedRoute>} />
            <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
            <Route path="/fiscal-documents" element={<ProtectedRoute><FiscalDocuments /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
            <Route path="/loads" element={<ProtectedRoute><Loads /></ProtectedRoute>} />
            <Route path="/loads/:id" element={<ProtectedRoute><LoadDetail /></ProtectedRoute>} />
            <Route path="/traceability" element={<ProtectedRoute><Traceability /></ProtectedRoute>} />
            <Route path="/operations" element={<ProtectedRoute><OperationsDashboard /></ProtectedRoute>} />
            <Route path="/events" element={<ProtectedRoute><OperationalEvents /></ProtectedRoute>} />
            <Route path="/ingestion" element={<ProtectedRoute><Ingestion /></ProtectedRoute>} />
            <Route path="/productivity" element={<ProtectedRoute><ProductivityReports /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/expense-approval" element={<ProtectedRoute><ExpenseApproval /></ProtectedRoute>} />
            <Route path="/integration-health" element={<ProtectedRoute><IntegrationHealth /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute><TeamManagement /></ProtectedRoute>} />
            <Route path="/regions" element={<ProtectedRoute><ClientRegions /></ProtectedRoute>} />
            <Route path="/freight" element={<ProtectedRoute><FreightTables /></ProtectedRoute>} />
            <Route path="/route-planning" element={<ProtectedRoute><RoutePlanning /></ProtectedRoute>} />
            <Route path="/receivables" element={<ProtectedRoute><Receivables /></ProtectedRoute>} />
            <Route path="/financial" element={<ProtectedRoute><Financial /></ProtectedRoute>} />
            <Route path="/operational-routes" element={<ProtectedRoute><OperationalRoutesPage /></ProtectedRoute>} />
            <Route path="/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
            <Route path="/incidents" element={<ProtectedRoute><Incidents /></ProtectedRoute>} />
            <Route path="/assets" element={<ProtectedRoute><AssetsPage /></ProtectedRoute>} />
            <Route path="/maintenance-orders" element={<ProtectedRoute><MaintenanceOrders /></ProtectedRoute>} />
            <Route path="/stock" element={<ProtectedRoute><StockPage /></ProtectedRoute>} />
            <Route path="/checklists" element={<ProtectedRoute><Checklists /></ProtectedRoute>} />
            <Route path="/reallocation" element={<ProtectedRoute><LoadReallocation /></ProtectedRoute>} />

            {/* Driver routes */}
            <Route path="/driver" element={<DriverRoute><DriverHome /></DriverRoute>} />
            <Route path="/driver/stops" element={<DriverRoute><DriverStops /></DriverRoute>} />
            <Route path="/driver/deliveries" element={<DriverRoute><DriverDeliveries /></DriverRoute>} />
            <Route path="/driver/issues" element={<DriverRoute><DriverIssues /></DriverRoute>} />
            <Route path="/driver/journey" element={<DriverRoute><DriverJourney /></DriverRoute>} />
            <Route path="/driver/expenses" element={<DriverRoute><DriverExpenses /></DriverRoute>} />
            <Route path="/driver/checklist" element={<DriverRoute><DriverChecklist /></DriverRoute>} />

            {/* Legacy redirect */}
            <Route path="/routes" element={<Navigate to="/corridors" replace />} />

            {/* Client portal */}
            <Route path="/portal" element={<ClientRoute><ClientPortal /></ClientRoute>} />

            <Route path="*" element={<Suspense fallback={<PageLoader />}><NotFound /></Suspense>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

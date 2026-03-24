import { lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { TenantProvider } from "@/hooks/useTenant";
import AppLayout from "@/components/layout/AppLayout";
import Auth from "@/pages/Auth";

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
const OperationsDashboard = lazy(() => import("@/pages/OperationsDashboard"));
const OperationalEvents = lazy(() => import("@/pages/OperationalEvents"));
const Ingestion = lazy(() => import("@/pages/Ingestion"));
const ProductivityReports = lazy(() => import("@/pages/ProductivityReports"));
const Settings = lazy(() => import("@/pages/Settings"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const queryClient = new QueryClient();

function PageLoader() {
  return <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">Carregando...</div>;
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
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/vehicles" element={<ProtectedRoute><Vehicles /></ProtectedRoute>} />
            <Route path="/drivers" element={<ProtectedRoute><Drivers /></ProtectedRoute>} />
            <Route path="/fleet-map" element={<ProtectedRoute><FleetMap /></ProtectedRoute>} />
            <Route path="/vehicles/:vehicleId" element={<ProtectedRoute><VehicleDetails /></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
            <Route path="/geofences" element={<ProtectedRoute><Geofences /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/routes" element={<ProtectedRoute><RoutesPage /></ProtectedRoute>} />
            <Route path="/clients" element={<ProtectedRoute><Clients /></ProtectedRoute>} />
            <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
            <Route path="/fiscal-documents" element={<ProtectedRoute><FiscalDocuments /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
            <Route path="/loads" element={<ProtectedRoute><Loads /></ProtectedRoute>} />
            <Route path="/loads/:id" element={<ProtectedRoute><LoadDetail /></ProtectedRoute>} />
            <Route path="/operations" element={<ProtectedRoute><OperationsDashboard /></ProtectedRoute>} />
            <Route path="/events" element={<ProtectedRoute><OperationalEvents /></ProtectedRoute>} />
            <Route path="/ingestion" element={<ProtectedRoute><Ingestion /></ProtectedRoute>} />
            <Route path="/productivity" element={<ProtectedRoute><ProductivityReports /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/integration-health" element={<ProtectedRoute><IntegrationHealth /></ProtectedRoute>} />
            <Route path="*" element={<Suspense fallback={<PageLoader />}><NotFound /></Suspense>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

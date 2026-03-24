import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { TenantProvider } from "@/hooks/useTenant";
import AppLayout from "@/components/layout/AppLayout";
import Auth from "@/pages/Auth";
import Settings from "@/pages/Settings";
import Dashboard from "@/pages/Dashboard";
import Vehicles from "@/pages/Vehicles";
import Drivers from "@/pages/Drivers";
import FleetMap from "@/pages/FleetMap";
import VehicleDetails from "@/pages/VehicleDetails";
import Alerts from "@/pages/Alerts";
import Geofences from "@/pages/Geofences";
import Reports from "@/pages/Reports";
import RoutesPage from "@/pages/Routes";
import IntegrationHealth from "@/pages/IntegrationHealth";
import Clients from "@/pages/Clients";
import Orders from "@/pages/Orders";
import FiscalDocuments from "@/pages/FiscalDocuments";
import Inventory from "@/pages/Inventory";
import Loads from "@/pages/Loads";
import OperationsDashboard from "@/pages/OperationsDashboard";
import OperationalEvents from "@/pages/OperationalEvents";
import Ingestion from "@/pages/Ingestion";
import ProductivityReports from "@/pages/ProductivityReports";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Carregando...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <TenantProvider><AppLayout>{children}</AppLayout></TenantProvider>;
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
            <Route path="/operations" element={<ProtectedRoute><OperationsDashboard /></ProtectedRoute>} />
            <Route path="/events" element={<ProtectedRoute><OperationalEvents /></ProtectedRoute>} />
            <Route path="/ingestion" element={<ProtectedRoute><Ingestion /></ProtectedRoute>} />
            <Route path="/productivity" element={<ProtectedRoute><ProductivityReports /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/integration-health" element={<ProtectedRoute><IntegrationHealth /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

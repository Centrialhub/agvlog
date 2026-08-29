import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import {
  AuthRoute,
  CapabilityGate,
  ClientRoute,
  DriverRoute,
  PageLoader,
  ProtectedRoute,
  RequireClientPortalAccess,
  RoleRouter,
} from "@/app/routeGuards";

const OperationsControl = lazy(() => import("@/pages/OperationsControl"));
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
const LoadExtractionAudit = lazy(() => import("@/pages/LoadExtractionAudit"));
const PodHistory = lazy(() => import("@/pages/PodHistory"));
const OperationsDashboard = lazy(() => import("@/pages/OperationsDashboard"));
const OperationalEvents = lazy(() => import("@/pages/OperationalEvents"));
const Ingestion = lazy(() => import("@/pages/Ingestion"));
const IngestionReports = lazy(() => import("@/pages/IngestionReports"));
const ProductivityReports = lazy(() => import("@/pages/ProductivityReports"));
const Settings = lazy(() => import("@/pages/Settings"));
const ExpenseApproval = lazy(() => import("@/pages/ExpenseApproval"));
const TeamManagement = lazy(() => import("@/pages/TeamManagement"));
const DataAudit = lazy(() => import("@/pages/DataAudit"));
const FreightHub = lazy(() => import("@/pages/FreightHub"));
const PortalLayout = lazy(() => import("@/components/portal/PortalLayout"));
const PortalDashboard = lazy(() => import("@/pages/portal/PortalDashboard"));
const PortalShipments = lazy(() => import("@/pages/portal/PortalShipments"));
const PortalShipmentDetail = lazy(() => import("@/pages/portal/PortalShipmentDetail"));
const PortalPickups = lazy(() => import("@/pages/portal/PortalPickups"));
const PortalDocuments = lazy(() => import("@/pages/portal/PortalDocuments"));
const PortalPods = lazy(() => import("@/pages/portal/PortalPods"));
const PortalOccurrences = lazy(() => import("@/pages/portal/PortalOccurrences"));
const PortalTracking = lazy(() => import("@/pages/portal/PortalTracking"));
const PortalReports = lazy(() => import("@/pages/portal/PortalReports"));
const PortalSettings = lazy(() => import("@/pages/portal/PortalSettings"));
const RoutePlanning = lazy(() => import("@/pages/RoutePlanning"));
const Receivables = lazy(() => import("@/pages/Receivables"));
const Financial = lazy(() => import("@/pages/Financial"));
const DriverSettlements = lazy(() => import("@/pages/DriverSettlements"));
const BankReconciliation = lazy(() => import("@/pages/BankReconciliation"));
const Payables = lazy(() => import("@/pages/Payables"));
const ClientInvoices = lazy(() => import("@/pages/ClientInvoices"));
const BillingEdi = lazy(() => import("@/pages/BillingEdi"));
const OperationalRoutesPage = lazy(() => import("@/pages/OperationalRoutesPage"));
const Employees = lazy(() => import("@/pages/Employees"));
const Incidents = lazy(() => import("@/pages/Incidents"));
const Payroll = lazy(() => import("@/pages/Payroll"));
const AssetsPage = lazy(() => import("@/pages/Assets"));
const MaintenanceOrders = lazy(() => import("@/pages/MaintenanceOrders"));
const StockPage = lazy(() => import("@/pages/Stock"));
const Checklists = lazy(() => import("@/pages/Checklists"));
const LoadReallocation = lazy(() => import("@/pages/LoadReallocation"));
const Billing = lazy(() => import("@/pages/BillingPage"));
const CteMonitor = lazy(() => import("@/pages/CteMonitor"));
const CteSearch = lazy(() => import("@/pages/CteSearch"));
const NFSe = lazy(() => import("@/pages/NFSe"));
const PickupOrders = lazy(() => import("@/pages/PickupOrders"));
const OrtManagement = lazy(() => import("@/pages/OrtManagement"));
const CteHub = lazy(() => import("@/pages/CteHubPage"));
const ProductTraceability = lazy(() => import("@/pages/ProductTraceability"));
const ProductHistory = lazy(() => import("@/pages/ProductHistory"));
const ImportedNotesSummary = lazy(() => import("@/pages/ImportedNotesSummary"));
const LoadControl = lazy(() => import("@/pages/LoadControl"));
const ClosingReports = lazy(() => import("@/pages/ClosingReports"));
const CteConsistencyReport = lazy(() => import("@/pages/CteConsistencyReport"));
const RuralClients = lazy(() => import("@/pages/RuralClients"));
const DriverMonitoring = lazy(() => import("@/pages/DriverMonitoring"));
const OccurrenceReports = lazy(() => import("@/pages/OccurrenceReports"));
const OccurrenceReturnSheet = lazy(() => import("@/pages/OccurrenceReturnSheet"));
const PalletReturns = lazy(() => import("@/pages/PalletReturns"));
const MerchandiseShortages = lazy(() => import("@/pages/MerchandiseShortages"));
const CostCenters = lazy(() => import("@/pages/CostCenters"));
const MdfeProvisional = lazy(() => import("@/pages/MdfeProvisional"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const SetPassword = lazy(() => import("@/pages/SetPassword"));

const DriverHome = lazy(() => import("@/pages/driver/DriverHome"));
const DriverStops = lazy(() => import("@/pages/driver/DriverStops"));
const DriverDeliveries = lazy(() => import("@/pages/driver/DriverDeliveries"));
const DriverIssues = lazy(() => import("@/pages/driver/DriverIssues"));
const DriverJourney = lazy(() => import("@/pages/driver/DriverJourney"));
const DriverExpenses = lazy(() => import("@/pages/driver/DriverExpenses"));
const DriverChecklist = lazy(() => import("@/pages/driver/DriverChecklist"));
const DriverEvents = lazy(() => import("@/pages/driver/DriverEvents"));
const DriverEventDetail = lazy(() => import("@/pages/driver/DriverEventDetail"));
const DriverChat = lazy(() => import("@/pages/driver/DriverChat"));
const DriverLoads = lazy(() => import("@/pages/driver/DriverLoads"));

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthRoute />} />
      <Route path="/set-password" element={<Suspense fallback={<PageLoader />}><SetPassword /></Suspense>} />
      <Route path="/" element={<ProtectedRoute gate="any"><RoleRouter /></ProtectedRoute>} />

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
      <Route path="/load-extraction-audit" element={<ProtectedRoute><LoadExtractionAudit /></ProtectedRoute>} />
      <Route path="/traceability/:docId/pod" element={<ProtectedRoute><PodHistory /></ProtectedRoute>} />
      <Route path="/operations" element={<ProtectedRoute><OperationsDashboard /></ProtectedRoute>} />
      <Route path="/operations-control" element={<ProtectedRoute><OperationsControl /></ProtectedRoute>} />
      <Route path="/events" element={<ProtectedRoute><OperationalEvents /></ProtectedRoute>} />
      <Route path="/ingestion" element={<ProtectedRoute><Ingestion /></ProtectedRoute>} />
      <Route path="/ingestion-reports" element={<ProtectedRoute><IngestionReports /></ProtectedRoute>} />
      <Route path="/productivity" element={<ProtectedRoute><ProductivityReports /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/expense-approval" element={<ProtectedRoute><ExpenseApproval /></ProtectedRoute>} />
      <Route path="/integration-health" element={<ProtectedRoute><IntegrationHealth /></ProtectedRoute>} />
      <Route path="/team" element={<ProtectedRoute><TeamManagement /></ProtectedRoute>} />
      <Route path="/data-audit" element={<ProtectedRoute><DataAudit /></ProtectedRoute>} />
      <Route path="/regions" element={<ProtectedRoute><FreightHub /></ProtectedRoute>} />
      <Route path="/freight" element={<ProtectedRoute><FreightHub /></ProtectedRoute>} />
      <Route path="/route-planning" element={<ProtectedRoute><RoutePlanning /></ProtectedRoute>} />
      <Route path="/receivables" element={<ProtectedRoute><Receivables /></ProtectedRoute>} />
      <Route path="/financial" element={<ProtectedRoute><Financial /></ProtectedRoute>} />
      <Route path="/driver-settlements" element={<ProtectedRoute><DriverSettlements /></ProtectedRoute>} />
      <Route path="/cost-centers" element={<ProtectedRoute><CostCenters /></ProtectedRoute>} />
      <Route path="/bank-reconciliation" element={<ProtectedRoute><BankReconciliation /></ProtectedRoute>} />
      <Route path="/payables" element={<ProtectedRoute><Payables /></ProtectedRoute>} />
      <Route path="/client-invoices" element={<ProtectedRoute><ClientInvoices /></ProtectedRoute>} />
      <Route path="/billing-edi" element={<ProtectedRoute><BillingEdi /></ProtectedRoute>} />
      <Route path="/operational-routes" element={<ProtectedRoute><OperationalRoutesPage /></ProtectedRoute>} />
      <Route path="/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
      <Route path="/incidents" element={<ProtectedRoute><Incidents /></ProtectedRoute>} />
      <Route path="/payroll" element={<ProtectedRoute><Payroll /></ProtectedRoute>} />
      <Route path="/assets" element={<ProtectedRoute><AssetsPage /></ProtectedRoute>} />
      <Route path="/maintenance-orders" element={<ProtectedRoute><MaintenanceOrders /></ProtectedRoute>} />
      <Route path="/stock" element={<ProtectedRoute><StockPage /></ProtectedRoute>} />
      <Route path="/checklists" element={<ProtectedRoute><Checklists /></ProtectedRoute>} />
      <Route path="/reallocation" element={<ProtectedRoute><LoadReallocation /></ProtectedRoute>} />
      <Route path="/billing" element={<ProtectedRoute><CapabilityGate capability="fiscal"><Billing /></CapabilityGate></ProtectedRoute>} />
      <Route path="/cte-monitor" element={<ProtectedRoute><CapabilityGate capability="fiscal"><CteMonitor /></CapabilityGate></ProtectedRoute>} />
      <Route path="/cte-search" element={<ProtectedRoute><CapabilityGate capability="fiscal"><CteSearch /></CapabilityGate></ProtectedRoute>} />
      <Route path="/cte-hub" element={<ProtectedRoute><CapabilityGate capability="fiscal"><CteHub /></CapabilityGate></ProtectedRoute>} />
      <Route path="/nfse" element={<ProtectedRoute><CapabilityGate capability="fiscal"><NFSe /></CapabilityGate></ProtectedRoute>} />
      <Route path="/cte-consistency" element={<ProtectedRoute><CapabilityGate capability="fiscal"><CteConsistencyReport /></CapabilityGate></ProtectedRoute>} />
      <Route path="/pickup-orders" element={<ProtectedRoute><PickupOrders /></ProtectedRoute>} />
      <Route path="/ort-management" element={<ProtectedRoute><OrtManagement /></ProtectedRoute>} />
      <Route path="/product-traceability" element={<ProtectedRoute><ProductTraceability /></ProtectedRoute>} />
      <Route path="/product-history" element={<ProtectedRoute><ProductHistory /></ProtectedRoute>} />
      <Route path="/mdfe-provisional" element={<ProtectedRoute><CapabilityGate capability="fiscal"><MdfeProvisional /></CapabilityGate></ProtectedRoute>} />
      <Route path="/imported-notes-summary" element={<ProtectedRoute><ImportedNotesSummary /></ProtectedRoute>} />
      <Route path="/load-control" element={<ProtectedRoute><LoadControl /></ProtectedRoute>} />
      <Route path="/closing-reports" element={<ProtectedRoute><ClosingReports /></ProtectedRoute>} />
      <Route path="/rural-clients" element={<ProtectedRoute><RuralClients /></ProtectedRoute>} />
      <Route path="/driver-monitoring" element={<ProtectedRoute><DriverMonitoring /></ProtectedRoute>} />
      <Route path="/occurrence-reports" element={<ProtectedRoute><OccurrenceReports /></ProtectedRoute>} />
      <Route path="/occurrences/:id/return-sheet" element={<ProtectedRoute><OccurrenceReturnSheet /></ProtectedRoute>} />
      <Route path="/pallet-returns" element={<ProtectedRoute><PalletReturns /></ProtectedRoute>} />
      <Route path="/merchandise-shortages" element={<ProtectedRoute><MerchandiseShortages /></ProtectedRoute>} />

      <Route path="/driver" element={<DriverRoute><DriverHome /></DriverRoute>} />
      <Route path="/driver/loads" element={<DriverRoute><DriverLoads /></DriverRoute>} />
      <Route path="/driver/stops" element={<DriverRoute><DriverStops /></DriverRoute>} />
      <Route path="/driver/deliveries" element={<DriverRoute><DriverDeliveries /></DriverRoute>} />
      <Route path="/driver/issues" element={<DriverRoute><DriverIssues /></DriverRoute>} />
      <Route path="/driver/journey" element={<DriverRoute><DriverJourney /></DriverRoute>} />
      <Route path="/driver/expenses" element={<DriverRoute><DriverExpenses /></DriverRoute>} />
      <Route path="/driver/checklist" element={<DriverRoute><DriverChecklist /></DriverRoute>} />
      <Route path="/driver/events" element={<DriverRoute><DriverEvents /></DriverRoute>} />
      <Route path="/driver/events/:id" element={<DriverRoute><DriverEventDetail /></DriverRoute>} />
      <Route path="/driver/chat" element={<DriverRoute><DriverChat /></DriverRoute>} />

      <Route path="/routes" element={<Navigate to="/corridors" replace />} />

      <Route
        path="/portal"
        element={(
          <ClientRoute>
            <RequireClientPortalAccess>
              <PortalLayout />
            </RequireClientPortalAccess>
          </ClientRoute>
        )}
      >
        <Route index element={<PortalDashboard />} />
        <Route path="shipments" element={<PortalShipments />} />
        <Route path="shipments/:documentId" element={<PortalShipmentDetail />} />
        <Route path="pickups" element={<PortalPickups />} />
        <Route path="documents" element={<PortalDocuments />} />
        <Route path="pods" element={<PortalPods />} />
        <Route path="occurrences" element={<PortalOccurrences />} />
        <Route path="tracking" element={<PortalTracking />} />
        <Route path="reports" element={<PortalReports />} />
        <Route path="settings" element={<PortalSettings />} />
      </Route>

      <Route path="*" element={<Suspense fallback={<PageLoader />}><NotFound /></Suspense>} />
    </Routes>
  );
}

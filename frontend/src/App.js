import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { Toaster } from "sonner";
import PWAInstallPrompt from "./components/PWAInstallPrompt";
import SplashScreen from "./components/SplashScreen";
import Header from "./components/Header";
import AnnouncementBar from "./components/AnnouncementBar";
import Footer from "./components/Footer";
import BottomNav from "./components/BottomNav";
import AdminLayout from "./components/AdminLayout";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import Dashboard from "./pages/Dashboard";
import AdminOverview from "./pages/AdminDashboard";
import AdminPlans from "./pages/AdminPlans";
import AdminDelivery from "./pages/AdminDelivery";
import AdminLiveMap from "./pages/AdminLiveMap";
import DeliveryBoyDashboard from "./pages/DeliveryBoyDashboard";
import Track from "./pages/Track";
import AdminCounter from "./pages/AdminCounter";
import AdminScanner from "./pages/AdminScanner";
import AdminMenu from "./pages/AdminMenu";
import AdminUsers from "./pages/AdminUsers";
import AdminTheme from "./pages/AdminTheme";
import AdminContent from "./pages/AdminContent";
import AdminLanding from "./pages/AdminLanding";
import AdminDashboardEditor from "./pages/AdminDashboardEditor";
import AdminTestimonials from "./pages/AdminTestimonials";
import AdminRawMaterials from "./pages/AdminRawMaterials";
import AdminRestaurant from "./pages/AdminRestaurant";
import AdminRestaurantOrders from "./pages/AdminRestaurantOrders";
import AdminWhatsAppOutbox from "./pages/AdminWhatsAppOutbox";
import StaffDeliveries from "./pages/StaffDeliveries";
import Plans from "./pages/Plans";
import Checkout from "./pages/Checkout";
import Profile from "./pages/Profile";
import Kiosk from "./pages/Kiosk";
import SelfScan from "./pages/SelfScan";
import Contact from "./pages/Contact";
import Restaurant from "./pages/Restaurant";
import RestaurantCheckout from "./pages/RestaurantCheckout";
import OrderTrack from "./pages/OrderTrack";
import RestaurantOrderHistory from "./pages/RestaurantOrderHistory";
import RiderDashboard from "./pages/RiderDashboard";
import { Privacy, Refund } from "./pages/PolicyPage";

function RequireAuth({ children, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;
  if (!user) {
    const next = encodeURIComponent(location.pathname + (location.search || ""));
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

function AdminIndex() {
  const { user } = useAuth();
  if (user?.role === "staff") return <Navigate to="/admin/deliveries-today" replace />;
  return <AdminOverview />;
}

function AppRoutes() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  const isKiosk = location.pathname.startsWith("/k/");

  if (isKiosk) {
    return (
      <Routes>
        <Route path="/k/:locationId" element={<Kiosk />} />
      </Routes>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <AnnouncementBar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/home" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/restaurant" element={<Restaurant />} />
          <Route path="/restaurant/checkout" element={<RequireAuth><RestaurantCheckout /></RequireAuth>} />
          <Route path="/restaurant/orders" element={<RequireAuth><RestaurantOrderHistory /></RequireAuth>} />
          <Route path="/restaurant/track/:orderId" element={<RequireAuth><OrderTrack /></RequireAuth>} />
          <Route path="/rider" element={<RequireAuth><RiderDashboard /></RequireAuth>} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/checkout/:planId" element={<RequireAuth><Checkout /></RequireAuth>} />
          <Route path="/self-scan" element={<RequireAuth><SelfScan /></RequireAuth>} />
          <Route path="/track" element={<RequireAuth><Track /></RequireAuth>} />
          <Route path="/boy" element={<RequireAuth roles={["delivery_boy"]}><DeliveryBoyDashboard /></RequireAuth>} />

          {/* Public information pages */}
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/refund" element={<Refund />} />
          <Route path="/contact" element={<Contact />} />

          {/* Admin / staff */}
          <Route path="/admin" element={<RequireAuth roles={["admin", "staff"]}><AdminLayout /></RequireAuth>}>
            <Route index element={<AdminIndex />} />
            <Route path="plans" element={<AdminPlans />} />
            <Route path="delivery" element={<AdminDelivery />} />
            <Route path="live" element={<AdminLiveMap />} />
            <Route path="scanner" element={<AdminScanner />} />
            <Route path="counter" element={<AdminCounter />} />
            <Route path="menu" element={<AdminMenu />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="theme" element={<AdminTheme />} />
            <Route path="landing" element={<AdminLanding />} />
            <Route path="dashboard-editor" element={<AdminDashboardEditor />} />
            <Route path="testimonials" element={<AdminTestimonials />} />
            <Route path="raw-materials" element={<AdminRawMaterials />} />
            <Route path="restaurant" element={<AdminRestaurant />} />
            <Route path="restaurant-orders" element={<AdminRestaurantOrders />} />
            <Route path="whatsapp" element={<AdminWhatsAppOutbox />} />
            <Route path="deliveries-today" element={<StaffDeliveries />} />
            <Route path="content/:contentKey" element={<AdminContent />} />
          </Route>

          {/* Redirects */}
          <Route path="/scan" element={<Navigate to="/admin/scanner" replace />} />
          <Route path="/counter" element={<Navigate to="/admin/counter" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <div className="App">
      <SplashScreen />
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <AppRoutes />
            <Toaster position="top-right" richColors />
            <PWAInstallPrompt />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </div>
  );
}

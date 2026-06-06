import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { GoogleOAuthProvider } from "@react-oauth/google";
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
import AdminControlTower from "./pages/AdminControlTower";
import AdminMessMenuCalendar from "./pages/AdminMessMenuCalendar";
import DeliveryBoyDashboard from "./pages/DeliveryBoyDashboard";
import Track from "./pages/Track";
import AdminCounter from "./pages/AdminCounter";
import AdminScanner from "./pages/AdminScanner";
import AdminKiosk from "./pages/AdminKiosk";
import AdminMenu from "./pages/AdminMenu";
import AdminUsers from "./pages/AdminUsers";
import AdminTheme from "./pages/AdminTheme";
import AdminContent from "./pages/AdminContent";
import AdminLanding from "./pages/AdminLanding";
import AdminDashboardEditor from "./pages/AdminDashboardEditor";
import AdminTestimonials from "./pages/AdminTestimonials";
import AdminRawMaterials from "./pages/AdminRawMaterials";
import AdminRestaurant from "./pages/AdminRestaurant";
import AdminPromotion from "./pages/AdminPromotion";
import AdminRestaurantOrders from "./pages/AdminRestaurantOrders";
import AdminWhatsAppOutbox from "./pages/AdminWhatsAppOutbox";
import StaffDeliveries from "./pages/StaffDeliveries";
import Plans from "./pages/Plans";
import Checkout from "./pages/Checkout";
import Profile from "./pages/Profile";
import Kiosk from "./pages/Kiosk";
import SelfScan from "./pages/SelfScan";
import Contact from "./pages/Contact";
import About from "./pages/About";
import Restaurant from "./pages/Restaurant";
import RestaurantCheckout from "./pages/RestaurantCheckout";
import OrderTrack from "./pages/OrderTrack";
import RestaurantOrderHistory from "./pages/RestaurantOrderHistory";
import RiderDashboard from "./pages/RiderDashboard";
import RiderAccount from "./pages/RiderAccount";
import BecomeARider from "./pages/BecomeARider";
import AdminRiderApplications from "./pages/AdminRiderApplications";
import AdminRestaurantTheme from "./pages/AdminRestaurantTheme";
import AdminRestaurantTracking from "./pages/AdminRestaurantTracking";
import AdminRestaurantTakeaway from "./pages/AdminRestaurantTakeaway";
import AdminBottomNavEditor from "./pages/AdminBottomNavEditor";
import AdminHeaderMenu from "./pages/AdminHeaderMenu";
import AdminPnL from "./pages/AdminPnL";
import AdminTiffinPreferences from "./pages/AdminTiffinPreferences";
import AdminTiffinStock from "./pages/AdminTiffinStock";
import AdminCashCollections from "./pages/AdminCashCollections";
import AdminPartialPayments from "./pages/AdminPartialPayments";
import AdminCashAnalytics from "./pages/AdminCashAnalytics";
import AdminKitchenSettings from "./pages/AdminKitchenSettings";
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
      <main className="flex-1 pb-16 md:pb-0">
        <Routes>
          <Route path="/" element={<Restaurant />} />
          <Route path="/home" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/restaurant" element={<Restaurant />} />
          <Route path="/restaurant/checkout" element={<RequireAuth><RestaurantCheckout /></RequireAuth>} />
          <Route path="/restaurant/orders" element={<RequireAuth><RestaurantOrderHistory /></RequireAuth>} />
          <Route path="/restaurant/track/:orderId" element={<RequireAuth><OrderTrack /></RequireAuth>} />
          <Route path="/rider" element={<RequireAuth><RiderDashboard /></RequireAuth>} />
          <Route path="/rider/account" element={<RequireAuth><RiderAccount /></RequireAuth>} />
          <Route path="/become-a-rider" element={<RequireAuth><BecomeARider /></RequireAuth>} />
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
          <Route path="/about" element={<About />} />

          {/* Admin / staff */}
          <Route path="/admin" element={<RequireAuth roles={["admin", "staff"]}><AdminLayout /></RequireAuth>}>
            <Route index element={<AdminIndex />} />
            <Route path="control-tower" element={<AdminControlTower />} />
            <Route path="mess-menu" element={<AdminMessMenuCalendar />} />
            <Route path="plans" element={<AdminPlans />} />
            <Route path="delivery" element={<AdminDelivery />} />
            <Route path="live" element={<AdminLiveMap />} />
            <Route path="scanner" element={<AdminScanner />} />
            <Route path="kiosk" element={<AdminKiosk />} />
            <Route path="counter" element={<AdminCounter />} />
            <Route path="menu" element={<AdminMenu />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="rider-applications" element={<AdminRiderApplications />} />
            <Route path="restaurant-theme" element={<AdminRestaurantTheme />} />
            <Route path="restaurant-tracking" element={<AdminRestaurantTracking />} />
            <Route path="restaurant-takeaway" element={<AdminRestaurantTakeaway />} />
            <Route path="bottom-nav" element={<AdminBottomNavEditor />} />
            <Route path="header-menu" element={<AdminHeaderMenu />} />
            <Route path="pnl" element={<AdminPnL />} />
            <Route path="tiffin-preferences" element={<AdminTiffinPreferences />} />
            <Route path="tiffin-stock" element={<AdminTiffinStock />} />
            <Route path="cash-collections" element={<AdminCashCollections />} />
            <Route path="cash-analytics" element={<AdminCashAnalytics />} />
            <Route path="kitchen-settings" element={<AdminKitchenSettings />} />
            <Route path="partial-payments" element={<AdminPartialPayments />} />
            <Route path="theme" element={<AdminTheme />} />
            <Route path="landing" element={<AdminLanding />} />
            <Route path="dashboard-editor" element={<AdminDashboardEditor />} />
            <Route path="testimonials" element={<AdminTestimonials />} />
            <Route path="raw-materials" element={<AdminRawMaterials />} />
            <Route path="restaurant" element={<AdminRestaurant />} />
            <Route path="promotion" element={<AdminPromotion />} />
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
  // Google OAuth Client ID is provisioned per-environment via .env. If it's
  // missing we still render the app but the Google sign-in button will hide
  // itself (see Login.jsx fallback to OTP-only flow).
  const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";
  return (
    <HelmetProvider>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
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
      </GoogleOAuthProvider>
    </HelmetProvider>
  );
}

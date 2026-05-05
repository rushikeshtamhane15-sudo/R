import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { Toaster } from "sonner";
import Header from "./components/Header";
import AdminLayout from "./components/AdminLayout";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import Dashboard from "./pages/Dashboard";
import AdminOverview from "./pages/AdminDashboard";
import AdminPlans from "./pages/AdminPlans";
import AdminCounter from "./pages/AdminCounter";
import AdminScanner from "./pages/AdminScanner";
import AdminMenu from "./pages/AdminMenu";
import AdminUsers from "./pages/AdminUsers";
import AdminTheme from "./pages/AdminTheme";
import Plans from "./pages/Plans";
import Checkout from "./pages/Checkout";
import Profile from "./pages/Profile";
import Kiosk from "./pages/Kiosk";
import SelfScan from "./pages/SelfScan";

function RequireAuth({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

// Admin users land on /admin by default after login
function PostLogin() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <Navigate to="/admin" replace />;
  return <Dashboard />;
}

function AppRoutes() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  const isKiosk = location.pathname.startsWith("/k/");
  return (
    <>
      {!isKiosk && <Header />}
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/k/:locationId" element={<Kiosk />} />
        <Route path="/dashboard" element={<RequireAuth><PostLogin /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/plans" element={<Plans />} />
        <Route path="/checkout/:planId" element={<RequireAuth><Checkout /></RequireAuth>} />
        <Route path="/self-scan" element={<RequireAuth><SelfScan /></RequireAuth>} />

        {/* Admin (single layout with nested routes) */}
        <Route path="/admin" element={<RequireAuth roles={["admin"]}><AdminLayout /></RequireAuth>}>
          <Route index element={<AdminOverview />} />
          <Route path="plans" element={<AdminPlans />} />
          <Route path="scanner" element={<AdminScanner />} />
          <Route path="counter" element={<AdminCounter />} />
          <Route path="menu" element={<AdminMenu />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="theme" element={<AdminTheme />} />
        </Route>

        {/* Old direct links redirect into admin */}
        <Route path="/scan" element={<Navigate to="/admin/scanner" replace />} />
        <Route path="/counter" element={<Navigate to="/admin/counter" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <AppRoutes />
            <Toaster position="top-right" richColors />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </div>
  );
}

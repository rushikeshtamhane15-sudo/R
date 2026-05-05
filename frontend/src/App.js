import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Toaster } from "sonner";
import Header from "./components/Header";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import Dashboard from "./pages/Dashboard";
import AdminDashboard from "./pages/AdminDashboard";
import AdminPlans from "./pages/AdminPlans";
import StaffScanner from "./pages/StaffScanner";
import Plans from "./pages/Plans";
import Checkout from "./pages/Checkout";
import Profile from "./pages/Profile";
import CounterQR from "./pages/CounterQR";
import Kiosk from "./pages/Kiosk";
import SelfScan from "./pages/SelfScan";

function RequireAuth({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
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
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/plans" element={<Plans />} />
        <Route path="/checkout/:planId" element={<RequireAuth><Checkout /></RequireAuth>} />
        <Route path="/scan" element={<RequireAuth roles={["staff", "admin"]}><StaffScanner /></RequireAuth>} />
        <Route path="/counter" element={<RequireAuth roles={["staff", "admin"]}><CounterQR /></RequireAuth>} />
        <Route path="/self-scan" element={<RequireAuth><SelfScan /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth roles={["admin"]}><AdminDashboard /></RequireAuth>} />
        <Route path="/admin/plans" element={<RequireAuth roles={["admin"]}><AdminPlans /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <Toaster position="top-right" richColors />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

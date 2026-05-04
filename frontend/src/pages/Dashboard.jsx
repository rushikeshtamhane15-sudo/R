import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import SubscriberDashboard from "./SubscriberDashboard";
import AdminDashboard from "./AdminDashboard";
import StaffScanner from "./StaffScanner";

export default function Dashboard() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <AdminDashboard />;
  if (user.role === "staff") return <StaffScanner />;
  return <SubscriberDashboard />;
}

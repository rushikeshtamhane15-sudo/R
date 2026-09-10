import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

// iter-95: HQ-admin "view-as-branch" support. AuthContext calls
// api.__setAsMessId(id) on mount + change. We then auto-append
// `as_mess_id=<id>` as a query param to every /admin/* and /franchise/*
// request unless the caller already passed one explicitly.
let _asMessId = null;
api.__setAsMessId = (id) => { _asMessId = id || null; };

// iter-158j: also inject `x-mess-id` on every content/franchise/mess-owner
// request so backend `/content/{key}` returns the mess-scoped version of
// the page (footer, about, privacy, etc.). Falls back to picked mess in
// localStorage for un-authenticated visitors.
api.interceptors.request.use((config) => {
  try {
    const picked = JSON.parse(localStorage.getItem("efoodtech.mess.picked") || "null");
    const mid = picked?.mess_id;
    if (mid) {
      config.headers = config.headers || {};
      if (!config.headers["x-mess-id"]) config.headers["x-mess-id"] = mid;
    }
  } catch {}
  return config;
});

api.interceptors.request.use((config) => {
  if (!_asMessId) return config;
  const url = config.url || "";
  // Only stamp admin-scoped endpoints; never touch /auth, /restaurant, /messes, etc.
  // The franchise/me/* endpoints intentionally ignore the param backend-side.
  if (!url.startsWith("/admin/")) return config;
  const params = config.params || {};
  if (params.as_mess_id == null) {
    config.params = { ...params, as_mess_id: _asMessId };
  }
  return config;
});

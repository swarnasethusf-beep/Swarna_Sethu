import axios from "axios";

/**
 * 🌐 API client — one place for the server URL and the login token.
 * Set REACT_APP_API_URL (frontend/.env) to point at a central server.
 */
export const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const TOKEN_KEY = "sr_token";

const api = axios.create({ baseURL: API_URL, timeout: 20000 });

let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { /* storage unavailable */ }
let onSessionExpired = null;

export function getToken() { return token; }

export function setToken(next) {
  token = next || null;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

/** App registers a handler that logs the user out when the server rejects the session */
export function onUnauthorized(fn) { onSessionExpired = fn; }

api.interceptors.request.use((cfg) => {
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const licenseBlocked = status === 403 && /license/i.test(err.response?.data?.error || "");
    if (token && (status === 401 || licenseBlocked) && onSessionExpired) onSessionExpired(err.response.data?.error);
    return Promise.reject(err);
  }
);

/** Human-readable error message for any failed request */
export function errMsg(err, fallback = "Something went wrong.") {
  if (err?.response?.data?.error) return err.response.data.error;
  if (err?.response?.status === 404) return `The server at ${API_URL} doesn't support this request — it may be running old code. Restart the backend.`;
  if (err?.response) return fallback;
  return "Cannot reach the server. Is the backend running?";
}

export default api;

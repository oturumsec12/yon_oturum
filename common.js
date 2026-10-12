import { CONFIG } from "./config.js";

const TOKEN_KEY = "mulakat_session_v1";
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
export function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ""; }
export function setToken(v) { sessionStorage.setItem(TOKEN_KEY, v); }
export function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }
export function checkConfig() {
  if (!/^https:\/\/[\w-]+\.supabase\.co\/?$/.test(CONFIG.SUPABASE_URL) || CONFIG.SUPABASE_URL.includes("PROJE-REFERANSINIZ")) {
    throw new Error("config.js dosyasındaki SUPABASE_URL henüz ayarlanmadı.");
  }
}
export async function api(action, args = {}) {
  checkConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token && action !== "login") headers["X-Session-Token"] = token;
    const res = await fetch(`${CONFIG.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${CONFIG.EDGE_FUNCTION}`, {
      method: "POST", headers, body: JSON.stringify({ action, ...args }),
      cache: "no-store", signal: ctrl.signal,
    });
    let data;
    try { data = await res.json(); } catch { throw new Error(`Sunucudan okunamayan yanıt geldi (HTTP ${res.status}).`); }
    if (!res.ok || !data.ok) {
      if (res.status === 401 && action !== "login") {
        clearToken();
        location.href = "index.html?expired=1";
      }
      throw new Error(data.error || `İşlem tamamlanamadı (HTTP ${res.status}).`);
    }
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Sunucu yanıt vermedi. Bağlantınızı kontrol edip yeniden deneyin.");
    throw e;
  } finally { clearTimeout(timer); }
}
export function setBusy(isBusy, text = "İşlem yapılıyor…") {
  const overlay = document.getElementById("busyOverlay");
  document.body.classList.toggle("is-busy", Boolean(isBusy));
  if (overlay) {
    overlay.hidden = !isBusy;
    const label = overlay.querySelector(".busy-label");
    if (label) label.textContent = text;
  }
}
let noticeTimer;
export function notify(message, type = "info") {
  let el = document.getElementById("notice");
  if (!el) {
    el = document.createElement("div");
    el.id = "notice"; el.className = "notice"; el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `notice visible ${type}`;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.classList.remove("visible"); }, 5500);
}
export function fmtDate(date) {
  if (!date) return "—";
  const val = new Date(`${date}T12:00:00+03:00`);
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: "Europe/Istanbul",
  }).format(val);
}
export function fmtShortDate(date) {
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
}
export function fmtHour(t) { return String(t || "").slice(0, 5).replace(":", "."); }
export function fmtDeadline(value) {
  if (!value) return "Henüz belirlenmedi";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}
export function toIstanbulInput(value) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function slotStart(slot) { return new Date(`${slot.slot_date}T${slot.start_time.slice(0, 8)}+03:00`); }
export function activeWindow(slot, deadline) {
  return !!deadline && Date.now() < new Date(deadline).getTime() && Date.now() < slotStart(slot).getTime();
}
export function dayGroups(slots) {
  const map = new Map();
  for (const slot of slots) {
    if (!map.has(slot.slot_date)) map.set(slot.slot_date, []);
    map.get(slot.slot_date).push(slot);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
export function describeRole(role) { return role === "IK" ? "İK Yöneticisi" : "Birim Yöneticisi"; }
export function commission(slot, no) { return slot.commissions.find(c => Number(c.commission_no) === no); }
export function hasPlace(c, role) { return role === "IK" ? Boolean(c?.ik_taken) : Boolean(c?.birim_taken); }
export function firstComplete(slot) {
  const first = commission(slot, 1);
  return Boolean(first?.ik_taken && first?.birim_taken);
}
export function nextCommission(slot, role, deadline) {
  if (!slot.selection_enabled || !activeWindow(slot, deadline)) return null;
  const c1 = commission(slot, 1);
  if (c1?.selection_enabled && !hasPlace(c1, role)) return c1;
  if (Number(slot.max_commissions) === 2 && firstComplete(slot)) {
    const c2 = commission(slot, 2);
    if (c2?.selection_enabled && !hasPlace(c2, role)) return c2;
  }
  return null;
}
export async function doLogout() {
  try { await api("logout"); } catch { /* tarayıcıdaki token yine kaldırılır */ }
  clearToken();
  location.href = "index.html";
}

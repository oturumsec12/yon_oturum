import {
  api, getToken, doLogout, setBusy, notify, esc, fmtDate, fmtShortDate,
  toIstanbulInput, dayGroups, commission, hasPlace, rolePriorityMet, canAssignRole, slotStart,
} from "./common.js";
import { downloadWorkbook } from "./excel.js";

const $ = id => document.getElementById(id);
const els = {
  identity: $("adminIdentity"), summary: $("summary"), slots: $("manageSlots"),
  managers: $("managerRows"), managerDetail: $("managerDetail"), detailContent: $("detailContent"),
  deadline: $("deadlineInput"), managerFilter: $("managerSearch"), dialog: $("confirmDialog"),
};
let state = null;
let busy = false;
let deadlineDirty = false;
let detailManagerId = null;
let managerTerm = "";
let pending = null;
let serverClock = null;
const hour = value => String(value || "").slice(0, 5);
const roleLabel = role => role === "IK" ? "İK" : "Birim";
const slotLabel = slot => `${fmtShortDate(slot.slot_date)} · ${hour(slot.start_time)}–${hour(slot.end_time)}`;
const isFull = c => Boolean(c.ik_taken && c.birim_taken);

function acceptState(data) {
  if (data.actor?.kind !== "ADMIN") { location.replace("select.html"); return false; }
  state = data;
  const timestamp = Date.parse(data.serverNow);
  serverClock = Number.isFinite(timestamp) ? { timestamp, receivedAt: performance.now() } : null;
  return true;
}
function currentTime() {
  return serverClock ? serverClock.timestamp + Math.max(0, performance.now() - serverClock.receivedAt) : Date.now();
}
function timeOpen(slot) {
  const deadline = state?.settings.selection_deadline;
  const now = currentTime();
  return Boolean(deadline) && now < Date.parse(deadline) && now < slotStart(slot).getTime();
}
function canReceive(slot, c) {
  return timeOpen(slot) && ["IK", "BIRIM"].some(role => canAssignRole(slot, c, role));
}
function commissionStatus(slot, c) {
  if (!timeOpen(slot) || !slot.selection_enabled || !c.selection_enabled) return "unavailable";
  if (isFull(c)) return "full";
  return canReceive(slot, c) ? "available" : "unavailable";
}
function slotStatus(slot) {
  if (!timeOpen(slot) || !slot.selection_enabled) return "unavailable";
  if (slot.commissions.length && slot.commissions.every(isFull)) return "full";
  return slot.commissions.some(c => canReceive(slot, c)) ? "available" : "unavailable";
}
function badge(status) {
  const label = { available: "Uygun", full: "Tam dolu", unavailable: "Şu an seçilemiyor" }[status];
  return `<span class="badge ${esc(status)}">${esc(label)}</span>`;
}
function lookup() { return new Map((state?.managers || []).map(m => [m.id, m])); }
function assignmentRows() {
  return (state?.slots || []).flatMap(slot => slot.commissions.flatMap(c => (c.assignments || []).map(a => ({
    ...a, slot, commission: Number(c.commission_no), commission_id: c.id,
  }))));
}
function countMap() {
  const counts = new Map();
  for (const a of assignmentRows()) counts.set(a.manager_id, (counts.get(a.manager_id) || 0) + 1);
  return counts;
}
function renderSummary() {
  const slots = state.slots;
  const completed = slots.reduce((n, slot) => n + slot.commissions.filter(isFull).length, 0);
  els.summary.innerHTML = [
    ["Tanımlı oturum", slots.length], ["Güncel atama", assignmentRows().length],
    ["Tam dolu komisyon", completed], ["Kapalı slot", slots.filter(s => !s.selection_enabled).length],
  ].map(([label, count]) => `<div class="stat"><strong>${esc(count)}</strong><span>${esc(label)}</span></div>`).join("");
}
function renderAdminCommission(slot, c, people) {
  const assignments = c.assignments || [];
  const waitingRoles = timeOpen(slot) && slot.selection_enabled && c.selection_enabled
    ? ["IK", "BIRIM"].filter(role => !hasPlace(c, role) && !rolePriorityMet(slot, c, role)) : [];
  const locked = waitingRoles.length > 0 && !canReceive(slot, c);
  const seats = ["IK", "BIRIM"].map(role => {
    const a = assignments.find(x => x.role === role);
    const person = a ? people.get(a.manager_id) : null;
    const first = commission(slot, 1);
    const waitNote = waitingRoles.includes(role) ? (first && !first.selection_enabled
      ? `1. komisyonda ${roleLabel(role)} kontenjanı boş; komisyon kapalı`
      : `1. komisyonda ${roleLabel(role)} seçimi bekleniyor`) : "";
    return `<div class="assignment"><span class="role-label">${role === "IK" ? "İK kontenjanı" : "Birim Kontenjanı"}</span>
      <strong class="seat ${a ? "taken" : "free"}">${a ? "● Dolu" : "○ Boş"}</strong>
      ${waitNote ? `<p class="lock-note">${esc(waitNote)}</p>` : ""}
      ${person ? `<div class="assignment-person"><span class="manager-code">${esc(person.code)}</span><span class="name">${esc(person.full_name)}</span></div>` : ""}
      ${a ? `<button type="button" class="button small danger" data-delete="${esc(a.id)}" aria-label="${esc(person?.code || roleLabel(role))} atamasını ${esc(slotLabel(slot))}, ${esc(c.commission_no)}. komisyondan sil">Sil</button>` : ""}</div>`;
  }).join("");
  return `<section class="commission${c.selection_enabled ? "" : " disabled"}${locked ? " locked" : ""}" data-commission-id="${esc(c.id)}">
    <div class="commission-head"><h4>${esc(c.commission_no)}. Komisyon</h4>${badge(commissionStatus(slot, c))}</div>
    <p class="commission-permission"><strong>${canReceive(slot, c) ? "Komisyon seçime açık" : "Komisyon seçime kapalı"}</strong></p>
    <div class="assignment-grid">${seats}</div>
    <div class="commission-actions"><button type="button" class="button small" data-toggle-commission="${esc(c.id)}">${c.selection_enabled ? "Komisyonu kapat" : "Komisyonu aç"}</button>
      <button type="button" class="button small danger" data-clear="${esc(c.id)}" ${assignments.length ? "" : "disabled"}>Seçimleri temizle</button></div>
  </section>`;
}
function renderSlots() {
  if (!state.slots.length) { els.slots.innerHTML = '<p class="empty-state">Henüz oturum bulunmuyor.</p>'; return; }
  const people = lookup();
  els.slots.innerHTML = dayGroups(state.slots).map(([date, slots]) => `<section class="day-group">
    <div class="day-heading"><span class="day-number">${esc(date.slice(-2))}</span><div><h3>${esc(fmtDate(date))}</h3><p>${esc(slots.length)} oturum</p></div></div>
    <div class="slot-grid">${slots.map(slot => `<article class="admin-slot ${esc(slotStatus(slot))}" id="slot-${esc(slot.id)}" data-slot-id="${esc(slot.id)}" tabindex="-1" aria-label="${esc(slotLabel(slot))}">
      <div class="slot-head"><div><div class="slot-date"><time datetime="${esc(slot.slot_date)}">${esc(fmtShortDate(slot.slot_date))}</time></div>
        <h3 class="slot-time">${esc(hour(slot.start_time))}–${esc(hour(slot.end_time))}</h3><p class="slot-meta">${esc(slot.max_commissions)} komisyon</p></div>${badge(slotStatus(slot))}</div>
      <div class="slot-permission"><strong>${slot.selection_enabled ? "Slot Etkin" : "Slot etkin değil"}</strong><button type="button" class="button small" data-toggle-slot="${esc(slot.id)}">${slot.selection_enabled ? "Slotu kapat" : "Slotu aç"}</button></div>
      <div class="commissions">${slot.commissions.map(c => renderAdminCommission(slot, c, people)).join("")}</div>
    </article>`).join("")}</div></section>`).join("");
}
function renderManagerDetail() {
  const manager = state.managers.find(m => m.id === detailManagerId);
  els.managerDetail.hidden = !manager;
  if (!manager) { els.detailContent.innerHTML = ""; return; }
  const rows = assignmentRows().filter(a => a.manager_id === manager.id);
  els.detailContent.innerHTML = `<h3 id="detailHeading" tabindex="-1">${esc(manager.code)} · ${esc(manager.full_name)}</h3><p>${esc(roleLabel(manager.role))} · ${esc(rows.length)} seçili oturum</p>` +
    (rows.length ? `<ul class="detail-list">${rows.map(a => `<li><strong>${esc(slotLabel(a.slot))}</strong><span>${esc(a.commission)}. Komisyon · ${a.slot.selection_enabled ? "Slot Etkin" : "Slot etkin değil"}</span></li>`).join("")}</ul>` : '<p class="empty-state">Henüz bir oturum seçimi yok.</p>');
}
function renderManagers() {
  const counts = countMap();
  const needle = managerTerm.trim().toUpperCase();
  const managers = state.managers.filter(m => m.code.toUpperCase().includes(needle));
  $("managerCount").textContent = `${managers.length} / ${state.managers.length} yönetici`;
  els.managers.innerHTML = managers.length ? managers.map(m => `<tr>
    <td><strong class="manager-code">${esc(m.code)}</strong></td><td>${esc(m.full_name)}</td><td>${esc(roleLabel(m.role))}</td><td>${m.active ? "Aktif" : "Pasif"}</td>
    <td class="count-cell">${esc(counts.get(m.id) || 0)}</td><td><button type="button" class="button small" id="detail-${esc(m.id)}" data-detail="${esc(m.id)}" aria-controls="managerDetail" aria-expanded="${String(detailManagerId === m.id)}">Detay</button></td>
  </tr>`).join("") : '<tr><td colspan="6" class="empty-state">Bu kodla eşleşen yönetici bulunamadı.</td></tr>';
  renderManagerDetail();
}
function render() {
  if (!state) return;
  const active = document.activeElement;
  const focusId = active?.id || active?.closest(".admin-slot")?.id;
  els.identity.innerHTML = `<span class="badge admin">Admin</span><small>${esc(state.actor.name)} · Kod: ${esc(state.actor.code)}</small>`;
  if (!deadlineDirty) els.deadline.value = toIstanbulInput(state.settings.selection_deadline);
  renderSummary(); renderSlots(); renderManagers();
  if (active && !active.isConnected) ($(focusId) || $("slotsTitle")).focus({ preventScroll: true });
}
async function refresh(showOverlay = false) {
  if (busy || pending) return;
  busy = true;
  if (showOverlay) setBusy(true, "Veriler yenileniyor…");
  try { if (acceptState(await api("bootstrap"))) render(); }
  catch (error) { notify(error.message, "error"); }
  finally { busy = false; if (showOverlay) setBusy(false); }
}
async function doAction(action, data, success) {
  if (busy) return;
  busy = true; setBusy(true);
  try {
    await api(action, data);
    if (action === "admin_set_deadline") deadlineDirty = false;
    if (acceptState(await api("bootstrap"))) render();
    notify(success, "success");
  } catch (error) { notify(error.message, "error"); }
  finally { busy = false; setBusy(false); }
}
function focusAfter(job) {
  const target = job.focusId ? $(job.focusId) : null;
  const origin = job.trigger?.isConnected ? job.trigger : null;
  (target || origin || $("slotsTitle")).focus({ preventScroll: true });
}
function ask(title, message, action, data, success, focusId, trigger, danger = false) {
  if (busy || pending || !state) return;
  pending = { action, data, success, focusId, trigger: trigger || document.activeElement };
  $("dialogTitle").textContent = title;
  $("dialogText").textContent = message;
  $("dialogConfirm").className = danger ? "button danger" : "button primary";
  $("dialogConfirm").textContent = danger ? (action === "admin_delete_assignment" ? "Sil" : "Temizle") : "Onayla";
  els.dialog.showModal();
  $("dialogCancel").focus();
}
$("dialogConfirm").addEventListener("click", async () => {
  if (!pending || busy) return;
  const job = pending;
  pending = null;
  els.dialog.close();
  await doAction(job.action, job.data, job.success);
  focusAfter(job);
});
$("dialogCancel").addEventListener("click", () => els.dialog.close());
els.dialog.addEventListener("close", () => {
  if (!pending) return;
  const job = pending;
  pending = null;
  focusAfter(job);
});
function findCommission(id) {
  for (const slot of state.slots) {
    const c = slot.commissions.find(item => item.id === id);
    if (c) return { slot, c };
  }
  return null;
}
els.slots.addEventListener("click", event => {
  if (busy || pending || !state) return;
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  if (button.dataset.toggleSlot) {
    const slot = state.slots.find(s => s.id === button.dataset.toggleSlot);
    if (!slot) return;
    const enabled = !slot.selection_enabled;
    ask(enabled ? "Slotu aç" : "Slotu kapat", `${slotLabel(slot)} oturumu ${enabled ? "yeni seçimlere açılsın" : "yeni seçimlere kapatılsın"} mı? Mevcut atamalar ve komisyonların kendi açık/kapalı izinleri korunur.`,
      "admin_set_slot", { slot_id: slot.id, enabled }, "Slot durumu güncellendi.", `slot-${slot.id}`, button);
  } else if (button.dataset.toggleCommission) {
    const found = findCommission(button.dataset.toggleCommission);
    if (!found) return;
    const { slot, c } = found;
    const enabled = !c.selection_enabled;
    ask(enabled ? "Komisyonu aç" : "Komisyonu kapat", `${slotLabel(slot)} · ${c.commission_no}. Komisyon ${enabled ? "yeni seçimlere açılsın" : "yeni seçimlere kapatılsın"} mı? Mevcut atamalar, diğer komisyon ve slot izni korunur.`,
      "admin_set_commission", { commission_id: c.id, enabled }, "Komisyon durumu güncellendi.", `slot-${slot.id}`, button);
  } else if (button.dataset.delete) {
    const a = assignmentRows().find(item => item.id === button.dataset.delete);
    if (!a) return;
    const person = lookup().get(a.manager_id);
    ask("Tek atamayı sil", `${person?.code || roleLabel(a.role)} kodunun ${slotLabel(a.slot)}, ${a.commission}. komisyondaki ${roleLabel(a.role)} ataması silinsin mi? Diğer atamalar ve seçim izinleri korunur.`,
      "admin_delete_assignment", { assignment_id: a.id }, "Tekil seçim silindi.", `slot-${a.slot.id}`, button, true);
  } else if (button.dataset.clear) {
    const found = findCommission(button.dataset.clear);
    if (!found) return;
    const { slot, c } = found;
    ask("Komisyon seçimlerini temizle", `${slotLabel(slot)} · ${c.commission_no}. Komisyon içindeki ${c.assignments.length} atama silinsin mi? Diğer komisyonun atamaları ve tüm açık/kapalı izinleri korunur.`,
      "admin_clear_commission", { commission_id: c.id }, "Komisyon seçimleri temizlendi.", `slot-${slot.id}`, button, true);
  }
});
els.managerFilter.addEventListener("input", event => {
  managerTerm = event.target.value;
  if (state) renderManagers();
});
els.managers.addEventListener("click", event => {
  if (!state) return;
  const button = event.target.closest("[data-detail]");
  if (!button) return;
  detailManagerId = button.dataset.detail;
  renderManagers();
  $("detailHeading")?.focus();
});
$("closeDetail").addEventListener("click", () => {
  const oldId = detailManagerId;
  detailManagerId = null;
  renderManagers();
  ($(`detail-${oldId}`) || $("managerTitle")).focus({ preventScroll: true });
});
els.deadline.addEventListener("input", () => { deadlineDirty = true; });
$("deadlineForm").addEventListener("submit", event => {
  event.preventDefault();
  if (!$("deadlineForm").reportValidity()) return;
  const deadline = els.deadline.value || null;
  const message = deadline ? `Genel seçim son tarihi ${fmtShortDate(deadline.slice(0, 10))} ${deadline.slice(11)} (Türkiye saati) olarak kaydedilsin mi?`
    : "Genel seçim son tarihi kaldırılsın mı? Yöneticilerin seçme, iptal ve taşıma işlemleri kapanır. Mevcut atamalar korunur.";
  ask("Son seçim tarihini güncelle", message, "admin_set_deadline", { deadline }, "Son seçim tarihi güncellendi.", "deadlineInput");
});
async function exportExcel() {
  if (busy || pending || !state) return;
  busy = true; setBusy(true, "Excel raporu hazırlanıyor…");
  try {
    if (!acceptState(await api("bootstrap"))) return;
    render();
    const people = lookup();
    const assignments = assignmentRows().sort((a, b) =>
      a.slot.slot_date.localeCompare(b.slot.slot_date) || a.slot.start_time.localeCompare(b.slot.start_time) ||
      String(people.get(a.manager_id)?.code || "").localeCompare(String(people.get(b.manager_id)?.code || "")));
    const rows = [["Yönetici kodu", "Oturum tarih ve saati", "Komisyon"]];
    for (const a of assignments) rows.push([
      people.get(a.manager_id)?.code || "", `${fmtDate(a.slot.slot_date)} ${hour(a.slot.start_time)} - ${hour(a.slot.end_time)}`, `${a.commission}. Komisyon`,
    ]);
    const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    downloadWorkbook([{ name: "Oturum Seçimleri", rows }], `oturum_secimleri_${stamp}.xlsx`);
    notify("Excel raporu indirildi.", "success");
  } catch (error) { notify(error.message || "Excel raporu oluşturulamadı.", "error"); }
  finally { busy = false; setBusy(false); }
}
$("exportBtn").addEventListener("click", exportExcel);
$("logoutBtn").addEventListener("click", doLogout);
$("refreshBtn").addEventListener("click", () => refresh(true));
if (getToken()) {
  refresh(true);
  setInterval(() => { if (!document.hidden && !busy && !pending) refresh(false); }, 30000);
} else {
  location.replace("index.html");
}

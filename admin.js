import {
  api, getToken, doLogout, setBusy, notify, esc, fmtDate, fmtShortDate, fmtHour,
  fmtDeadline, toIstanbulInput, dayGroups, commission, firstComplete, describeRole,
} from "./common.js";
import { downloadWorkbook } from "./excel.js";

if (!getToken()) location.replace("index.html");
const els = {
  identity: document.getElementById("adminIdentity"), summary: document.getElementById("summary"),
  slots: document.getElementById("manageSlots"), managers: document.getElementById("managerRows"),
  managerDetail: document.getElementById("managerDetail"),
  deadline: document.getElementById("deadlineInput"), slotFilter: document.getElementById("slotSearch"),
  managerFilter: document.getElementById("managerSearch"),
};
let state = null;
let busy = false;
let deadlineDirty = false;
let detailManagerId = null;
let selectedSlotDate = "";
let managerTerm = "";
function lookup() {
  return new Map((state?.managers || []).map(m => [m.id, m]));
}
function assignmentRows() {
  if (!state) return [];
  return state.slots.flatMap(slot => slot.commissions.flatMap(c => (c.assignments || []).map(a => ({
    ...a, slot, commission: c.commission_no, commission_id: c.id,
  }))));
}
function countMap() {
  const counts = new Map();
  for (const a of assignmentRows()) counts.set(a.manager_id, (counts.get(a.manager_id) || 0) + 1);
  return counts;
}
function renderSummary() {
  const slots = state.slots;
  const assignmentCount = assignmentRows().length;
  const completed = slots.reduce((n, slot) => n + slot.commissions.filter(c => c.ik_taken && c.birim_taken).length, 0);
  const closed = slots.filter(s => !s.selection_enabled).length;
  els.summary.innerHTML = [
    ["Tanımlı slot", slots.length], ["Güncel atama", assignmentCount],
    ["Tam dolu komisyon", completed], ["Seçime kapalı slot", closed],
  ].map(([name, value]) => `<div class="stat"><strong>${value}</strong><span>${name}</span></div>`).join("");
}
function renderAdminCommission(slot, c, people) {
  const assignments = c.assignments || [];
  const locked = Number(c.commission_no) === 2 && !firstComplete(slot);
  const rows = ["IK", "BIRIM"].map(role => {
    const a = assignments.find(x => x.role === role);
    const p = a ? people.get(a.manager_id) : null;
    return `<div class="assignment-item"><div><span class="field-help">${role === "IK" ? "İK" : "Birim"}</span>
      ${p ? `<strong>${esc(p.code)} · ${esc(p.full_name)}</strong>` : `<span class="assignment-empty">Boş kontenjan</span>`}
      </div>${a ? `<button class="button danger small" data-delete="${esc(a.id)}" title="Yalnızca bu yöneticinin bu komisyondaki seçimini sil">Sil</button>` : ""}</div>`;
  }).join("");
  let label = c.selection_enabled ? "Seçime açık" : "Seçime kapalı";
  if (locked && c.selection_enabled) label = "1. komisyon eksik: yeni seçim kilitli";
  return `<article class="admin-commission ${!c.selection_enabled ? "disabled" : ""}">
    <div class="admin-commission-head"><h4>${c.commission_no}. Komisyon</h4>
      <span class="status-pill ${!c.selection_enabled || locked ? "amber" : "green"}">${esc(label)}</span></div>
    ${rows}
    <div class="card-actions"><button class="button small ${c.selection_enabled ? "outline" : "success"}" data-toggle-commission="${esc(c.id)}" data-enabled="${String(!c.selection_enabled)}">${c.selection_enabled ? "Seçime kapat" : "Seçime aç"}</button>
      <button class="button danger small" data-clear="${esc(c.id)}" data-count="${assignments.length}">Seçimleri temizle</button></div>
  </article>`;
}
function renderSlots() {
  const people = lookup();
  const shown = state.slots.filter(s => !selectedSlotDate || s.slot_date === selectedSlotDate);
  if (!shown.length) { els.slots.innerHTML = `<div class="empty-card">Bu tarihte oturum bulunamadı.</div>`; return; }
  els.slots.innerHTML = dayGroups(shown).map(([date, slots]) => `<section class="day-block">
    <div class="day-header"><span class="day-number">${esc(date.slice(-2))}</span><div><div class="day-title">${esc(fmtDate(date))}</div>
    <div class="day-subtitle">${slots.length} zaman dilimi</div></div></div>
    <div class="day-slots">${slots.map(slot => `<article class="slot-card admin-slot ${!slot.selection_enabled ? "off" : ""}">
      <div class="admin-slot-header"><div><div class="admin-slot-title">${fmtHour(slot.start_time)}–${fmtHour(slot.end_time)}</div>
      <span class="slot-meta">${slot.max_commissions} komisyon · ${slot.selection_enabled ? "Slot açık" : "Slot kapalı"}</span></div>
      <div class="actions"><button class="button small ${slot.selection_enabled ? "outline" : "success"}" data-toggle-slot="${esc(slot.id)}" data-enabled="${String(!slot.selection_enabled)}">${slot.selection_enabled ? "Slotu kapat" : "Slotu aç"}</button></div>
      </div>
      <div class="admin-comms">${slot.commissions.map(c => renderAdminCommission(slot, c, people)).join("")}</div>
      </article>`).join("")}</div></section>`).join("");
}
function renderManagers() {
  const counts = countMap();
  const needle = managerTerm.toLocaleLowerCase("tr-TR");
  const managers = state.managers.filter(m =>
    `${m.code} ${m.full_name} ${m.role}`.toLocaleLowerCase("tr-TR").includes(needle));
  els.managers.innerHTML = managers.length ? managers.map(m => `<tr>
    <td><strong>${esc(m.code)}</strong></td><td>${esc(m.full_name)}</td><td>${esc(describeRole(m.role))}${m.active ? "" : " · Pasif"}</td>
    <td class="count-number">${counts.get(m.id) || 0}</td>
    <td><button class="button ghost small" data-detail="${esc(m.id)}">Detay</button></td>
  </tr>`).join("") : `<tr><td colspan="5" class="empty-card">Yönetici bulunamadı.</td></tr>`;
  renderManagerDetail();
}
function renderManagerDetail() {
  const manager = state?.managers.find(m => m.id === detailManagerId);
  if (!manager) { els.managerDetail.hidden = true; els.managerDetail.innerHTML = ""; return; }
  const rows = assignmentRows().filter(r => r.manager_id === manager.id);
  els.managerDetail.hidden = false;
  els.managerDetail.innerHTML = `<div><strong>${esc(manager.code)} · ${esc(manager.full_name)}</strong> — ${rows.length} oturum</div>` +
    (rows.length ? `<ul>${rows.map(a => `<li>${fmtShortDate(a.slot.slot_date)} · ${fmtHour(a.slot.start_time)}–${fmtHour(a.slot.end_time)} · ${a.commission}. Komisyon</li>`).join("")}</ul>` : `<p class="field-help">Henüz bir oturum seçimi yok.</p>`);
}
function render() {
  if (!state) return;
  if (state.actor.kind !== "ADMIN") { location.replace("select.html"); return; }
  els.identity.innerHTML = `<strong>${esc(state.actor.name)}</strong><small>Admin · Kod: ${esc(state.actor.code)}</small>`;
  if (!deadlineDirty) els.deadline.value = toIstanbulInput(state.settings.selection_deadline);
  renderSummary(); renderSlots(); renderManagers();
}
async function refresh(showOverlay = false) {
  if (busy) return;
  busy = true; if (showOverlay) setBusy(true, "Veriler yenileniyor…");
  try { state = await api("bootstrap"); render(); }
  catch (e) { notify(e.message, "error"); }
  finally { busy = false; if (showOverlay) setBusy(false); }
}
async function doAction(action, data, success) {
  if (busy) return;
  busy = true; setBusy(true);
  try {
    await api(action, data);
    state = await api("bootstrap");
    render();
    notify(success, "success");
  } catch (e) { notify(e.message, "error"); }
  finally { busy = false; setBusy(false); }
}
els.slots.addEventListener("click", e => {
  if (busy) return;
  const del = e.target.closest("[data-delete]");
  if (del) {
    if (confirm("Yalnızca bu yöneticinin ilgili komisyondaki seçimi silinsin mi? Diğer atamalar korunacaktır.")) {
      doAction("admin_delete_assignment", { assignment_id: del.dataset.delete }, "Tekil seçim silindi.");
    }
    return;
  }
  const clr = e.target.closest("[data-clear]");
  if (clr) {
    const amount = Number(clr.dataset.count || 0);
    if (confirm(`Bu komisyonun ${amount} adet mevcut yönetici seçimi silinecek. Diğer komisyon ve açık/kapalı ayarları DEĞİŞMEYECEK. Devam edilsin mi?`)) {
      doAction("admin_clear_commission", { commission_id: clr.dataset.clear }, "Komisyon seçimleri temizlendi.");
    }
    return;
  }
  const toggleSlot = e.target.closest("[data-toggle-slot]");
  if (toggleSlot) {
    const enabled = toggleSlot.dataset.enabled === "true";
    if (confirm(`Bu SLOT ${enabled ? "seçime açılsın" : "yeni seçimlere kapatılsın"} mı? Mevcut atamalar silinmeyecek.`)) {
      doAction("admin_set_slot", { slot_id: toggleSlot.dataset.toggleSlot, enabled }, "Slot durumu güncellendi.");
    }
    return;
  }
  const toggleComm = e.target.closest("[data-toggle-commission]");
  if (toggleComm) {
    const enabled = toggleComm.dataset.enabled === "true";
    if (confirm(`Yalnızca bu KOMİSYON ${enabled ? "seçime açılsın" : "yeni seçimlere kapatılsın"} mı? Mevcut atamalar korunacaktır.`)) {
      doAction("admin_set_commission", { commission_id: toggleComm.dataset.toggleCommission, enabled }, "Komisyon durumu güncellendi.");
    }
  }
});
els.slotFilter.addEventListener("input", e => { selectedSlotDate = e.target.value; renderSlots(); });
document.getElementById("clearFilterBtn").addEventListener("click", () => {
  selectedSlotDate = ""; els.slotFilter.value = ""; renderSlots();
});
els.managerFilter.addEventListener("input", e => {
  managerTerm = e.target.value; renderManagers();
});
els.managers.addEventListener("click", e => {
  const b = e.target.closest("[data-detail]");
  if (b) { detailManagerId = detailManagerId === b.dataset.detail ? null : b.dataset.detail; renderManagerDetail(); }
});
els.deadline.addEventListener("input", () => { deadlineDirty = true; });
document.getElementById("deadlineForm").addEventListener("submit", e => {
  e.preventDefault();
  const deadline = els.deadline.value || null;
  const msg = deadline ? `Genel seçim son tarihi ${deadline.replace("T", " ")} (Türkiye saati) olarak kaydedilsin mi?`
    : "Genel seçim son tarihi kaldırılacak ve yöneticilerin yeni seçimleri kapalı kalacak. Emin misiniz?";
  if (!confirm(msg)) return;
  deadlineDirty = false;
  doAction("admin_set_deadline", { deadline }, "Son seçim tarihi güncellendi.");
});
function exportExcel() {
  if (!state) return;
  const people = lookup(), assignments = assignmentRows(), counts = countMap();
  const summary = [["Tarih", "Başlangıç", "Bitiş", "Komisyon", "Slot seçime açık", "Komisyon seçime açık", "Birinci komisyon dolu", "İK kodu", "İK adı", "Birim kodu", "Birim adı"]];
  for (const slot of state.slots) for (const c of slot.commissions) {
    const ik = (c.assignments || []).find(a => a.role === "IK");
    const birim = (c.assignments || []).find(a => a.role === "BIRIM");
    const ip = ik && people.get(ik.manager_id), bp = birim && people.get(birim.manager_id);
    summary.push([
      fmtShortDate(slot.slot_date), fmtHour(slot.start_time), fmtHour(slot.end_time), Number(c.commission_no),
      slot.selection_enabled ? "Evet" : "Hayır", c.selection_enabled ? "Evet" : "Hayır",
      firstComplete(slot) ? "Evet" : "Hayır", ip?.code || "", ip?.full_name || "", bp?.code || "", bp?.full_name || "",
    ]);
  }
  const rows = [["Yönetici kodu", "Ad soyad", "Tür", "Tarih", "Başlangıç", "Bitiş", "Komisyon", "Slot seçime açık"]];
  for (const a of assignments) {
    const person = people.get(a.manager_id);
    rows.push([person?.code || "", person?.full_name || "", describeRole(a.role),
      fmtShortDate(a.slot.slot_date), fmtHour(a.slot.start_time), fmtHour(a.slot.end_time),
      Number(a.commission), a.slot.selection_enabled ? "Evet" : "Hayır"]);
  }
  const personSummary = [["Yönetici kodu", "Ad soyad", "Tür", "Aktif", "Toplam seçili oturum"]];
  for (const m of state.managers) personSummary.push([
    m.code, m.full_name, describeRole(m.role), m.active ? "Evet" : "Hayır", counts.get(m.id) || 0,
  ]);
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  downloadWorkbook([
    { name: "Komisyon Özeti", rows: summary },
    { name: "Yönetici Atamaları", rows },
    { name: "Yönetici Özeti", rows: personSummary },
  ], `mulakat_raporu_${stamp}.xlsx`);
  notify("Excel raporu indirildi.", "success");
}
document.getElementById("exportBtn").addEventListener("click", exportExcel);
document.getElementById("logoutBtn").addEventListener("click", doLogout);
document.getElementById("refreshBtn").addEventListener("click", () => refresh(true));
refresh(true);
setInterval(() => { if (!document.hidden && !busy) refresh(false); }, 30000);

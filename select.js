import {
  api, getToken, doLogout, setBusy, notify, esc, fmtDeadline,
  activeWindow, commission, hasPlace, rolePriorityMet, dayGroups, describeRole, nextCommission,
} from "./common.js";

if (!getToken()) location.replace("index.html");
const byId = id => document.getElementById(id);
const els = {
  calendar: document.getElementById("calendar"), selections: document.getElementById("mySelections"),
  identity: document.getElementById("userIdentity"), deadline: document.getElementById("deadlineBanner"),
  count: document.getElementById("myCount"), moveNotice: document.getElementById("moveMessage"),
  cancelMove: document.getElementById("cancelMoveBtn"), months: document.getElementById("monthSwitch"),
  moveText: byId("moveText"), deadlineLabel: byId("deadlineLabel"), deadlineValue: byId("deadlineValue"),
  roleNote: byId("roleNote"), dialog: byId("confirmDialog"),
};
const icons = {
  check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10 3.5 3.5 7.5-7.5"/></svg>',
  lock: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6a3 3 0 0 1 6 0v3"/><path d="M10 12v2"/></svg>',
  clock: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 5.5v5l3 1.5"/></svg>',
  person: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="6.5" r="3"/><path d="M4 17v-1a6 6 0 0 1 12 0v1"/></svg>',
  arrow: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5"/></svg>',
  circle: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="5.5"/></svg>',
  full: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4" fill="currentColor" stroke="none"/></svg>',
};
const fmtHour = value => String(value || "").slice(0, 5);
const fmtDate = value => new Intl.DateTimeFormat("tr-TR", {
  day: "numeric", month: "long", weekday: "long", timeZone: "Europe/Istanbul",
}).format(new Date(`${value}T12:00:00+03:00`));
const cardDateLabel = value => new Intl.DateTimeFormat("tr-TR", {
  day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul",
}).format(new Date(`${value}T12:00:00+03:00`));
const slotLabel = slot => `${cardDateLabel(slot.slot_date)}, ${fmtHour(slot.start_time)}–${fmtHour(slot.end_time)}`;
const roleLabel = role => role === "IK" ? "İK" : "Birim";
let state = null;
let busy = false;
let movingId = null;
let currentMonth = "all";
let pendingAction = null;

function mine() {
  if (!state) return [];
  return state.slots.flatMap(slot => slot.commissions
    .filter(c => c.my_assignment_id)
    .map(c => ({ id: c.my_assignment_id, slot, number: c.commission_no })));
}
function movingChoice() { return mine().find(choice => choice.id === movingId); }
function editable(choice) { return Boolean(choice && activeWindow(choice.slot, state.settings.selection_deadline)); }
function stateOf(slot) {
  if (slot.commissions.some(c => c.my_assignment_id)) return { type: "mine", label: "Seçildi", icon: "check", reason: "Bu oturumda mevcut seçiminiz var." };
  const deadline = state.settings.selection_deadline;
  let reason;
  if (!deadline) reason = "Genel seçim son tarihi henüz belirlenmedi.";
  else if (Date.now() >= new Date(deadline).getTime()) reason = "Genel seçim süresi doldu.";
  else if (!activeWindow(slot, deadline)) reason = "Oturumun başlangıç saati geçti.";
  else if (!slot.selection_enabled) reason = "Admin bu oturumu yeni seçimlere kapattı.";
  if (reason) return { type: "unavailable", label: "Şu an seçilemiyor", icon: "lock", reason };
  if (nextCommission(slot, state.actor.role, deadline)) return { type: "available", label: "Uygun", icon: "circle", reason: `${roleLabel(state.actor.role)} kontenjanı seçilebilir.` };
  if (slot.commissions.length && slot.commissions.every(c => c.ik_taken && c.birim_taken)) return { type: "full", label: "Tam dolu", icon: "full", reason: "Boş kontenjan bulunmuyor." };
  const role = state.actor.role;
  const first = commission(slot, 1);
  const second = commission(slot, 2);
  if (first && !hasPlace(first, role) && !first.selection_enabled) {
    reason = `1. komisyondaki ${roleLabel(role)} kontenjanı boş ve komisyon yeni seçimlere kapalı.`;
  } else if (second?.selection_enabled && !hasPlace(second, role) && !rolePriorityMet(slot, second, role)) {
    reason = `2. komisyondaki ${roleLabel(role)} kontenjanı için önce 1. komisyonda ${roleLabel(role)} seçimi yapılmalı.`;
  } else {
    reason = `${roleLabel(role)} türü için seçilebilir kontenjan bulunmuyor.`;
  }
  return { type: "unavailable", label: "Şu an seçilemiyor", icon: "lock", reason };
}
function seat(c, role, candidate) {
  if (c.my_assignment_id && state.actor.role === role) return `<span class="seat own">${icons.check}Siz</span>`;
  const taken = role === "IK" ? c.ik_taken : c.birim_taken;
  const available = candidate?.id === c.id && state.actor.role === role;
  return `<span class="seat ${taken ? "taken" : available ? "open-for-you" : ""}"><span class="circle" aria-hidden="true"></span>${taken ? "Dolu" : "Boş"}</span>`;
}
function slotCard(slot) {
  const status = stateOf(slot);
  const own = slot.commissions.some(c => c.my_assignment_id);
  const count = slot.commissions.reduce((n, c) => n + Number(Boolean(c.ik_taken)) + Number(Boolean(c.birim_taken)), 0);
  const candidate = nextCommission(slot, state.actor.role, state.settings.selection_deadline);
  let action;
  if (own) action = `<button class="button blue" type="button" data-view="${esc(slot.id)}">${icons.check}Seçimimi gör</button>`;
  else if (candidate && (!movingId || editable(movingChoice()))) action = `<button class="button primary" type="button" data-select="${esc(slot.id)}">${movingId ? "Buraya taşı" : "Oturumu seç"}${icons.arrow}</button>`;
  else action = `<button class="button" type="button" disabled>${status.type === "full" ? "Kontenjan dolu" : "Seçilemiyor"}</button>`;
  const rows = slot.commissions.map(c => {
    const role = state.actor.role;
    const locked = Number(c.commission_no) === 2 && !hasPlace(c, role) && !rolePriorityMet(slot, c, role);
    const reasons = [];
    if (!c.selection_enabled) reasons.push("Yeni seçimlere kapalı");
    else if (locked && slot.selection_enabled && activeWindow(slot, state.settings.selection_deadline)) {
      const first = commission(slot, 1);
      reasons.push(first && !first.selection_enabled
        ? `1. komisyonda ${roleLabel(role)} kontenjanı boş; komisyon kapalı`
        : `1. komisyonda ${roleLabel(role)} seçimi bekleniyor`);
    }
    return `<tr data-commission-id="${esc(c.id)}"${reasons.length ? ' class="waiting"' : ""}><td>${reasons.length ? `<span class="row-lock">${icons.lock}${Number(c.commission_no)}. komisyon</span><small class="row-reason">${reasons.join(" · ")}</small>` : `${Number(c.commission_no)}. komisyon`}</td><td>${seat(c, "IK", candidate)}</td><td>${seat(c, "BIRIM", candidate)}</td></tr>`;
  }).join("");
  return `<article class="slot ${status.type}" data-slot-id="${esc(slot.id)}" aria-label="${esc(`${slotLabel(slot)}, ${status.label}. ${status.reason}`)}">
    <div class="slot-head"><div><time class="slot-date" datetime="${esc(slot.slot_date)}">${esc(cardDateLabel(slot.slot_date))}</time><div class="slot-time">${fmtHour(slot.start_time)}–${fmtHour(slot.end_time)}</div><div class="slot-meta">${Number(slot.max_commissions)} komisyon · ${count} / ${Number(slot.max_commissions) * 2} kontenjan dolu</div></div><span class="badge ${status.type}" title="${esc(status.reason)}">${icons[status.icon]}${status.label}</span></div>
    <table class="commission-table" aria-label="Komisyon kontenjanları"><thead><tr><th scope="col">Komisyon</th><th scope="col">İK kontenjanı</th><th scope="col">Birim Kontenjanı</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="slot-foot">${action}</div></article>`;
}
function renderSelections() {
  const selections = mine();
  els.count.textContent = String(selections.length);
  els.count.setAttribute("aria-label", `${selections.length} seçilmiş oturum`);
  if (movingId && !editable(movingChoice())) movingId = null;
  if (!selections.length) {
    els.selections.innerHTML = '<p class="empty-selection">Henüz oturum seçmediniz. Takvimdeki “Uygun” oturumlardan birini seçebilirsiniz.</p>';
    return;
  }
  els.selections.innerHTML = selections.map(choice => {
    return `<article class="selection${movingId === choice.id ? " is-moving" : ""}" id="choice-${esc(choice.slot.id)}" tabindex="-1"><span class="selection-check">${icons.check}</span><div class="selection-main"><strong>${esc(fmtDate(choice.slot.slot_date))}</strong><span>${fmtHour(choice.slot.start_time)}–${fmtHour(choice.slot.end_time)} · ${Number(choice.number)}. komisyon</span></div><div class="selection-actions">${editable(choice)
      ? `<button type="button" class="text-button" data-move="${esc(choice.id)}" aria-label="${esc(`${slotLabel(choice.slot)} seçimini değiştir`)}">Değiştir</button><button type="button" class="text-button cancel" data-cancel="${esc(choice.id)}" aria-label="${esc(`${slotLabel(choice.slot)} seçimini iptal et`)}">İptal et</button>`
      : '<span class="selection-window">Geçmiş / süre dolmuş</span>'}</div></article>`;
  }).join("");
}
function renderMonthSwitch() {
  const months = [...new Set(state.slots.map(s => String(s.slot_date).slice(0,7)))].sort();
  if (currentMonth !== "all" && !months.includes(currentMonth)) currentMonth = "all";
  els.months.innerHTML = [`<button type="button" class="month" aria-pressed="${currentMonth === "all"}" data-month="all">Tümü</button>`,
    ...months.map(month => {
      const name = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" })
        .format(new Date(`${month}-01T12:00:00+03:00`));
      return `<button type="button" class="month" aria-pressed="${currentMonth === month}" data-month="${month}">${esc(name)}</button>`;
    })].join("");
}
function renderCalendar() {
  if (movingId && !editable(movingChoice())) { movingId = null; renderSelections(); }
  const slots = state.slots.filter(s => currentMonth === "all" || String(s.slot_date).startsWith(currentMonth));
  els.calendar.innerHTML = slots.length ? dayGroups(slots).map(([date, daySlots]) => `<section class="day-group"><div class="day-heading"><span class="day-number" aria-hidden="true">${Number(date.slice(-2))}</span><div><h3>${esc(fmtDate(date))}</h3><p>${esc(date.slice(0, 4))} · ${daySlots.length} oturum</p></div></div><div class="slot-grid">${daySlots.map(slotCard).join("")}</div></section>`).join("")
    : '<p class="empty-selection">Bu dönemde tanımlanmış oturum bulunmuyor.</p>';
  const source = movingChoice();
  els.moveNotice.hidden = !source;
  els.moveText.textContent = source ? `${slotLabel(source.slot)} seçiminizi taşımak için yeşil bir oturum seçin.` : "";
}
function render() {
  if (!state) return;
  if (state.actor.kind !== "MANAGER") { location.replace("admin.html"); return; }
  els.identity.innerHTML = `<strong>${esc(describeRole(state.actor.role))}</strong><small>${esc(state.actor.name)} · Kod: ${esc(state.actor.code)}</small>`;
  els.roleNote.textContent = `${roleLabel(state.actor.role)} kontenjanına göre`;
  const d = state.settings.selection_deadline;
  const expired = !d || Date.now() >= new Date(d).getTime();
  els.deadline.classList.toggle("closed", expired);
  els.deadlineLabel.textContent = expired ? "Seçim süresi kapalı" : "Son seçim tarihi";
  els.deadlineValue.textContent = fmtDeadline(d);
  renderMonthSwitch(); renderSelections(); renderCalendar();
}
function focusSelection(slotId, highlight = false) {
  const selection = slotId ? byId(`choice-${slotId}`) : null;
  const target = selection || byId("myTitle");
  target.focus({ preventScroll: true });
  if (selection && highlight) {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    selection.scrollIntoView({ behavior: reduceMotion ? "instant" : "smooth", block: "center" });
    selection.classList.remove("flash"); void selection.offsetWidth; selection.classList.add("flash");
  }
}
async function refresh(showOverlay = false) {
  if (!getToken()) { location.replace("index.html"); return; }
  if (busy || els.dialog.open) return;
  busy = true;
  if (showOverlay) setBusy(true, "Takvim yükleniyor…");
  try {
    const result = await api("bootstrap");
    state = result;
    render();
  } catch (e) { notify(e.message, "error"); }
  finally { busy = false; if (showOverlay) setBusy(false); }
}
async function doAction(action, data, successMessage, focusSlotId = null) {
  if (busy) return;
  busy = true; setBusy(true);
  try {
    await api(action, data);
    movingId = null;
    state = await api("bootstrap");
    render();
    focusSelection(focusSlotId);
    notify(successMessage, "success");
  } catch (e) { notify(e.message, "error"); }
  finally { busy = false; setBusy(false); }
}
function confirmAction(title, message, label, action, danger = false) {
  pendingAction = action;
  byId("dialogTitle").textContent = title; byId("dialogText").textContent = message;
  byId("dialogConfirm").textContent = label;
  byId("dialogConfirm").className = `button ${danger ? "danger" : "primary"}`;
  els.dialog.showModal(); byId("dialogCancel").focus();
}
function rejectExpiredMove() {
  movingId = null; render();
  notify("Eski seçimin değiştirme süresi doldu veya seçim artık mevcut değil.", "error");
}
byId("dialogCancel").addEventListener("click", () => { pendingAction = null; els.dialog.close(); });
els.dialog.addEventListener("cancel", () => { pendingAction = null; });
byId("dialogConfirm").addEventListener("click", () => {
  if (busy) return;
  const action = pendingAction; pendingAction = null; els.dialog.close();
  if (action) action();
});
els.selections.addEventListener("click", event => {
  if (busy || !state) return;
  const move = event.target.closest("[data-move]");
  const cancel = event.target.closest("[data-cancel]");
  const choiceId = move?.dataset.move || cancel?.dataset.cancel;
  if (!choiceId) return;
  const choice = mine().find(item => item.id === choiceId);
  if (!editable(choice)) { render(); notify("Bu seçim artık değiştirilemiyor.", "error"); return; }
  if (move) {
    movingId = choice.id; currentMonth = "all"; render();
    els.moveNotice.scrollIntoView({ behavior: "smooth", block: "center" });
    els.cancelMove.focus({ preventScroll: true }); return;
  }
  confirmAction("Seçiminiz iptal edilsin mi?", `${slotLabel(choice.slot)} oturumu seçimlerinizden kaldırılacak.`, "Seçimi iptal et", () => {
    const current = mine().find(item => item.id === choice.id);
    if (!editable(current)) { render(); notify("Bu seçim artık iptal edilemiyor.", "error"); return; }
    doAction("cancel", { assignment_id: choice.id }, "Seçiminiz iptal edildi.");
  }, true);
});
els.calendar.addEventListener("click", event => {
  if (busy || !state) return;
  const view = event.target.closest("[data-view]");
  if (view) { focusSelection(view.dataset.view, true); return; }
  const button = event.target.closest("[data-select]");
  if (!button) return;
  const slotId = button.dataset.select;
  const slot = state.slots.find(item => item.id === slotId);
  if (!slot) return;
  const sourceId = movingId;
  if (sourceId && !editable(movingChoice())) { rejectExpiredMove(); return; }
  const candidate = nextCommission(slot, state.actor.role, state.settings.selection_deadline);
  if (!candidate || slot.commissions.some(c => c.my_assignment_id)) {
    render(); notify("Bu oturum şu an seçilemiyor.", "error"); return;
  }
  confirmAction(sourceId ? "Seçiminiz taşınsın mı?" : "Oturum seçilsin mi?",
    `${slotLabel(slot)}. ${roleLabel(state.actor.role)} kontenjanı için uygun komisyon sistem tarafından atanacaktır.${sourceId ? " Eski seçiminiz yalnızca yeni seçim başarıyla kaydedilince kaldırılır." : ""}`,
    sourceId ? "Seçimimi taşı" : "Seçimi onayla", () => {
      if (sourceId && !editable(mine().find(choice => choice.id === sourceId))) { rejectExpiredMove(); return; }
      const target = state.slots.find(item => item.id === slotId);
      if (!target || target.commissions.some(c => c.my_assignment_id) || !nextCommission(target, state.actor.role, state.settings.selection_deadline)) {
        render(); notify("Bu oturum şu an seçilemiyor. Mevcut seçiminiz korundu.", "error"); return;
      }
      if (sourceId) doAction("move", { assignment_id: sourceId, slot_id: slotId }, "Seçiminiz başarıyla taşındı. Toplam seçim sayınız değişmedi.", slotId);
      else doAction("select", { slot_id: slotId }, "Oturum seçiminiz kaydedildi.", slotId);
    });
});
els.cancelMove.addEventListener("click", () => {
  const source = movingChoice(); movingId = null; render(); focusSelection(source?.slot.id);
  notify("Taşıma işleminden vazgeçildi. Seçiminiz korundu.");
});
els.months.addEventListener("click", e => {
  const chip = e.target.closest("[data-month]");
  if (!chip || !state) return;
  currentMonth = chip.dataset.month;
  renderMonthSwitch(); renderCalendar();
  els.months.querySelector(`[data-month="${currentMonth}"]`)?.focus();
});
document.getElementById("logoutBtn").addEventListener("click", doLogout);
document.getElementById("refreshBtn").addEventListener("click", () => refresh(true));
byId("personIcon").innerHTML = icons.person;
byId("clockIcon").innerHTML = icons.clock;
byId("legendCheck").innerHTML = icons.check;
byId("legendLock").innerHTML = icons.lock;
if (getToken()) {
  refresh(true);
  setInterval(() => { if (getToken() && !document.hidden && !busy && !els.dialog.open) refresh(false); }, 20000);
}

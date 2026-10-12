import {
  api, getToken, doLogout, setBusy, notify, esc, fmtDate, fmtHour, fmtDeadline,
  activeWindow, commission, firstComplete, dayGroups, describeRole, nextCommission,
} from "./common.js";

if (!getToken()) location.replace("index.html");
const els = {
  calendar: document.getElementById("calendar"), selections: document.getElementById("mySelections"),
  identity: document.getElementById("userIdentity"), deadline: document.getElementById("deadlineBanner"),
  count: document.getElementById("myCount"), moveNotice: document.getElementById("moveMessage"),
  cancelMove: document.getElementById("cancelMoveBtn"), months: document.getElementById("monthSwitch"),
};
let state = null;
let busy = false;
let movingId = null;
let currentMonth = "all";

function mine() {
  if (!state) return [];
  return state.slots.flatMap(slot => slot.commissions
    .filter(c => c.my_assignment_id)
    .map(c => ({ id: c.my_assignment_id, slot, number: c.commission_no })));
}
function commissionDisplay(slot, c) {
  const locked = Number(c.commission_no) === 2 && !firstComplete(slot);
  const own = Boolean(c.my_assignment_id);
  let stateText = "Açık";
  if (!c.selection_enabled) stateText = "Admin kapattı";
  else if (locked) stateText = "Yeni seçime kilitli";
  else if (c.ik_taken && c.birim_taken) stateText = "Tam dolu";
  return `<div class="commission-mini ${locked ? "locked" : ""}">
    <div class="commission-mini-top"><h4>${Number(c.commission_no)}. Komisyon ${own ? "· Sizin seçiminiz" : ""}</h4>
      <span class="status-pill ${locked || !c.selection_enabled ? "amber" : c.ik_taken && c.birim_taken ? "green" : ""}">${esc(stateText)}</span></div>
    <div class="pair-row">
      <div class="pair-chip ${c.ik_taken ? "taken" : "free"}"><span>İK</span><b>${c.ik_taken ? "● Dolu" : "○ Boş"}</b></div>
      <div class="pair-chip ${c.birim_taken ? "taken" : "free"}"><span>Birim</span><b>${c.birim_taken ? "● Dolu" : "○ Boş"}</b></div>
    </div>
  </div>`;
}
function renderSelections() {
  const selections = mine();
  els.count.textContent = String(selections.length);
  if (movingId && !selections.some(c => c.id === movingId)) movingId = null;
  els.cancelMove.hidden = !movingId;
  els.moveNotice.hidden = !movingId;
  els.moveNotice.textContent = movingId
    ? "Değiştirme modundasınız. Aşağıdaki takvimden yeni bir zaman dilimi seçin; yeni seçim kaydedilirse eski seçiminiz otomatik kaldırılır."
    : "";
  if (!selections.length) {
    els.selections.innerHTML = `<div class="empty-card">Henüz oturum seçmediniz. Aşağıdaki takvimden uygun bir oturum seçebilirsiniz.</div>`;
    return;
  }
  els.selections.innerHTML = selections.map(choice => {
    const allowed = activeWindow(choice.slot, state.settings.selection_deadline);
    return `<article class="selection-card">
      <div class="selection-title">${esc(fmtDate(choice.slot.slot_date))}</div>
      <div class="selection-meta">${fmtHour(choice.slot.start_time)}–${fmtHour(choice.slot.end_time)} · ${choice.number}. Komisyon</div>
      <div class="card-actions">
        ${allowed ? `<button type="button" class="button small ${movingId === choice.id ? "primary" : "outline"}" data-move="${esc(choice.id)}">Değiştir</button>
        <button type="button" class="button danger small" data-cancel="${esc(choice.id)}">İptal et</button>` : `<span class="status-pill">Geçmiş / süre dolmuş</span>`}
      </div>
    </article>`;
  }).join("");
}
function renderMonthSwitch() {
  const months = [...new Set(state.slots.map(s => String(s.slot_date).slice(0,7)))].sort();
  if (currentMonth !== "all" && !months.includes(currentMonth)) currentMonth = "all";
  els.months.innerHTML = [`<button type="button" class="chip ${currentMonth === "all" ? "active" : ""}" data-month="all">Tümü</button>`,
    ...months.map(month => {
      const name = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" })
        .format(new Date(`${month}-01T12:00:00+03:00`));
      return `<button type="button" class="chip ${currentMonth === month ? "active" : ""}" data-month="${month}">${esc(name)}</button>`;
    })].join("");
}
function renderCalendar() {
  const slots = state.slots.filter(s => currentMonth === "all" || String(s.slot_date).startsWith(currentMonth));
  if (!slots.length) {
    els.calendar.innerHTML = `<div class="empty-card">Bu dönemde tanımlanmış oturum bulunmuyor.</div>`;
    return;
  }
  const role = state.actor.role;
  els.calendar.innerHTML = dayGroups(slots).map(([date, daySlots]) => {
    return `<section class="day-block"><div class="day-header"><span class="day-number">${esc(date.slice(-2))}</span>
      <div><div class="day-title">${esc(fmtDate(date))}</div><div class="day-subtitle">${daySlots.length} zaman dilimi</div></div></div>
      <div class="day-slots">${daySlots.map(slot => {
        const own = slot.commissions.some(c => c.my_assignment_id);
        const opportunity = nextCommission(slot, role, state.settings.selection_deadline);
        const canMove = movingId && mine().find(x => x.id === movingId)?.slot.id !== slot.id;
        const c1 = commission(slot, 1);
        const c2 = commission(slot, 2);
        const showC2 = c2 && (firstComplete(slot) || c2.ik_taken || c2.birim_taken);
        const future = activeWindow(slot, state.settings.selection_deadline);
        let hint = "";
        if (!future) hint = "Oturum başlangıcı veya genel seçim süresi geçmiş.";
        else if (!slot.selection_enabled) hint = "Bu slot admin tarafından yeni seçimlere kapatılmış.";
        else if (own) hint = "Bu zaman diliminde zaten seçiminiz var.";
        else if (!opportunity) hint = "Sizin paydaş türünüz için uygun kontenjan yok.";
        else hint = `${describeRole(role)} · ${opportunity.commission_no}. komisyon için uygun`;
        return `<article class="slot-card ${slot.selection_enabled ? "" : "off"}">
          <div class="slot-header"><div><div class="slot-time">${fmtHour(slot.start_time)}–${fmtHour(slot.end_time)}</div>
            <div class="slot-meta">En fazla ${slot.max_commissions} komisyon</div></div>
            <span class="status-pill ${!slot.selection_enabled ? "red" : "green"}">${slot.selection_enabled ? "Slot açık" : "Slot kapalı"}</span>
          </div>
          <div class="commission-stack">${c1 ? commissionDisplay(slot,c1) : ""}
            ${showC2 ? commissionDisplay(slot,c2) : c2 ? `<div class="commission-mini locked"><div class="commission-mini-top"><h4>2. Komisyon</h4><span class="status-pill amber">1. komisyon tamamlanınca açılır</span></div></div>` : ""}
          </div>
          <div class="slot-actions">${opportunity && !own ? `<button type="button" class="button ${movingId ? (canMove ? "primary" : "outline") : "primary"} small" data-select="${esc(slot.id)}" ${movingId && !canMove ? "disabled" : ""}>${movingId ? "Seçimimi buraya taşı" : "Bu oturumu seç"} →</button>` : ""}</div>
          <div class="slot-hint">${esc(hint)}</div>
        </article>`;
      }).join("")}</div></section>`;
  }).join("");
}
function render() {
  if (!state) return;
  if (state.actor.kind !== "MANAGER") { location.replace("admin.html"); return; }
  els.identity.innerHTML = `<strong>${esc(state.actor.name)}</strong><small>${esc(describeRole(state.actor.role))} · Kod: ${esc(state.actor.code)}</small>`;
  const d = state.settings.selection_deadline;
  const expired = !d || Date.now() >= new Date(d).getTime();
  els.deadline.classList.toggle("closed", expired);
  els.deadline.textContent = expired
    ? `Seçim süresi kapalı. Son tarih: ${fmtDeadline(d)}. Mevcut seçimler görüntülenebilir.`
    : `Son seçim ve değişiklik tarihi: ${fmtDeadline(d)} (Türkiye saati).`;
  renderMonthSwitch(); renderSelections(); renderCalendar();
}
async function refresh(showOverlay = false) {
  if (busy) return;
  busy = true;
  if (showOverlay) setBusy(true, "Takvim yükleniyor…");
  try {
    const result = await api("bootstrap");
    state = result;
    render();
  } catch (e) { notify(e.message, "error"); }
  finally { busy = false; if (showOverlay) setBusy(false); }
}
async function doAction(action, data, successMessage) {
  if (busy) return;
  busy = true; setBusy(true);
  try {
    await api(action, data);
    movingId = null;
    state = await api("bootstrap");
    render();
    notify(successMessage, "success");
  } catch (e) { notify(e.message, "error"); }
  finally { busy = false; setBusy(false); }
}
els.selections.addEventListener("click", e => {
  const move = e.target.closest("[data-move]");
  const cancel = e.target.closest("[data-cancel]");
  if (move) {
    movingId = move.dataset.move;
    render();
    document.getElementById("calendar").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (cancel && window.confirm("Bu oturumdaki kendi seçiminizi iptal etmek istediğinize emin misiniz?")) {
    doAction("cancel", { assignment_id: cancel.dataset.cancel }, "Seçiminiz iptal edildi.");
  }
});
els.calendar.addEventListener("click", e => {
  const button = e.target.closest("[data-select]");
  if (!button || !state || busy) return;
  const slotId = button.dataset.select;
  const slot = state.slots.find(s => s.id === slotId);
  if (!slot) return;
  const label = `${fmtDate(slot.slot_date)}, ${fmtHour(slot.start_time)}–${fmtHour(slot.end_time)}`;
  if (movingId) {
    if (window.confirm(`Seçiminiz ${label} oturumuna taşınsın mı? Eski seçim yalnızca yeni seçim başarıyla kaydedilince kaldırılır.`)) {
      doAction("move", { assignment_id: movingId, slot_id: slotId }, "Seçiminiz başarıyla taşındı.");
    }
  } else if (window.confirm(`${label} oturumunu seçmek istiyor musunuz?`)) {
    doAction("select", { slot_id: slotId }, "Oturum seçiminiz kaydedildi.");
  }
});
els.cancelMove.addEventListener("click", () => { movingId = null; render(); });
els.months.addEventListener("click", e => {
  const chip = e.target.closest("[data-month]");
  if (!chip) return;
  currentMonth = chip.dataset.month;
  els.months.querySelectorAll(".chip").forEach(btn => btn.classList.toggle("active", btn === chip));
  renderCalendar();
});
document.getElementById("logoutBtn").addEventListener("click", doLogout);
document.getElementById("refreshBtn").addEventListener("click", () => refresh(true));
refresh(true);
setInterval(() => { if (!document.hidden && !busy) refresh(false); }, 20000);

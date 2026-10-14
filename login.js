import { api, setToken, clearToken, setBusy } from "./common.js";

const form = document.getElementById("loginForm");
const codeInput = document.getElementById("accessCode");
const errorBox = document.getElementById("loginError");
let submitting = false;
if (new URLSearchParams(location.search).has("expired")) {
  errorBox.textContent = "Oturumunuz sona erdi. Yeniden giriş yapın.";
  errorBox.hidden = false;
}
codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  codeInput.setAttribute("aria-invalid", "false");
  errorBox.textContent = "";
  errorBox.hidden = true;
});
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (submitting) return;
  const code = codeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    codeInput.setAttribute("aria-invalid", "true");
    errorBox.textContent = "Lütfen 5 karakterli giriş kodunuzu yazın.";
    errorBox.hidden = false; codeInput.focus(); return;
  }
  submitting = true;
  codeInput.setAttribute("aria-invalid", "false");
  setBusy(true, "Giriş yapılıyor…");
  errorBox.textContent = "";
  errorBox.hidden = true;
  try {
    clearToken();
    const response = await api("login", { code });
    setToken(response.token);
    location.replace(response.actor.kind === "ADMIN" ? "admin.html" : "select.html");
  } catch (error) {
    errorBox.textContent = error.message; errorBox.hidden = false;
  } finally { submitting = false; setBusy(false); }
});

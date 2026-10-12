import { api, setToken, clearToken, setBusy } from "./common.js";

const form = document.getElementById("loginForm");
const codeInput = document.getElementById("accessCode");
const errorBox = document.getElementById("loginError");
if (new URLSearchParams(location.search).has("expired")) {
  errorBox.textContent = "Oturumunuz sona erdi. Yeniden giriş yapın.";
  errorBox.hidden = false;
}
codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  errorBox.hidden = true;
});
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = codeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    errorBox.textContent = "Lütfen 5 karakterli kodu girin."; errorBox.hidden = false; return;
  }
  setBusy(true, "Giriş yapılıyor…");
  errorBox.hidden = true;
  try {
    clearToken();
    const response = await api("login", { code });
    setToken(response.token);
    location.replace(response.actor.kind === "ADMIN" ? "admin.html" : "select.html");
  } catch (error) {
    errorBox.textContent = error.message; errorBox.hidden = false;
  } finally { setBusy(false); }
});

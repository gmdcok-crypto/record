const SIGNUP_URL = "https://record-production.up.railway.app/transcriber/?signup=1";

const modal = document.getElementById("terms-modal");
const openBtn = document.getElementById("signup-open-btn");
const agreeAll = document.getElementById("terms-agree-all");
const requiredChecks = Array.from(document.querySelectorAll(".terms-required"));
const nextBtn = document.getElementById("terms-next-btn");

function allRequiredChecked() {
  return requiredChecks.every((input) => input.checked);
}

function syncAgreeAll() {
  agreeAll.checked = allRequiredChecked();
  nextBtn.disabled = !allRequiredChecked();
}

function openModal() {
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("terms-modal-open");
  nextBtn.focus();
}

function closeModal() {
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("terms-modal-open");
}

function resetModal() {
  agreeAll.checked = false;
  requiredChecks.forEach((input) => {
    input.checked = false;
  });
  document.querySelectorAll(".terms-body").forEach((body) => {
    body.hidden = true;
  });
  document.querySelectorAll(".terms-toggle").forEach((toggle) => {
    toggle.setAttribute("aria-expanded", "false");
    toggle.classList.remove("is-open");
  });
  syncAgreeAll();
}

openBtn?.addEventListener("click", () => {
  resetModal();
  openModal();
});

modal?.querySelectorAll("[data-terms-close]").forEach((el) => {
  el.addEventListener("click", closeModal);
});

agreeAll?.addEventListener("change", () => {
  requiredChecks.forEach((input) => {
    input.checked = agreeAll.checked;
  });
  syncAgreeAll();
});

requiredChecks.forEach((input) => {
  input.addEventListener("change", syncAgreeAll);
});

document.querySelectorAll("[data-terms-toggle]").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const key = toggle.getAttribute("data-terms-toggle");
    const body = document.getElementById(`terms-body-${key}`);
    if (!body) return;
    const willOpen = body.hidden;
    body.hidden = !willOpen;
    toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
    toggle.classList.toggle("is-open", willOpen);
  });
});

nextBtn?.addEventListener("click", () => {
  if (!allRequiredChecked()) return;
  window.location.href = SIGNUP_URL;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) {
    closeModal();
  }
});

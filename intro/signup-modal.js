const API_BASE = window.location.origin;
const CLIENT_URL = `${API_BASE}/`;
const TOKEN_KEY = "member_access_token";
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[#?!@$%^&*\-]).{8,16}$/;
const EMAIL_PATTERN = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

const termsModal = document.getElementById("terms-modal");
const signupModal = document.getElementById("signup-modal");
const openBtn = document.getElementById("signup-open-btn");
const agreeAll = document.getElementById("terms-agree-all");
const requiredChecks = Array.from(document.querySelectorAll(".terms-required"));
const termsNextBtn = document.getElementById("terms-next-btn");
const signupForm = document.getElementById("signup-form");
const signupError = document.getElementById("signup-error");
const signupEmailHint = document.getElementById("signup-email-hint");
const checkEmailBtn = document.getElementById("signup-check-email-btn");
const emailInput = document.getElementById("signup-email");

async function loadServiceTerms() {
  const body = document.getElementById("terms-body-service");
  if (!body || body.dataset.loaded === "1") return;
  try {
    const res = await fetch("./service-terms-content.html");
    if (!res.ok) throw new Error("terms fetch failed");
    body.innerHTML = await res.text();
    body.dataset.loaded = "1";
  } catch {
    body.innerHTML = "<p>약관을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>";
  }
}

function allRequiredChecked() {
  return requiredChecks.every((input) => input.checked);
}

function syncAgreeAll() {
  agreeAll.checked = allRequiredChecked();
  termsNextBtn.disabled = !allRequiredChecked();
}

function setBodyLocked(locked) {
  document.body.classList.toggle("terms-modal-open", locked);
}

function openTermsModal() {
  termsModal.hidden = false;
  termsModal.setAttribute("aria-hidden", "false");
  setBodyLocked(true);
  termsNextBtn.focus();
}

function closeTermsModal() {
  termsModal.hidden = true;
  termsModal.setAttribute("aria-hidden", "true");
}

function openSignupModal() {
  signupModal.hidden = false;
  signupModal.setAttribute("aria-hidden", "false");
  setBodyLocked(true);
  document.getElementById("signup-name")?.focus();
}

function closeSignupModal() {
  signupModal.hidden = true;
  signupModal.setAttribute("aria-hidden", "true");
  if (termsModal.hidden) {
    setBodyLocked(false);
  }
}

function closeAllModals() {
  closeTermsModal();
  closeSignupModal();
  setBodyLocked(false);
}

function resetTermsModal() {
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

function resetSignupForm() {
  signupForm?.reset();
  signupError.hidden = true;
  signupError.textContent = "";
  signupEmailHint.hidden = true;
  signupEmailHint.textContent = "";
  signupEmailHint.className = "signup-hint";
}

function showSignupError(message) {
  signupError.textContent = message;
  signupError.hidden = false;
}

function showEmailHint(message, ok) {
  signupEmailHint.textContent = message;
  signupEmailHint.hidden = false;
  signupEmailHint.className = ok ? "signup-hint signup-hint--ok" : "signup-hint signup-hint--error";
}

openBtn?.addEventListener("click", () => {
  resetTermsModal();
  resetSignupForm();
  openTermsModal();
});

termsModal?.querySelectorAll("[data-terms-close]").forEach((el) => {
  el.addEventListener("click", closeAllModals);
});

signupModal?.querySelectorAll("[data-signup-close]").forEach((el) => {
  el.addEventListener("click", () => {
    closeSignupModal();
    setBodyLocked(false);
  });
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

termsNextBtn?.addEventListener("click", () => {
  if (!allRequiredChecked()) return;
  closeTermsModal();
  resetSignupForm();
  openSignupModal();
});

checkEmailBtn?.addEventListener("click", async () => {
  const email = emailInput?.value.trim().toLowerCase() || "";
  if (!EMAIL_PATTERN.test(email)) {
    showEmailHint("올바른 이메일 형식이 아닙니다.", false);
    return;
  }
  checkEmailBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/member/auth/check-email?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    if (!res.ok) {
      showEmailHint(data.detail || "이메일 확인에 실패했습니다.", false);
      return;
    }
    if (data.available) {
      showEmailHint("사용 가능한 이메일입니다.", true);
    } else {
      showEmailHint("이미 사용 중인 이메일입니다.", false);
    }
  } catch {
    showEmailHint("서버 연결에 실패했습니다.", false);
  } finally {
    checkEmailBtn.disabled = false;
  }
});

document.querySelectorAll("[data-clear-for]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    const target = document.getElementById(button.getAttribute("data-clear-for"));
    if (target) {
      target.value = "";
      target.focus();
    }
  });
});

document.querySelectorAll("[data-toggle-for]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.getAttribute("data-toggle-for"));
    if (!target) return;
    const show = target.type === "password";
    target.type = show ? "text" : "password";
    button.setAttribute("aria-label", show ? "비밀번호 숨기기" : "비밀번호 표시");
  });
});

signupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  signupError.hidden = true;

  const name = document.getElementById("signup-name")?.value.trim() || "";
  const email = emailInput?.value.trim().toLowerCase() || "";
  const password = document.getElementById("signup-password")?.value || "";
  const passwordConfirm = document.getElementById("signup-password-confirm")?.value || "";

  if (!name) return showSignupError("이름을 입력해 주세요.");
  if (!EMAIL_PATTERN.test(email)) return showSignupError("올바른 이메일 형식이 아닙니다.");
  if (!PASSWORD_PATTERN.test(password)) {
    return showSignupError("비밀번호는 영문, 숫자, 특수문자(#?!@$%^&*-) 포함 8~16자리여야 합니다.");
  }
  if (password !== passwordConfirm) return showSignupError("비밀번호가 일치하지 않습니다.");

  const submitBtn = document.getElementById("signup-submit-btn");
  submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/member/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await res.json();
    if (!res.ok) {
      showSignupError(typeof data.detail === "string" ? data.detail : "회원가입에 실패했습니다.");
      return;
    }
    localStorage.setItem(TOKEN_KEY, data.access_token);
    window.location.href = CLIENT_URL;
  } catch {
    showSignupError("서버 연결에 실패했습니다.");
  } finally {
    submitBtn.disabled = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!termsModal.hidden) {
    closeAllModals();
  }
});

loadServiceTerms();
closeAllModals();

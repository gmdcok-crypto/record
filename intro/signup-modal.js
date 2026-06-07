const API_BASE = window.location.origin;
const HOME_URL = `${API_BASE}/`;
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
const phoneVerifyBtn = document.getElementById("signup-phone-verify-btn");
const emailInput = document.getElementById("signup-email");

let emailAvailable = false;
let phoneVerified = false;
let mockVerifyCode = "";

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
  emailAvailable = false;
  phoneVerified = false;
  mockVerifyCode = "";
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
  el.addEventListener("click", closeAllModals);
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

emailInput?.addEventListener("input", () => {
  emailAvailable = false;
  signupEmailHint.hidden = true;
});

checkEmailBtn?.addEventListener("click", async () => {
  const email = emailInput?.value.trim().toLowerCase() || "";
  if (!EMAIL_PATTERN.test(email)) {
    showEmailHint("올바른 이메일 형식이 아닙니다.", false);
    emailAvailable = false;
    return;
  }
  checkEmailBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/member/auth/check-email?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    if (!res.ok) {
      showEmailHint(data.detail || "이메일 확인에 실패했습니다.", false);
      emailAvailable = false;
      return;
    }
    if (data.available) {
      showEmailHint("사용 가능한 이메일입니다.", true);
      emailAvailable = true;
    } else {
      showEmailHint("이미 사용 중인 이메일입니다.", false);
      emailAvailable = false;
    }
  } catch {
    showEmailHint("서버 연결에 실패했습니다.", false);
    emailAvailable = false;
  } finally {
    checkEmailBtn.disabled = false;
  }
});

phoneVerifyBtn?.addEventListener("click", () => {
  const phone = document.getElementById("signup-phone")?.value.replace(/\D/g, "") || "";
  if (phone.length < 10) {
    showSignupError("휴대폰 번호를 올바르게 입력해 주세요.");
    return;
  }
  mockVerifyCode = String(Math.floor(100000 + Math.random() * 900000));
  phoneVerified = false;
  signupError.hidden = true;
  window.alert(`인증번호가 발송되었습니다.\n(테스트용 인증번호: ${mockVerifyCode})`);
});

document.getElementById("signup-verify-code")?.addEventListener("input", (event) => {
  const value = event.target.value.replace(/\D/g, "");
  event.target.value = value;
  phoneVerified = value.length === 6 && value === mockVerifyCode;
});

document.querySelectorAll("[data-clear-for]").forEach((button) => {
  button.addEventListener("click", () => {
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
  const phone = document.getElementById("signup-phone")?.value.replace(/\D/g, "") || "";

  if (!name) return showSignupError("이름을 입력해 주세요.");
  if (!EMAIL_PATTERN.test(email)) return showSignupError("올바른 이메일 형식이 아닙니다.");
  if (!emailAvailable) return showSignupError("이메일 중복확인을 해주세요.");
  if (!PASSWORD_PATTERN.test(password)) {
    return showSignupError("비밀번호는 영문, 숫자, 특수문자(#?!@$%^&*-) 포함 8~16자리여야 합니다.");
  }
  if (password !== passwordConfirm) return showSignupError("비밀번호가 일치하지 않습니다.");
  if (!phoneVerified) return showSignupError("휴대폰 인증을 완료해 주세요.");

  const submitBtn = document.getElementById("signup-submit-btn");
  submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/member/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name, phone }),
    });
    const data = await res.json();
    if (!res.ok) {
      showSignupError(typeof data.detail === "string" ? data.detail : "회원가입에 실패했습니다.");
      return;
    }
    localStorage.setItem(TOKEN_KEY, data.access_token);
    window.location.href = HOME_URL;
  } catch {
    showSignupError("서버 연결에 실패했습니다.");
  } finally {
    submitBtn.disabled = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!signupModal.hidden) {
    closeAllModals();
    return;
  }
  if (!termsModal.hidden) {
    closeAllModals();
  }
});

closeAllModals();

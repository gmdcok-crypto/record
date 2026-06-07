const API_BASE = window.location.origin;
const TRANSCRIBER_URL = `${API_BASE}/transcriber/`;
const TOKEN_KEY = "transcriber_access_token";

const termsModal = document.getElementById("terms-modal");
const signupModal = document.getElementById("signup-modal");
const openBtn = document.getElementById("signup-open-btn");
const agreeAll = document.getElementById("terms-agree-all");
const requiredChecks = Array.from(document.querySelectorAll(".terms-required"));
const termsNextBtn = document.getElementById("terms-next-btn");
const signupForm = document.getElementById("signup-form");
const signupError = document.getElementById("signup-error");
const signupIdHint = document.getElementById("signup-id-hint");
const checkIdBtn = document.getElementById("signup-check-id-btn");
const phoneVerifyBtn = document.getElementById("signup-phone-verify-btn");
const loginIdInput = document.getElementById("signup-login-id");

let loginIdAvailable = false;
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
  loginIdAvailable = false;
  phoneVerified = false;
  mockVerifyCode = "";
  signupError.hidden = true;
  signupError.textContent = "";
  signupIdHint.hidden = true;
  signupIdHint.textContent = "";
  signupIdHint.className = "signup-hint";
}

function showSignupError(message) {
  signupError.textContent = message;
  signupError.hidden = false;
}

function showIdHint(message, ok) {
  signupIdHint.textContent = message;
  signupIdHint.hidden = false;
  signupIdHint.className = ok ? "signup-hint signup-hint--ok" : "signup-hint signup-hint--error";
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

loginIdInput?.addEventListener("input", () => {
  loginIdAvailable = false;
  signupIdHint.hidden = true;
});

checkIdBtn?.addEventListener("click", async () => {
  const loginId = loginIdInput?.value.trim() || "";
  if (!/^[A-Za-z0-9]{8}$/.test(loginId)) {
    showIdHint("아이디는 영문·숫자 8자여야 합니다.", false);
    loginIdAvailable = false;
    return;
  }
  checkIdBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/transcriber/auth/check-login-id?login_id=${encodeURIComponent(loginId)}`);
    const data = await res.json();
    if (!res.ok) {
      showIdHint(data.detail || "아이디 확인에 실패했습니다.", false);
      loginIdAvailable = false;
      return;
    }
    if (data.available) {
      showIdHint("사용 가능한 아이디입니다.", true);
      loginIdAvailable = true;
    } else {
      showIdHint("이미 사용 중인 아이디입니다.", false);
      loginIdAvailable = false;
    }
  } catch {
    showIdHint("서버 연결에 실패했습니다.", false);
    loginIdAvailable = false;
  } finally {
    checkIdBtn.disabled = false;
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
  const loginId = document.getElementById("signup-login-id")?.value.trim() || "";
  const password = document.getElementById("signup-password")?.value || "";
  const passwordConfirm = document.getElementById("signup-password-confirm")?.value || "";
  const phone = document.getElementById("signup-phone")?.value.replace(/\D/g, "") || "";
  const residentId = document.getElementById("signup-resident-id")?.value.replace(/\D/g, "") || "";
  const bankName = document.getElementById("signup-bank-name")?.value.trim() || "";
  const accountNumber = document.getElementById("signup-account-number")?.value.replace(/\D/g, "") || "";

  if (!name) return showSignupError("이름을 입력해 주세요.");
  if (!/^[A-Za-z0-9]{8}$/.test(loginId)) return showSignupError("아이디는 영문·숫자 8자여야 합니다.");
  if (!loginIdAvailable) return showSignupError("아이디 중복확인을 해주세요.");
  if (password.length < 8) return showSignupError("비밀번호는 8자 이상이어야 합니다.");
  if (password !== passwordConfirm) return showSignupError("비밀번호가 일치하지 않습니다.");
  if (!phoneVerified) return showSignupError("휴대폰 인증을 완료해 주세요.");
  if (!residentId) return showSignupError("주민등록번호를 입력해 주세요.");
  if (!bankName) return showSignupError("은행명을 입력해 주세요.");
  if (!accountNumber) return showSignupError("계좌번호를 입력해 주세요.");

  const submitBtn = document.getElementById("signup-submit-btn");
  submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/transcriber/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login_id: loginId,
        password,
        name,
        phone,
        resident_id: residentId,
        bank_name: bankName,
        account_number: accountNumber,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showSignupError(typeof data.detail === "string" ? data.detail : "회원가입에 실패했습니다.");
      return;
    }
    localStorage.setItem(TOKEN_KEY, data.access_token);
    window.location.href = TRANSCRIBER_URL;
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

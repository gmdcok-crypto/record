import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  EMAIL_PATTERN,
  PASSWORD_PATTERN,
  checkEmailAvailability,
  redirectAfterSignup,
  signupMember,
} from "./memberAuth";

type TermsKey = "service" | "privacy" | "collection";

const REQUIRED_TERMS: TermsKey[] = ["service", "privacy", "collection"];

type SignupFlowContextValue = {
  openSignupFlow: () => void;
};

const SignupFlowContext = createContext<SignupFlowContextValue | null>(null);

export function shouldAutoOpenSignupFlow(): boolean {
  const params = new URLSearchParams(window.location.search);
  const signup = params.get("signup");
  if (signup === "1" || signup === "true" || signup === "open") return true;
  return window.location.hash === "#signup";
}

function clearSignupAutoOpenParam(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("signup");
  if (url.hash === "#signup") url.hash = "";
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next);
}

export function useSignupFlow(): SignupFlowContextValue {
  const value = useContext(SignupFlowContext);
  if (!value) {
    throw new Error("useSignupFlow must be used within SignupFlowProvider");
  }
  return value;
}

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    document.body.classList.toggle("terms-modal-open", locked);
    return () => {
      document.body.classList.remove("terms-modal-open");
    };
  }, [locked]);
}

function TermsModal({
  open,
  onClose,
  onNext,
}: {
  open: boolean;
  onClose: () => void;
  onNext: () => void;
}) {
  const [agreeAll, setAgreeAll] = useState(false);
  const [checked, setChecked] = useState<Record<TermsKey, boolean>>({
    service: false,
    privacy: false,
    collection: false,
  });
  const [expanded, setExpanded] = useState<Record<TermsKey, boolean>>({
    service: false,
    privacy: false,
    collection: false,
  });
  const [serviceTermsHtml, setServiceTermsHtml] = useState(
    '<p class="terms-loading">약관을 불러오는 중…</p>'
  );
  const [serviceTermsLoaded, setServiceTermsLoaded] = useState(false);

  const allRequiredChecked = REQUIRED_TERMS.every((key) => checked[key]);

  useEffect(() => {
    if (!open || serviceTermsLoaded) return;
    void fetch("/service-terms-content.html")
      .then((res) => {
        if (!res.ok) throw new Error("terms fetch failed");
        return res.text();
      })
      .then((html) => {
        setServiceTermsHtml(html);
        setServiceTermsLoaded(true);
      })
      .catch(() => {
        setServiceTermsHtml("<p>약관을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>");
      });
  }, [open, serviceTermsLoaded]);

  useEffect(() => {
    if (!open) return;
    setAgreeAll(false);
    setChecked({ service: false, privacy: false, collection: false });
    setExpanded({ service: false, privacy: false, collection: false });
  }, [open]);

  useEffect(() => {
    setAgreeAll(allRequiredChecked);
  }, [allRequiredChecked]);

  if (!open) return null;

  const toggleRequired = (key: TermsKey, value: boolean) => {
    setChecked((prev) => ({ ...prev, [key]: value }));
  };

  const toggleExpanded = (key: TermsKey) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="terms-modal" aria-hidden="false">
      <button type="button" className="terms-modal__backdrop" aria-label="닫기" onClick={onClose} />
      <div
        className="terms-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-modal-title"
        aria-describedby="terms-modal-desc"
      >
        <p className="signup-modal__eyebrow">필수 약관</p>
        <h2 className="terms-modal__title" id="terms-modal-title">
          회원 약관 동의
        </h2>
        <p className="terms-modal__desc" id="terms-modal-desc">
          불판녹취속기사무소 서비스 이용을 위하여 필수 약관 동의 확인이 필요합니다.
        </p>

        <div className="terms-list">
          <label className="terms-row terms-row--all">
            <input
              type="checkbox"
              className="terms-check"
              checked={agreeAll}
              onChange={(event) => {
                const next = event.target.checked;
                setAgreeAll(next);
                setChecked({ service: next, privacy: next, collection: next });
              }}
            />
            <span className="terms-row__label">전체동의</span>
          </label>

          <div className="terms-item">
            <label className="terms-row">
              <input
                type="checkbox"
                className="terms-check terms-required"
                checked={checked.service}
                onChange={(event) => toggleRequired("service", event.target.checked)}
              />
              <span className="terms-row__label">(필수) 서비스 이용약관</span>
            </label>
            <button
              type="button"
              className={`terms-toggle${expanded.service ? " is-open" : ""}`}
              aria-expanded={expanded.service}
              aria-controls="terms-body-service"
              onClick={() => toggleExpanded("service")}
            >
              <span className="sr-only">서비스 이용약관 보기</span>
            </button>
            {!expanded.service ? null : (
              <div
                className="terms-body terms-body--long"
                id="terms-body-service"
                dangerouslySetInnerHTML={{ __html: serviceTermsHtml }}
              />
            )}
          </div>

          <div className="terms-item">
            <label className="terms-row">
              <input
                type="checkbox"
                className="terms-check terms-required"
                checked={checked.privacy}
                onChange={(event) => toggleRequired("privacy", event.target.checked)}
              />
              <span className="terms-row__label">(필수) 개인정보처리방침</span>
            </label>
            <button
              type="button"
              className={`terms-toggle${expanded.privacy ? " is-open" : ""}`}
              aria-expanded={expanded.privacy}
              aria-controls="terms-body-privacy"
              onClick={() => toggleExpanded("privacy")}
            >
              <span className="sr-only">개인정보처리방침 보기</span>
            </button>
            {!expanded.privacy ? null : (
              <div className="terms-body" id="terms-body-privacy">
                <p>
                  수집 항목: 이름, 이메일, 휴대폰 번호 등. 이용 목적: 회원 식별, 녹취 업로드·
                  결과 확인, 고객 지원. 보관 기간: 관련 법령 및 서비스 이용 종료 시까지.
                </p>
              </div>
            )}
          </div>

          <div className="terms-item">
            <label className="terms-row">
              <input
                type="checkbox"
                className="terms-check terms-required"
                checked={checked.collection}
                onChange={(event) => toggleRequired("collection", event.target.checked)}
              />
              <span className="terms-row__label">(필수) 개인정보수집이용동의</span>
            </label>
            <button
              type="button"
              className={`terms-toggle${expanded.collection ? " is-open" : ""}`}
              aria-expanded={expanded.collection}
              aria-controls="terms-body-collection"
              onClick={() => toggleExpanded("collection")}
            >
              <span className="sr-only">개인정보수집이용동의 보기</span>
            </button>
            {!expanded.collection ? null : (
              <div className="terms-body" id="terms-body-collection">
                <p>
                  일반 회원가입 및 본인 확인, 녹취 서비스 이용을 위해 개인정보를 수집·이용합니다.
                  동의를 거부할 수 있으나, 거부 시 회원가입 및 서비스 이용이 제한될 수 있습니다.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="terms-modal__actions">
          <button
            type="button"
            className="terms-btn terms-btn--primary"
            disabled={!allRequiredChecked}
            onClick={onNext}
          >
            다음
          </button>
          <button type="button" className="terms-btn terms-btn--ghost" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

function SignupModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [emailHint, setEmailHint] = useState<{ message: string; ok: boolean } | null>(null);
  const [error, setError] = useState("");
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setPassword("");
    setPasswordConfirm("");
    setShowPassword(false);
    setShowPasswordConfirm(false);
    setEmailHint(null);
    setError("");
  }, [open]);

  if (!open) return null;

  const handleCheckEmail = async () => {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      setEmailHint({ message: "올바른 이메일 형식이 아닙니다.", ok: false });
      return;
    }
    setCheckingEmail(true);
    try {
      const result = await checkEmailAvailability(normalized);
      setEmailHint({ message: result.message, ok: result.ok });
    } catch {
      setEmailHint({ message: "서버 연결에 실패했습니다.", ok: false });
    } finally {
      setCheckingEmail(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const trimmedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      setError("이름을 입력해 주세요.");
      return;
    }
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError("올바른 이메일 형식이 아닙니다.");
      return;
    }
    if (!PASSWORD_PATTERN.test(password)) {
      setError("비밀번호는 영문, 숫자, 특수문자(#?!@$%^&*-) 포함 8~16자리여야 합니다.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await signupMember({
        name: trimmedName,
        email: normalizedEmail,
        password,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      redirectAfterSignup(result.token);
    } catch {
      setError("서버 연결에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="terms-modal signup-modal" aria-hidden="false">
      <button type="button" className="terms-modal__backdrop" aria-label="닫기" onClick={onClose} />
      <div
        className="terms-modal__panel signup-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signup-modal-title"
        aria-describedby="signup-modal-desc"
      >
        <button type="button" className="modal-close-btn" aria-label="닫기" onClick={onClose}>
          ×
        </button>
        <p className="signup-modal__eyebrow">회원 가입</p>
        <h2 className="terms-modal__title" id="signup-modal-title">
          회원가입
        </h2>
        <p className="terms-modal__desc" id="signup-modal-desc">
          불판녹취속기사무소
        </p>

        <form className="signup-form" noValidate onSubmit={handleSubmit}>
          <label className="signup-field">
            <input
              type="text"
              name="name"
              placeholder="이름을 입력해 주세요."
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              type="button"
              className="signup-clear"
              aria-label="이름 지우기"
              onClick={() => setName("")}
            >
              ×
            </button>
          </label>

          <div className="signup-split">
            <label className="signup-field signup-field--grow">
              <input
                type="email"
                name="email"
                placeholder="이메일을 입력해 주세요."
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button
                type="button"
                className="signup-clear"
                aria-label="이메일 지우기"
                onClick={() => setEmail("")}
              >
                ×
              </button>
            </label>
            <button
              type="button"
              className="signup-side-btn"
              disabled={checkingEmail}
              onClick={() => void handleCheckEmail()}
            >
              중복확인
            </button>
          </div>
          {emailHint ? (
            <p className={`signup-hint signup-hint--${emailHint.ok ? "ok" : "error"}`}>
              {emailHint.message}
            </p>
          ) : null}

          <label className="signup-field">
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              placeholder="비밀번호"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="signup-toggle-pw"
              aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
              onClick={() => setShowPassword((prev) => !prev)}
            >
              👁
            </button>
          </label>

          <label className="signup-field">
            <input
              type={showPasswordConfirm ? "text" : "password"}
              name="password_confirm"
              placeholder="비밀번호 확인"
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
            />
            <button
              type="button"
              className="signup-toggle-pw"
              aria-label={showPasswordConfirm ? "비밀번호 확인 숨기기" : "비밀번호 확인 표시"}
              onClick={() => setShowPasswordConfirm((prev) => !prev)}
            >
              👁
            </button>
          </label>
          <p className="signup-rule">✓ 영문, 숫자, 특수문자 (#?!@$%^&*-) 포함 8~16자리</p>

          <div className="signup-identity" aria-label="본인인증">
            <button type="button" className="signup-side-btn" disabled>
              본인인증
            </button>
          </div>

          {error ? <p className="signup-error">{error}</p> : null}

          <div className="terms-modal__actions signup-modal__actions">
            <button type="submit" className="terms-btn terms-btn--primary" disabled={submitting}>
              가입하기
            </button>
            <button type="button" className="terms-btn terms-btn--ghost" onClick={onClose}>
              취소
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SignupFlowProvider({ children }: { children: ReactNode }) {
  const [termsOpen, setTermsOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  const modalOpen = termsOpen || signupOpen;
  useBodyScrollLock(modalOpen);

  const closeAll = useCallback(() => {
    setTermsOpen(false);
    setSignupOpen(false);
  }, []);

  const openSignupFlow = useCallback(() => {
    setSignupOpen(false);
    setTermsOpen(true);
  }, []);

  useEffect(() => {
    if (!shouldAutoOpenSignupFlow()) return;
    clearSignupAutoOpenParam();
    openSignupFlow();
  }, [openSignupFlow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!termsOpen && !signupOpen)) return;
      closeAll();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [termsOpen, signupOpen, closeAll]);

  const contextValue = useMemo(() => ({ openSignupFlow }), [openSignupFlow]);

  return (
    <SignupFlowContext.Provider value={contextValue}>
      {children}
      <TermsModal
        open={termsOpen}
        onClose={closeAll}
        onNext={() => {
          setTermsOpen(false);
          setSignupOpen(true);
        }}
      />
      <SignupModal open={signupOpen} onClose={closeAll} />
    </SignupFlowContext.Provider>
  );
}

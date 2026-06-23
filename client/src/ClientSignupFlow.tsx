import { useCallback, useEffect, useState, type FormEvent } from "react";
import * as PortOne from "@portone/browser-sdk/v2";
import {
  EMAIL_PATTERN,
  PASSWORD_PATTERN,
  checkEmailAvailability,
  fetchPortOnePublicConfig,
  lookupMemberIdentityVerification,
  signupMember,
  type MemberProfile,
} from "./api";
import {
  createIdentityVerificationId,
  formatVerifiedPhone,
} from "./identityVerification";
import "./styles/signup-modal.css";

type TermsKey = "service" | "privacy" | "collection";

const REQUIRED_TERMS: TermsKey[] = ["service", "privacy", "collection"];
const IDENTITY_VERIFICATION_HINT = "안전한 의뢰를 위해 본인인증를 완료해주세요";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: (member: MemberProfile) => void;
  initialIdentityVerificationId?: string | null;
  onIdentityVerificationHandled?: () => void;
};

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
    '<p class="terms-loading">약관을 불러오는 중…</p>',
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
        aria-labelledby="client-terms-modal-title"
        aria-describedby="client-terms-modal-desc"
      >
        <p className="signup-modal__eyebrow">필수 약관</p>
        <h2 className="terms-modal__title" id="client-terms-modal-title">
          회원 약관 동의
        </h2>
        <p className="terms-modal__desc" id="client-terms-modal-desc">
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
              aria-controls="client-terms-body-service"
              onClick={() => toggleExpanded("service")}
            >
              <span className="sr-only">서비스 이용약관 보기</span>
            </button>
            {!expanded.service ? null : (
              <div
                className="terms-body terms-body--long"
                id="client-terms-body-service"
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
              aria-controls="client-terms-body-privacy"
              onClick={() => toggleExpanded("privacy")}
            >
              <span className="sr-only">개인정보처리방침 보기</span>
            </button>
            {!expanded.privacy ? null : (
              <div className="terms-body terms-body--long" id="client-terms-body-privacy">
                <h4 className="terms-doc-title">개인정보처리방침</h4>
                <p>
                  불판녹취속기는 회원 식별, 본인확인, 상담, 견적 안내, 의뢰 접수,
                  결제 확인, 세금계산서 또는 영수증 발급, 녹취록 작성, 결과물 납품,
                  고객 응대, 부정 이용 방지, 분쟁 대응을 위하여 필요한 개인정보를
                  처리할 수 있습니다.
                </p>
                <p>
                  수집될 수 있는 개인정보 항목은 이름, 연락처, 이메일, 비밀번호,
                  회사명 또는 소속, 결제정보, 서비스 이용기록, 접속기록, IP주소,
                  쿠키, 업로드 파일명, 의뢰 내용, 제출처, 요청사항, 상담 내용 등입니다.
                </p>
                <p>
                  개인정보는 회원 탈퇴 시 또는 수집·이용 목적이 달성된 때까지 보관됩니다.
                  다만 결제기록, 거래기록, 소비자 분쟁 처리기록 등 법령에 따라 보관이
                  필요한 정보는 해당 법령에서 정한 기간 동안 보관될 수 있습니다.
                </p>
                <p>
                  불판녹취속기는 원활한 서비스 제공을 위하여 필요한 범위에서 속기사,
                  검수자, 결제대행사, 문자·알림톡 발송업체, 클라우드 저장업체,
                  서버 관리업체 등에게 업무를 위탁할 수 있습니다.
                </p>
                <p>
                  위탁되는 정보는 서비스 수행에 필요한 최소한의 정보로 제한되며,
                  위탁받은 업체 또는 작업자는 업무 목적 외로 개인정보를 이용할 수 없습니다.
                </p>
                <p>
                  불판녹취속기는 개인정보 보호를 위하여 접근 권한 관리, 자료 보안,
                  비밀유지, 파일 삭제 등 필요한 보호조치를 시행합니다.
                </p>
                <p>
                  불판녹취속기는 회원의 동의를 받은 경우 이벤트, 할인 혜택, 재주문 혜택,
                  추천인 혜택, 서비스 안내, 카카오톡 채널 안내 등 광고성 정보를 문자,
                  카카오 알림톡, 이메일 등의 방법으로 발송할 수 있습니다.
                </p>
                <p>
                  불판녹취속기는 회원이 명시적으로 수신거부 의사를 표시한 경우
                  광고성 정보를 발송하지 않습니다.
                </p>
                <p>
                  회원은 언제든지 문자 수신거부, 이메일 수신거부, 카카오톡 채널 차단,
                  고객센터 요청 등의 방법으로 광고성 정보 수신 동의를 철회할 수 있습니다.
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
              aria-controls="client-terms-body-collection"
              onClick={() => toggleExpanded("collection")}
            >
              <span className="sr-only">개인정보수집이용동의 보기</span>
            </button>
            {!expanded.collection ? null : (
              <div className="terms-body terms-body--long" id="client-terms-body-collection">
                <h4 className="terms-doc-title">개인정보 수집·이용 동의</h4>
                <p>
                  불판녹취속기는 녹취록 작성 및 검수를 위하여 회원이 업로드하거나
                  제공한 음성파일, 영상파일, 녹음 내용, 참고자료, 구간 요청사항,
                  사건 관련 메모를 처리할 수 있습니다.
                </p>
                <p>
                  음성·영상파일에는 이름, 연락처, 주소, 가족관계, 사건 내용,
                  분쟁 내용, 금융거래 내용, 건강정보 등 개인정보 또는 민감하거나
                  사적인 정보가 포함될 수 있습니다.
                </p>
                <p>
                  회원은 불판녹취속기에 제공하는 음성파일, 영상파일, 녹음자료,
                  참고자료가 개인정보보호법, 통신비밀보호법 등 관련 법령에 위반되지
                  않는 적법한 자료임을 확인합니다.
                </p>
                <p>
                  회원은 해당 자료를 수집·이용·제공할 적법한 권한이 있으며,
                  타인의 개인정보, 음성, 대화 내용, 사건 자료 등이 포함된 경우
                  관련 법령상 필요한 동의, 고지, 안내, 비식별 처리, 익명 처리 등
                  필요한 조치를 하였음을 확인합니다.
                </p>
                <p>
                  회원이 관련 법령상 필요한 동의, 고지, 안내 또는 보호조치를 하지
                  않음으로 인하여 발생하는 민원, 분쟁, 손해배상, 형사책임,
                  행정처분 등은 회원 본인의 책임으로 합니다.
                </p>
                <p>
                  불판녹취속기는 회원이 제공한 자료의 적법성, 수집 경위,
                  제3자 동의 여부, 제공 권한 여부를 별도로 보증하지 않으며,
                  회사의 고의 또는 중과실이 없는 한 회원이 필요한 조치를 하지 않아
                  발생한 손해에 대하여 책임을 부담하지 않습니다.
                </p>
                <p>
                  녹취록 결과물은 음성파일의 품질, 녹음 환경, 발화자의 발음,
                  말 빠르기, 사투리, 배경소음, 통화 품질, 중복 발화 여부에 따라
                  일부 청취 불가 또는 불명확 표시가 발생할 수 있습니다.
                </p>
                <p>
                  불판녹취속기는 가능한 범위에서 정확한 청취와 검수를 진행하나,
                  음성 자체가 불명확한 부분에 대하여 100% 정확성을 보증하지 않습니다.
                </p>
                <p>
                  불판녹취속기는 서비스 제공, 수정 요청, 재다운로드, 고객 응대,
                  분쟁 대응을 위하여 회원이 제공한 음성파일, 영상파일, 참고자료 및
                  완성된 결과물을 일정 기간 보관할 수 있습니다.
                </p>
                <p>
                  기본 보관기간은 납품 완료일 또는 다운로드 가능일로부터 10일로 합니다.
                  보관기간이 지나면 파일과 결과물은 개인정보 보호 및 보안 관리를 위하여
                  복구 불가능한 방식으로 삭제될 수 있습니다.
                </p>
                <p>
                  회원은 납품받은 결과물을 보관기간 내에 다운로드하고 별도로 저장해야 하며,
                  보관기간 경과 후 삭제된 자료는 복구 또는 재납품이 불가능할 수 있습니다.
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
  onSuccess,
  initialIdentityVerificationId,
  onIdentityVerificationHandled,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (member: MemberProfile) => void;
  initialIdentityVerificationId?: string | null;
  onIdentityVerificationHandled?: () => void;
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
  const [verifyingIdentity, setVerifyingIdentity] = useState(false);
  const [identityRequired, setIdentityRequired] = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [identityVerificationId, setIdentityVerificationId] = useState("");

  useEffect(() => {
    if (!open) return;
    void fetchPortOnePublicConfig()
      .then((config) => setIdentityRequired(Boolean(config.portoneIdentityEnabled)))
      .catch(() => setIdentityRequired(false));
  }, [open]);

  useEffect(() => {
    const pendingId = initialIdentityVerificationId;
    if (!open || !pendingId) return;

    setVerifyingIdentity(true);
    void lookupMemberIdentityVerification(pendingId)
      .then((verified) => {
        setIdentityVerificationId(pendingId);
        setVerifiedPhone(verified.phone ?? "");
        setName((current) => current.trim() || verified.name || "");
        setError("");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "본인인증 결과를 불러오지 못했습니다.");
      })
      .finally(() => {
        onIdentityVerificationHandled?.();
        setVerifyingIdentity(false);
      });
  }, [open, initialIdentityVerificationId, onIdentityVerificationHandled]);

  useEffect(() => {
    if (!open) return;
    if (initialIdentityVerificationId) return;
    setName("");
    setEmail("");
    setPassword("");
    setPasswordConfirm("");
    setShowPassword(false);
    setShowPasswordConfirm(false);
    setEmailHint(null);
    setError("");
    setVerifiedPhone("");
    setIdentityVerificationId("");
  }, [open, initialIdentityVerificationId]);

  if (!open) return null;

  const verifyIdentity = async () => {
    setError("");
    setVerifyingIdentity(true);
    try {
      const config = await fetchPortOnePublicConfig();
      if (!config.portoneIdentityEnabled || !config.portoneStoreId || !config.portoneIdentityChannelKey) {
        throw new Error("포트원 본인인증 설정이 아직 완료되지 않았습니다.");
      }
      const nextIdentityVerificationId = createIdentityVerificationId();
      const response = await PortOne.requestIdentityVerification({
        storeId: config.portoneStoreId,
        identityVerificationId: nextIdentityVerificationId,
        channelKey: config.portoneIdentityChannelKey,
        redirectUrl: window.location.href,
      });
      if (!response) return;
      if (response.code !== undefined) {
        throw new Error(response.message || "본인인증이 취소되었습니다.");
      }
      const verified = await lookupMemberIdentityVerification(nextIdentityVerificationId);
      setIdentityVerificationId(nextIdentityVerificationId);
      setVerifiedPhone(verified.phone ?? "");
      if (verified.name && !name.trim()) {
        setName(verified.name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "본인인증에 실패했습니다.");
    } finally {
      setVerifyingIdentity(false);
    }
  };

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
    if (identityRequired && (!verifiedPhone || !identityVerificationId)) {
      setError("회원가입 전에 본인인증을 완료해 주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const member = await signupMember({
        name: trimmedName,
        email: normalizedEmail,
        password,
        identityVerificationId: identityVerificationId || undefined,
      });
      onSuccess(member);
    } catch (err) {
      setError(err instanceof Error ? err.message : "회원가입에 실패했습니다.");
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
        aria-labelledby="client-signup-modal-title"
        aria-describedby="client-signup-modal-desc"
      >
        <button type="button" className="modal-close-btn" aria-label="닫기" onClick={onClose}>
          ×
        </button>
        <p className="signup-modal__eyebrow">회원 가입</p>
        <h2 className="terms-modal__title" id="client-signup-modal-title">
          회원가입
        </h2>
        <p className="terms-modal__desc" id="client-signup-modal-desc">
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
            <button
              type="button"
              className="signup-side-btn"
              disabled={verifyingIdentity || !identityRequired}
              onClick={() => void verifyIdentity()}
            >
              {verifyingIdentity ? "인증 중…" : verifiedPhone ? "재인증" : "본인인증"}
            </button>
          </div>
          {verifiedPhone ? (
            <p className="signup-hint signup-hint--ok">
              인증된 휴대폰: {formatVerifiedPhone(verifiedPhone)}
            </p>
          ) : identityRequired ? (
            <p className="signup-hint">{IDENTITY_VERIFICATION_HINT}</p>
          ) : null}

          {error ? <p className="signup-error">{error}</p> : null}

          <div className="terms-modal__actions signup-modal__actions">
            <button type="submit" className="terms-btn terms-btn--primary" disabled={submitting}>
              {submitting ? "가입 중…" : "가입하기"}
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

export default function ClientSignupFlow({
  open,
  onClose,
  onSuccess,
  initialIdentityVerificationId,
  onIdentityVerificationHandled,
}: Props) {
  const [termsOpen, setTermsOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  const modalOpen = open && (termsOpen || signupOpen);
  useBodyScrollLock(modalOpen);

  const closeAll = useCallback(() => {
    setTermsOpen(false);
    setSignupOpen(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      setTermsOpen(false);
      setSignupOpen(false);
      return;
    }
    if (initialIdentityVerificationId) {
      setTermsOpen(false);
      setSignupOpen(true);
      return;
    }
    setSignupOpen(false);
    setTermsOpen(true);
  }, [open, initialIdentityVerificationId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !modalOpen) return;
      closeAll();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, closeAll]);

  const handleSuccess = (member: MemberProfile) => {
    setTermsOpen(false);
    setSignupOpen(false);
    onSuccess(member);
  };

  if (!open) return null;

  return (
    <>
      <TermsModal
        open={termsOpen}
        onClose={closeAll}
        onNext={() => {
          setTermsOpen(false);
          setSignupOpen(true);
        }}
      />
      <SignupModal
        open={signupOpen}
        onClose={closeAll}
        onSuccess={handleSuccess}
        initialIdentityVerificationId={initialIdentityVerificationId}
        onIdentityVerificationHandled={onIdentityVerificationHandled}
      />
    </>
  );
}

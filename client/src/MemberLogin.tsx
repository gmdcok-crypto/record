import { useEffect, useState, type FormEvent } from "react";
import * as PortOne from "@portone/browser-sdk/v2";
import ClientSignupFlow from "./ClientSignupFlow";
import {
  fetchPortOnePublicConfig,
  loginMember,
  lookupMemberIdentityVerification,
  phoneSessionMember,
  type MemberProfile,
} from "./api";
import {
  clearPortOneIdentityVerificationIdFromUrl,
  createIdentityVerificationId,
  formatVerifiedPhone,
  readPortOneIdentityVerificationIdFromUrl,
} from "./identityVerification";
import "./styles/login.css";

type MemberLoginProps = {
  onSuccess: (member: MemberProfile) => void;
};

export default function MemberLogin({ onSuccess }: MemberLoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifyingIdentity, setVerifyingIdentity] = useState(false);
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [signupOpen, setSignupOpen] = useState(() => Boolean(readPortOneIdentityVerificationIdFromUrl()));
  const [pendingIdentityVerificationId, setPendingIdentityVerificationId] = useState<string | null>(() =>
    readPortOneIdentityVerificationIdFromUrl(),
  );

  useEffect(() => {
    const pendingId = pendingIdentityVerificationId;
    if (!pendingId || signupOpen) return;
    setVerifyingIdentity(true);
    void lookupMemberIdentityVerification(pendingId)
      .then(async (verified) => {
        setVerifiedPhone(verified.phone ?? "");
        const member = await phoneSessionMember({
          identityVerificationId: pendingId,
          name: verified.name ?? undefined,
        });
        clearPortOneIdentityVerificationIdFromUrl();
        setPendingIdentityVerificationId(null);
        onSuccess(member);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "본인인증 결과를 불러오지 못했습니다.");
      })
      .finally(() => setVerifyingIdentity(false));
  }, [pendingIdentityVerificationId, signupOpen, onSuccess]);

  const verifyIdentityLogin = async () => {
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
      setVerifiedPhone(verified.phone ?? "");
      const member = await phoneSessionMember({
        identityVerificationId: nextIdentityVerificationId,
        name: verified.name ?? undefined,
      });
      onSuccess(member);
    } catch (err) {
      setError(err instanceof Error ? err.message : "본인인증 로그인에 실패했습니다.");
    } finally {
      setVerifyingIdentity(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const member = await loginMember(email, password);
      onSuccess(member);
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="client-login bp-page">
        <div className="client-login__panel">
          <p className="client-login__eyebrow">불판녹취</p>
          <h1 className="client-login__title">로그인</h1>
          <p className="client-login__desc">휴대폰 본인인증으로 로그인하거나 가입하세요.</p>

          <button
            type="button"
            className="client-login__submit bp-button bp-button-primary"
            disabled={verifyingIdentity || submitting}
            onClick={() => void verifyIdentityLogin()}
          >
            {verifyingIdentity ? "인증 처리 중…" : "휴대폰 본인인증으로 시작"}
          </button>
          {verifiedPhone ? (
            <p className="client-login__footer">인증된 휴대폰: {formatVerifiedPhone(verifiedPhone)}</p>
          ) : null}

          {error ? <p className="client-login__error">{error}</p> : null}

          <p className="client-login__footer">
            아직 회원이 아니신가요?{" "}
            <button type="button" className="client-login__link" onClick={() => setSignupOpen(true)}>
              약관 동의 후 가입
            </button>
          </p>

          <p className="client-login__footer">
            <button
              type="button"
              className="client-login__link"
              onClick={() => setShowEmailLogin((prev) => !prev)}
            >
              {showEmailLogin ? "이메일 로그인 닫기" : "기존 이메일 계정으로 로그인"}
            </button>
          </p>

          {showEmailLogin ? (
            <form className="client-login__form" onSubmit={onSubmit}>
              <label className="client-login__field">
                <span className="client-login__label">이메일</span>
                <input
                  type="email"
                  className="client-login__input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  placeholder="이메일을 입력해 주세요"
                />
              </label>

              <label className="client-login__field">
                <span className="client-login__label">비밀번호</span>
                <input
                  type="password"
                  className="client-login__input"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  minLength={8}
                  placeholder="비밀번호"
                />
              </label>

              <button type="submit" className="client-login__submit bp-button bp-button-primary" disabled={submitting}>
                {submitting ? "로그인 중…" : "이메일 로그인"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <ClientSignupFlow
        open={signupOpen}
        onClose={() => setSignupOpen(false)}
        onSuccess={(member) => {
          setSignupOpen(false);
          onSuccess(member);
        }}
        initialIdentityVerificationId={pendingIdentityVerificationId}
        onIdentityVerificationHandled={() => {
          clearPortOneIdentityVerificationIdFromUrl();
          setPendingIdentityVerificationId(null);
        }}
      />
    </>
  );
}

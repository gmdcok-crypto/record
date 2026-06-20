import { useMemo, useState, type FormEvent } from "react";
import { loginMember, type MemberProfile } from "./api";
import "./styles/login.css";

type MemberLoginProps = {
  signupUrl: string;
  onSuccess: (member: MemberProfile) => void;
};

function buildIntroSignupUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("signup", "1");
    return url.toString();
  } catch {
    const trimmed = baseUrl.replace(/\/$/, "");
    return `${trimmed}?signup=1`;
  }
}

export default function MemberLogin({ signupUrl, onSuccess }: MemberLoginProps) {
  const introSignupUrl = useMemo(() => buildIntroSignupUrl(signupUrl), [signupUrl]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
    <div className="client-login">
      <div className="client-login__panel">
        <p className="client-login__eyebrow">의뢰인 녹취</p>
        <h1 className="client-login__title">로그인</h1>
        <p className="client-login__desc">가입한 이메일과 비밀번호로 로그인하세요.</p>

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

          {error ? <p className="client-login__error">{error}</p> : null}

          <button type="submit" className="client-login__submit" disabled={submitting}>
            {submitting ? "로그인 중…" : "로그인"}
          </button>
        </form>

        <p className="client-login__footer">
          아직 회원이 아니신가요?{" "}
          <a href={introSignupUrl} className="client-login__link">
            회원가입
          </a>
        </p>
      </div>
    </div>
  );
}

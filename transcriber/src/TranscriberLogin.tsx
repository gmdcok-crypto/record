import { useState, type FormEvent } from "react";
import { AuthShell } from "./AuthShell";
import { SignupError, SignupField } from "./SignupFields";
import { loginTranscriber, type TranscriberAuthProfile } from "./api";

type TranscriberLoginProps = {
  onSuccess: (transcriber: TranscriberAuthProfile) => void;
  onSignup: () => void;
};

export default function TranscriberLogin({ onSuccess, onSignup }: TranscriberLoginProps) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const transcriber = await loginTranscriber(loginId, password);
      onSuccess(transcriber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="로그인" desc="가입한 로그인 ID와 비밀번호로 로그인하세요.">
      <form className="grid gap-3" onSubmit={onSubmit}>
        <SignupField
          value={loginId}
          onChange={(event) => setLoginId(event.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 8))}
          onClear={() => setLoginId("")}
          placeholder="로그인 ID (영문·숫자 8자 이내)"
          autoComplete="username"
          required
          maxLength={8}
        />

        <SignupField
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="비밀번호"
          autoComplete="current-password"
          showPasswordToggle
          required
          minLength={8}
        />

        {error ? <SignupError>{error}</SignupError> : null}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-12 rounded-xl bg-sky-500 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "로그인 중…" : "로그인"}
        </button>
      </form>

      <p className="text-center text-sm text-slate-400">
        아직 계정이 없으신가요?{" "}
        <button type="button" onClick={onSignup} className="font-semibold text-sky-400 hover:text-sky-300">
          회원가입
        </button>
      </p>
    </AuthShell>
  );
}

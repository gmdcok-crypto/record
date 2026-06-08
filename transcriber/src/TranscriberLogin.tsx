import { useState, type FormEvent } from "react";
import { loginTranscriber, type TranscriberAuthProfile } from "./api";

type TranscriberLoginProps = {
  onSuccess: (transcriber: TranscriberAuthProfile) => void;
};

export default function TranscriberLogin({ onSuccess }: TranscriberLoginProps) {
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
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-8 text-slate-100">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <p className="text-sm font-semibold text-cyan-300">속기사 녹취</p>
        <h1 className="mt-1 text-2xl font-bold text-white">로그인</h1>
        <p className="mt-2 text-sm text-slate-400">관리자에게 안내받은 로그인 ID와 비밀번호를 입력하세요.</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">로그인 ID</span>
            <input
              type="text"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 8))}
              autoComplete="username"
              required
              minLength={8}
              maxLength={8}
              pattern="[A-Za-z0-9]{8}"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm tracking-[0.2em] text-white outline-none ring-cyan-500/0 transition focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
              placeholder="영문·숫자 8자"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              minLength={8}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none ring-cyan-500/0 transition focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
              placeholder="비밀번호"
            />
          </label>

          {error ? (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-cyan-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "로그인 중…" : "로그인"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-500">
          최초 이용 시 관리자에게 등록 요청 후 가입 절차를 진행해 주세요.
        </p>
      </div>
    </div>
  );
}

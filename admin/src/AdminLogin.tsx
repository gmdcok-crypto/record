import { useState, type FormEvent } from "react";

import { loginAdmin, type AdminProfile } from "./api";

type AdminLoginProps = {
  onSuccess: (admin: AdminProfile) => void;
};

export default function AdminLogin({ onSuccess }: AdminLoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const admin = await loginAdmin(email, password);
      onSuccess(admin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl">
        <div className="mb-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Bluecom Admin</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">관리자 로그인</h1>
          <p className="mt-2 text-sm text-slate-400">등급별 권한이 적용된 운영 콘솔입니다.</p>
        </div>

        <form className="grid gap-3" onSubmit={onSubmit}>
          <label className="grid gap-1.5 text-sm">
            <span className="text-slate-300">이메일</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none ring-cyan-500/30 focus:ring-2"
              placeholder="ops@bluecom.local"
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="text-slate-300">비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              minLength={8}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none ring-cyan-500/30 focus:ring-2"
              placeholder="비밀번호"
            />
          </label>

          {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 min-h-11 rounded-xl bg-cyan-500 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    </div>
  );
}

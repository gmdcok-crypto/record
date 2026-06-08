import { useState, type FormEvent } from "react";
import { checkTranscriberLoginId, signupTranscriber, type TranscriberAuthProfile } from "./api";

type TranscriberSignupProps = {
  onSuccess: (transcriber: TranscriberAuthProfile) => void;
  onLogin: () => void;
};

const inputClassName =
  "w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none ring-cyan-500/0 transition focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20";

function normalizeLoginId(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "").slice(0, 11);
}

function normalizeResidentId(value: string): string {
  return value.replace(/[^\d-]/g, "").slice(0, 14);
}

export default function TranscriberSignup({ onSuccess, onLogin }: TranscriberSignupProps) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [residentId, setResidentId] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [loginIdHint, setLoginIdHint] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const verifyLoginId = async (value: string) => {
    const normalized = normalizeLoginId(value);
    if (normalized.length !== 8) {
      setLoginIdHint("");
      return;
    }
    try {
      const available = await checkTranscriberLoginId(normalized);
      setLoginIdHint(available ? "사용 가능한 로그인 ID입니다." : "이미 사용 중인 로그인 ID입니다.");
    } catch {
      setLoginIdHint("");
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    const normalizedLoginId = normalizeLoginId(loginId);
    if (normalizedLoginId.length !== 8) {
      setError("로그인 ID는 영문·숫자 8자여야 합니다.");
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    if (!name.trim()) {
      setError("이름을 입력해 주세요.");
      return;
    }
    if (normalizePhone(phone).length < 10) {
      setError("휴대폰 번호를 올바르게 입력해 주세요.");
      return;
    }
    if (!residentId.trim()) {
      setError("주민등록번호를 입력해 주세요.");
      return;
    }
    if (!bankName.trim()) {
      setError("은행명을 입력해 주세요.");
      return;
    }
    if (!accountNumber.trim()) {
      setError("계좌번호를 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const available = await checkTranscriberLoginId(normalizedLoginId);
      if (!available) {
        setError("이미 사용 중인 로그인 ID입니다.");
        return;
      }
      const transcriber = await signupTranscriber({
        login_id: normalizedLoginId,
        password,
        name: name.trim(),
        phone: normalizePhone(phone),
        resident_id: residentId.trim(),
        bank_name: bankName.trim(),
        account_number: accountNumber.trim(),
      });
      onSuccess(transcriber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "회원가입에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-8 text-slate-100">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <p className="text-sm font-semibold text-violet-300">속기사 녹취</p>
        <h1 className="mt-1 text-2xl font-bold text-white">회원가입</h1>
        <p className="mt-2 text-sm text-slate-400">
          관리자에 사전 등록된 속기사만 가입할 수 있습니다. 휴대폰·주민등록번호가 관리자 정보와 일치해야 합니다.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              로그인 ID <span className="text-rose-400">*</span>
            </span>
            <input
              type="text"
              value={loginId}
              onChange={(event) => {
                const next = normalizeLoginId(event.target.value);
                setLoginId(next);
                setLoginIdHint("");
              }}
              onBlur={() => void verifyLoginId(loginId)}
              autoComplete="username"
              required
              minLength={8}
              maxLength={8}
              className={`${inputClassName} font-mono tracking-[0.2em]`}
              placeholder="영문·숫자 8자"
            />
            {loginIdHint ? (
              <p className={`mt-1.5 text-xs ${loginIdHint.includes("사용 가능") ? "text-emerald-300" : "text-amber-300"}`}>
                {loginIdHint}
              </p>
            ) : null}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">
                비밀번호 <span className="text-rose-400">*</span>
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                className={inputClassName}
                placeholder="8자 이상"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">
                비밀번호 확인 <span className="text-rose-400">*</span>
              </span>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                className={inputClassName}
                placeholder="비밀번호 재입력"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              이름 <span className="text-rose-400">*</span>
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
              className={inputClassName}
              placeholder="실명"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              휴대폰 <span className="text-rose-400">*</span>
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(normalizePhone(event.target.value))}
              autoComplete="tel"
              required
              className={inputClassName}
              placeholder="01012345678"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              주민등록번호 <span className="text-rose-400">*</span>
            </span>
            <input
              type="text"
              value={residentId}
              onChange={(event) => setResidentId(normalizeResidentId(event.target.value))}
              required
              className={inputClassName}
              placeholder="관리자 등록 정보와 동일하게"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">
                은행명 <span className="text-rose-400">*</span>
              </span>
              <input
                type="text"
                value={bankName}
                onChange={(event) => setBankName(event.target.value)}
                required
                className={inputClassName}
                placeholder="예: 국민은행"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">
                계좌번호 <span className="text-rose-400">*</span>
              </span>
              <input
                type="text"
                value={accountNumber}
                onChange={(event) => setAccountNumber(event.target.value.replace(/[^\d-]/g, ""))}
                required
                className={inputClassName}
                placeholder="- 없이 입력 가능"
              />
            </label>
          </div>

          {error ? (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-violet-500 py-3 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "가입 처리 중…" : "회원가입"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-400">
          이미 계정이 있으신가요?{" "}
          <button type="button" onClick={onLogin} className="font-semibold text-cyan-400 hover:text-cyan-300">
            로그인
          </button>
        </p>
      </div>
    </div>
  );
}

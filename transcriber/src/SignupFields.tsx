import { useState, type InputHTMLAttributes, type ReactNode } from "react";

const fieldClassName =
  "w-full min-h-12 rounded-xl border border-slate-400/20 bg-slate-900/70 px-4 pr-10 text-[0.95rem] text-slate-50 placeholder:text-slate-500 focus:border-sky-400/65 focus:outline-none focus:ring-[3px] focus:ring-sky-400/15";

type SignupFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  onClear?: () => void;
  showPasswordToggle?: boolean;
};

export function SignupField({ onClear, showPasswordToggle, type = "text", ...props }: SignupFieldProps) {
  const [visible, setVisible] = useState(false);
  const inputType = showPasswordToggle ? (visible ? "text" : "password") : type;

  return (
    <label className="relative block">
      <input {...props} type={inputType} className={fieldClassName} />
      {onClear && props.value ? (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:text-slate-200"
          aria-label="입력 지우기"
        >
          ×
        </button>
      ) : null}
      {showPasswordToggle ? (
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:text-slate-200"
          aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
        >
          {visible ? "🙈" : "👁"}
        </button>
      ) : null}
    </label>
  );
}

export function SignupSplit({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">{children}</div>;
}

export function SignupSideButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-12 whitespace-nowrap rounded-xl bg-slate-500/45 px-3.5 text-[0.82rem] font-semibold text-slate-50 transition hover:bg-slate-500/60 disabled:cursor-not-allowed disabled:opacity-55"
    >
      {children}
    </button>
  );
}

export function SignupHint({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "error" }) {
  const toneClass =
    tone === "ok" ? "text-green-400" : tone === "error" ? "text-red-400" : "text-slate-400";
  return <p className={`-mt-1 text-[0.82rem] ${toneClass}`}>{children}</p>;
}

export function SignupRule({ children }: { children: ReactNode }) {
  return <p className="-mt-1 text-[0.82rem] text-sky-400">{children}</p>;
}

export function SignupError({ children }: { children: ReactNode }) {
  return <p className="text-[0.86rem] text-red-400">{children}</p>;
}

export function SignupActions({
  submitLabel,
  submitting,
  onCancel,
}: {
  submitLabel: string;
  submitting?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="grid gap-2 pt-1">
      <button
        type="submit"
        disabled={submitting}
        className="min-h-12 rounded-xl bg-sky-500 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "처리 중…" : submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-12 rounded-xl border border-slate-400/20 bg-transparent text-sm font-semibold text-slate-300 transition hover:bg-white/5"
      >
        취소
      </button>
    </div>
  );
}

export function PhoneVerifyPreview() {
  return (
    <div className="grid gap-3 rounded-xl border border-dashed border-slate-400/30 bg-slate-900/35 p-3.5">
      <p className="m-0 text-[0.84rem] font-semibold text-slate-400">
        본인인증 (통신사)
        <span className="ml-1.5 rounded-full bg-sky-400/15 px-2 py-0.5 text-[0.72rem] font-semibold text-sky-300">
          추후 연동
        </span>
      </p>
      <SignupSplit>
        <SignupField value="" placeholder="'-'를 제외하고 입력" disabled />
        <SignupSideButton disabled>인증번호받기</SignupSideButton>
      </SignupSplit>
      <SignupField value="" placeholder="인증번호 6자리" disabled />
      <p className="m-0 text-[0.78rem] text-slate-500">
        전화 인증은 추후 오픈 예정입니다. 현재는 아래 연락처 정보로 가입합니다.
      </p>
    </div>
  );
}

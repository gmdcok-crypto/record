import { useState, type InputHTMLAttributes, type ReactNode } from "react";

const fieldClassName =
  "esl-field w-full min-h-12 border px-4 pr-10 text-[0.95rem] placeholder:text-[#9aa3b2] focus:outline-none";

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
          className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--esl-muted)] hover:text-[var(--esl-text)]"
          aria-label="입력 지우기"
        >
          ×
        </button>
      ) : null}
      {showPasswordToggle ? (
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--esl-muted)] hover:text-[var(--esl-text)]"
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
      className="min-h-12 whitespace-nowrap border px-3.5 text-[0.82rem] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55"
    >
      {children}
    </button>
  );
}

export function SignupHint({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "error" }) {
  const toneClass =
    tone === "ok" ? "text-emerald-700" : tone === "error" ? "text-red-600" : "text-[var(--esl-muted)]";
  return <p className={`-mt-1 text-[0.82rem] ${toneClass}`}>{children}</p>;
}

export function SignupRule({ children }: { children: ReactNode }) {
  return <p className="-mt-1 text-[0.82rem] text-[var(--esl-navy-mid)]">{children}</p>;
}

export function SignupError({ children }: { children: ReactNode }) {
  return <p className="text-[0.86rem] text-red-600">{children}</p>;
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
        className="min-h-12 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "처리 중…" : submitLabel}
      </button>
      <button type="button" onClick={onCancel} className="min-h-12 border bg-transparent text-sm font-semibold transition">
        취소
      </button>
    </div>
  );
}

export function PhoneVerifyPreview({
  verifiedPhone,
  verifying,
  onVerify,
}: {
  verifiedPhone?: string;
  verifying?: boolean;
  onVerify?: () => void;
}) {
  return (
    <div className="grid gap-3 rounded border border-dashed p-3.5">
      <p className="m-0 text-[0.84rem] font-semibold text-[var(--esl-muted)]">
        본인인증
        <span className="ml-1.5 rounded-full bg-[#eef3fa] px-2 py-0.5 text-[0.72rem] font-semibold text-[var(--esl-navy-mid)]">
          가입 전 필수
        </span>
      </p>
      <SignupSplit>
        <SignupField value={verifiedPhone ?? ""} placeholder="'-'를 제외하고 입력" disabled />
        <SignupSideButton disabled={verifying} onClick={onVerify}>
          {verifying ? "인증 중..." : verifiedPhone ? "재인증" : "본인인증"}
        </SignupSideButton>
      </SignupSplit>
      <SignupField value={verifiedPhone ? "인증 완료" : ""} placeholder="인증 결과가 여기에 반영됩니다" disabled />
      <p className="m-0 text-[0.78rem] text-[var(--esl-muted)]">
        회원가입 전 포트원 본인인증을 완료해 주세요. 가입 후에는 개인정보 설정에서 다시 인증할 수 있습니다.
      </p>
    </div>
  );
}

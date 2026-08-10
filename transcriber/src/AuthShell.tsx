import type { ReactNode } from "react";

type AuthShellProps = {
  title: string;
  desc: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({ title, desc, eyebrow = "속기사 녹취", children, footer }: AuthShellProps) {
  return (
    <div className="esl-login flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="esl-login-card relative w-full max-w-[460px] max-h-[min(90vh,720px)] overflow-y-auto px-6 py-7">
        <p className="text-center text-sm font-semibold text-[var(--esl-navy-mid)]">{eyebrow}</p>
        <h1 className="mt-2 text-center text-[1.35rem] font-bold">{title}</h1>
        <p className="mt-3 text-center text-[0.92rem] leading-relaxed">{desc}</p>
        <div className="mt-6">{children}</div>
        {footer ? <div className="mt-5">{footer}</div> : null}
      </div>
    </div>
  );
}

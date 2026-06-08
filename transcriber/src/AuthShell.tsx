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
    <div className="flex min-h-dvh items-center justify-center bg-[#040810]/90 px-4 py-8">
      <div className="relative w-full max-w-[460px] max-h-[min(90vh,720px)] overflow-y-auto rounded-[20px] border border-slate-400/20 bg-gradient-to-b from-[#1a2332] to-[#121a27] px-6 py-7 shadow-[0_28px_80px_rgba(0,0,0,0.45)] text-[#e8eef7]">
        <p className="text-center text-sm font-semibold text-sky-300">{eyebrow}</p>
        <h1 className="mt-2 text-center text-[1.35rem] font-bold text-slate-50">{title}</h1>
        <p className="mt-3 text-center text-[0.92rem] leading-relaxed text-slate-400">{desc}</p>
        <div className="mt-6">{children}</div>
        {footer ? <div className="mt-5">{footer}</div> : null}
      </div>
    </div>
  );
}

export type ActionNoticeKind = "success" | "error" | "info";

export type ActionNotice = {
  kind: ActionNoticeKind;
  title?: string;
  message: string;
};

type Props = {
  notice: ActionNotice | null;
  onClose: () => void;
};

const DEFAULT_TITLES: Record<ActionNoticeKind, string> = {
  success: "완료",
  error: "오류",
  info: "안내",
};

export default function ActionNoticeModal({ notice, onClose }: Props) {
  if (!notice) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-slate-950 p-6 shadow-2xl">
        <h3
          className={`text-lg font-semibold ${
            notice.kind === "error" ? "text-rose-300" : "text-white"
          }`}
        >
          {notice.title ?? DEFAULT_TITLES[notice.kind]}
        </h3>
        <p className="mt-3 text-sm leading-6 text-slate-300">{notice.message}</p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
              notice.kind === "error"
                ? "bg-rose-600 text-white hover:bg-rose-500"
                : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
            }`}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

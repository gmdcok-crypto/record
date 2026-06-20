export type ActionNoticeKind = "success" | "error" | "info";

export type ActionNotice = {
  kind: ActionNoticeKind;
  title?: string;
  message: string;
};

type Props = {
  notice: ActionNotice | null;
  onClose: () => void;
  accent?: "cyan" | "violet" | "blue";
};

const DEFAULT_TITLES: Record<ActionNoticeKind, string> = {
  success: "완료",
  error: "오류",
  info: "안내",
};

export default function ActionNoticeModal({ notice, onClose, accent = "cyan" }: Props) {
  if (!notice) return null;

  const confirmClass =
    notice.kind === "error"
      ? "bg-rose-600 text-white hover:bg-rose-500"
      : accent === "violet"
        ? "bg-violet-600 text-white hover:bg-violet-500"
        : accent === "blue"
          ? "bg-blue-600 text-white hover:bg-blue-500"
          : "bg-brand-orange text-white hover:bg-brand-orange-dark";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-page/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-shell border border-line bg-white p-5 shadow-strong">
        <h3
          className={`text-lg font-semibold ${
            notice.kind === "error" ? "text-red-700" : "text-brand-navy"
          }`}
        >
          {notice.title ?? DEFAULT_TITLES[notice.kind]}
        </h3>
        <p className="mt-3 text-sm leading-6 text-brand-navy">{notice.message}</p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${confirmClass}`}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

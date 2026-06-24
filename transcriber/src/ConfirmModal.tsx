type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "계속",
  cancelLabel = "취소",
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-black/40"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <h3 id="confirm-modal-title" className="text-lg font-semibold text-white">
          {title}
        </h3>
        <p className="mt-3 text-sm leading-6 text-slate-300">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

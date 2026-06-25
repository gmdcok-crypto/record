type Props = {
  open: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

export default function UnsavedChangesModal({ open, saving = false, onSave, onDiscard, onCancel }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-page/75 px-4 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-shell border border-line bg-white p-5 shadow-strong"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
      >
        <h3 id="unsaved-changes-title" className="text-lg font-semibold text-brand-navy">
          수정 내용이 있습니다
        </h3>
        <p className="mt-3 text-sm leading-6 text-brand-navy">
          저장하지 않고 나가면 변경 사항이 사라집니다.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-brand-navy transition hover:bg-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-brand-navy transition hover:bg-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            저장 안 함
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-xl bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-orange-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

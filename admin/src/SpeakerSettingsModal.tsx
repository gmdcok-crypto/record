import { useEffect, useState } from "react";
import { speakerLabel } from "./api";

type Props = {
  open: boolean;
  speakerIds: string[];
  labels: Record<string, string>;
  onClose: () => void;
  onApply: (labels: Record<string, string>) => void;
};

export default function SpeakerSettingsModal({
  open,
  speakerIds,
  labels,
  onClose,
  onApply,
}: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const id of speakerIds) {
      next[id] = labels[id] ?? "";
    }
    setDraft(next);
  }, [open, speakerIds, labels]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-800">화자 설정</h2>
        <p className="mt-1 text-sm text-slate-500">
          표시 이름을 바꿉니다. 비워 두면 기본 이름(화자 1, 화자 2…)이 사용됩니다.
        </p>

        <div className="mt-4 max-h-64 space-y-3 overflow-y-auto">
          {speakerIds.length === 0 && (
            <p className="text-sm text-slate-400">인식된 화자가 없습니다.</p>
          )}
          {speakerIds.map((id) => (
            <label key={id} className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                {speakerLabel(id)} (ID: {id})
              </span>
              <input
                type="text"
                value={draft[id] ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [id]: e.target.value }))}
                placeholder={speakerLabel(id)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}

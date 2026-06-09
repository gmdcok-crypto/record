import { useEffect, useState } from "react";

import { speakerLabel } from "./api";

type Props = {
  open: boolean;
  speakerIds: string[];
  labels: Record<string, string>;
  onClose: () => void;
  onApply: (labels: Record<string, string>) => void;
  onAddSpeaker: () => void;
};

export default function SpeakerSettingsModal({
  open,
  speakerIds,
  labels,
  onClose,
  onApply,
  onAddSpeaker,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">화자 설정</h2>
            <p className="mt-1 text-sm text-slate-400">
              표시 이름을 바꾸거나 새 화자를 추가할 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddSpeaker}
            className="shrink-0 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
          >
            화자 추가
          </button>
        </div>

        <div className="mt-4 max-h-64 space-y-3 overflow-y-auto">
          {speakerIds.length === 0 && (
            <p className="text-sm text-slate-500">등록된 화자가 없습니다. 화자 추가를 눌러 주세요.</p>
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
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-blue-500"
              />
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}

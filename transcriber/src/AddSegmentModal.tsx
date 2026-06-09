import { useEffect, useState } from "react";

import { speakerLabel } from "./api";
import { parseDurationInput } from "./transcriptEditor";

export type AddSegmentDraft = {
  speaker: string;
  text: string;
  start_ms: number | null;
  end_ms: number | null;
};

type Props = {
  open: boolean;
  speakerIds: string[];
  speakerLabels: Record<string, string>;
  defaultSpeakerId?: string;
  onClose: () => void;
  onAdd: (draft: AddSegmentDraft) => void;
};

export default function AddSegmentModal({
  open,
  speakerIds,
  speakerLabels,
  defaultSpeakerId,
  onClose,
  onAdd,
}: Props) {
  const [speaker, setSpeaker] = useState("");
  const [text, setText] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSpeaker(defaultSpeakerId ?? speakerIds[0] ?? "");
    setText("");
    setStartTime("");
    setEndTime("");
    setError("");
  }, [open, defaultSpeakerId, speakerIds]);

  if (!open) return null;

  const handleSubmit = () => {
    const trimmedText = text.trim();
    if (!speaker) {
      setError("화자를 선택해 주세요.");
      return;
    }
    if (!trimmedText) {
      setError("대화 내용을 입력해 주세요.");
      return;
    }

    const start_ms = parseDurationInput(startTime);
    const end_ms = parseDurationInput(endTime);
    if (startTime.trim() && start_ms == null) {
      setError("시작 시간 형식이 올바르지 않습니다. 예: 01:23");
      return;
    }
    if (endTime.trim() && end_ms == null) {
      setError("종료 시간 형식이 올바르지 않습니다. 예: 01:45");
      return;
    }
    if (start_ms != null && end_ms != null && end_ms < start_ms) {
      setError("종료 시간은 시작 시간보다 같거나 늦어야 합니다.");
      return;
    }

    onAdd({
      speaker,
      text: trimmedText,
      start_ms,
      end_ms,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">대화 추가</h2>
        <p className="mt-1 text-sm text-slate-400">새 대화 구간을 녹취록에 추가합니다.</p>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">화자</span>
            <select
              value={speaker}
              onChange={(event) => setSpeaker(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-violet-500"
            >
              {speakerIds.map((id) => (
                <option key={id} value={id}>
                  {speakerLabel(id, speakerLabels)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">대화 내용</span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              placeholder="추가할 대화 내용을 입력하세요."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-6 text-slate-100 outline-none transition focus:border-violet-500"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">시작 시간</span>
              <input
                type="text"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                placeholder="00:00"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-violet-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">종료 시간</span>
              <input
                type="text"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                placeholder="00:00"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-violet-500"
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">시간은 `분:초`(예: 01:23) 형식으로 입력하세요. 비워 두면 시간 없이 추가됩니다.</p>

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
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
            onClick={handleSubmit}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
          >
            추가
          </button>
        </div>
      </div>
    </div>
  );
}

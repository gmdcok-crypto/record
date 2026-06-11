import { useEffect, useState } from "react";

import type { JobInquiryMessage } from "./api";

type Props = {
  title?: string;
  accent?: "cyan" | "violet" | "blue";
  jobId: string | null;
  loadMessages: (jobId: string) => Promise<JobInquiryMessage[]>;
  sendMessage: (jobId: string, message: string) => Promise<JobInquiryMessage>;
  emptyMessage?: string;
  sendLabel?: string;
  onError: (message: string) => void;
  refreshKey?: number;
};

function bubbleClass(role: string): string {
  if (role === "admin") {
    return "border-violet-500/30 bg-violet-500/10 text-violet-50";
  }
  return "border-slate-700 bg-slate-950 text-slate-100";
}

export default function ManagerInquiryPanel({
  title = "관리자 문의",
  accent = "violet",
  jobId,
  loadMessages,
  sendMessage,
  emptyMessage = "등록된 문의가 없습니다.",
  sendLabel = "문의 보내기",
  onError,
  refreshKey = 0,
}: Props) {
  const [messages, setMessages] = useState<JobInquiryMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!jobId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    loadMessages(jobId)
      .then(setMessages)
      .catch((err) => onError(err instanceof Error ? err.message : "문의 내역을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [jobId, loadMessages, onError, refreshKey]);

  const handleSend = async () => {
    if (!jobId) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const created = await sendMessage(jobId, text);
      setMessages((prev) => [...prev, created]);
      setDraft("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "문의 전송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  const titleColor =
    accent === "cyan" ? "text-cyan-300" : accent === "blue" ? "text-blue-300" : "text-violet-300";
  const buttonColor =
    accent === "cyan"
      ? "bg-cyan-600 hover:bg-cyan-500"
      : accent === "blue"
        ? "bg-blue-600 hover:bg-blue-500"
        : "bg-violet-600 hover:bg-violet-500";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80">
      <div className="border-b border-slate-800 px-4 py-3">
        <h3 className={`text-sm font-semibold ${titleColor}`}>{title}</h3>
        <p className="mt-1 text-xs text-slate-500">작업 관련 문의는 관리자에게만 전달됩니다.</p>
      </div>

      <div className="max-h-64 space-y-3 overflow-y-auto px-4 py-3">
        {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : null}
        {!loading && messages.length === 0 ? <p className="text-sm text-slate-500">{emptyMessage}</p> : null}
        {messages.map((message) => (
          <div key={message.id} className={`rounded-xl border px-3 py-2 ${bubbleClass(message.sender_role)}`}>
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="font-semibold">{message.sender_name}</span>
              <span className="text-slate-400">
                {message.created_at ? new Date(message.created_at).toLocaleString("ko-KR") : "-"}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.message}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-800 px-4 py-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder="관리자에게 전달할 내용을 입력하세요."
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-6 text-slate-100 outline-none transition focus:border-violet-500"
        />
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${buttonColor}`}
          >
            {sending ? "전송 중..." : sendLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

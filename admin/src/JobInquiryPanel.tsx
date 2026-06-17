import { useEffect, useState } from "react";

import type { JobInquiryMessage } from "./api";
import { formatKstDateTime } from "./formatKstDateTime";

type Props = {
  title: string;
  accent?: "cyan" | "violet";
  jobId: string | null;
  threadType: "client_admin" | "transcriber_admin";
  loadMessages: (jobId: string, threadType: "client_admin" | "transcriber_admin") => Promise<JobInquiryMessage[]>;
  sendMessage: (
    jobId: string,
    threadType: "client_admin" | "transcriber_admin",
    message: string,
  ) => Promise<JobInquiryMessage>;
  onError: (message: string) => void;
  refreshKey?: number;
};

function bubbleClass(role: string, accent: "cyan" | "violet"): string {
  if (role === "admin") {
    return accent === "violet"
      ? "border-violet-500/30 bg-violet-500/10 text-violet-50"
      : "border-cyan-500/30 bg-cyan-500/10 text-cyan-50";
  }
  return "border-white/10 bg-slate-950 text-slate-100";
}

export default function JobInquiryPanel({
  title,
  accent = "cyan",
  jobId,
  threadType,
  loadMessages,
  sendMessage,
  onError,
  refreshKey = 0,
}: Props) {
  const [messages, setMessages] = useState<JobInquiryMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!jobId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    loadMessages(jobId, threadType)
      .then(setMessages)
      .catch((err) => onError(err instanceof Error ? err.message : "문의 내역을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [jobId, threadType, loadMessages, onError, refreshKey]);

  const handleSend = async () => {
    if (!jobId) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const created = await sendMessage(jobId, threadType, text);
      setMessages((prev) => [...prev, created]);
      setDraft("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "전달 메시지 저장에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/50">
      <div className="border-b border-white/10 px-4 py-3">
        <h3 className={`text-sm font-semibold ${accent === "violet" ? "text-violet-300" : "text-cyan-300"}`}>{title}</h3>
      </div>
      <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
        {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : null}
        {!loading && messages.length === 0 ? <p className="text-sm text-slate-500">아직 등록된 대화가 없습니다.</p> : null}
        {messages.map((message) => (
          <div key={message.id} className={`rounded-xl border px-3 py-2 ${bubbleClass(message.sender_role, accent)}`}>
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="font-semibold">{message.sender_name}</span>
              <span className="text-slate-400">
                {message.created_at ? formatKstDateTime(message.created_at) : "-"}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.message}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 px-4 py-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder="상대방에게 전달할 메시지를 입력하세요."
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-6 text-slate-100 outline-none transition focus:border-cyan-500"
        />
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${
              accent === "violet" ? "bg-violet-600 hover:bg-violet-500" : "bg-cyan-600 hover:bg-cyan-500"
            }`}
          >
            {sending ? "전송 중..." : "관리자 답변 보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}

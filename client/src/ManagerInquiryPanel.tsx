import { useEffect, useState } from "react";

import type { JobInquiryMessage } from "./api";
import { formatKstDateTime } from "./formatKstDateTime";

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
    return "client-edit__bubble client-edit__bubble--admin";
  }
  return "client-edit__bubble client-edit__bubble--client";
}

export default function ManagerInquiryPanel({
  title = "관리자 문의",
  accent: _accent = "cyan",
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

  return (
    <div className="client-edit__panel">
      <div className="client-edit__panel-header">
        <h3 className="client-edit__panel-title">{title}</h3>
        <p className="client-edit__panel-desc">작업 관련 문의는 관리자에게만 전달됩니다.</p>
      </div>

      <div className="max-h-64 space-y-3 overflow-y-auto px-4 py-3">
        {loading ? <p className="text-sm text-[var(--bp-body)]">불러오는 중...</p> : null}
        {!loading && messages.length === 0 ? (
          <p className="text-sm text-[var(--bp-body)]">{emptyMessage}</p>
        ) : null}
        {messages.map((message) => (
          <div key={message.id} className={bubbleClass(message.sender_role)}>
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="font-semibold">{message.sender_name}</span>
              <span className="text-[var(--bp-body)]">
                {message.created_at ? formatKstDateTime(message.created_at) : "-"}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.message}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--bp-line)] px-4 py-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder="관리자에게 전달할 내용을 입력하세요."
          className="client-edit__textarea"
        />
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
            className="bp-button bp-button-primary"
          >
            {sending ? "전송 중..." : sendLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

import type { PushPermissionState } from "./pushNotificationPromptState";

type Props = {
  open: boolean;
  enabling: boolean;
  permission: PushPermissionState;
  onEnable: () => void;
  onDismiss: () => void;
};

export default function PushNotificationPrompt({
  open,
  enabling,
  permission,
  onEnable,
  onDismiss,
}: Props) {
  if (!open) return null;

  const denied = permission === "denied";

  return (
    <div
      className="push-prompt"
      role="dialog"
      aria-labelledby="push-prompt-title"
      aria-modal="true"
    >
      <div className="push-prompt__backdrop" aria-hidden="true" />
      <div className="push-prompt__card">
        <p className="push-prompt__eyebrow">알림 설정</p>
        <h2 className="push-prompt__title" id="push-prompt-title">
          {denied ? "브라우저 알림이 차단되어 있습니다" : "작업 알림을 켜 주세요"}
        </h2>
        {denied ? (
          <p className="push-prompt__desc">
            관리자 답변, PDF 전달, 상태 변경 알림을 받으려면 브라우저 설정에서 이 사이트의 알림을
            허용해 주세요. 허용 후 아래 <strong>다시 시도</strong>를 눌러 주세요.
          </p>
        ) : (
          <p className="push-prompt__desc">
            관리자 답변, PDF 전달, 작업 상태 변경을 놓치지 않도록 브라우저 알림을 허용해 주세요.
          </p>
        )}
        <ul className="push-prompt__list">
          <li>관리자 문의 답변</li>
          <li>녹취록 PDF 전달</li>
          <li>작업 상태 변경</li>
        </ul>
        <div className="push-prompt__actions">
          {!denied ? (
            <button
              type="button"
              className="push-prompt__btn push-prompt__btn--primary"
              disabled={enabling}
              onClick={onEnable}
            >
              {enabling ? "알림 설정 중…" : "알림 받기"}
            </button>
          ) : (
            <button
              type="button"
              className="push-prompt__btn push-prompt__btn--primary"
              disabled={enabling}
              onClick={onEnable}
            >
              {enabling ? "확인 중…" : "다시 시도"}
            </button>
          )}
          <button
            type="button"
            className="push-prompt__btn push-prompt__btn--ghost"
            disabled={enabling}
            onClick={onDismiss}
          >
            나중에
          </button>
        </div>
      </div>
    </div>
  );
}

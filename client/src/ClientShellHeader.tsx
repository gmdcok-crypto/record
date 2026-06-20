type Props = {
  memberName: string | null;
  guestLabel: string;
  enablingPush: boolean;
  showPushButton: boolean;
  onEnablePush: () => void;
  onLogout: () => void;
};

export default function ClientShellHeader({
  memberName,
  guestLabel,
  enablingPush,
  showPushButton,
  onEnablePush,
  onLogout,
}: Props) {
  return (
    <header className="client-shell__header">
      <div>
        <p className="client-shell__brand-eyebrow">불판녹취</p>
        <h1 className="client-shell__brand-title">{memberName ? `${memberName}님` : guestLabel}</h1>
      </div>
      <div className="client-shell__actions">
        {showPushButton ? (
          <button
            type="button"
            onClick={onEnablePush}
            disabled={enablingPush}
            className="bp-button bp-button-soft bp-button-compact disabled:opacity-50"
          >
            {enablingPush ? "알림 설정 중…" : "알림 받기"}
          </button>
        ) : null}
        <button type="button" onClick={onLogout} className="bp-button bp-button-outline bp-button-compact">
          로그아웃
        </button>
      </div>
    </header>
  );
}

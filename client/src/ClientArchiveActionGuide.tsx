export default function ClientArchiveActionGuide() {
  return (
    <div className="client-archive__working-notice" role="note">
      <span className="client-archive__working-notice-icon" aria-hidden="true">
        i
      </span>
      <p className="client-archive__working-notice-text">
        작업 중(작성 중) 상태에서는 작성이 진행되고 있어 현재 내용을 확인할 수 없습니다.
        <br />
        작성 중이 끝나고, 의뢰인 검토 단계가 되면{" "}
        <strong className="client-archive__working-notice-emphasis">확인 및 수정이 가능합니다.</strong>
      </p>
    </div>
  );
}

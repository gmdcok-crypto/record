type GuideAction = {
  title: string;
  desc: string;
  icon: string;
};

type GuideCard = {
  tone: "review" | "request" | "share";
  title: string;
  desc: string;
  headerIcon: string;
  actions: GuideAction[];
};

const GUIDE_CARDS: GuideCard[] = [
  {
    tone: "review",
    title: "수정 후 진행",
    desc: "수정할 내용이 있는 경우",
    headerIcon: "✏️",
    actions: [
      { icon: "📝", title: "수정 후 저장", desc: "변경 내용을 저장합니다" },
      { icon: "👤", title: "검토 요청", desc: "수정 완료 후 검토를 요청합니다" },
    ],
  },
  {
    tone: "request",
    title: "바로 요청",
    desc: "수정할 내용이 없는 경우",
    headerIcon: "💬",
    actions: [
      { icon: "📄", title: "녹취록 요청", desc: "최종 녹취록을 요청합니다" },
      { icon: "📕", title: "PDF 다운로드", desc: "최종 승인 후 제출용 PDF를 다운로드합니다" },
    ],
  },
  {
    tone: "share",
    title: "공유",
    desc: "필요할 때만 이용하세요",
    headerIcon: "🔗",
    actions: [
      { icon: "🔗", title: "공유 링크 만들기", desc: "다른 사람과 내용을 공유할 수 있는 링크를 생성합니다" },
    ],
  },
];

function GuideActionItem({ action, tone }: { action: GuideAction; tone: GuideCard["tone"] }) {
  return (
    <div className={`client-archive__guide-action client-archive__guide-action--${tone}`}>
      <span className="client-archive__guide-action-icon" aria-hidden="true">
        {action.icon}
      </span>
      <div className="client-archive__guide-action-text">
        <p className="client-archive__guide-action-title">{action.title}</p>
        <p className="client-archive__guide-action-desc">{action.desc}</p>
      </div>
      <span className="client-archive__guide-action-chevron" aria-hidden="true">
        ›
      </span>
    </div>
  );
}

export default function ClientArchiveActionGuide() {
  return (
    <div className="client-archive__guide-grid">
      {GUIDE_CARDS.map((card) => (
        <section key={card.title} className={`client-archive__guide-card client-archive__guide-card--${card.tone}`}>
          <header className="client-archive__guide-card-header">
            <span className="client-archive__guide-card-icon" aria-hidden="true">
              {card.headerIcon}
            </span>
            <div>
              <h3 className="client-archive__guide-card-title">{card.title}</h3>
              <p className="client-archive__guide-card-desc">{card.desc}</p>
            </div>
          </header>
          <div
            className={`client-archive__guide-actions${
              card.actions.length === 1 ? " client-archive__guide-actions--single" : ""
            }`}
          >
            {card.actions.map((action) => (
              <GuideActionItem key={action.title} action={action} tone={card.tone} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import logo from "./assets/width_1024.png";
import uploadIcon from "./assets/DesktopPinterestFormUnifiedV3/47762f3b57e28050c36f2dd2f70879f749dbfd75.png";
import selectIcon from "./assets/DesktopPinterestFormUnifiedV3/e3547b726ceb63cb05d0bbe146755cc2b188322d.png";
import resultIcon from "./assets/DesktopPinterestFormUnifiedV3/4964a99c420dfab8970e60b8334e9bbe757fb73e.png";
import audioIcon from "./assets/DesktopPinterestFormUnifiedV3/90f3f0201b9c0c09d3e2ce472bdee17041dcb571.png";
import estimateIcon from "./assets/DesktopPinterestFormUnifiedV3/9e05105179ea59d345958c137813038bf89b6b7c.png";
import paymentIcon from "./assets/DesktopPinterestFormUnifiedV3/47fb733560f74165fa55b2b5ef4acbe3677b6eac.png";
import nuanceIcon from "./assets/DesktopPinterestFormUnifiedV3/9dc9c7f75bcfd938f7d9cc4ccd92ea19bb89c509.png";
import contextIcon from "./assets/DesktopPinterestFormUnifiedV3/9de0954f6f4b0a1c3587b7f07a4451955864f788.png";
import sadIcon from "./assets/DesktopPinterestFormUnifiedV3/7431f57c1a63f2fdfa65c2585ea00f0e644cf432.png";
import mobileMascot from "./assets/MobilePinterestFormUnifiedV3/90d99f09138042927aebcbc452ca495efa019925.png";
import heroStoryBanner from "./assets/hero-story-banner.png";
import { SignupFlowProvider, useSignupFlow } from "./signup/SignupFlow";
import QuoteModal from "./quote/QuoteModal";
import { preloadChannelTalk, showChannelTalkMessenger } from "./lib/channelTalk";

const transcriptSamplePdf = "/assets/transcript-sample.pdf";

const navItems = [
  ["#service", "서비스 소개"],
  ["#features", "핵심 기능"],
  ["#process", "진행 방식"],
  ["#results", "결과물"]
];

const serviceCards = [
  { title: "모바일 원스탑", text: "방문 없이 파일 업로드부터 결과물 수령까지", dark: true },
  { title: "원본 음성 업로드", text: "휴대전화 녹음 파일이나 전달받은 음성을 안전하게 접수", dark: true },
  { title: "전문 속기사 작성", text: "화자와 문맥을 확인하며 원문 흐름에 맞게 정리", dark: false },
  { title: "AI 보조 점검", text: "이름, 숫자, 오타 가능성을 한 번 더 확인", dark: false },
  { title: "최종 검수 완료", text: "PDF 녹취록으로 화자 구분과 페이지 번호까지 정리", dark: false }
];

const featureCards = [
  {
    icon: uploadIcon,
    badge: "UPLOAD",
    title: "1분 만에 의뢰 시작",
    text: "회원가입과 복잡한 상담 없이 파일 업로드만으로 녹취 의뢰를 시작할 수 있습니다."
  },
  {
    icon: selectIcon,
    badge: "SELECT",
    title: "필요한 부분만 녹취",
    text: "전체 또는 원하는 구간을 선택하여 합리적인 비용으로 의뢰할 수 있습니다."
  },
  {
    icon: resultIcon,
    badge: "ONE STOP",
    title: "업로드부터 결과물까지",
    text: "파일 업로드, 구간 선택, 결제, 녹취록 수령 흐름을 온라인에서 간편하게 보여줍니다."
  }
];

const processSteps = [
  { icon: uploadIcon, title: "의뢰 이름 정하기", text: "사건명, 통화명처럼 나중에 찾기 쉬운 이름을 먼저 정합니다." },
  { icon: audioIcon, title: "음성 파일 올리기", text: "휴대전화 녹음 파일이나 전달받은 음성 파일을 선택합니다." },
  { icon: selectIcon, title: "녹취할 부분 선택", text: "전체 녹취 또는 필요한 구간만 선택해 의뢰 범위를 정합니다." },
  { icon: estimateIcon, title: "예상 금액 확인", text: "선택한 파일 길이와 구간 기준으로 결제 금액을 확인합니다." },
  { icon: paymentIcon, title: "결제 후 파일 보내기", text: "결제 완료 후 원본 음성 파일을 안전하게 전송합니다." }
];

const qualityCards = [
  { icon: contextIcon, label: "화자 구분", title: "누가 말했는지 정확하게 구분", dark: true },
  { icon: nuanceIcon, label: "전문 용어", title: "사투리, 사건, 회의 용어의 표기 일관성", dark: false },
  { icon: sadIcon, label: "대화 맥락", title: "앞뒤 흐름을 반영한 자연스러운 문장", dark: false }
];

function CtaButton({ className = "" }: { className?: string }) {
  const { openSignupFlow } = useSignupFlow();
  return (
    <button
      type="button"
      className={`cta-button ${className}`}
      onClick={openSignupFlow}
      aria-label="녹취록 의뢰하기"
    >
      녹취록 의뢰하기
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="section-label">{children}</p>;
}

function Header({
  onOpenQuote,
  onOpenChannelTalk,
}: {
  onOpenQuote: () => void;
  onOpenChannelTalk: () => void;
}) {
  return (
    <header className="site-header">
      <a className="brand" href="#service" aria-label="불판녹취 홈">
        <img src={logo} alt="불판녹취 로고" />
        <span>
          <strong>불판녹취속기사무소</strong>
          <small>속기사 직접 작성</small>
        </span>
      </a>
      <nav className="site-nav" aria-label="주요 섹션">
        {navItems.map(([href, label]) => (
          <a key={href} href={href}>{label}</a>
        ))}
      </nav>
      <div className="site-header-actions">
        <button type="button" className="header-ghost-btn" onClick={onOpenQuote}>
          무료견적
        </button>
        <button type="button" className="header-ghost-btn" onClick={onOpenChannelTalk}>
          상담문의
        </button>
        <CtaButton />
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" id="service">
      <div className="hero-copy">
        <span className="eyebrow">HOT SPEED 녹취 서비스</span>
        <h1>
          불판 녹취 속기사무소는
          <span>정확하고 빠르게</span>
          안전하게 구워드립니다.
        </h1>
        <p>
          15년 이상 경력의 전문 속기사가 직접 작성합니다. 화자 구분, 문맥 분석, 증거 활용까지 책임지는 녹취록을 제공합니다.
        </p>
        <div className="hero-actions">
          <CtaButton />
          <a className="secondary-button" href="#process">진행 방식 보기</a>
        </div>
        <div className="stat-row">
          <strong>50년+<span>누적 실무경력</span></strong>
          <strong>24H<span>초안 작성</span></strong>
          <strong>100%<span>인간 검수</span></strong>
        </div>
      </div>
      <div className="hero-card-stack" aria-label="서비스 진행 요약">
        {serviceCards.map((card, index) => (
          <article className={card.dark ? "hero-mini-card dark" : "hero-mini-card"} key={card.title}>
            <span>{index + 1}</span>
            <div>
              <h2>{card.title}</h2>
              <p>{card.text}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function HeroStoryBanner() {
  return (
    <section className="hero-story-banner" aria-label="음성에서 녹취록까지">
      <img
        src={heroStoryBanner}
        alt="마이크로 녹음된 음성이 불판 위에서 정리되어 만년필로 녹취록이 작성되는 과정을 보여주는 이미지"
      />
    </section>
  );
}

function About() {
  return (
    <section className="section about-section">
      <div className="copy-block">
        <SectionLabel>서비스 소개</SectionLabel>
        <h2>왜, 불판녹취인가?</h2>
        <p>
          불판은 충분히 달아올라야 제 역할을 합니다. 제대로 달아오른 불판만이 재료의 본질을 놓치지 않고 끝까지 책임 있게 익혀낼 수 있습니다.
        </p>
        <p>
          우리는 단순히 녹음된 말을 글자로 옮기는 곳이 아닙니다. 의뢰인이 맡긴 한 마디 한 마디를 필요한 순간 활용될 수 있는 기록으로 남기기 위해 노력합니다.
        </p>
      </div>
      <div className="principles">
        {["감사합니다", "경청합니다", "질문합니다"].map((item) => (
          <article key={item}>{item}</article>
        ))}
      </div>
    </section>
  );
}

function HotSpeed() {
  return (
    <section className="section white-section">
      <SectionLabel>서비스 소개</SectionLabel>
      <h2>급한 상황일수록 모바일로 더 빠르게, 중요한 녹취일수록 더 정확하게.</h2>
      <p className="section-lead">불판녹취는 단순 녹취 작성이 아니라 의뢰인의 상황을 이해하고 해결하는 것을 목표로 합니다.</p>
      <div className="hot-grid">
        <article>
          <span>NOISE</span>
          <h3>난청 음성 · 현장 녹음 검토</h3>
          <p>전화 통화는 물론 현장, 회의, 차량, 매장 녹음도 반복 청취와 문맥 분석으로 처리합니다.</p>
        </article>
        <article className="dark">
          <span>24H</span>
          <h3>24시간 이내 초안 작성</h3>
          <p>경찰 신고, 변호사 상담, 민사·형사 사건처럼 시간이 중요한 경우 빠르게 초안을 작성합니다.</p>
        </article>
        <article>
          <span>HUMAN</span>
          <h3>기계가 아닌 사람이 책임지는 녹취록</h3>
          <p>AI는 글을 만들 수 있지만 대화의 의도와 상황까지 책임지지는 못합니다.</p>
        </article>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="section white-section" id="features">
      <SectionLabel>핵심 기능</SectionLabel>
      <h2>모바일 회원가입과 동시에 빠르게 시작하는 핵심기능</h2>
      <p className="section-lead">파일 업로드부터 구간 선택, 결제, 녹취록 수령까지 온라인에서 간편하게 진행할 수 있습니다.</p>
      <div className="feature-grid">
        {featureCards.map((card) => (
          <article className="feature-card" key={card.title}>
            <span>{card.badge}</span>
            <h3>{card.title}</h3>
            <p>{card.text}</p>
            <img src={card.icon} alt="" />
          </article>
        ))}
      </div>
    </section>
  );
}

function Process() {
  return (
    <section className="section process-section" id="process">
      <SectionLabel>진행 방식</SectionLabel>
      <h2>업로드부터 결제까지 다섯 단계로 진행됩니다</h2>
      <div className="process-grid">
        {processSteps.map((step, index) => (
          <article className="process-card" key={step.title}>
            <div className="process-icon">
              <img src={step.icon} alt="" />
              <span>{index + 1}</span>
            </div>
            <strong>{String(index + 1).padStart(2, "0")} {step.title}</strong>
            <p>{step.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Quality() {
  return (
    <section className="section quality-section">
      <div className="copy-block">
        <SectionLabel>품질 기준</SectionLabel>
        <h2>왜 사람이 직접 작성해야 할까요?</h2>
        <p>같은 말도 화자와 상황에 따라 증거의 의미가 달라집니다. 법률 분쟁, 민원, 계약, 상담 녹취는 화자 구분과 전후 맥락, 전문 용어까지 반영해야 합니다.</p>
      </div>
      <div className="quality-grid">
        {qualityCards.map((card) => (
          <article className={card.dark ? "quality-card dark" : "quality-card"} key={card.label}>
            <span>{card.label}</span>
            <strong>{card.title}</strong>
            <img src={card.icon} alt="" />
          </article>
        ))}
      </div>
    </section>
  );
}

function Results() {
  return (
    <section className="results-section" id="results">
      <div>
        <SectionLabel>결과물</SectionLabel>
        <h2>받는 즉시 활용할 수 있는 문서형 녹취록</h2>
        <p>화자 구분, 문서형 편집, 확인 문구와 페이지 번호를 포함한 PDF로 제공합니다.</p>
        <ul>
          {["화자 구분", "문맥 반영", "PDF 제공", "증거 제출 가능"].map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="pdf-sample" aria-label="PDF 결과물 예시">
        <div className="pdf-sample__toolbar">
          <span className="pdf-sample__label">녹취록 출력 예시</span>
          <a
            className="pdf-sample__open"
            href={transcriptSamplePdf}
            target="_blank"
            rel="noreferrer"
          >
            PDF 전체 보기
          </a>
        </div>
        <iframe
          className="pdf-sample__frame"
          src={`${transcriptSamplePdf}#view=FitH`}
          title="녹취록 PDF 출력 예시"
        />
      </div>
    </section>
  );
}

function Request() {
  const { openSignupFlow } = useSignupFlow();
  return (
    <section className="request-section" id="request">
      <img src={mobileMascot} alt="" />
      <h2>중요한 통화, 정확한 녹취록이 필요하신가요?</h2>
      <p>예상 비용을 먼저 안내하며 상담 후 진행 여부를 결정하셔도 됩니다.</p>
      <button type="button" className="cta-button large" onClick={openSignupFlow}>
        녹취록 의뢰하기
      </button>
    </section>
  );
}

function Footer({
  onOpenQuote,
  onOpenChannelTalk,
}: {
  onOpenQuote: () => void;
  onOpenChannelTalk: () => void;
}) {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <img src={logo} alt="" />
        <div>
          <strong>불판녹취</strong>
          <p>정확성, 증거 활용, 책임과 보안을 기준으로 중요한 대화를 문서로 완성합니다.</p>
        </div>
      </div>
      <div className="footer-links">
        <a href="#service">서비스 소개</a>
        <a href="#process">요금 안내</a>
        <button type="button" className="footer-link-btn" onClick={onOpenQuote}>
          무료 견적
        </button>
        <button type="button" className="footer-link-btn" onClick={onOpenChannelTalk}>
          상담문의
        </button>
      </div>
    </footer>
  );
}

function AppContent() {
  const [quoteOpen, setQuoteOpen] = useState(false);

  useEffect(() => {
    void preloadChannelTalk();
  }, []);

  const openQuote = () => setQuoteOpen(true);
  const openChannelTalk = () => {
    void showChannelTalkMessenger();
  };

  return (
    <>
      <Header onOpenQuote={openQuote} onOpenChannelTalk={openChannelTalk} />
      <main>
        <Hero />
        <HeroStoryBanner />
        <About />
        <HotSpeed />
        <Features />
        <Process />
        <Quality />
        <Results />
        <Request />
      </main>
      <Footer onOpenQuote={openQuote} onOpenChannelTalk={openChannelTalk} />
      <QuoteModal open={quoteOpen} onClose={() => setQuoteOpen(false)} />
    </>
  );
}

export default function App() {
  return (
    <SignupFlowProvider>
      <div className="app">
        <AppContent />
      </div>
    </SignupFlowProvider>
  );
}

export type ClientTab = "upload" | "archive" | "edit";

type TabItem = { id: ClientTab; label: string };

type Props = {
  tabs: TabItem[];
  activeTab: ClientTab;
  onChange: (tab: ClientTab) => void;
};

export default function ClientTopTabNav({ tabs, activeTab, onChange }: Props) {
  return (
    <nav className="client-shell__tab-nav" aria-label="주요 메뉴">
      <div className="client-shell__tab-grid">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`bp-tab ${isActive ? "is-active" : ""}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

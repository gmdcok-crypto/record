import type { ReactNode } from "react";
import type { ClientTab } from "./ClientTopTabNav";

type Props = {
  activeTab: ClientTab;
  onChange: (tab: ClientTab) => void;
};

type TabDef = { id: ClientTab; label: string; icon: () => ReactNode };

const tabs: TabDef[] = [
  {    id: "upload",
    label: "업로드",
    icon: () => (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 16V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "archive",
    label: "보관함",
    icon: () => (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path
          d="M4 7h16M6 7V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "edit",
    label: "편집",
    icon: () => (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path
          d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export default function ClientBottomTabBar({ activeTab, onChange }: Props) {
  return (
    <nav
      className="client-bottom-tab-bar fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur lg:hidden"
      aria-label="모바일 주요 메뉴"
    >
      <div className="client-shell__inner mx-auto grid grid-cols-3 px-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`client-bottom-tab-bar__item ${isActive ? "is-active" : ""}`}
            >
              {tab.icon()}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

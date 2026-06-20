import type { KeyboardEvent, ReactNode } from "react";
import type { TranscriptChangeItem } from "./api";
import { changeTypeLabel, diffText, type DiffPart } from "./transcriptChangeDiff";

type Props = {
  change: TranscriptChangeItem;
  onSegmentFocus?: (segmentIndex: number) => void;
};

function segmentLabel(segmentIndex?: number): string | null {
  if (segmentIndex == null) return null;
  return `구간 ${segmentIndex + 1}`;
}

function InlineDiff({ parts }: { parts: DiffPart[] }) {
  return (
    <p className="client-edit__history-diff">
      {parts.map((part, index) => {
        if (part.op === "equal") {
          return (
            <span key={index} className="client-edit__history-diff-eq">
              {part.text}
            </span>
          );
        }
        if (part.op === "delete") {
          return (
            <span key={index} className="client-edit__history-diff-del">
              {part.text}
            </span>
          );
        }
        return (
          <span key={index} className="client-edit__history-diff-ins">
            {part.text}
          </span>
        );
      })}
    </p>
  );
}

function ValueArrow({ before, after }: { before: string; after: string }) {
  return (
    <p className="client-edit__history-value">
      <span className="client-edit__history-value-before">{before || "(없음)"}</span>
      <span className="client-edit__history-arrow" aria-hidden="true">
        →
      </span>
      <span className="client-edit__history-value-after">{after || "(없음)"}</span>
    </p>
  );
}

export default function TranscriptChangeLine({ change, onSegmentFocus }: Props) {
  const segment = segmentLabel(change.segment_index);
  const label = changeTypeLabel(change.type);
  const clickable = change.segment_index != null && Boolean(onSegmentFocus);

  const handleClick = () => {
    if (change.segment_index == null || !onSegmentFocus) return;
    onSegmentFocus(change.segment_index);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!clickable) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleClick();
    }
  };

  let body: ReactNode;
  switch (change.type) {
    case "segment_text":
      body = <InlineDiff parts={diffText(change.before ?? "", change.after ?? "")} />;
      break;
    case "segment_speaker":
    case "speaker_label":
      body = <ValueArrow before={change.before ?? ""} after={change.after ?? ""} />;
      break;
    case "segment_added":
      body = (
        <p className="client-edit__history-block client-edit__history-block--added">
          {change.after || ""}
        </p>
      );
      break;
    case "segment_removed":
      body = (
        <p className="client-edit__history-block client-edit__history-block--removed">
          {change.before || ""}
        </p>
      );
      break;
    case "segment_omitted":
      body = (
        <>
          <p className="client-edit__history-block client-edit__history-block--removed">{change.before || ""}</p>
          <p className="client-edit__history-block client-edit__history-block--muted">{change.after || "(생략)"}</p>
        </>
      );
      break;
    case "segment_restored":
      body = (
        <>
          <p className="client-edit__history-block client-edit__history-block--muted">{change.before || "(생략)"}</p>
          <p className="client-edit__history-block client-edit__history-block--added">{change.after || ""}</p>
        </>
      );
      break;
    default:
      body = <p className="client-edit__history-diff">{JSON.stringify(change)}</p>;
  }

  return (
    <li
      className={`client-edit__history-change client-edit__history-change--${change.type}${
        clickable ? " is-clickable" : ""
      }`}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={clickable ? handleKeyDown : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? "클릭하면 편집 화면의 해당 구간으로 이동합니다." : undefined}
    >
      <div className="client-edit__history-change-head">
        <span className="client-edit__history-change-type">{label}</span>
        {segment ? <span className="client-edit__history-change-segment">{segment}</span> : null}
        {change.speaker ? (
          <span className="client-edit__history-change-speaker">화자 {change.speaker}</span>
        ) : null}
        {change.speaker_id ? (
          <span className="client-edit__history-change-speaker">화자 {change.speaker_id}</span>
        ) : null}
        {clickable ? <span className="client-edit__history-change-link">구간 보기</span> : null}
      </div>
      {body}
    </li>
  );
}

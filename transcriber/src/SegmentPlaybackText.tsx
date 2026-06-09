import { useEffect, useMemo, useRef, useState } from "react";

import type { TranscriptToken } from "./api";
import {
  activeWordClass,
  buildSegmentTimedWords,
  isWordActive,
  type TimedWord,
} from "./playbackHighlight";
import type { SegmentTiming } from "./segmentAudio";

type Props = {
  value: string;
  segment: SegmentTiming;
  segmentIndex: number;
  segments: SegmentTiming[];
  tokens: TranscriptToken[];
  playbackMs: number;
  isAudioPlaying: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  onChange: (text: string) => void;
  onPlayRequest: () => void;
  onAutoResize?: (element: HTMLTextAreaElement) => void;
};

export default function SegmentPlaybackText({
  value,
  segment,
  segmentIndex,
  segments,
  tokens,
  playbackMs,
  isAudioPlaying,
  disabled = false,
  readOnly = false,
  placeholder,
  onChange,
  onPlayRequest,
  onAutoResize,
}: Props) {
  const [editing, setEditing] = useState(false);
  const activeWordRef = useRef<HTMLSpanElement | null>(null);

  const words = useMemo(
    () => buildSegmentTimedWords(value, segment, segmentIndex, segments, tokens),
    [value, segment, segmentIndex, segments, tokens],
  );

  const showKaraoke = isAudioPlaying && !editing && !readOnly && words.length > 0 && segment.start_ms != null;

  useEffect(() => {
    if (!showKaraoke) return;
    activeWordRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [playbackMs, showKaraoke]);

  if (readOnly) {
    return (
      <ReadOnlyPlaybackText
        value={value}
        words={words}
        playbackMs={playbackMs}
        isAudioPlaying={isAudioPlaying}
        disabled={disabled || segment.start_ms == null}
        onPlayRequest={onPlayRequest}
        activeWordRef={activeWordRef}
      />
    );
  }

  if (showKaraoke) {
    return (
      <div
        role="button"
        tabIndex={0}
        onMouseDown={(event) => {
          event.preventDefault();
          onPlayRequest();
        }}
        onDoubleClick={() => setEditing(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPlayRequest();
          }
        }}
        className="w-full cursor-pointer rounded-lg border border-transparent bg-slate-900/60 px-3 py-2 text-sm leading-7 outline-none transition"
      >
        <KaraokeWords words={words} playbackMs={playbackMs} isAudioPlaying activeWordRef={activeWordRef} />
      </div>
    );
  }

  return (
    <textarea
      value={value}
      rows={1}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value);
        onAutoResize?.(event.currentTarget);
      }}
      onMouseDown={(event) => {
        if (document.activeElement !== event.currentTarget) {
          event.preventDefault();
          onPlayRequest();
        }
      }}
      onDoubleClick={() => setEditing(true)}
      onFocus={(event) => {
        setEditing(true);
        onAutoResize?.(event.currentTarget);
      }}
      onBlur={() => setEditing(false)}
      ref={(element) => {
        if (element) onAutoResize?.(element);
      }}
      placeholder={placeholder}
      className="w-full resize-none overflow-hidden rounded-lg border border-transparent bg-slate-900/60 px-3 py-2 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 hover:border-slate-700 focus:border-blue-500 focus:bg-slate-900 disabled:opacity-50"
    />
  );
}

function KaraokeWords({
  words,
  playbackMs,
  isAudioPlaying,
  activeWordRef,
}: {
  words: TimedWord[];
  playbackMs: number;
  isAudioPlaying: boolean;
  activeWordRef: { current: HTMLSpanElement | null };
}) {
  return (
    <>
      {words.map((word, index) => {
        const active = isAudioPlaying && isWordActive(word, playbackMs);
        const played = isAudioPlaying && playbackMs >= word.end_ms;
        return (
          <span
            key={`${word.start_ms}-${index}`}
            ref={active ? (element) => { activeWordRef.current = element; } : undefined}
            data-active-word={active ? "true" : undefined}
            className={activeWordClass(active, played)}
          >
            {word.text}
          </span>
        );
      })}
    </>
  );
}

function ReadOnlyPlaybackText({
  value,
  words,
  playbackMs,
  isAudioPlaying,
  disabled,
  onPlayRequest,
  activeWordRef,
}: {
  value: string;
  words: TimedWord[];
  playbackMs: number;
  isAudioPlaying: boolean;
  disabled: boolean;
  onPlayRequest: () => void;
  activeWordRef: { current: HTMLSpanElement | null };
}) {
  const showKaraoke = isAudioPlaying && words.length > 0;

  return (
    <button
      type="button"
      onClick={onPlayRequest}
      disabled={disabled}
      className="w-full rounded-lg border border-transparent bg-slate-900/60 px-3 py-2 text-left text-sm leading-7 text-slate-100 transition hover:border-white/10 hover:bg-slate-900 disabled:cursor-default disabled:text-slate-400"
    >
      {showKaraoke ? (
        <KaraokeWords words={words} playbackMs={playbackMs} isAudioPlaying activeWordRef={activeWordRef} />
      ) : (
        value || "(내용 없음)"
      )}
    </button>
  );
}

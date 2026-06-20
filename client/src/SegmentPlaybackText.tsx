import { useEffect, useMemo, useRef, useState } from "react";

import type { SelectedUploadSegment, TranscriptToken } from "./api";
import {
  activeWordClass,
  buildSegmentTimedWords,
  isWordActive,
  type TimedWord,
} from "./playbackHighlight";
import type { SegmentTiming } from "./segmentAudio";

const PLAY_CLICK_DELAY_MS = 280;

type Props = {
  value: string;
  segment: SegmentTiming;
  segmentIndex: number;
  segments: SegmentTiming[];
  tokens: TranscriptToken[];
  selectedSegments?: SelectedUploadSegment[];
  playbackMs: number;
  isAudioPlaying: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  onChange: (text: string) => void;
  onPlayRequest: () => void;
  onEditStart?: () => void;
  onAutoResize?: (element: HTMLTextAreaElement) => void;
};

export default function SegmentPlaybackText({
  value,
  segment,
  segmentIndex,
  segments,
  tokens,
  selectedSegments = [],
  playbackMs,
  isAudioPlaying,
  disabled = false,
  readOnly = false,
  placeholder,
  onChange,
  onPlayRequest,
  onEditStart,
  onAutoResize,
}: Props) {
  const [editing, setEditing] = useState(false);
  const activeWordRef = useRef<HTMLSpanElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const playTimerRef = useRef<number | null>(null);

  const words = useMemo(
    () => buildSegmentTimedWords(value, segment, segmentIndex, segments, tokens, selectedSegments),
    [value, segment, segmentIndex, segments, tokens, selectedSegments],
  );

  const showKaraoke = isAudioPlaying && !editing && !readOnly && words.length > 0 && segment.start_ms != null;

  const cancelScheduledPlay = () => {
    if (playTimerRef.current == null) return;
    window.clearTimeout(playTimerRef.current);
    playTimerRef.current = null;
  };

  const schedulePlay = () => {
    cancelScheduledPlay();
    playTimerRef.current = window.setTimeout(() => {
      playTimerRef.current = null;
      onPlayRequest();
    }, PLAY_CLICK_DELAY_MS);
  };

  const enterEditMode = () => {
    cancelScheduledPlay();
    onEditStart?.();
    setEditing(true);
  };

  useEffect(() => {
    return () => cancelScheduledPlay();
  }, []);

  useEffect(() => {
    if (!showKaraoke) return;
    activeWordRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [playbackMs, showKaraoke]);

  useEffect(() => {
    if (!editing) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    onAutoResize?.(textarea);
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }, [editing, onAutoResize]);

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
          schedulePlay();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          enterEditMode();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            schedulePlay();
          }
        }}
        className="w-full cursor-pointer rounded-lg border border-transparent bg-soft px-3 py-2 text-sm leading-7 outline-none transition"
      >
        <KaraokeWords words={words} playbackMs={playbackMs} isAudioPlaying activeWordRef={activeWordRef} />
      </div>
    );
  }

  return (
    <textarea
      ref={(element) => {
        textareaRef.current = element;
        if (element) onAutoResize?.(element);
      }}
      value={value}
      rows={1}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value);
        onAutoResize?.(event.currentTarget);
      }}
      onMouseDown={(event) => {
        if (editing || disabled) return;
        event.preventDefault();
        schedulePlay();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        enterEditMode();
      }}
      onFocus={(event) => {
        cancelScheduledPlay();
        setEditing(true);
        onAutoResize?.(event.currentTarget);
      }}
      onBlur={() => setEditing(false)}
      placeholder={placeholder}
      className="w-full resize-none overflow-hidden rounded-lg border border-transparent bg-soft px-3 py-2 text-sm leading-6 text-brand-navy outline-none transition placeholder:text-brand-brown/60 hover:border-line focus:border-brand-orange/55 focus:bg-white disabled:opacity-50"
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
            className={activeWordClass(active, played, Boolean(word.outsideSelection))}
            title={word.outsideSelection ? "선택 구간 밖 텍스트" : undefined}
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
      className="w-full rounded-lg border border-transparent bg-soft px-3 py-2 text-left text-sm leading-7 text-brand-navy transition hover:border-white/10 hover:bg-white disabled:cursor-default disabled:text-brand-brown"
    >
      {showKaraoke ? (
        <KaraokeWords words={words} playbackMs={playbackMs} isAudioPlaying activeWordRef={activeWordRef} />
      ) : (
        value || "(내용 없음)"
      )}
    </button>
  );
}

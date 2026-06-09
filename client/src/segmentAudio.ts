export type SegmentTiming = {
  start_ms: number | null;
  end_ms: number | null;
};

export function resolveSegmentEndMs(segments: SegmentTiming[], index: number): number | null {
  const current = segments[index];
  if (!current) return null;
  if (current.end_ms != null) return current.end_ms;

  const next = segments[index + 1];
  if (next?.start_ms != null) {
    const start = current.start_ms ?? 0;
    return Math.max(next.start_ms - 1, start);
  }

  return null;
}

function waitForSeek(audio: HTMLAudioElement, targetSeconds: number): Promise<void> {
  if (Math.abs(audio.currentTime - targetSeconds) < 0.05) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      audio.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const onSeeked = () => finish();
    const timer = window.setTimeout(finish, 400);
    audio.addEventListener("seeked", onSeeked);
  });
}

export async function playSegmentAudio(
  audio: HTMLAudioElement,
  segmentEndRef: { current: number | null },
  startMs: number,
  endMs: number | null,
): Promise<void> {
  const startSeconds = Math.max(0, startMs / 1000);
  let endSeconds: number | null = endMs != null ? endMs / 1000 : null;

  if (endSeconds == null && Number.isFinite(audio.duration) && audio.duration > 0) {
    endSeconds = audio.duration;
  }

  const stopAt = endSeconds != null ? Math.max(startSeconds, endSeconds) : null;

  audio.pause();
  audio.currentTime = startSeconds;
  await waitForSeek(audio, startSeconds);

  segmentEndRef.current = stopAt;

  try {
    await audio.play();
  } catch {
    segmentEndRef.current = null;
  }
}

export function attachSegmentStopListener(
  audio: HTMLAudioElement,
  segmentEndRef: { current: number | null },
): () => void {
  const handleTimeUpdate = () => {
    const stopAt = segmentEndRef.current;
    if (stopAt == null) return;
    if (audio.currentTime >= stopAt - 0.05) {
      segmentEndRef.current = null;
      audio.pause();
    }
  };

  const handleEnded = () => {
    segmentEndRef.current = null;
  };

  audio.addEventListener("timeupdate", handleTimeUpdate);
  audio.addEventListener("ended", handleEnded);

  return () => {
    audio.removeEventListener("timeupdate", handleTimeUpdate);
    audio.removeEventListener("ended", handleEnded);
  };
}

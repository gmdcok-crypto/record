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
  } catch (err) {
    segmentEndRef.current = null;
    throw err;
  }
}

type SegmentStopListenerOptions = {
  onPlaybackEnd?: () => void;
};

export function attachSegmentStopListener(
  audio: HTMLAudioElement,
  segmentEndRef: { current: number | null },
  options?: SegmentStopListenerOptions,
): () => void {
  const endPlayback = () => {
    options?.onPlaybackEnd?.();
  };

  const handleTimeUpdate = () => {
    const stopAt = segmentEndRef.current;
    if (stopAt == null) return;
    if (audio.currentTime >= stopAt - 0.05) {
      segmentEndRef.current = null;
      audio.pause();
      endPlayback();
    }
  };

  const handleEnded = () => {
    segmentEndRef.current = null;
    endPlayback();
  };

  const handlePause = () => {
    if (segmentEndRef.current == null) {
      endPlayback();
    }
  };

  audio.addEventListener("timeupdate", handleTimeUpdate);
  audio.addEventListener("ended", handleEnded);
  audio.addEventListener("pause", handlePause);

  return () => {
    audio.removeEventListener("timeupdate", handleTimeUpdate);
    audio.removeEventListener("ended", handleEnded);
    audio.removeEventListener("pause", handlePause);
  };
}

export function attachPlaybackTimeListener(
  audio: HTMLAudioElement,
  callbacks: {
    onTimeUpdate: (playbackMs: number) => void;
    onPlayingChange: (playing: boolean) => void;
  },
): () => void {
  const handleTimeUpdate = () => {
    callbacks.onTimeUpdate(Math.floor(audio.currentTime * 1000));
  };

  const handlePlay = () => {
    callbacks.onPlayingChange(true);
    handleTimeUpdate();
  };

  const handlePause = () => {
    callbacks.onPlayingChange(false);
  };

  const handleEnded = () => {
    callbacks.onPlayingChange(false);
    callbacks.onTimeUpdate(0);
  };

  audio.addEventListener("timeupdate", handleTimeUpdate);
  audio.addEventListener("play", handlePlay);
  audio.addEventListener("pause", handlePause);
  audio.addEventListener("ended", handleEnded);

  if (!audio.paused) {
    callbacks.onPlayingChange(true);
    handleTimeUpdate();
  }

  return () => {
    audio.removeEventListener("timeupdate", handleTimeUpdate);
    audio.removeEventListener("play", handlePlay);
    audio.removeEventListener("pause", handlePause);
    audio.removeEventListener("ended", handleEnded);
  };
}

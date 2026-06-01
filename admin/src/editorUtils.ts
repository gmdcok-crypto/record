import type { Segment } from "./api";

export function parseMsFromHeadingText(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d{2}):(\d{2})/);
  if (!match) return null;
  return (Number(match[1]) * 60 + Number(match[2])) * 1000;
}

export function resolveSegmentFromClick(
  root: HTMLElement | null,
  target: EventTarget | null,
  segments: Segment[],
): { index: number; startMs: number | null } | null {
  if (!root || !(target instanceof HTMLElement)) return null;

  const clickedHeading = target.closest("h3");
  const clickedParagraph = target.closest("p");

  let heading: HTMLHeadingElement | null = null;
  if (clickedHeading) {
    heading = clickedHeading;
  } else if (clickedParagraph?.previousElementSibling?.tagName === "H3") {
    heading = clickedParagraph.previousElementSibling as HTMLHeadingElement;
  }

  if (!heading) return null;

  const headings = Array.from(root.querySelectorAll("h3"));
  const index = headings.indexOf(heading);
  if (index < 0) return null;

  const attrMs = heading.getAttribute("data-start-ms");
  const parsedAttrMs = attrMs != null && attrMs !== "" ? Number(attrMs) : NaN;
  const startMs =
    segments[index]?.start_ms ??
    (Number.isFinite(parsedAttrMs) ? parsedAttrMs : parseMsFromHeadingText(heading.textContent));

  return { index, startMs: startMs ?? null };
}

function isSeekReady(audio: HTMLAudioElement): boolean {
  return (
    audio.readyState >= HTMLMediaElement.HAVE_METADATA &&
    Number.isFinite(audio.duration) &&
    audio.duration > 0 &&
    audio.seekable.length > 0 &&
    audio.seekable.end(audio.seekable.length - 1) > 0
  );
}

async function waitForMediaEvent(
  audio: HTMLAudioElement,
  event: "loadedmetadata" | "progress" | "seeked",
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      audio.removeEventListener(event, onEvent);
      resolve();
    };
    const onEvent = () => done();
    const timer = window.setTimeout(done, timeoutMs);
    audio.addEventListener(event, onEvent);
  });
}

async function waitUntilSeekReady(audio: HTMLAudioElement, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!isSeekReady(audio) && Date.now() < deadline) {
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      await waitForMediaEvent(audio, "loadedmetadata", 5000);
    } else {
      await waitForMediaEvent(audio, "progress", 2000);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}

export async function seekAudio(audio: HTMLAudioElement, ms: number): Promise<void> {
  const seconds = Math.max(0, ms / 1000);
  await waitUntilSeekReady(audio);

  if (Math.abs(audio.currentTime - seconds) < 0.05) return;

  audio.pause();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    audio.currentTime = seconds;
    await waitForMediaEvent(audio, "seeked", 5000);
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    if (Math.abs(audio.currentTime - seconds) < 0.5) return;
  }
}

export function highlightActiveSegment(root: HTMLElement | null, activeIndex: number): void {
  if (!root) return;

  root.querySelectorAll("[data-segment-active]").forEach((el) => {
    el.removeAttribute("data-segment-active");
  });

  const heading = root.querySelectorAll("h3").item(activeIndex);
  if (!heading) return;

  heading.setAttribute("data-segment-active", "true");
  if (heading.nextElementSibling?.tagName === "P") {
    heading.nextElementSibling.setAttribute("data-segment-active", "true");
  }
}

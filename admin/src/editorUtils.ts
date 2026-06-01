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

export async function seekAudio(audio: HTMLAudioElement, ms: number): Promise<void> {
  const seconds = Math.max(0, ms / 1000);
  if (Math.abs(audio.currentTime - seconds) < 0.05) return;

  await new Promise<void>((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      audio.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const onSeeked = () => done();
    audio.addEventListener("seeked", onSeeked);
    audio.currentTime = seconds;
    window.setTimeout(done, 400);
  });
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

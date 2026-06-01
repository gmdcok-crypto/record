import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export function findSegmentIndexAtPos(doc: ProseMirrorNode, pos: number): number {
  let headingIndex = -1;
  let result = 0;

  doc.nodesBetween(0, doc.content.size, (node, nodePos) => {
    if (node.type.name === "heading") {
      headingIndex += 1;
    }

    const inside = pos >= nodePos && pos <= nodePos + node.nodeSize;
    if (!inside) return;

    if (node.type.name === "heading" && headingIndex >= 0) {
      result = headingIndex;
    } else if (node.type.name === "paragraph") {
      result = Math.max(headingIndex, 0);
    }
  });

  return result;
}

export function highlightActiveSegment(root: HTMLElement | null, activeIndex: number): void {
  if (!root) return;

  root.querySelectorAll("[data-segment-active]").forEach((el) => {
    el.removeAttribute("data-segment-active");
  });

  const headings = root.querySelectorAll("h3");
  const heading = headings.item(activeIndex);
  if (!heading) return;

  heading.setAttribute("data-segment-active", "true");
  if (heading.nextElementSibling?.tagName === "P") {
    heading.nextElementSibling.setAttribute("data-segment-active", "true");
  }
}

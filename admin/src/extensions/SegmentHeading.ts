import Heading from "@tiptap/extension-heading";

export const SegmentHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      segmentIndex: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-segment-index"),
        renderHTML: (attributes) => {
          if (attributes.segmentIndex == null) return {};
          return { "data-segment-index": String(attributes.segmentIndex) };
        },
      },
      startMs: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-start-ms"),
        renderHTML: (attributes) => {
          if (attributes.startMs == null) return {};
          return { "data-start-ms": String(attributes.startMs) };
        },
      },
    };
  },
}).configure({ levels: [3] });

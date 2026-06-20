/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "var(--bp-paper)",
        soft: "var(--bp-surface-muted)",
        muted: "var(--bp-line)",
        ink: "var(--bp-ink)",
        line: "var(--bp-line)",
        "line-strong": "var(--border-strong)",
        brand: {
          orange: "var(--bp-accent)",
          "orange-dark": "var(--bp-accent-dark)",
          navy: "var(--bp-ink)",
          "navy-soft": "var(--navy-soft)",
          brown: "var(--bp-body)",
        },
        danger: "var(--bp-danger)",
        review: "var(--bp-review)",
        "review-stroke": "var(--bp-review-stroke)",
        "accent-soft": "var(--bp-accent-soft)",
        "save-text": "var(--bp-save-text)",
        "share-soft": "var(--bp-share-soft)",
        "pdf-soft": "var(--bp-pdf-soft)",
        "pdf-text": "var(--bp-pdf-text)",
      },
      fontFamily: {
        sans: ["var(--bp-font-family)"],
      },
      fontSize: {
        display: ["26px", { lineHeight: "1.25", fontWeight: "700" }],
        title: ["22px", { lineHeight: "1.3", fontWeight: "700" }],
        section: ["15px", { lineHeight: "1.35", fontWeight: "700" }],
      },
      boxShadow: {
        card: "var(--bp-shadow-card)",
        strong: "var(--bp-shadow-strong)",
      },
      borderRadius: {
        shell: "var(--bp-radius-card)",
        card: "var(--bp-radius-card)",
        section: "var(--bp-radius-section)",
        button: "var(--bp-radius-button)",
        control: "var(--bp-radius-control)",
        chip: "var(--bp-radius-small)",
      },
      spacing: {
        section: "var(--bp-section-gap)",
      },
      minHeight: {
        action: "var(--bp-action-height)",
      },
    },
  },
  plugins: [],
};

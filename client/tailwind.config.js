/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#fbfbf9",
        soft: "#f6f6f3",
        muted: "#e5e5e0",
        ink: "#33332e",
        line: "rgba(15, 39, 72, 0.09)",
        "line-strong": "rgba(15, 39, 72, 0.14)",
        brand: {
          orange: "#ff6b4a",
          "orange-dark": "#e85a38",
          navy: "#0f2748",
          "navy-soft": "#1a3a5c",
          brown: "#736352",
        },
      },
      boxShadow: {
        card: "0 2px 16px rgba(15, 39, 72, 0.07)",
        strong: "0 24px 60px rgba(0, 0, 0, 0.34)",
      },
      borderRadius: {
        shell: "24px",
      },
    },
  },
  plugins: [],
};

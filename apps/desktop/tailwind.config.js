/** @type {import('tailwindcss').Config} */
const themed = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        white: themed("white"),
        slate: {
          100: themed("slate-100"),
          200: themed("slate-200"),
          300: themed("slate-300"),
          400: themed("slate-400"),
          500: themed("slate-500"),
          600: themed("slate-600"),
        },
        base: {
          900: themed("base-900"),
          800: themed("base-800"),
          700: themed("base-700"),
          600: themed("base-600"),
          500: themed("base-500"),
        },
        line: themed("line"),
        accent: {
          DEFAULT: themed("accent"),
          soft: themed("accent-soft"),
        },
        win: themed("win"),
        fair: themed("fair"),
        loss: themed("loss"),
        warn: themed("warn"),
        yourside: themed("yourside"),
        theirside: themed("theirside"),
        toggle: themed("toggle"),
      },
      fontFamily: {
        sans: ["Segoe UI", "system-ui", "-apple-system", "sans-serif"],
      },
      boxShadow: {
        glass: "var(--shadow-glass)",
        glow: "0 0 0 1px rgb(var(--color-accent) / 0.35)",
      },
      backdropBlur: {
        xs: "2px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out",
      },
    },
  },
  plugins: [],
};

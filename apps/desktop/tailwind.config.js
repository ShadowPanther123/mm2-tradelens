/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: {
          900: "#0c0e14",
          800: "#12141c",
          700: "#171a24",
          600: "#1e2230",
          500: "#272c3d",
        },
        line: "#2c313f",
        accent: {
          DEFAULT: "#6ea8fe",
          soft: "#8fbcff",
        },
        win: "#6fcf97",
        fair: "#6ea8fe",
        loss: "#e79a9a",
        warn: "#e6c07b",
        yourside: "#7bd3a0",
        theirside: "#f0b37e",
      },
      fontFamily: {
        sans: ["Segoe UI", "system-ui", "-apple-system", "sans-serif"],
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0, 0, 0, 0.36)",
        glow: "0 0 0 1px rgba(110, 168, 254, 0.35)",
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

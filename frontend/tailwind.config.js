/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        // Polymarket brand blue
        pm: {
          blue:       "#0066FF",
          blueLight:  "#EBF0FF",
          blueMid:    "#3B82F6",
        },
        // YES = emerald green
        yes: {
          DEFAULT:    "#10B981",
          light:      "#D1FAE5",
          dark:       "#059669",
        },
        // NO = rose red
        no: {
          DEFAULT:    "#EF4444",
          light:      "#FEE2E2",
          dark:       "#DC2626",
        },
        // Neutral grays (Polymarket's palette)
        gray: {
          50:  "#F9FAFB",
          100: "#F3F4F6",
          150: "#EAECF0",
          200: "#E5E7EB",
          300: "#D1D5DB",
          400: "#9CA3AF",
          500: "#6B7280",
          600: "#4B5563",
          700: "#374151",
          800: "#1F2937",
          900: "#111827",
          950: "#030712",
        },
        // Page background
        bg: "#F2F4F7",
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "media", // Automatically follows system preference
  theme: {
    extend: {
      colors: {
        primary: "#8b5cf6",
        secondary: "#ec4899",
        dark: "#0f172a",
        darker: "#020617",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [],
};

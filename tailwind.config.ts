import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#07070a",
        panel: "#0f0f16",
        border: "rgba(255,255,255,0.08)",

        monad: {
          purple: "#8b5cf6",
          violet: "#a855f7",
          glow: "#c4b5fd",
        },

        buy: "#10b981",
        sell: "#ef4444",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(139,92,246,0.35), 0 0 25px rgba(139,92,246,0.15)",
      },
    },
  },
  plugins: [],
};

export default config;

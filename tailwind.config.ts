import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1c1e21",
        muted: "#6b7280",
        line: "#e6e8eb",
        accent: "#2563eb",
        "accent-soft": "#eef2ff",
        danger: "#e11d48",
        canvas: "#f1f2f4",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,.08), 0 4px 20px rgba(0,0,0,.06)",
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b1020",
        card: "#141b2d",
        accent: "#00c896"
      }
    }
  },
  plugins: []
} satisfies Config;

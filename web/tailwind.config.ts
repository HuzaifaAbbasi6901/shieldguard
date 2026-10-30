import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1440px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // ShieldGuard threat-state colors
        shield: {
          cyan: "#22d3ee",
          green: "#34d399",
          amber: "#fbbf24",
          red: "#fb7185",
          navy: "#0a0f1e",
          deep: "#050810",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "radar-sweep": {
          to: { transform: "rotate(360deg)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.85)", opacity: "0.9" },
          "70%": { transform: "scale(1.25)", opacity: "0" },
          "100%": { transform: "scale(1.25)", opacity: "0" },
        },
        "glow-breathe": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        "alarm-flash": {
          "0%, 100%": { opacity: "0" },
          "50%": { opacity: "0.35" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-600px 0" },
          "100%": { backgroundPosition: "600px 0" },
        },
      },
      animation: {
        "radar-sweep": "radar-sweep 4s linear infinite",
        "pulse-ring": "pulse-ring 2.2s cubic-bezier(0.2, 0.6, 0.4, 1) infinite",
        "glow-breathe": "glow-breathe 3s ease-in-out infinite",
        "alarm-flash": "alarm-flash 1.1s ease-in-out infinite",
        "float-slow": "float-slow 5s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
      boxShadow: {
        glow: "0 0 24px 2px hsl(var(--primary) / 0.35)",
        "glow-lg": "0 0 48px 6px hsl(var(--primary) / 0.28)",
        "glow-red": "0 0 36px 4px rgba(251, 113, 133, 0.4)",
        glass: "0 8px 32px rgba(2, 6, 23, 0.45)",
      },
    },
  },
  plugins: [],
};

export default config;

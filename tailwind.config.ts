import type { Config } from "tailwindcss";

/**
 * All colors resolve through CSS variables defined in src/index.css, so every
 * class works in both the light "paper" theme and the dark "slate" theme.
 *
 * The `slate` and `amber` scales are remapped onto semantic tokens so code
 * ported from quran-reader (written against Tailwind's dark slate palette)
 * becomes theme-aware without rewriting its class names.
 */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        arabic: ["Amiri", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        ground: "var(--ground)",
        card: "var(--card)",
        card2: "var(--card2)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        edge: "var(--border)",
        "edge-strong": "var(--border-strong)",
        primary: {
          DEFAULT: "var(--primary)",
          soft: "var(--primary-soft)",
        },
        "on-primary": "var(--on-primary)",
        gold: {
          DEFAULT: "var(--gold)",
          text: "var(--gold-text)",
        },

        // quran-reader compatibility aliases
        surface: {
          DEFAULT: "var(--ground)",
          light: "var(--card)",
          lighter: "var(--card2)",
        },
        slate: {
          100: "var(--ink)",
          200: "var(--ink)",
          300: "var(--ink-soft)",
          400: "var(--muted)",
          500: "var(--faint)",
          600: "var(--border-strong)",
          700: "var(--border)",
          800: "var(--card2)",
        },
        amber: {
          200: "var(--gold-text)",
          300: "var(--gold-text)",
          400: "var(--gold)",
          500: "rgb(var(--gold-rgb) / <alpha-value>)",
          600: "#A9853F",
        },
        emerald: {
          300: "var(--primary)",
          400: "var(--primary)",
          500: "var(--primary)",
          600: "var(--primary)",
        },
        red: {
          400: "rgb(var(--danger-rgb) / <alpha-value>)",
          500: "rgb(var(--danger-rgb) / <alpha-value>)",
          800: "rgb(var(--danger-rgb) / <alpha-value>)",
          900: "rgb(var(--danger-rgb) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;

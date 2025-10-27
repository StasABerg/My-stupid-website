import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const terminalColors = {
  green: "hsl(var(--terminal-green))",
  cyan: "hsl(var(--terminal-cyan))",
  magenta: "hsl(var(--terminal-magenta))",
  yellow: "hsl(var(--terminal-yellow))",
  red: "hsl(var(--terminal-red))",
  blue: "hsl(var(--terminal-blue))",
  white: "hsl(var(--terminal-white))",
} as const;

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        mono: ['Fira Code', 'Courier New', 'monospace'],
      },
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
        terminal: {
          ...terminalColors,
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderColor: {
        DEFAULT: "hsl(var(--border))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ...Object.fromEntries(
          Object.entries(terminalColors).map(([key, value]) => [`terminal-${key}`, value]),
        ),
      },
      ringColor: {
        DEFAULT: "hsl(var(--ring))",
        ring: "hsl(var(--ring))",
        ...Object.fromEntries(
          Object.entries(terminalColors).map(([key, value]) => [`terminal-${key}`, value]),
        ),
      },
      ringOffsetColor: {
        background: "hsl(var(--background))",
      },
      backgroundColor: {
        background: "hsl(var(--background))",
        popover: "hsl(var(--popover))",
        card: "hsl(var(--card))",
        sidebar: "hsl(var(--sidebar-background))",
        ...Object.fromEntries(
          Object.entries(terminalColors).map(([key, value]) => [`terminal-${key}`, value]),
        ),
      },
      textColor: {
        foreground: "hsl(var(--foreground))",
        muted: "hsl(var(--muted-foreground))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        "destructive-foreground": "hsl(var(--destructive-foreground))",
        "popover-foreground": "hsl(var(--popover-foreground))",
        "card-foreground": "hsl(var(--card-foreground))",
        "sidebar-foreground": "hsl(var(--sidebar-foreground))",
        ...Object.fromEntries(
          Object.entries(terminalColors).map(([key, value]) => [`terminal-${key}`, value]),
        ),
      },
      divideColor: {
        ...Object.fromEntries(
          Object.entries(terminalColors).map(([key, value]) => [`terminal-${key}`, value]),
        ),
      },
      caretColor: {
        ...Object.fromEntries(
          Object.entries(terminalColors).map(([key, value]) => [`terminal-${key}`, value]),
        ),
      },
      accentColor: {
        ...Object.fromEntries(
          Object.entries(terminalColors).map(([key, value]) => [`terminal-${key}`, value]),
        ),
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
} satisfies Config;

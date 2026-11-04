// Aerie theming: every colour below reads a `--md-<role>` CSS variable (an "r g b"
// triplet) set by src/aerie/theme/useAerieTheme.ts, so one palette switch restyles
// everything and opacity modifiers like `text-white/60` keep working.
const md = (role) => `rgb(var(--md-${role}) / <alpha-value>)`;
const mdAlpha = (role, alpha) => `rgb(var(--md-${role}) / ${alpha})`;
// Corner radius: Material values when [data-theme="material"] sets the variable,
// otherwise the fallback, which is PILLAR's original value.
const radius = (name, fallback) => `var(--aerie-radius-${name}, ${fallback})`;

const MATERIAL_ROLES = [
  "surface", "surface-dim", "surface-bright",
  "surface-container-lowest", "surface-container-low", "surface-container",
  "surface-container-high", "surface-container-highest",
  "on-surface", "on-surface-variant", "outline", "outline-variant",
  "inverse-surface", "inverse-on-surface", "inverse-primary",
  "primary", "on-primary", "primary-container", "on-primary-container",
  "secondary", "on-secondary", "secondary-container", "on-secondary-container",
  "tertiary", "on-tertiary", "tertiary-container", "on-tertiary-container",
  "error", "on-error", "error-container", "on-error-container",
  "scrim", "shadow",
];

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Design tokens for PILLAR
      colors: {
        // Material 3 roles: bg-surface-container, text-on-surface-variant, bg-primary, ...
        ...Object.fromEntries(MATERIAL_ROLES.map((role) => [role, md(role)])),
        // PILLAR wrote its UI as white-on-dark (`text-white/80`, `bg-white/10`, ...).
        // "white" now means "content colour on the current surface": pure white in the
        // glass theme (identical to before), Material on-surface in the Pixel theme.
        white: md("on-surface"),
        // For text that must stay white whatever the theme (e.g. on a red badge).
        "fixed-white": "#ffffff",
        // Semantic color palette
        'pill-bg': {
          DEFAULT: mdAlpha("surface", 0.85),
          light: mdAlpha("surface-container", 0.75),
          dark: mdAlpha("surface-dim", 0.9),
        },
        'pill-border': mdAlpha("on-surface", 0.08),
        'pill-accent': {
          DEFAULT: md("primary"), // PILLAR red in glass, Material primary in Pixel theme
          muted: mdAlpha("primary", 0.95),
        },
        'pill-danger': {
          DEFAULT: '#ef4444',
          light: 'rgba(239, 68, 68, 0.3)',
        },
        'pill-success': {
          DEFAULT: '#22c55e',
          light: 'rgba(34, 197, 94, 0.4)',
        },
        'pill-warning': {
          DEFAULT: '#f59e0b',
          light: 'rgba(245, 158, 11, 0.2)',
        },
        'pill-muted': {
          DEFAULT: mdAlpha("on-surface", 0.8),
          light: mdAlpha("on-surface", 0.6),
          lighter: mdAlpha("on-surface", 0.5),
          lightest: mdAlpha("on-surface", 0.1),
        },
      },
      spacing: {
        // Consistent spacing scale for pill components
        'pill-xs': '0.125rem', // 2px
        'pill-sm': '0.25rem',  // 4px
        'pill-md': '0.5rem',   // 8px
        'pill-lg': '0.75rem',  // 12px
        'pill-xl': '1rem',     // 16px
        'pill-2xl': '1.5rem',  // 24px
        'pill-3xl': '2rem',    // 32px
      },
      borderRadius: {
        // Tailwind's own steps, made theme-aware (fallback = Tailwind default)
        DEFAULT: radius("default", "0.25rem"),
        md: radius("md", "0.375rem"),
        lg: radius("lg", "0.5rem"),
        xl: radius("xl", "0.75rem"),
        '2xl': radius("2xl", "1rem"),
        // Consistent border radius scale
        'pill-sm': radius("pill-sm", "0.5rem"),   // 8px
        'pill-md': radius("pill-md", "0.75rem"),  // 12px
        'pill-lg': radius("pill-lg", "1rem"),     // 16px
        'pill-xl': radius("pill-xl", "1.125rem"), // 18px
        'pill-2xl': radius("pill-2xl", "1.25rem"), // 20px
        'pill-3xl': radius("pill-3xl", "1.75rem"), // 28px
        'pill-full': '9999px',
      },
      fontFamily: {
        // Pixel uses Google Sans; Roboto Flex is its open (OFL) cousin and ships locally.
        material: ['"Roboto Flex Variable"', '"Segoe UI Variable"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Consistent typography scale
        'pill-xs': ['10px', { lineHeight: '1.2', letterSpacing: '0.01em' }],
        'pill-sm': ['11px', { lineHeight: '1.3', letterSpacing: '0.01em' }],
        'pill-base': ['12px', { lineHeight: '1.4', letterSpacing: '0.01em' }],
        'pill-md': ['13px', { lineHeight: '1.4', letterSpacing: '0.02em' }],
        'pill-lg': ['18px', { lineHeight: '1.2', letterSpacing: '0.02em', fontWeight: '600' }],
      },
      animation: {
        'slide-up-fade': 'slideUpFade 0.4s ease-out',
      },
      keyframes: {
        slideUpFade: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

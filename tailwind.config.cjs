/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        panel: 'hsl(var(--panel))',
        border: 'hsl(var(--border))',
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        success: 'hsl(var(--success))',
        danger: 'hsl(var(--danger))',
      },
      borderRadius: { lg: '12px', md: '8px', sm: '6px' },
      fontFamily: { sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'], mono: ['Cascadia Code', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
}

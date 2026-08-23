import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#10201C',
        muted: '#5D6863',
        surface: '#F7F8F3',
        panel: '#FFFFFF',
        primary: '#0F766E',
        secondary: '#2563EB',
        accent: '#F59E0B'
      }
    }
  },
  plugins: []
}

export default config

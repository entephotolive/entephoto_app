/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
    './src/screens/**/*.{js,jsx,ts,tsx}',
    './src/components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          background: '#0B0F1A',
          surface: '#121826',
          surfaceElevated: '#1A2233',
          border: '#232C40',
          primary: '#3B82F6',
          primaryPressed: '#2563EB',
          primaryMuted: '#1E3A5F',
          textPrimary: '#F5F7FA',
          textSecondary: '#9AA4B2',
          textMuted: '#5C6578',
          success: '#22C55E',
          error: '#EF4444',
          warning: '#F59E0B',

          // Preserved brand palette
          cream: '#FAF6F0',
          obsidian: '#121316',
          coral: '#FF6433',
          coralSoft: '#FF9E7D',
          coralCircle: '#FDB69E',
          mint: '#A5E8D2',
          mintBadge: '#D4F5E8',
          pinkBadge: '#FFE6DD',
          pinkBadge2: '#FFE2DC',
          yellowClay: '#FFE17D',
          muted: '#71717A',
        },
      },
      fontFamily: {
        editorial: ['Playfair Display', 'Georgia', 'serif'],
        sans: ['System', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

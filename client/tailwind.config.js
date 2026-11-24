export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--bg-page)',
        card: 'var(--bg-card)',
        cardhover: 'var(--bg-card-hover)',
        inputbg: 'var(--bg-input)',
        borderc: 'var(--border-color)',
        main: 'var(--text-main)',
        muted: 'var(--text-muted)',
        primary: 'var(--primary)',
        primaryhover: 'var(--primary-hover)',
        primarylight: 'var(--primary-light)',
        primarysubtle: 'var(--primary-subtle)',
      }
    }
  },
  plugins: []
};

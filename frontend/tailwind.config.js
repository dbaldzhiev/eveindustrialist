/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        eve: {
          bg:       "#09111f",
          surface:  "#0d1b2e",
          border:   "#1a2d47",
          orange:   "#e87427",
          "orange-dim": "#a0541a",
          blue:     "#4da6ff",
          text:     "#c8d4e6",
          muted:    "#4a5a72",
          profit:   "#4caf50",
          loss:     "#ef5350",
        },
      },
      fontFamily: {
        eve: ["Exo 2", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

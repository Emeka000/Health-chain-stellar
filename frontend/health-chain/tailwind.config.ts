import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          black: "#000000",
          dark: "#0d0d0d",
          textBold: "#3c3c3c",
          navLine: "#4b4949",
          loginBtn: "#893d3d", 
          requestBtn: "#2c2525",
          footer: "#1e2833", 
        },
        burgundy: {
          800: '#991b1b',
          950: '#7f1d1d',
        },
      },
      backgroundImage: {
        'blood-gradient': 'linear-gradient(135deg, #B32346 0%, #6a0b37 100%)',
      },
      boxShadow: {
        'blood-drop': '0px 4px 4px 0px rgba(165, 164, 164, 0.5)',
        'card': '0px 4px 20px rgba(0, 0, 0, 0.05)',
      },
      fontFamily: {
        poppins: ['var(--font-poppins)'],
        roboto: ['var(--font-roboto)'],
        manrope: ['var(--font-manrope)'],
        dmsans: ['var(--font-dm-sans)'],
      },
    },
  },
  plugins: [
    function ({ addUtilities }: any) {
      addUtilities({
        '.sr-only': {
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: '0',
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          borderWidth: '0',
        },
        '.focus-visible\\:not-sr-only:focus-visible': {
          position: 'static',
          width: 'auto',
          height: 'auto',
          padding: 'inherit',
          margin: 'inherit',
          overflow: 'visible',
          clip: 'auto',
          whiteSpace: 'normal',
        },
      });
    },
  ],
};
export default config;
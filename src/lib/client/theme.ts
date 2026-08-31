import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type Theme = 
  | 'cinematic-dark' 
  | 'midnight-glow' 
  | 'nordic-frost' 
  | 'sunset-mirage' 
  | 'forest-haven'
  | 'solarized-light'
  | 'boi-butter'
  | 'daddy-please'
  | 'himbo-juice';

const DEFAULT_THEME: Theme = 'cinematic-dark';
const THEME_CHROME_COLORS: Record<Theme, string> = {
  'cinematic-dark': '#090b1a',
  'midnight-glow': '#080611',
  'nordic-frost': '#1a2634',
  'sunset-mirage': '#1a1028',
  'forest-haven': '#0d2118',
  'solarized-light': '#fdf6e3',
  'boi-butter': '#332209',
  'daddy-please': '#2a1111',
  'himbo-juice': '#171034'
};
function createThemeStore() {
  const { subscribe, set } = writable<Theme>(DEFAULT_THEME);

  return {
    subscribe,
    init: () => {
      if (browser) {
        const savedTheme = localStorage.getItem('dear-robot.theme') as Theme;
        if (savedTheme && isValidTheme(savedTheme)) {
          set(savedTheme);
          applyTheme(savedTheme);
        } else {
          applyTheme(DEFAULT_THEME);
        }
      }
    },
    setTheme: (theme: Theme) => {
      if (browser) {
        localStorage.setItem('dear-robot.theme', theme);
        applyTheme(theme);
      }
      set(theme);
    }
  };
}

function isValidTheme(theme: string): theme is Theme {
  return [
    'cinematic-dark',
    'midnight-glow',
    'nordic-frost',
    'sunset-mirage',
    'forest-haven',
    'solarized-light',
    'boi-butter',
    'daddy-please',
    'himbo-juice'
  ].includes(theme);
}

function applyTheme(theme: Theme) {
  if (browser) {
    document.documentElement.setAttribute('data-theme', theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_CHROME_COLORS[theme]);
    // Also update color-scheme for system UI elements
    const isLight = theme === 'solarized-light';
    document.documentElement.style.colorScheme = isLight ? 'light' : 'dark';
  }
}

export const themeStore = createThemeStore();

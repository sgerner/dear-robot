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
    // Also update color-scheme for system UI elements
    const isLight = theme === 'solarized-light';
    document.documentElement.style.colorScheme = isLight ? 'light' : 'dark';
  }
}

export const themeStore = createThemeStore();

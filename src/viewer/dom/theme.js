export const DEFAULT_THEME = 'light';
export const THEME_STORAGE_KEY = '3dtiles-inspector-theme';

const THEMES = new Set(['dark', 'light']);
const SCENE_BACKGROUND_COLORS = {
  dark: 0x2d2d2d,
  light: 0xe8e8e8,
};
export function normalizeTheme(value) {
  return THEMES.has(value) ? value : null;
}

function getBrowserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readStoredTheme(storage) {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storeTheme(storage, theme) {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme switching should still work when storage is unavailable.
  }
}

export function createThemeController({
  documentElement = document.documentElement,
  onThemeChanged,
  scene,
  storage = getBrowserStorage(),
  themeToggle,
}) {
  let theme =
    readStoredTheme(storage) ||
    normalizeTheme(documentElement.dataset.theme) ||
    DEFAULT_THEME;

  function applyTheme(nextTheme, { persist = false } = {}) {
    theme = normalizeTheme(nextTheme) || DEFAULT_THEME;
    documentElement.dataset.theme = theme;
    documentElement.style.colorScheme = theme;
    themeToggle.checked = theme === 'dark';
    scene.background?.setHex?.(SCENE_BACKGROUND_COLORS[theme]);
    onThemeChanged?.(theme);

    if (persist) {
      storeTheme(storage, theme);
    }
  }

  function handleThemeChange() {
    applyTheme(themeToggle.checked ? 'dark' : 'light', { persist: true });
  }

  themeToggle.addEventListener('change', handleThemeChange);
  applyTheme(theme);

  return {
    dispose() {
      themeToggle.removeEventListener('change', handleThemeChange);
    },
    getTheme: () => theme,
    setTheme: (nextTheme) => applyTheme(nextTheme, { persist: true }),
  };
}

// Theme — palette swap mechanism.
//
// Provides:
//   - THEMES: registered theme definitions (id, name, series colors for JS use)
//   - getActiveTheme(): the currently-active theme object
//   - setTheme(id): swap themes live (updates data-theme attribute, notifies
//     listeners). CSS custom properties cascade automatically; JS-side colors
//     (chart series, etc.) update via onThemeChange listeners.
//   - onThemeChange(cb): subscribe to theme swaps
//
// Each theme defines a `series` map keyed by semantic slot ('cyan', 'pink',
// 'green', 'amber', 'purple', 'red'). Blueprints reference these slots,
// not hex codes — `color: 'cyan'` resolves through the active theme.

const THEMES = {
  original: {
    id: 'original',
    name: 'Original',
    // Series colors used in blueprints by semantic slot name.
    series: {
      cyan:   '#4cc9f0',
      pink:   '#f72585',
      green:  '#4ade80',
      amber:  '#f59e0b',
      purple: '#8b5cf6',
      red:    '#ef4444',
    },
    crosshair: 'rgba(230, 230, 230, 0.45)',
  },

  // Catppuccin Mocha for UI surfaces + Tableau 10 for chart series.
  // The slot names are preserved across themes so blueprints don't change.
  mocha: {
    id: 'mocha',
    name: 'Mocha + Tableau 10',
    series: {
      cyan:   '#76B7B2',  // Tableau 10 teal
      pink:   '#FF9DA7',  // Tableau 10 pink
      green:  '#59A14F',  // Tableau 10 green
      amber:  '#F28E2B',  // Tableau 10 orange
      purple: '#B07AA1',  // Tableau 10 purple
      red:    '#E15759',  // Tableau 10 red
    },
    crosshair: 'rgba(205, 214, 244, 0.45)',
  },

  // Gruvbox (dark, warm). Mustard, terracotta, olive, oxide-red.
  gruvbox: {
    id: 'gruvbox',
    name: 'Gruvbox (warm)',
    series: {
      cyan:   '#83a598',  // faded blue
      pink:   '#d3869b',  // faded purple
      green:  '#b8bb26',  // bright olive-green
      amber:  '#fabd2f',  // mustard
      purple: '#fe8019',  // terracotta orange (repurposed for distinction)
      red:    '#fb4934',  // bright oxide-red
    },
    crosshair: 'rgba(235, 219, 178, 0.45)',
  },

  // Nord. Cool, calm, arctic-blue + soft pastel aurora accents.
  nord: {
    id: 'nord',
    name: 'Nord (arctic)',
    series: {
      cyan:   '#88c0d0',  // nord8 frost
      pink:   '#b48ead',  // nord15 purple
      green:  '#a3be8c',  // nord14
      amber:  '#ebcb8b',  // nord13
      purple: '#d08770',  // nord12 orange (repurposed for distinction)
      red:    '#bf616a',  // nord11
    },
    crosshair: 'rgba(216, 222, 233, 0.45)',
  },

  // Forest (Everforest-inspired). Mossy greens, wheat, sage, dusty rose.
  forest: {
    id: 'forest',
    name: 'Forest (earth)',
    series: {
      cyan:   '#7fbbb3',  // faded teal
      pink:   '#d699b6',  // mauve
      green:  '#a7c080',  // sage
      amber:  '#dbbc7f',  // wheat
      purple: '#e69875',  // terracotta
      red:    '#e67e80',  // dusty red
    },
    crosshair: 'rgba(211, 198, 170, 0.45)',
  },
};

let _activeTheme = THEMES[localStorage.getItem('theme') || 'original'] || THEMES.original;
const _themeListeners = [];

function getActiveTheme() {
  return _activeTheme;
}

function setTheme(id) {
  if (!THEMES[id]) return;
  _activeTheme = THEMES[id];
  localStorage.setItem('theme', id);
  document.documentElement.dataset.theme = id;
  for (const cb of _themeListeners) {
    try { cb(_activeTheme); } catch (e) { console.error(e); }
  }
}

function onThemeChange(cb) {
  _themeListeners.push(cb);
  return () => {
    const i = _themeListeners.indexOf(cb);
    if (i >= 0) _themeListeners.splice(i, 1);
  };
}

// Resolve a color value: if it's a theme series slot key, return the active
// theme's hex; otherwise treat as a literal CSS color string.
function resolveColor(slotOrLiteral) {
  const t = getActiveTheme();
  if (t.series && t.series[slotOrLiteral]) return t.series[slotOrLiteral];
  return slotOrLiteral;
}

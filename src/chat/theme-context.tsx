// React context for the active palette — consumed by Ink chat components.
import { createContext, useContext } from 'react';
import { theme, type Palette } from '../utils/theme.js';

const ThemeContext = createContext<Palette>(theme());

export const ThemeProvider = ThemeContext.Provider;

export function useTheme(): Palette {
    return useContext(ThemeContext);
}

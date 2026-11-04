import { createContext, useContext } from "react";

/** Lets any module ask "am I drawing the Material (Pixel) theme?" without prop drilling. */
export const AerieThemeContext = createContext<{ isMaterial: boolean; isDark: boolean }>({
  isMaterial: false,
  isDark: true,
});

export const useAerieThemeContext = () => useContext(AerieThemeContext);

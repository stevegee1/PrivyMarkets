import { useState, useEffect } from 'react';

/**
 * useTheme — persists light/dark preference in localStorage
 * and toggles the `dark` class on <html> (Tailwind darkMode: "class")
 */
export function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('pm-theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add('dark');
      localStorage.setItem('pm-theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('pm-theme', 'light');
    }
  }, [dark]);

  return { dark, toggle: () => setDark(d => !d) };
}

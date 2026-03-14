import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

/**
 * ThemeToggle — sun/moon icon button.
 * Drop this anywhere in a header; it reads and writes theme globally.
 */
export default function ThemeToggle({ className = '' }) {
  const { dark, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`p-2 rounded-lg transition-colors
        text-gray-500 hover:text-gray-900 hover:bg-gray-100
        dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800
        ${className}`}
    >
      {dark
        ? <Sun  className="w-4 h-4" />
        : <Moon className="w-4 h-4" />}
    </button>
  );
}

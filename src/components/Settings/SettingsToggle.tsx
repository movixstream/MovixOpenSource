import type { ButtonHTMLAttributes } from 'react';

interface SettingsToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'color'> {
  checked: boolean;
  onToggle: () => void;
  color?: string;
}

/** Shared with the appearance settings (scroll position, background, etc.). */
export function SettingsToggle({ checked, onToggle, color = 'red', className = '', ...props }: SettingsToggleProps) {
  const bgActive = color === 'blue' ? 'bg-blue-500' : color === 'purple' ? 'bg-purple-500' : color === 'green' ? 'bg-green-500' : color === 'indigo' ? 'bg-indigo-500' : 'bg-red-600';
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={`relative ml-4 w-14 h-8 rounded-full transition-colors duration-300 flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none ${checked ? bgActive : 'bg-gray-600'} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-300 motion-reduce:transition-none ${checked ? 'translate-x-6' : 'translate-x-0'}`}
      />
    </button>
  );
}

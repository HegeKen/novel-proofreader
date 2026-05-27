import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder = '请选择',
  className = '',
  disabled = false,
  style,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`} style={style}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full flex items-center justify-between px-4 py-3 bg-[var(--glass-bg)] border border-[var(--border)] rounded-[var(--r-lg)] text-[14px] cursor-pointer transition-all duration-[var(--duration)] focus:outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-dim)] ${
          disabled
            ? 'opacity-50 cursor-not-allowed text-[var(--text-secondary)]'
            : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]'
        }`}
        style={{
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <span className="flex-1 text-center">{selectedOption?.label || placeholder}</span>
        <ChevronDown
          size={16}
          className={`text-[var(--text-secondary)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[var(--glass-bg)] border border-[var(--border)] rounded-[var(--r-lg)] shadow-[var(--shadow-lg)] z-50 overflow-hidden animate-[slideDown_0.2s_ease]"
          style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="max-h-60 overflow-y-auto">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={`w-full flex items-center justify-center px-4 py-3 text-center text-[14px] transition-colors duration-150 hover:bg-[var(--bg-hover)] relative ${
                  option.value === value
                    ? 'text-[var(--accent)] bg-[var(--accent-dim)]'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={16} className="absolute right-4" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

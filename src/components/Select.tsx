import { useState, useRef, useEffect } from "react";
import { Icons } from "./Icons";

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

export function Select({
  value,
  onChange,
  options,
  placeholder = "请选择",
  className = "",
  disabled = false,
  style,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const dropdownWidth = Math.min(rect.width, 280);
      const maxHeight = window.innerHeight - rect.bottom - 20;
      
      setDropdownStyle({
        left: `${rect.left}px`,
        top: `${rect.bottom + 8}px`,
        width: `${dropdownWidth}px`,
        maxHeight: `${Math.max(maxHeight, 100)}px`,
      });
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`custom-select ${className}`} style={style}>
      <button
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <span>{selectedOption?.label || placeholder}</span>
        <Icons.chevronDown size={16} className={`custom-select-arrow ${isOpen ? "open" : ""}`} />
      </button>

      {isOpen && !disabled && (
        <div className="custom-select-dropdown" style={dropdownStyle}>
          <div className="custom-select-options">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`custom-select-option ${option.value === value ? "active" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.value === value && <Icons.checkCircle size={16} className="custom-select-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

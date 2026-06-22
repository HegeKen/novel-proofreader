import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
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

  const updateDropdownPosition = useCallback(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const dropdownWidth = Math.min(rect.width, 280);
      const maxHeight = window.innerHeight - rect.bottom - 20;
      const safeMaxHeight = Math.max(Math.min(maxHeight, 300), 100);
      
      const newStyle: React.CSSProperties = {
        position: "fixed",
        left: `${Math.max(rect.left, 16)}px`,
        top: `${rect.bottom + 8}px`,
        width: `${dropdownWidth}px`,
        maxHeight: `${safeMaxHeight}px`,
        zIndex: 9999,
      };
      
      setDropdownStyle(newStyle);
    }
  }, [isOpen]);

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
    updateDropdownPosition();
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener("resize", updateDropdownPosition);
      window.addEventListener("scroll", updateDropdownPosition);
      return () => {
        window.removeEventListener("resize", updateDropdownPosition);
        window.removeEventListener("scroll", updateDropdownPosition);
      };
    }
  }, [isOpen, updateDropdownPosition]);

  const handleOpen = useCallback(() => {
    if (!disabled) {
      setIsOpen(true);
    }
  }, [disabled]);

  return (
    <div ref={containerRef} className={`custom-select ${className}`} style={style}>
      <button
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        onClick={handleOpen}
        disabled={disabled}
      >
        <span>{selectedOption?.label || placeholder}</span>
        <Icons.chevronDown size={16} className={`custom-select-arrow ${isOpen ? "open" : ""}`} />
      </button>

      {isOpen && !disabled && createPortal(
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
        </div>,
        document.body
      )}
    </div>
  );
}

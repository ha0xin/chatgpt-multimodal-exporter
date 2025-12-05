import { useEffect, useRef } from 'preact/hooks';

interface CheckboxProps {
    checked: boolean;
    indeterminate?: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
    disabled?: boolean;
    className?: string;
}

export function Checkbox({ checked, indeterminate, onChange, label, disabled, className = '' }: CheckboxProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.indeterminate = !!indeterminate;
        }
    }, [indeterminate]);

    return (
        <label className={`cgptx-checkbox-wrapper ${disabled ? 'disabled' : ''} ${className}`}>
            <div className="cgptx-checkbox-input-wrapper">
                <input
                    ref={inputRef}
                    type="checkbox"
                    className="cgptx-checkbox-input"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => onChange(e.currentTarget.checked)}
                />
                <div className="cgptx-checkbox-custom">
                    <svg viewBox="0 0 24 24" className="cgptx-checkbox-icon check">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <svg viewBox="0 0 24 24" className="cgptx-checkbox-icon minus">
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                </div>
            </div>
            {label && <span className="cgptx-checkbox-label">{label}</span>}
        </label>
    );
}

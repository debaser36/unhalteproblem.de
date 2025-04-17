import React from 'react';

interface VeryCoolButtonProps {
    color?: 'indigo' | 'blue' | 'red' | 'green' | 'purple' | 'gray';
    onClick?: () => void;
    icon?: React.ReactNode;
    buttonText?: string;
    extraClasses?: string;
    overrideClasses?: boolean;
    position?: 'top-right' | 'bottom-right' | 'none';
}

const VeryCoolButton: React.FC<VeryCoolButtonProps> = (props) => {
    const { 
        color = 'indigo',
        extraClasses = '',
        overrideClasses = false,
        position = 'none',
        onClick,
        icon,
        buttonText = 'Very Cool Button'
    } = props;

    const generateClasses = () => {
        if (overrideClasses) return extraClasses;

        // Base classes
        const baseClasses = `
            flex items-center justify-center
            px-3 py-2 sm:px-4 sm:py-2
            text-sm sm:text-base text-white
            font-medium sm:font-semibold rounded-lg
            shadow-md transition duration-200
            focus:outline-none focus:ring-2 focus:ring-offset-2
            ease-in-out transform
            hover:scale-95
        `;

        // Position classes
        let positionClasses = '';
        if (position === 'top-right') {
            positionClasses = 'fixed top-4 right-4 z-10';
        } else if (position === 'bottom-right') {
            positionClasses = 'fixed bottom-4 right-4 z-10';
        }

        // Color classes
        const colorClasses = `
            bg-${color}-600
            hover:bg-${color}-700
            focus:ring-${color}-500
        `;

        return `${baseClasses} ${positionClasses} ${colorClasses} ${extraClasses}`;
    };

    return (
        <button
            onClick={onClick}
            className={generateClasses()}
        >
            {icon && <span className="mr-2">{icon}</span>}
            {buttonText}
        </button>
    );
};

export default VeryCoolButton;
import React, { useState, useRef, useEffect } from 'react';

// Define types for menu items
type MenuItem = {
  id: string;
  label: string;
  path?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  color?: string;
  divider?: boolean;
};

// Define the props interface
interface DropdownMenuProps {
  items: MenuItem[][];  // Array of arrays for grouped items
  color?: 'indigo' | 'blue' | 'red' | 'green' | 'purple' | 'gray';
  onSelect?: (id: string) => void;
  icon?: React.ReactNode;
  buttonText?: string;
}

const DropdownMenu: React.FC<DropdownMenuProps> = (props) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { 
    items, 
    color = 'indigo', 
    onSelect, 
    icon, 
    buttonText = 'Options' 
  } = props;

  // Handle clicks outside the dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Map color prop to Tailwind classes
  const getColorClasses = (colorName: string) => {
    const colorMap: Record<string, { bg: string, hover: string, focus: string, text: string, hoverBg: string }> = {
      indigo: { 
        bg: 'bg-indigo-600', 
        hover: 'hover:bg-indigo-700', 
        focus: 'focus:ring-indigo-500',
        text: 'text-indigo-500',
        hoverBg: 'hover:bg-indigo-50'
      },
      blue: { 
        bg: 'bg-blue-600', 
        hover: 'hover:bg-blue-700', 
        focus: 'focus:ring-blue-500',
        text: 'text-blue-500',
        hoverBg: 'hover:bg-blue-50'
      },
      red: { 
        bg: 'bg-red-600', 
        hover: 'hover:bg-red-700', 
        focus: 'focus:ring-red-500',
        text: 'text-red-500',
        hoverBg: 'hover:bg-red-50'
      },
      green: { 
        bg: 'bg-green-600', 
        hover: 'hover:bg-green-700', 
        focus: 'focus:ring-green-500',
        text: 'text-green-500',
        hoverBg: 'hover:bg-green-50'
      },
      purple: { 
        bg: 'bg-purple-600', 
        hover: 'hover:bg-purple-700', 
        focus: 'focus:ring-purple-500',
        text: 'text-purple-500',
        hoverBg: 'hover:bg-purple-50'
      },
      gray: { 
        bg: 'bg-gray-600', 
        hover: 'hover:bg-gray-700', 
        focus: 'focus:ring-gray-500',
        text: 'text-gray-500',
        hoverBg: 'hover:bg-gray-50'
      }
    };

    return colorMap[colorName] || colorMap.indigo;
  };

  const colorClasses = getColorClasses(color);

  // Handle item click
  const handleItemClick = (item: MenuItem) => {
    if (item.onClick) {
      item.onClick();
    }
    if (onSelect) {
      onSelect(item.id);
    }
    setIsOpen(false);
  };

  // Default chevron icon if none provided
  const defaultIcon = (
    <svg
      className="ml-2 h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        className={`inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white ${colorClasses.bg} rounded-md shadow-sm ${colorClasses.hover} focus:outline-none focus:ring-2 focus:ring-offset-2 ${colorClasses.focus}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {buttonText}
        {icon || defaultIcon}
      </button>
  
      {isOpen && (
        <div className=" absolute left-full top-0 ml-2 flex flex-row items-start gap-1 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-10 p-2">
          {items.flat().map((item) => (
            <a 
              key={item.id}
              href="#" 
              className={`group flex flex-col items-center justify-center px-3 py-2 text-sm text-gray-700 ${colorClasses.hoverBg} hover:text-gray-900 rounded`}
              onClick={(e) => {
                e.preventDefault();
                handleItemClick(item);
              }}
            >
              {item.icon && (
                <span className=" mb-1 w-5 h-5 text-gray-500 group-hover:text-gray-900">
                  {item.icon}
                </span>
              )}
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
  
  
};

export default DropdownMenu;
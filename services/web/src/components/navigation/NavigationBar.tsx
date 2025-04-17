import React from 'react';
import { useNavigate } from 'react-router-dom';
import DropdownMenu from "./DropdownMenu";
import { Menu } from 'lucide-react';
import { navigationItems, ExtendedMenuItem } from './NavItems';

const NavigationBar: React.FC = () => {
  const navigate = useNavigate();

  // Handle navigation when menu item is selected
  const onSelect = (id: string) => {
    // Find the selected item in the navigation items
    const flattenedItems = navigationItems.flat();
    const selectedItem = flattenedItems.find(item => item.id === id) as ExtendedMenuItem;
    
    if (selectedItem && selectedItem.path) {
      console.log(`Navigating to: ${selectedItem.path}`);
      navigate(selectedItem.path);
    }
  };

  return (
    <div className="flex items-center justify-between p-2 sm:p-4 bg-white shadow w-full">
      <div className="w-full grid grid-cols-3 items-center">
        {/* Left section with dropdown menu */}
        <div className="justify-self-start">
          <DropdownMenu 
            items={navigationItems}
            onSelect={onSelect}
            color="indigo"
            buttonText="Menu"
            icon={<Menu className="ml-2 h-4 w-4" />}
            direction="down" // Make the dropdown open downward
          />
        </div>
        
        {/* Center section with app name */}
        <div className="text-lg font-semibold justify-self-center">
          Unhalteproblem
        </div>
        
        {/* Right section (empty for balance) */}
        <div className="justify-self-end">
          {/* Empty div for layout balance */}
        </div>
      </div>
    </div>
  );
};

export default NavigationBar;
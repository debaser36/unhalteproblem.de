
export interface DropdownItem {
    id: string;
    label: string;
    path: string;
  }
  
  export interface MenuItem {
    id: string;
    label: string;
    dropdownItems: DropdownItem[];
  }
  
  export interface NavMenuItemProps {
    menuItem: MenuItem;
    isActive: boolean;
    onToggle: () => void;
  }
  
  export interface DropdownMenuProps {
    id: string;
    items: DropdownItem[];
  }
  
  export interface NavigationBarProps {
    children?: React.ReactNode;
    menuItems?: MenuItem[]; 
  }
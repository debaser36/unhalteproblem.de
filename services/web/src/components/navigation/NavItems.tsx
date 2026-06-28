import {HomeIcon, MailIcon, PackageIcon, WrenchIcon} from "lucide-react"  
  // Extended MenuItem type with path property
  export type ExtendedMenuItem = {
    id: string;
    label: string;
    path: string;
    icon?: React.ReactNode;
    onClick?: () => void;
    color?: string;
  };
  


// Navigation items with route paths and smaller icons
export const navigationItems : ExtendedMenuItem[][] = [
    [
      {
        id: 'home',
        label: 'Home',
        path: '/',
        icon: (
          <HomeIcon className="w-5 h-5"/>),
      },
      /* {
        id: 'dashboard',
        label: 'Dashboard',
        path: '/dashboard',
        icon:(<LayoutDashboardIcon className="w-5 h-5"/>),
      }, */
      /* {
        id: 'profile',
        label: 'Profile',
        path: '/profile',
        icon: (<UserIcon className="w-5 h-5"/>
        ),
      } */
    ],
    [
      {
        id: 'contact',
        label: 'Contact',
        path: '/contact',
        icon: (
          <MailIcon className="w-5 h-5"/>
        ),
      },
      {
        id: 'games',
        label: 'Games',
        path: '/games',
        icon: (
          <PackageIcon className="w-5 h-5" />
        ),
      },
      {
        id: 'tools',
        label: 'Tools',
        path: '/tools',
        icon: (
          <WrenchIcon  className="w-5 h-5"/>
)
      }
    ]
  ];
  

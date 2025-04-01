import React, { memo } from 'react';
import { Dropdown } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { NavMenuItemProps } from '../../types/navigation';

const NavMenuItem: React.FC<NavMenuItemProps> = memo(({ menuItem }) => {
  return (
    <Dropdown as="li" className="nav-item">
      <Dropdown.Toggle as="button" className="nav-link">
        {menuItem.label} <span className="dropdown-icon">▼</span>
      </Dropdown.Toggle>

      <Dropdown.Menu>
        {menuItem.dropdownItems.map((item) => (
          <Dropdown.Item key={item.id} as={Link} to={item.path}>
            {item.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
});

NavMenuItem.displayName = 'NavMenuItem';

export default NavMenuItem;

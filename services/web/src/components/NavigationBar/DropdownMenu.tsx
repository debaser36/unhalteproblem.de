import React from 'react';
import { Link } from 'react-router-dom';
import { Dropdown } from 'react-bootstrap';
import { DropdownMenuProps } from '../../types/navigation';

const DropdownMenu: React.FC<DropdownMenuProps> = ({ id, items }) => {
  return (
    <Dropdown.Menu id={id}>
      {items.map((item) => (
        <Dropdown.Item 
          as={Link}  // Use React Router's Link with Bootstrap
          to={item.path} 
          key={item.id}
        >
          {item.label}
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  );
};

export default DropdownMenu;

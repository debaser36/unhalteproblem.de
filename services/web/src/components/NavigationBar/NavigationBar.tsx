import React from 'react';
import { Navbar, Nav, Container, Dropdown } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { MenuItem, NavigationBarProps } from '../../types/navigation';

const defaultMenuItems: MenuItem[] = [
  {
    id: 'home',
    label: 'Home',
    dropdownItems: [
      { id: 'dashboard', label: 'Dashboard', path: '/dashboard' },
      { id: 'profile', label: 'Profile', path: '/profile' }
    ]
  },
  {
    id: 'about',
    label: 'About',
    dropdownItems: [
      { id: 'contact', label: 'Contact', path: '/contact' }
    ]
  },
  {
    id: 'projects',
    label: 'Projects',
    dropdownItems: [
        {id: 'snake', label: 'Snake', path: '/games/snake'}
    ]
  }
];

const NavigationBar: React.FC<NavigationBarProps> = ({ children, menuItems = defaultMenuItems }) => {
  return (
    <Navbar expand="lg" bg="dark" variant="dark" className="navigation-bar">
      <Container>
        {/* Logo */}
        <Navbar.Brand as={Link} to="/">Logo</Navbar.Brand>

        {/* Mobile Menu Toggle */}
        <Navbar.Toggle aria-controls="basic-navbar-nav" />

        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
            {menuItems.map((menuItem) => (
              <Dropdown key={menuItem.id}>
                <Dropdown.Toggle variant="secondary" id={`dropdown-${menuItem.id}`}>
                  {menuItem.label}
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  {menuItem.dropdownItems.map((item) => (
                    <Dropdown.Item key={item.id} as={Link} to={item.path}>
                      {item.label}
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown>
            ))}
          </Nav>

          {/* Additional Right-Side Actions (e.g., Login Button) */}
          <Nav className="ms-auto">
            {children}
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

export default NavigationBar;

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Container, Button } from 'react-bootstrap'; // Import React-Bootstrap components

import NavigationBar from './components/NavigationBar/NavigationBar';
import Home from './components/pages/Home';

import './styles/index.scss'; // Import global Sass styles
import GAME_SNAKE from './components/pages/games/Snake';

// Example placeholder components for routes
const Dashboard = () => <div className="page">Dashboard Page</div>;
const Profile = () => <div className="page">Profile Page</div>;
const Contact = () => <div className="page">Contact Page</div>;
const Games = () => <div className="page">Games Overview Page</div>;
const GameSnake = () => GAME_SNAKE({})

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Container className="app"> {/* Use React-Bootstrap Container */}
        <NavigationBar>
          <Button variant="primary" className="login-button">
            Login
          </Button>
        </NavigationBar>

        <main className="content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/games" element={<Games />} />
            <Route path="/games/snake" element={<GameSnake />} />
          </Routes>
        </main>

        <footer className="text-center mt-4"> {/* Bootstrap utility classes */}
          <p>©2025 Nico - All rights reserved</p>
        </footer>
      </Container>
    </BrowserRouter>
  );
};

export default App;

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import NavigationBar from './components/navigation/NavigationBar';
import './styles/global.css';

// Page components
const Home: React.FC = () => <div className="p-6"><h1 className="text-2xl font-bold">Home</h1><p>Welcome to the home page!</p></div>;
const Dashboard: React.FC = () => <div className="p-6"><h1 className="text-2xl font-bold">Dashboard</h1><p>Your dashboard content here</p></div>;
const Profile: React.FC = () => <div className="p-6"><h1 className="text-2xl font-bold">Profile</h1><p>User profile information</p></div>;
const Contact: React.FC = () => <div className="p-6"><h1 className="text-2xl font-bold">Contact</h1><p>Contact information and form</p></div>;
const Games: React.FC = () => <div className="p-6"><h1 className="text-2xl font-bold">Games</h1><p>Game library and features</p></div>;

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <div className="flex flex-col min-h-screen">
        <NavigationBar />
        <div className="container mx-auto px-4">
          <main className="flex-grow py-5">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/games" element={<Games />} />
            </Routes>
          </main>
          <footer className="py-4 border-t border-gray-200">
            <p className="text-center text-gray-600">©2025 Nico - All rights reserved</p>
          </footer>
        </div>
      </div>
    </BrowserRouter>
  );
};

export default App;
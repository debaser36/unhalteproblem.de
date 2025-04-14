import React from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import NavigationBar from './components/navigation/NavigationBar';
import './styles/global.css';
import VeryCoolButton from './components/general/VeryCoolButton';

// Page components
const Home: React.FC = () => <div className="p-6"><h1 className="text-2xl font-bold">Home</h1><p>Welcome to the home page!</p></div>;
const Dashboard: React.FC = () => <div className="p-6"><h1 className="text-2xl font-bold">Dashboard</h1><p>Your dashboard content here</p></div>;
const Profile: React.FC = () => <div className="p-6"><h1 className="text-2xl font-bold">Profile</h1><p>User profile information</p></div>;
const Contact: React.FC = () => <div className="p-6"><h1 className="text-2xl font-bold">Contact</h1><p>Contact information and form</p></div>;
const Games: React.FC = () => <div className="p-6"><h1 className="text-2xl font-bold">Games</h1><p>Game library and features</p></div>;
const LoginScreen: React.FC = () => <div className="p-6"><h1 className="text-2xl font-bold">Login</h1><p>Login form and authentication</p></div>;



const App: React.FC = () => {
  const navigate = useNavigate();
  return (
      <div className="flex flex-row max-h-15 ">
        <NavigationBar />
        <VeryCoolButton color={'blue'} buttonText='Login' onClick={() => navigate("/login")}/>
        <div className="container mx-auto px-4">
        
          <main className="flex-grow py-5">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/games" element={<Games />} />
              <Route path="/login" element={<LoginScreen />} />
            </Routes>
          </main>
          <footer className="py-4 border-t border-gray-200">
            <p className="text-center text-gray-600">©2025 Nico - All rights reserved</p>
          </footer>
        </div>
      </div>
  );
};

export default App;
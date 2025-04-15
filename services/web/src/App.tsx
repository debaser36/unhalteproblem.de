// App.tsx
import React from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import NavigationBar from './components/navigation/NavigationBar';
import './styles/global.css';
import VeryCoolButton from './components/general/VeryCoolButton';
import LoginPage from './components/pages/LoginPage';

// Page components
const Home: React.FC = () => (
  <div className="p-4 text-center">
    <h1 className="text-2xl font-bold">Home</h1>
    <p>Welcome to the home page!</p>
  </div>
);

const Dashboard: React.FC = () => (
  <div className="p-4 text-center">
    <h1 className="text-2xl font-bold">Dashboard</h1>
    <p>Your dashboard content here</p>
  </div>
);

const Profile: React.FC = () => (
  <div className="p-4 text-center">
    <h1 className="text-2xl font-bold">Profile</h1>
    <p>User profile information</p>
  </div>
);

const Contact: React.FC = () => (
  <div className="p-4 text-center">
    <h1 className="text-2xl font-bold">Contact</h1>
    <p>Contact information and form</p>
  </div>
);

const Games: React.FC = () => (
  <div className="p-4 text-center">
    <h1 className="text-2xl font-bold">Games</h1>
    <p>Game library and features</p>
  </div>
);

const App: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 text-gray-900">
      <header className="shadow-md bg-white">
        <NavigationBar />
      </header>

      <main className="flex-grow">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/games" element={<Games />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </main>

      <footer className="bg-white text-center py-4 text-sm border-t">
        ©2025 Nico - All rights reserved
      </footer>

      {/* Example button to trigger login navigation */}

        <VeryCoolButton onClick={() => navigate('/login')} color='blue' buttonText='Login' extraClasses='w-32'>
        </VeryCoolButton>

    </div>
  );
};

export default App;

// App.tsx
import React from 'react';
import { Routes, Route, /* useNavigate, */ useLocation } from 'react-router-dom';
import NavigationBar from './components/navigation/NavigationBar';
import './styles/global.css';
import LoginPage from './components/pages/LoginPage';
import ToolPage from './components/pages/ToolPage';
import KiwiCalc from './components/pages/KiwiCalc';
import HomePage from './components/pages/HomePage';
import Layout from './Layout';

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
  const location = useLocation();

  return (
    <Layout>
      <header className="shadow-md bg-transparent">
        {location.pathname !== '/login' && <NavigationBar />}
      </header>

      <main className="grow px-4 md:px-8 py-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/games" element={<Games />} />
          <Route path="/tools" element={<ToolPage />}/>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/tools/kiwiCalc" element={<KiwiCalc></KiwiCalc>}/>
        </Routes>
      </main>
      <footer className="bg-card text-card-foreground border-t border-border text-center py-4 text-xs sm:text-sm">
        ©2026 Nico - All rights reserved
      </footer>
    </Layout>
  );
};

export default App;
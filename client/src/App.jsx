import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import BottomNav from './components/BottomNav';
import Login from './pages/Login';
import Search from './pages/Search';
import Friends from './pages/Friends';
import Profile from './pages/Profile';

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <main key={location.pathname} className="max-w-lg mx-auto pb-24 animate-tab-enter">
      <Routes location={location}>
        <Route path="/" element={<Navigate to="/search" replace />} />
        <Route path="/search" element={<Search />} />
        <Route path="/friends" element={<Friends />} />
        <Route path="/friends/:id" element={<Friends />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/search" replace />} />
      </Routes>
    </main>
  );
}

function AppRoutes() {
  const { token } = useAuth();

  if (!token) return <Login />;

  return (
    <div className="min-h-screen bg-page text-main transition-colors duration-200">
      <AnimatedRoutes />
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
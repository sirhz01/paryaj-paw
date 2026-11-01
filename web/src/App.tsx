import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Account from './pages/Account';
import Contact from './pages/Contact';
import Cgu from './pages/legal/Cgu';
import Rgpd from './pages/legal/Rgpd';
import NotFound from './pages/NotFound';
import GamePlaceholder from './pages/GamePlaceholder';
import Keno from './pages/games/Keno';
import Lobby from './pages/Lobby';
import Login from './pages/Login';
import Register from './pages/Register';
import Wallet from './pages/Wallet';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Lobby />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="contact" element={<Contact />} />
        <Route path="rgpd" element={<Rgpd />} />
        <Route path="cgu" element={<Cgu />} />
        <Route
          path="wallet"
          element={
            <ProtectedRoute>
              <Wallet />
            </ProtectedRoute>
          }
        />
        <Route
          path="account"
          element={
            <ProtectedRoute>
              <Account />
            </ProtectedRoute>
          }
        />
        <Route
          path="play/keno"
          element={
            <ProtectedRoute>
              <Keno />
            </ProtectedRoute>
          }
        />
        <Route
          path="play/:game"
          element={
            <ProtectedRoute>
              <GamePlaceholder />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import LoginPage from './pages/LoginPage';
import EventsPage from './pages/EventsPage';
import DashboardPage from './pages/DashboardPage';
import CheckInPage from './pages/CheckInPage';
import GuestListPage from './pages/GuestListPage';
import GuestDetailPage from './pages/GuestDetailPage';
import ActivitiesPage from './pages/ActivitiesPage';
import UsersPage from './pages/UsersPage';
import StaffDetailPage from './pages/StaffDetailPage';
import StaffDashboardPage from './pages/StaffDashboardPage';
import LeaderboardPage from './pages/LeaderboardPage';
import ImportPage from './pages/ImportPage';
import ImportHistoryPage from './pages/ImportHistoryPage';
import RegistrationPage from './pages/RegistrationPage';
import PendingRequestsPage from './pages/PendingRequestsPage';
import AcceptInvitationPage from './pages/AcceptInvitationPage';
import PendingApprovalPage from './pages/PendingApprovalPage';
import Layout from './components/Layout';

function ProtectedRoute({ children, adminOnly = false, user }) {
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const auth = useAuth();
  const theme = useTheme();

  return (
    <Routes>
      <Route path="/login" element={auth.user ? <Navigate to="/" replace /> : <LoginPage onLogin={auth.login} />} />
      <Route path="/register" element={auth.user ? <Navigate to="/" replace /> : <RegistrationPage />} />
      <Route path="/invitation/:token" element={auth.user ? <Navigate to="/" replace /> : <AcceptInvitationPage />} />
      <Route path="/pending-approval/:requestId" element={auth.user ? <Navigate to="/" replace /> : <PendingApprovalPage />} />
      <Route path="/" element={
        <ProtectedRoute user={auth.user}>
          <Layout user={auth.user} onLogout={auth.logout} theme={theme} />
        </ProtectedRoute>
      }>
        <Route index element={auth.isAdmin ? <EventsPage /> : <Navigate to="/checkin" replace />} />
        <Route path="events/:eventId" element={<DashboardPage />} />
        <Route path="checkin" element={<CheckInPage user={auth.user} />} />
        <Route path="events/:eventId/guests" element={<GuestListPage />} />
        <Route path="events/:eventId/import/history" element={<ImportHistoryPage />} />
        <Route path="events/:eventId/import" element={<ImportPage />} />
        <Route path="events/:eventId/guests/:guestId" element={<GuestDetailPage />} />
        <Route path="events/:eventId/activities" element={<ActivitiesPage />} />
        <Route path="users" element={<ProtectedRoute user={auth.user} adminOnly><UsersPage /></ProtectedRoute>} />
        <Route path="pending" element={<ProtectedRoute user={auth.user} adminOnly><PendingRequestsPage /></ProtectedRoute>} />
        <Route path="staff/:staffId" element={<ProtectedRoute user={auth.user} adminOnly><StaffDetailPage /></ProtectedRoute>} />
        <Route path="staff/me" element={<StaffDashboardPage />} />
        <Route path="leaderboard" element={<ProtectedRoute user={auth.user} adminOnly><LeaderboardPage /></ProtectedRoute>} />
      </Route>
    </Routes>
  );
}

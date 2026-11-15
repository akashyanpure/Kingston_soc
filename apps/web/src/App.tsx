import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { PortalShell, RequireRole } from './components/PortalShell';
import { RequireSession, Shell } from './components/Shell';
import { ScreenSkeleton } from './components/ui';
import { allowedPath, homeFor } from './lib/portal';
import { useSession } from './lib/session';
import { Account } from './screens/Account';
import { Camera } from './screens/Camera';
import { Done } from './screens/Done';
import { Login } from './screens/Login';
import { NewVisit } from './screens/NewVisit';
import { Room } from './screens/Room';
import { VisitOverview } from './screens/VisitOverview';
import { Visits } from './screens/Visits';

// Split out: the report renderer (Review) and the desktop portals. All chunks are precached by the service worker.
const Review = lazy(() => import('./screens/Review').then((m) => ({ default: m.Review })));
const ManageDashboard = lazy(() => import('./screens/manage/Dashboard').then((m) => ({ default: m.ManageDashboard })));
const ManageSchedule = lazy(() => import('./screens/manage/Schedule').then((m) => ({ default: m.ManageSchedule })));
const ManageReports = lazy(() => import('./screens/manage/Reports').then((m) => ({ default: m.ManageReports })));
const AdminUsers = lazy(() => import('./screens/admin/Users').then((m) => ({ default: m.AdminUsers })));
const AdminLibrary = lazy(() => import('./screens/admin/Library').then((m) => ({ default: m.AdminLibrary })));
const AdminFormSchemes = lazy(() => import('./screens/admin/FormSchemes').then((m) => ({ default: m.AdminFormSchemes })));
const AdminSystem = lazy(() => import('./screens/admin/System').then((m) => ({ default: m.AdminSystem })));

/** After sign-in: back to where the user was going if their role allows it, else their role's home (ROLE_HOME). */
function LoginRoute() {
  const session = useSession();
  const loc = useLocation();
  if (session === undefined) return null;
  if (!session) return <Login />;
  const from = (loc.state as { from?: string } | null)?.from;
  return <Navigate to={from && allowedPath(session.role, from) ? from : homeFor(session.role)} replace />;
}

/** "/" → the signed-in role's home. */
function RoleHome() {
  const session = useSession();
  if (session === undefined) return null;
  return <Navigate to={session ? homeFor(session.role) : '/login'} replace />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}><ScreenSkeleton /></div>}>
      <Routes>
        <Route index element={<RoleHome />} />
        <Route element={<Shell />}>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<RequireSession />}>
            <Route path="visits" element={<Visits />} />
            <Route path="visits/new" element={<NewVisit />} />
            <Route path="visits/:visitId" element={<VisitOverview />} />
            <Route path="visits/:visitId/rooms/:roomId" element={<Room />} />
            <Route path="visits/:visitId/photo" element={<Camera />} />
            <Route path="visits/:visitId/review" element={<Review />} />
            <Route path="visits/:visitId/done" element={<Done />} />
            <Route path="account" element={<Account />} />
          </Route>
        </Route>
        <Route element={<RequireRole area="manage" />}>
          <Route element={<PortalShell />}>
            <Route path="manage" element={<ManageDashboard />} />
            <Route path="manage/visits" element={<ManageSchedule />} />
            <Route path="manage/reports" element={<ManageReports />} />
          </Route>
        </Route>
        <Route element={<RequireRole area="admin" />}>
          <Route element={<PortalShell />}>
            <Route path="admin" element={<AdminUsers />} />
            <Route path="admin/library" element={<AdminLibrary />} />
            <Route path="admin/form" element={<AdminFormSchemes />} />
            <Route path="admin/system" element={<AdminSystem />} />
          </Route>
        </Route>
        <Route path="manager" element={<Navigate to="/manage" replace />} />
        <Route path="*" element={<RoleHome />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

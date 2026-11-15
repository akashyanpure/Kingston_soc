import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { RequireSession, Shell } from './components/Shell';
import { useSession } from './lib/session';
import { Account } from './screens/Account';
import { Camera } from './screens/Camera';
import { Done } from './screens/Done';
import { Login } from './screens/Login';
import { NewVisit } from './screens/NewVisit';
import { Room } from './screens/Room';
import { VisitOverview } from './screens/VisitOverview';
import { Visits } from './screens/Visits';

// Split out: the report renderer (Review) and the desktop manager view. Both chunks are precached by the service worker.
const Review = lazy(() => import('./screens/Review').then((m) => ({ default: m.Review })));
const Manager = lazy(() => import('./screens/Manager').then((m) => ({ default: m.Manager })));

function LoginRoute() {
  const session = useSession();
  const loc = useLocation();
  if (session === undefined) return null;
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  return session ? <Navigate to={from} replace /> : <Login />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<RequireSession />}>
          <Route index element={<Visits />} />
          <Route path="visits/new" element={<NewVisit />} />
          <Route path="visits/:visitId" element={<VisitOverview />} />
          <Route path="visits/:visitId/rooms/:roomId" element={<Room />} />
          <Route path="visits/:visitId/photo" element={<Camera />} />
          <Route path="visits/:visitId/review" element={<Review />} />
          <Route path="visits/:visitId/done" element={<Done />} />
          <Route path="account" element={<Account />} />
        </Route>
      </Route>
      <Route element={<Shell wide />}>
        <Route element={<RequireSession />}>
          <Route path="manager" element={<Manager />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<p className="small muted" style={{ padding: 16 }}>Loading…</p>}>
        <AppRoutes />
      </Suspense>
    </BrowserRouter>
  );
}

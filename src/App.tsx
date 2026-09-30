import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

const Admin = lazy(() => import('./admin/Admin').then((module) => ({ default: module.Admin })));
const Player = lazy(() => import('./player/Player').then((module) => ({ default: module.Player })));

export function App() {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <main className="route-loading" role="status">
            Chargement…
          </main>
        }
      >
        <Routes>
          <Route path="/display" element={<Player />} />
          <Route
            path="/admin/*"
            element={
              <Admin demoMode={new URLSearchParams(window.location.search).get('demo') === '1'} />
            }
          />
          <Route path="*" element={<Navigate to="/display" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

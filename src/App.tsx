import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Admin } from './admin/Admin';
import { Player } from './player/Player';

export function App() {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}

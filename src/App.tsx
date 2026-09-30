import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Admin } from './admin/Admin';
import { Display } from './display/Display';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/display" element={<Display />} />
        <Route path="/admin/*" element={<Admin />} />
        <Route path="*" element={<Navigate to="/display" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

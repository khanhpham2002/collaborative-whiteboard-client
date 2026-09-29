import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import WhiteboardRoom from './pages/WhiteboardRoom';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<WhiteboardRoom />} />
        <Route path="/room/:roomId" element={<WhiteboardRoom />} />
      </Routes>
    </Router>
  );
}

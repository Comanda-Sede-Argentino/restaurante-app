import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import AccesoGate from './components/AccesoGate.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AccesoGate>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AccesoGate>
  </React.StrictMode>
);

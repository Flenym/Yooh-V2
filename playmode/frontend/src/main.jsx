import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './styles.css';

if (typeof window !== 'undefined' && typeof window.global === 'undefined') {
  window.global = window;
}

createRoot(document.getElementById('root')).render(<App />);

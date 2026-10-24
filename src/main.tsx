import {createRoot} from 'react-dom/client';
import { config } from '@fortawesome/fontawesome-svg-core';
import App from './App.tsx';
import './index.css';

config.autoAddCss = false;

createRoot(document.getElementById('root')!).render(<App />);

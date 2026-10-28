import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App demoMode={import.meta.env.DEV && import.meta.env.VITE_CABMS_DEMO === 'true'} />);

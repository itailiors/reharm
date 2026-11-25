import '../design/tokens.css';
import './ui/styles.css';
import './ui/app.css';
import { ReharmApp } from './ui/app';

declare global {
  interface Window { reharm?: ReharmApp }
}

const start = () => {
  window.reharm = new ReharmApp();
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

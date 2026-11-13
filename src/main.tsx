import ReactDOM from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/geist';
import './styles.css';

document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);

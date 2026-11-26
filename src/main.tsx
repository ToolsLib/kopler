import ReactDOM from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { App } from './App';
import '@fontsource-variable/geist';
import './styles.css';

const ImageViewer = lazy(() => import('./ImageViewer').then(module => ({ default: module.ImageViewer })));

document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const imageId = new URLSearchParams(location.search).get('image');
ReactDOM.createRoot(document.getElementById('root')!).render(imageId ? <Suspense fallback={<p role="status">Opening image…</p>}><ImageViewer imageId={imageId} /></Suspense> : <App />);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@learning-more/ui/styles.css';

import { App } from './app.js';
import './styles.css';

window.addEventListener('keydown', (event) => {
  if (
    ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
  ) {
    document.documentElement.dataset.inputModality = 'keyboard';
  }
});
window.addEventListener('pointerdown', () => {
  document.documentElement.dataset.inputModality = 'pointer';
});

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Missing #root element');
}

const visualFixtureId =
  import.meta.env.MODE === 'visual' && window.location.pathname.startsWith('/__visual/')
    ? decodeURIComponent(window.location.pathname.slice('/__visual/'.length))
    : undefined;

if (visualFixtureId === undefined) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} else {
  void import('./visual/visual-fixture-app.js').then(({ VisualFixtureApp }) => {
    createRoot(rootElement).render(<VisualFixtureApp fixtureId={visualFixtureId} />);
  });
}

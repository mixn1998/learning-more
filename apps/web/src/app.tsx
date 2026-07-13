import { BrowserRouter } from 'react-router-dom';

import { AppRoutes } from './router.js';

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

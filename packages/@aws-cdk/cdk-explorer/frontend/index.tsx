import '@cloudscape-design/global-styles/index.css';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

applyMode(Mode.Light);

const container = document.getElementById('root');
if (!container) {
  throw new Error('CDK Explorer: #root element not found');
}
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

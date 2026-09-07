import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ControlApp from './control/ControlApp';
import { OutputApp } from './output/OutputApp';
import TresMasasApp from './tresmasas/TresMasasApp';
import FluidsEditorApp from './fluids-show/FluidsEditorApp';
import './styles.css';

const view = new URLSearchParams(window.location.search).get('view');
const pathname = window.location.pathname.replace(/\/+$/, '');
const tresMasas = view === 'tresmasas' || view === 'tres-masas'
  || pathname.endsWith('/tresmasas') || pathname.endsWith('/tres-masas');
const fluids = !tresMasas && (view === 'fluids' || pathname.endsWith('/fluids'));
const output = !tresMasas && !fluids
  && (window.location.pathname.startsWith('/output') || view === 'output');
document.documentElement.dataset.view = tresMasas ? 'tres-masas'
  : fluids ? 'fluids'
  : output ? 'output'
  : 'control';
document.title = tresMasas ? 'Radiance · Tres Masas'
  : fluids ? 'Radiance · Fluids'
  : output ? 'Radiance · Output'
  : 'Radiance · Control';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {tresMasas ? <TresMasasApp />
      : fluids ? <FluidsEditorApp />
      : output ? <OutputApp />
      : <ControlApp />}
  </StrictMode>,
);

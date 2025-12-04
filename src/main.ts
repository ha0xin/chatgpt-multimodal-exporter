

import { mountUI } from './ui';
import { U } from './utils';

function boot() {
  if (!U.isHostOK()) return;
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    mountUI();
  } else {
    document.addEventListener('DOMContentLoaded', mountUI);
  }
}

boot();

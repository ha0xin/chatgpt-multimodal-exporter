

import { mountUI } from './ui';
import { isHostOK } from './utils';

function boot() {
  if (!isHostOK()) return;
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    mountUI();
  } else {
    document.addEventListener('DOMContentLoaded', mountUI);
  }
}

boot();

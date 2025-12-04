import { U } from './utils';
import { injectStyles } from './ui/styles';
import { mountMiniEntry } from './ui/miniEntry';

export function mountUI() {
  if (!U.isHostOK()) return;
  if (U.qs('#cgptx-mini-btn')) return;

  injectStyles();
  mountMiniEntry();
}

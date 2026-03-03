export const CHATGPT_ICON_BUTTON_CLASS = [
  'cgptx-mini-btn',
  'text-token-text-tertiary',
  'no-draggable',
  'hover:bg-token-surface-hover',
  'dark:hover:bg-token-main-surface-tertiary',
  'keyboard-focused:bg-token-surface-hover',
  'touch:h-10',
  'touch:w-10',
  'flex',
  'h-9',
  'w-9',
  'items-center',
  'justify-center',
  'rounded-lg',
  'focus:outline-none',
  'disabled:opacity-50',
].join(' ');

export const CHATGPT_MODAL_OVERLAY_CLASS = [
  'cgptx-modal',
  'fixed',
  'inset-0',
  'z-50',
  'before:starting:backdrop-blur-0',
  'before:absolute',
  'before:inset-0',
  'before:bg-gray-200/50',
  'before:backdrop-blur-[1px]',
  'not-motion-reduce:before:transition',
  'not-motion-reduce:before:duration-250',
  'dark:before:bg-black/50',
  'before:starting:opacity-0',
].join(' ');

export const CHATGPT_MODAL_GRID_CLASS = 'z-50 h-full w-full overflow-y-auto grid grid-cols-[10px_1fr_10px] grid-rows-[minmax(10px,1fr)_auto_minmax(10px,1fr)] md:grid-rows-[minmax(20px,0.8fr)_auto_minmax(20px,1fr)]';

export const CHATGPT_MODAL_BOX_CLASS = 'cgptx-modal-box popover bg-token-bg-primary relative col-auto col-start-2 row-auto row-start-2 h-full w-full text-start start-1/2 ltr:-translate-x-1/2 rtl:translate-x-1/2 rounded-2xl shadow-long flex flex-col focus:outline-hidden overflow-hidden max-h-[85vh] max-md:min-h-[60vh] md:h-[600px] md:max-w-[680px]';

export const CHATGPT_MODAL_HEADER_CLASS = 'cgptx-modal-header min-h-header-height flex justify-between p-2.5 ps-4 select-none border-token-border-light border-b gap-2';

export const CHATGPT_MODAL_TITLE_CLASS = 'cgptx-modal-title w-full text-lg font-normal text-token-text-primary truncate select-none';

export const CHATGPT_PANEL_CLASS = 'text-token-text-primary relative flex w-full flex-col overflow-y-auto px-4 text-sm max-md:max-h-[calc(100vh-150px)] md:min-h-[380px]';

export const CHATGPT_CLOSE_BUTTON_CLASS = 'text-token-text-tertiary no-draggable hover:bg-token-surface-hover dark:hover:bg-token-main-surface-tertiary keyboard-focused:bg-token-surface-hover touch:h-10 touch:w-10 flex h-9 w-9 items-center justify-center rounded-lg focus:outline-none disabled:opacity-50';

export const CHATGPT_SETTINGS_LEFT_CLOSE_BUTTON_CLASS = 'flex h-9 w-9 items-center justify-center rounded-lg hover:bg-token-surface-hover dark:hover:bg-token-main-surface-tertiary keyboard-focused:bg-token-surface-hover bg-transparent';

export const CHATGPT_SECONDARY_BUTTON_CLASS = 'btn relative group-focus-within/dialog:focus-visible:[outline-width:1.5px] group-focus-within/dialog:focus-visible:[outline-offset:2.5px] group-focus-within/dialog:focus-visible:[outline-style:solid] group-focus-within/dialog:focus-visible:[outline-color:var(--text-primary)] btn-secondary shrink-0';

export const CHATGPT_SELECT_BUTTON_CLASS = 'text-token-text-primary border border-transparent inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-white px-3 text-sm dark:transparent dark:bg-transparent leading-none outline-hidden cursor-pointer hover:bg-token-main-surface-secondary dark:hover:bg-token-main-surface-secondary keyboard-focused:bg-token-main-surface-secondary radix-state-active:text-token-text-secondary radix-disabled:cursor-auto radix-disabled:bg-transparent radix-disabled:text-token-text-tertiary dark:radix-disabled:bg-transparent data-no-hover-bg:hover:bg-transparent dark:data-no-hover-bg:hover:bg-transparent';

export const CHATGPT_SWITCH_CLASS = 'radix-state-checked:bg-blue-400 focus-visible:ring-token-text-primary relative box-content aspect-7/4 shrink-0 rounded-full bg-gray-200 p-[2px] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:opacity-50 dark:bg-gray-600 h-4';

export const CHATGPT_SWITCH_THUMB_CLASS = 'radix-state-checked:translate-x-[calc(var(--to-end-unit,1)*100%*(7/4-1))] flex aspect-square h-full items-center justify-center rounded-full bg-white transition-transform duration-100';

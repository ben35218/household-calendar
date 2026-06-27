import { reactive } from 'vue';

// Promise-based confirm dialog singleton (#6). Replaces blocking window.confirm()
// with a themed Vuetify dialog. Usage:
//   const { confirm } = useConfirm();
//   if (!(await confirm({ title: 'Delete?', message: '…', confirmColor: 'error' }))) return;
const state = reactive({
  show: false,
  title: 'Are you sure?',
  message: '',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  confirmColor: 'primary',
});

let resolver = null;

function confirm(opts = {}) {
  state.title        = opts.title        ?? 'Are you sure?';
  state.message      = opts.message      ?? '';
  state.confirmText  = opts.confirmText  ?? 'Confirm';
  state.cancelText   = opts.cancelText   ?? 'Cancel';
  state.confirmColor = opts.confirmColor ?? 'primary';
  state.show = true;
  return new Promise((resolve) => { resolver = resolve; });
}

function _resolve(value) {
  state.show = false;
  if (resolver) { resolver(value); resolver = null; }
}

export function useConfirm() {
  return {
    confirmState: state,
    confirm,
    _accept: () => _resolve(true),
    _cancel: () => _resolve(false),
  };
}

import { reactive } from 'vue';

// App-wide snackbar singleton. Replaces scattered per-view snackbars and raw
// window.alert() calls with one consistent, non-blocking surface (#6).
const state = reactive({
  show: false,
  text: '',
  color: 'success',   // success | error | info | warning
  timeout: 3500,
});

function notify(text, color = 'success', timeout = 3500) {
  state.text = text;
  state.color = color;
  state.timeout = timeout;
  state.show = true;
}

export function useSnackbar() {
  return {
    snackbar: state,
    notify,
    success: (t, ms) => notify(t, 'success', ms),
    error:   (t, ms) => notify(t, 'error', ms ?? 5000),
    info:    (t, ms) => notify(t, 'info', ms),
  };
}

import { ref } from 'vue';

// Small shared snackbar helper so every view doesn't re-implement the same
// { show, text, color } state + success/error toggles. Pair with <SnackbarHost>.
export function useSnackbar() {
  const snack = ref({ show: false, text: '', color: 'success' });

  function notify(text, color = 'success') {
    snack.value = { show: true, text, color };
  }
  const success = (text) => notify(text, 'success');
  const error = (text) => notify(text, 'error');

  // Pull the server's error message out of an Axios error, with a fallback.
  function fromError(err, fallback = 'Something went wrong') {
    error(err?.response?.data?.error || fallback);
  }

  return { snack, notify, success, error, fromError };
}

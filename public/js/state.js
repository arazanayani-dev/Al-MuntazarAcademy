/* Shared browser state: the signed-in person, today's date, the records the server sent, and screen state. */
export const S = { view: 'home', p: {}, modal: null, draft: null, exam: null, form: {}, back: null, tab: null, more: false };
export let TODAY = '';
export let ME = null;

export function setSession(me, today, data) {
  ME = me;
  TODAY = today;
  Object.assign(S, data);
}

export function clearSession() { ME = null; }

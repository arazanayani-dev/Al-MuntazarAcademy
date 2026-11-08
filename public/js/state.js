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

/* A person can hold several roles; screens read ME.role, set to the role of the page being shown. */
export function useRole(r) { if (ME && ME.roles && ME.roles.includes(r)) ME.role = r; }

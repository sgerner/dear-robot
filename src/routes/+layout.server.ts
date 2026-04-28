export function load({ locals }) {
  return {
    authenticated: locals.user.authenticated,
    csrfToken: locals.csrfToken
  };
}

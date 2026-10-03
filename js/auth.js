const Auth = (() => {
  let currentUser = null;

  async function checkSession() {
    try {
      const resp = await fetch('/api/auth/me');
      const data = await resp.json();
      if (data.success && data.user) {
        currentUser = data.user;
        return currentUser;
      }
    } catch {
      // not logged in
    }
    currentUser = null;
    return null;
  }

  async function login(username, password) {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json();
    if (data.success) {
      currentUser = data.user;
    }
    return data;
  }

  async function register(username, password) {
    const resp = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return resp.json();
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
  }

  function getUser() {
    return currentUser;
  }

  function isAdmin() {
    return currentUser && currentUser.role === 'admin';
  }

  return { checkSession, login, register, logout, getUser, isAdmin };
})();

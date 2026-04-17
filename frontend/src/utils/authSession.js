let logoutInProgress = false;

const AUTH_ERROR_CODES = new Set([
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_REQUIRED',
  'AUTH_ACCOUNT_INACTIVE'
]);

export const clearAuthSession = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
};

const getAuthMessage = (responseData) => {
  const message = responseData?.error || responseData?.message || '';
  return String(message).toLowerCase();
};

export const isAuthFailureResponse = (status, responseData) => {
  if (status === 401) {
    return true;
  }

  if (status !== 403) {
    return false;
  }

  if (AUTH_ERROR_CODES.has(responseData?.code)) {
    return true;
  }

  const message = getAuthMessage(responseData);
  return (
    message.includes('invalid or expired token') ||
    message.includes('invalid token') ||
    message.includes('expired token') ||
    message.includes('jwt malformed') ||
    message.includes('access token required')
  );
};

export const triggerAuthLogout = () => {
  if (logoutInProgress || typeof window === 'undefined') {
    return;
  }

  logoutInProgress = true;
  clearAuthSession();

  if (window.location.pathname !== '/login') {
    window.location.assign('/login');
    return;
  }

  setTimeout(() => {
    logoutInProgress = false;
  }, 300);
};


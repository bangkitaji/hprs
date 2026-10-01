const { verifyToken } = require('../utils/auth');

/**
 * Middleware untuk memvalidasi token JWT pada header Authorization
 * Format: Authorization: Bearer <token>
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Access denied. Authentication token not found. Please sign in first.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Your session has expired (60-minute limit). Please sign in again.',
      });
    }
    return res.status(401).json({
      error: 'Invalid authentication token. Please sign in again.',
    });
  }
}

/**
 * Middleware untuk otorisasi berbasis peran (Role-Based Access Control)
 * @param {string|string[]} roles Peran yang diizinkan (misal: 'administrator' atau ['administrator', 'user'])
 */
function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required before role authorization.',
      });
    }

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden. Your account role does not have permission to access this resource.',
      });
    }

    next();
  };
}

module.exports = {
  authenticate,
  requireRole,
};

const userService = require('../services/userService');

/**
 * Controller untuk endpoint POST /api/auth/login
 */
async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const authResult = await userService.authenticateUser(username, password);
    res.json({
      success: true,
      message: 'Login successful.',
      ...authResult,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller untuk endpoint GET /api/auth/me (Cek sesi pengguna)
 */
async function getProfile(req, res, next) {
  try {
    res.json({
      user: req.user,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller untuk endpoint POST /api/auth/change-password
 * Mengubah password pengguna yang sedang aktif (berlaku untuk semua role)
 */
async function changePassword(req, res, next) {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const result = await userService.changePassword(
      userId,
      currentPassword,
      newPassword,
      confirmPassword
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login,
  getProfile,
  changePassword,
};

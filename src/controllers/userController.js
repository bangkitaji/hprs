const userService = require('../services/userService');

/**
 * Controller untuk endpoint GET /api/users
 */
async function listUsers(req, res, next) {
  try {
    const users = await userService.getAllUsers();
    res.json(users);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller untuk endpoint POST /api/users
 */
async function createUser(req, res, next) {
  try {
    const { username, password, full_name, role } = req.body;
    const newUser = await userService.createUser({ username, password, full_name, role });
    res.status(201).json({
      success: true,
      message: `User ${newUser.username} successfully created.`,
      user: newUser,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller untuk endpoint DELETE /api/users/:id
 */
async function deleteUser(req, res, next) {
  try {
    const targetUserId = req.params.id;
    const currentUserId = req.user.id;
    const deleted = await userService.deleteUser(targetUserId, currentUserId);
    res.json({
      success: true,
      message: `User ${deleted.username} successfully deleted.`,
      user: deleted,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller untuk endpoint PUT /api/users/:id/password
 * Administrator mereset password user manapun
 */
async function updateUserPassword(req, res, next) {
  try {
    const targetUserId = req.params.id;
    const { newPassword, confirmPassword } = req.body;
    const result = await userService.adminResetPassword(
      targetUserId,
      newPassword,
      confirmPassword
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listUsers,
  createUser,
  deleteUser,
  updateUserPassword,
};

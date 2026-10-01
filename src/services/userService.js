const { pool } = require('../config/database');
const { hashPassword, comparePassword, generateToken } = require('../utils/auth');

/**
 * Authenticate user by username and password.
 */
async function authenticateUser(username, password) {
  if (!username || !password) {
    const error = new Error('Username and password are required.');
    error.status = 400;
    throw error;
  }

  const query = `
    SELECT id, username, password_hash, full_name, role, is_active
    FROM users
    WHERE LOWER(username) = LOWER($1)
  `;
  const result = await pool.query(query, [username.trim()]);

  if (result.rows.length === 0) {
    const error = new Error('Invalid username or password.');
    error.status = 401;
    throw error;
  }

  const user = result.rows[0];

  if (!user.is_active) {
    const error = new Error('Your account has been deactivated. Please contact an Administrator.');
    error.status = 403;
    throw error;
  }

  const isMatch = await comparePassword(password, user.password_hash);
  if (!isMatch) {
    const error = new Error('Invalid username or password.');
    error.status = 401;
    throw error;
  }

  const token = generateToken(user);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
    },
  };
}

/**
 * Get list of all registered users (Administrator only).
 */
async function getAllUsers() {
  const query = `
    SELECT id, username, full_name, role, is_active, created_at, updated_at
    FROM users
    ORDER BY id ASC
  `;
  const result = await pool.query(query);
  return result.rows;
}

/**
 * Create a new user account (Administrator only).
 */
async function createUser({ username, password, full_name, role }) {
  if (!username || !password || !full_name || !role) {
    const error = new Error('All fields (username, password, full name, role) are required.');
    error.status = 400;
    throw error;
  }

  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  if (cleanUsername.length < 3) {
    const error = new Error('Username must be at least 3 alphanumeric characters.');
    error.status = 400;
    throw error;
  }

  if (password.length < 6) {
    const error = new Error('Password must be at least 6 characters.');
    error.status = 400;
    throw error;
  }

  if (!['administrator', 'user'].includes(role)) {
    const error = new Error('Role must be either "administrator" or "user".');
    error.status = 400;
    throw error;
  }

  // Check if username already exists
  const checkQuery = 'SELECT id FROM users WHERE LOWER(username) = LOWER($1)';
  const checkResult = await pool.query(checkQuery, [cleanUsername]);
  if (checkResult.rows.length > 0) {
    const error = new Error(`Username "${cleanUsername}" is already taken.`);
    error.status = 409;
    throw error;
  }

  const hashedPassword = await hashPassword(password);

  const insertQuery = `
    INSERT INTO users (username, password_hash, full_name, role)
    VALUES ($1, $2, $3, $4)
    RETURNING id, username, full_name, role, is_active, created_at
  `;
  const insertResult = await pool.query(insertQuery, [
    cleanUsername,
    hashedPassword,
    full_name.trim(),
    role,
  ]);

  return insertResult.rows[0];
}

/**
 * Delete a user account (Administrator only).
 */
async function deleteUser(userId, currentUserId) {
  const targetId = parseInt(userId, 10);
  if (isNaN(targetId)) {
    const error = new Error('Invalid user ID.');
    error.status = 400;
    throw error;
  }

  if (targetId === currentUserId) {
    const error = new Error('You cannot delete your own active account.');
    error.status = 400;
    throw error;
  }

  const deleteQuery = 'DELETE FROM users WHERE id = $1 RETURNING id, username';
  const result = await pool.query(deleteQuery, [targetId]);

  if (result.rows.length === 0) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}

/**
 * Change password for the currently logged-in user.
 * Available to all users (standard users & administrators).
 *
 * @param {number|string} userId - ID of the user requesting password change
 * @param {string} currentPassword - Current password to verify
 * @param {string} newPassword - New password to set
 * @param {string} confirmPassword - Confirmation of new password
 */
async function changePassword(userId, currentPassword, newPassword, confirmPassword) {
  const targetId = parseInt(userId, 10);
  if (isNaN(targetId)) {
    const error = new Error('Invalid user ID.');
    error.status = 400;
    throw error;
  }

  if (!currentPassword || !newPassword) {
    const error = new Error('Current password and new password are required.');
    error.status = 400;
    throw error;
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    const error = new Error('New password confirmation does not match.');
    error.status = 400;
    throw error;
  }

  if (newPassword.length < 6) {
    const error = new Error('New password must be at least 6 characters.');
    error.status = 400;
    throw error;
  }

  // Get user from database
  const query = 'SELECT id, username, password_hash FROM users WHERE id = $1';
  const result = await pool.query(query, [targetId]);

  if (result.rows.length === 0) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const user = result.rows[0];

  // Verify current password
  const isMatch = await comparePassword(currentPassword, user.password_hash);
  if (!isMatch) {
    const error = new Error('Current password is incorrect.');
    error.status = 400;
    throw error;
  }

  // Ensure new password is not identical to current password
  const isSame = await comparePassword(newPassword, user.password_hash);
  if (isSame) {
    const error = new Error('New password cannot be the same as current password.');
    error.status = 400;
    throw error;
  }

  const hashedPassword = await hashPassword(newPassword);

  await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [hashedPassword, targetId]
  );

  return {
    success: true,
    message: 'Password changed successfully. Please use your new password on your next sign in.',
  };
}

/**
 * Reset password for any user account (Administrator only).
 *
 * @param {number|string} userId - ID of target user
 * @param {string} newPassword - New password to set
 * @param {string} confirmPassword - Confirmation of new password
 */
async function adminResetPassword(userId, newPassword, confirmPassword) {
  const targetId = parseInt(userId, 10);
  if (isNaN(targetId)) {
    const error = new Error('Invalid user ID.');
    error.status = 400;
    throw error;
  }

  if (!newPassword) {
    const error = new Error('New password is required.');
    error.status = 400;
    throw error;
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    const error = new Error('New password confirmation does not match.');
    error.status = 400;
    throw error;
  }

  if (newPassword.length < 6) {
    const error = new Error('New password must be at least 6 characters.');
    error.status = 400;
    throw error;
  }

  const checkResult = await pool.query('SELECT id, username FROM users WHERE id = $1', [targetId]);
  if (checkResult.rows.length === 0) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const targetUser = checkResult.rows[0];
  const hashedPassword = await hashPassword(newPassword);

  await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [hashedPassword, targetId]
  );

  return {
    success: true,
    message: `Password for user "${targetUser.username}" successfully updated.`,
    user: {
      id: targetUser.id,
      username: targetUser.username,
    },
  };
}

module.exports = {
  authenticateUser,
  getAllUsers,
  createUser,
  deleteUser,
  changePassword,
  adminResetPassword,
};

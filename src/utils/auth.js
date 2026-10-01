const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DEFAULT_DEV_SECRET = 'hpr_secure_jwt_secret_key_2026_super_secret';
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET) {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET environment variable is required in production.');
  }
  if (process.env.JWT_SECRET === DEFAULT_DEV_SECRET || process.env.JWT_SECRET.length < 32) {
    console.warn('⚠️ [SECURITY WARNING] JWT_SECRET in production is weak or using the default sample secret. Please set a strong, random 256-bit secret.');
  }
}

const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_DEV_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '60m';

/**
 * Hash password polos menggunakan algoritma bcrypt (10 rounds salt).
 */
async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, 10);
}

/**
 * Validasi kecocokan password polos dengan hash di database.
 */
async function comparePassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword);
}

/**
 * Hasilkan JSON Web Token (JWT) dengan masa kedaluwarsa sesi (default 60 menit).
 */
function generateToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * Verifikasi keabsahan JWT.
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
};

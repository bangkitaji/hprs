const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

// Seluruh rute manajemen pengguna membutuhkan autentikasi dan peran administrator
router.use(authenticate);
router.use(requireRole('administrator'));

router.get('/', userController.listUsers);
router.post('/', userController.createUser);
router.delete('/:id', userController.deleteUser);

module.exports = router;

const express = require('express');
const router = express.Router();
const { upload } = require('../config/upload');
const uploadController = require('../controllers/uploadController');

router.post('/preview', upload.single('file'), uploadController.previewUpload);
router.post('/process', uploadController.processUpload);

module.exports = router;

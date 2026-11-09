const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

// Pastikan direktori uploads tersedia
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const cleanOriginalName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uniqueSuffix}-${cleanOriginalName}`);
  },
});

const maxUploadSizeMb = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '100', 10);

const upload = multer({
  storage,
  limits: {
    fileSize: maxUploadSizeMb * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    // Validasi ekstensi yang didukung: Excel (.xlsx, .xls), CSV (.csv), dan Text (.txt)
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.xlsx', '.xls', '.csv', '.txt'];
    if (allowedExts.includes(ext)) {
      return cb(null, true);
    }
    cb(new Error('Unsupported file format! Please upload an Excel (.xlsx, .xls), CSV (.csv), or Text (.txt) file.'));
  },
});

module.exports = {
  upload,
  UPLOAD_DIR,
};

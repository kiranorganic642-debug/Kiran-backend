const multer = require('multer');

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 9,
  },
  fileFilter: (req, file, callback) => {
    if (allowedTypes.has(file.mimetype)) return callback(null, true);
    callback(new Error('Only JPEG, PNG, GIF and WebP images are supported'));
  },
});

module.exports = { upload };

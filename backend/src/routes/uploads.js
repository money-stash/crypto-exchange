const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// endpoint для скачивания файлов чата
router.get('/chats/:filename', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN', 'MANAGER', 'OPERATOR']),
  async (req, res) => {
    try {
      const { filename } = req.params;
      const baseFilename = path.basename(String(filename || ''));
      const filePath = path.join(__dirname, '../../uploads/chats', baseFilename);
      
      // проверяем существование файла
      try {
        await fs.access(filePath);
      } catch {
        return res.status(404).json({
          success: false,
          message: 'Файл не найден'
        });
      }
      
      // определяем тип файла и отправляем
      const ext = path.extname(filename).toLowerCase();
      let contentType = 'application/octet-stream';
      
      if (['.jpg', '.jpeg'].includes(ext)) {
        contentType = 'image/jpeg';
      } else if (ext === '.png') {
        contentType = 'image/png';
      } else if (ext === '.pdf') {
        contentType = 'application/pdf';
      }
      
      res.setHeader('Content-Type', contentType);

      const safeFilename = baseFilename
        .replace(/[\r\n]/g, '')
        .replace(/["\\]/g, '_')
        .replace(/[^\x20-\x7E]+/g, '_')
        .trim() || 'file';
      const encodedFilename = encodeURIComponent(baseFilename || 'file');

      res.setHeader(
        'Content-Disposition',
        `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
      );
      res.sendFile(filePath);
      
    } catch (error) {
      console.error('Ошибка скачивания файла:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка скачивания файла',
        error: error.message
      });
    }
  }
);

// настройка хранилища файлов
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/mailings');
    
    // создаем папку если не существует
    try {
      await fs.access(uploadDir);
    } catch {
      await fs.mkdir(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // генерируем уникальное имя файла
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(originalName);
    const name = path.basename(originalName, ext);
    
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

// фильтр типов файлов
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 
    'image/jpg', 
    'image/png', 
    'image/gif', 
    'image/webp'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Неподдерживаемый тип файла. Разрешены: JPEG, PNG, GIF, WebP'), false);
  }
};

// настройка multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB максимум
    files: 10 // максимум 10 файлов
  },
  fileFilter: fileFilter
});

// загрузка файлов для рассылки
router.post('/mailing-attachments', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']),
  upload.array('files', 10), // максимум 10 файлов
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Файлы не были загружены'
        });
      }

      // формируем ответ с информацией о загруженных файлах
      const uploadedFiles = req.files.map(file => ({
        filename: file.filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        path: `/uploads/mailings/${file.filename}`,
        url: `${req.protocol}://${req.get('host')}/uploads/mailings/${file.filename}`
      }));

      res.json({
        success: true,
        message: `Успешно загружено ${uploadedFiles.length} файл(ов)`,
        files: uploadedFiles
      });

    } catch (error) {
      console.error('Ошибка загрузки файлов:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка загрузки файлов',
        error: error.message
      });
    }
  }
);

// удаление файла
router.delete('/mailing-attachments/:filename',
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']),
  async (req, res) => {
    try {
      const { filename } = req.params;
      const filePath = path.join(__dirname, '../../uploads/mailings', filename);
      
      // проверяем существование файла
      try {
        await fs.access(filePath);
      } catch {
        return res.status(404).json({
          success: false,
          message: 'Файл не найден'
        });
      }
      
      // удаляем файл
      await fs.unlink(filePath);
      
      res.json({
        success: true,
        message: 'Файл успешно удален'
      });
      
    } catch (error) {
      console.error('Ошибка удаления файла:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка удаления файла',
        error: error.message
      });
    }
  }
);

// получение списка файлов (для отладки)
router.get('/mailing-attachments',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  async (req, res) => {
    try {
      const uploadDir = path.join(__dirname, '../../uploads/mailings');
      
      try {
        const files = await fs.readdir(uploadDir);
        const filesInfo = [];
        
        for (const file of files) {
          const filePath = path.join(uploadDir, file);
          const stats = await fs.stat(filePath);
          
          filesInfo.push({
            filename: file,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            url: `${req.protocol}://${req.get('host')}/uploads/mailings/${file}`
          });
        }
        
        res.json({
          success: true,
          files: filesInfo
        });
        
      } catch {
        res.json({
          success: true,
          files: []
        });
      }
      
    } catch (error) {
      console.error('Ошибка получения списка файлов:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка получения списка файлов',
        error: error.message
      });
    }
  }
);

module.exports = router;

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class ImageGenerator {
  constructor() {
    // Цвета в стиле вашей админки
    this.colors = {
      background: '#1a202c',      // Темно-синий
      accent: '#4263eb',          // Синий акцент
      accentDark: '#3b5bdb',      // Темнее синий
      text: '#ffffff',            // Белый
      textSecondary: '#cbd5e0',   // Серый
      gradient1: '#667eea',       // Градиент начало
      gradient2: '#764ba2'        // Градиент конец
    };

    // Директория для сохранения изображений
    this.imagesDir = path.join(__dirname, '../../generated-images');
    this.browser = null;
  }

  /**
   * Инициализация браузера
   */
  async ensureBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    return this.browser;
  }

  /**
   * Инициализация директории для изображений
   */
  async ensureImagesDir() {
    try {
      await fs.mkdir(this.imagesDir, { recursive: true });
    } catch (error) {
      console.error('Error creating images directory:', error);
    }
  }

  /**
   * Создает HTML для изображения
   */
  generateHTML(title, iconSvg, subtitle = null, customGradient = null) {
    const gradient = customGradient || 'linear-gradient(155deg, #020202 0%, #0c0c0c 52%, #151515 100%)';
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      width: 800px;
      height: 180px;
      margin: 0;
      padding: 0;
      overflow: hidden;
      font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #000;
    }
    
    .container {
      width: 100%;
      height: 100%;
      background: ${gradient};
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 24px;
      position: relative;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 18px;
      overflow: hidden;
    }
    
    .container::before {
      content: '';
      position: absolute;
      inset: -30% auto auto -10%;
      width: 360px;
      height: 360px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%);
      filter: blur(2px);
    }
    
    .container::after {
      content: '';
      position: absolute;
      inset: auto -12% -42% auto;
      width: 340px;
      height: 260px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(255, 255, 255, 0.08) 0%, transparent 72%);
    }
    
    .text-content {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    
    .title {
      font-size: 58px;
      font-weight: 700;
      color: white;
      letter-spacing: -0.02em;
      font-family: 'Manrope', sans-serif;
      line-height: 1.05;
      text-align: center;
      text-shadow: 0 8px 20px rgba(0, 0, 0, 0.55);
    }
    
    .subtitle {
      font-size: 20px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.72);
      font-family: 'Manrope', sans-serif;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="text-content">
      <div class="title">${title}</div>
      ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Получить SVG иконку из Lucide
   */
  getLucideIcon(iconName) {
    const icons = {
      'headphones': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>`,
      'shopping-bag': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
      'dollar-sign': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
      'trending-up': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
      'user': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
      'credit-card': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`,
      'building-2': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>`,
      'user-check': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>`,
      'clipboard-list': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>`,
      'check-circle': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
      'x-circle': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>`,
      'hourglass': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>`
    };
    
    return icons[iconName] || icons['shopping-bag'];
  }

  /**
   * Создает премиальное изображение-заголовок
   * @param {string} title - Заголовок (например, "Покупка актива")
   * @param {string} icon - Emoji иконка (например, "💰")
   * @param {string} templateName - Имя шаблона для кеширования
   * @param {string} subtitle - Подзаголовок (опционально)
   * @param {string} customGradient - Кастомный градиент (опционально)
   * @returns {Promise<string>} - Путь к сохраненному изображению
   */
  async generateHeaderImage(title, iconName, templateName, subtitle = null, customGradient = null) {
    await this.ensureImagesDir();

    // Проверяем, есть ли уже сохраненное изображение
    const imagePath = path.join(this.imagesDir, `${templateName}.png`);
    
    try {
      await fs.access(imagePath);
      console.log(`✅ Using cached image: ${templateName}`);
      return imagePath;
    } catch (error) {
      // Файл не существует, создаем новый
      console.log(`🎨 Generating new image: ${templateName}`);
    }

    const browser = await this.ensureBrowser();
    const page = await browser.newPage();

    try {
      // Устанавливаем размер viewport
      await page.setViewport({ width: 800, height: 180 });

      // Получаем SVG иконку
      const iconSvg = this.getLucideIcon(iconName);

      // Генерируем HTML
      const html = this.generateHTML(title, iconSvg, subtitle, customGradient);

      // Загружаем HTML
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Делаем скриншот
      await page.screenshot({
        path: imagePath,
        type: 'png',
        omitBackground: false
      });

      console.log(`✅ Image generated and saved: ${templateName}`);
      return imagePath;
    } finally {
      await page.close();
    }
  }

  /**
   * Создает изображение для "Покупки"
   */
  async generateBuyImage() {
    return await this.generateHeaderImage(
      'Покупка актива',
      'shopping-bag',
      'buy_crypto',
      'Быстрая обработка операций'
    );
  }

  /**
   * Создает изображение для "Продажи"
   */
  async generateSellImage() {
    return await this.generateHeaderImage(
      'Продажа актива',
      'dollar-sign',
      'sell_crypto',
      'Быстрый вывод средств'
    );
  }

  /**
   * Создает изображение для "Курсов"
   */
  async generateRatesImage() {
    return await this.generateHeaderImage(
      'Текущие тарифы',
      'trending-up',
      'rates',
      'Актуальные тарифы обмена'
    );
  }

  /**
   * Создает изображение для "Профиля"
   */
  async generateCabinetImage() {
    return await this.generateHeaderImage(
      'Личный профиль',
      'user',
      'cabinet',
      'Платежные данные, статистика, рефералы'
    );
  }

  /**
   * Создает изображение для "Приветствия"
   */
  async generateWelcomeImage() {
    return await this.generateHeaderImage(
      'Добро пожаловать',
      'headphones',
      'welcome',
      'Платформа цифровых обменов'
    );
  }

  /**
   * Создает изображение для "Ввод карты/телефона"
   */
  async generateEnterCardImage() {
    return await this.generateHeaderImage(
      'Укажите платежные данные',
      'credit-card',
      'enter_card',
      'Номер карты или телефон для СБП'
    );
  }

  /**
   * Создает изображение для "Ввод банка"
   */
  async generateEnterBankImage() {
    return await this.generateHeaderImage(
      'Название банка',
      'building-2',
      'enter_bank',
      'Укажите банк получателя'
    );
  }

  /**
   * Создает изображение для "Ввод ФИО"
   */
  async generateEnterFIOImage() {
    return await this.generateHeaderImage(
      'ФИО получателя',
      'user-check',
      'enter_fio',
      'Укажите полное имя'
    );
  }

  /**
   * Generates image for the confirmation summary block.
   */
  async generateOrderSummaryImage() {
    return await this.generateHeaderImage(
      'A4 / CONTROL',
      'clipboard-list',
      'order_summary',
      'Check packet before submit'
    );
  }

  /**
   * Создает изображение для "Операция закрыта" (зеленый градиент)
   */
  async generateOrderCompletedImage() {
    return await this.generateHeaderImage(
      'Операция закрыта',
      'check-circle',
      'order_completed',
      'Ваша операция успешно выполнена',
      'linear-gradient(135deg, #10b981 0%, #059669 100%)' // green gradient
    );
  }

  /**
   * Создает изображение для "Операция отменена" (красный градиент)
   */
  async generateOrderCancelledImage() {
    return await this.generateHeaderImage(
      'Операция отменена',
      'x-circle',
      'order_cancelled',
      'К сожалению, операция была отменена',
      'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' // red gradient
    );
  }

  /**
   * Создает изображение для "Проверяем перевод" (оранжевый/желтый градиент)
   */
  async generatePaymentPendingImage() {
    return await this.generateHeaderImage(
      'Проверяем перевод',
      'hourglass',
      'payment_pending',
      'Ожидайте подтверждения',
      'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' // amber/orange gradient
    );
  }

  /**
   * Удаляет все сгенерированные изображения (для пересоздания)
   */
  async clearCache() {
    try {
      const files = await fs.readdir(this.imagesDir);
      for (const file of files) {
        await fs.unlink(path.join(this.imagesDir, file));
      }
      console.log('✅ Image cache cleared');
    } catch (error) {
      console.error('Error clearing image cache:', error);
    }
  }

  /**
   * Закрыть браузер при завершении работы
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = new ImageGenerator();

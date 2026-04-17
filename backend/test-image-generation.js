/**
 * Тестовый скрипт для проверки генерации изображений
 * Запуск: node test-image-generation.js
 */

const imageGenerator = require('./src/utils/imageGenerator');

async function test() {
  console.log('🎨 Starting image generation test...\n');

  try {
    // Тест 1: Приветствие
    console.log('1️⃣ Generating welcome image...');
    const welcomeImage = await imageGenerator.generateWelcomeImage();
    console.log(`✅ Welcome image created: ${welcomeImage}\n`);

    // Тест 2: Покупка
    console.log('2️⃣ Generating buy image...');
    const buyImage = await imageGenerator.generateBuyImage();
    console.log(`✅ Buy image created: ${buyImage}\n`);

    // Тест 3: Продажа
    console.log('3️⃣ Generating sell image...');
    const sellImage = await imageGenerator.generateSellImage();
    console.log(`✅ Sell image created: ${sellImage}\n`);

    // Тест 4: Тарифы
    console.log('4️⃣ Generating rates image...');
    const ratesImage = await imageGenerator.generateRatesImage();
    console.log(`✅ Rates image created: ${ratesImage}\n`);

    // Тест 5: Профиль
    console.log('5️⃣ Generating cabinet image...');
    const cabinetImage = await imageGenerator.generateCabinetImage();
    console.log(`✅ Cabinet image created: ${cabinetImage}\n`);

    // Проверяем кеширование
    console.log('6️⃣ Testing cache (generating buy image again)...');
    const buyImageCached = await imageGenerator.generateBuyImage();
    console.log(`✅ Buy image from cache: ${buyImageCached}\n`);

    console.log('✅ All tests passed! Check generated-images/ folder');
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Закрываем браузер
    await imageGenerator.close();
  }
}

test();

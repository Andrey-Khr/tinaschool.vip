const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
require('dotenv').config();
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const upload = multer();

// --- Робота з файлом для зберігання замовлень ---
const ORDERS_FILE_PATH = path.join(__dirname, 'orders.json');

// Функція для читання даних з файлу
function readOrders() {
    try {
        if (!fs.existsSync(ORDERS_FILE_PATH)) {
            // Якщо файл не існує, створюємо його з початковою структурою
            fs.writeFileSync(ORDERS_FILE_PATH, JSON.stringify({ orders: {} }, null, 2));
        }
        const fileContent = fs.readFileSync(ORDERS_FILE_PATH, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        console.error('❌ Помилка читання файлу замовлень:', error);
        return { orders: {} }; // Повертаємо пусту структуру в разі помилки
    }
}

// Функція для запису даних у файл
function writeOrders(data) {
    try {
        fs.writeFileSync(ORDERS_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error('❌ Помилка запису у файл замовлень:', error);
    }
}
// --- Кінець блоку роботи з файлом ---

// Перевірка обов'язкових змінних оточення
const requiredEnvVars = {
    MERCHANT_ACCOUNT: process.env.MERCHANT_ACCOUNT,
    MERCHANT_SECRET_KEY: process.env.MERCHANT_SECRET_KEY,
    MERCHANT_DOMAIN_NAME: process.env.MERCHANT_DOMAIN_NAME,
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS,
        // Telegram є опціональним
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID
};

const missingVars = Object.entries(requiredEnvVars)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

if (missingVars.length > 0) {
    console.error('❌ Відсутні обов\'язкові змінні оточення:', missingVars.join(', '));
    console.error('📝 Перевірте файл .env');
    process.exit(1);
}

const MERCHANT_ACCOUNT = process.env.MERCHANT_ACCOUNT;
const MERCHANT_SECRET_KEY = process.env.MERCHANT_SECRET_KEY;
const MERCHANT_DOMAIN_NAME = process.env.MERCHANT_DOMAIN_NAME;

// Email configuration
const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = process.env.EMAIL_PORT || 587;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER;

// Метрики для моніторингу
const metrics = {
    totalOrders: 0,
    successfulPayments: 0,
    failedPayments: 0,
    emailsSent: 0,
    emailsFailed: 0,
    startTime: Date.now()
};

// Налаштування транспорту для email
const transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100
});

transporter.verify((error, success) => {
    if (error) {
        console.error('❌ Email налаштування неправильні:', error.message);
    } else {
        console.log('✅ Email сервер готовий до відправки');
    }
});

// Rate limiting
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 хвилин
    max: 10, // максимум 10 спроб на IP
    message: 'Забагато спроб оплати. Спробуйте через 15 хвилин.',
    standardHeaders: true,
    legacyHeaders: false
});

// Функція валідації email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Функція для відправки email клієнту
async function sendPaymentConfirmationEmail(email, name, courseName, orderId) {
    try {
        // ВИКОРИСТОВУЄМО GOOGLE DRIVE ДЛЯ ДОСТУПУ ДО КУРСУ
        const googleDriveUrl = 'https://drive.google.com/drive/folders/1YJ7COy6SdH0lBk9PJ9ij3ywdN37udNtm?usp=sharing'; 
        
        const mailOptions = {
            from: EMAIL_FROM,
            to: email, // Змінна 'email' залишається
            subject: 'Доступ до курсу "Începe româna cu Tina"', // Тему листа також оновлено
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                    <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        
                        <h2 style="color: #2c3e50; text-align: center; margin-bottom: 20px;">Bună ziua!</h2>
                        
                        <p style="font-size: 16px; line-height: 1.6;">Дуже рада, що Ви долучилися до курсу "Începe româna cu Tina".</p>
                        <p style="font-size: 16px; line-height: 1.6;">Сподіваюсь, що він стане корисним, цінним та дійсно допоможе Вам вивчити румунську мову 🫶</p>

                        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #007bff;">
                            <p style="font-size: 16px; line-height: 1.6; margin-top: 0; margin-bottom: 10px;">
                                <strong>Посилання на Google drive:</strong>
                            </p>
                            <a href="https://drive.google.com/drive/folders/1YJ7COy6SdH0lBk9PJ9ij3ywdN37udNtm?usp=sharing" style="color: #007bff; text-decoration: none; word-break: break-all;">
                                https://drive.google.com/drive/folders/1YJ7COy6SdH0lBk9PJ9ij3ywdN37udNtm?usp=sharing
                            </a>
                        </div>

                        <ul style="font-size: 16px; line-height: 1.6; padding-left: 25px; margin-bottom: 25px;">
                            <li>Спочатку відкрийте презентацію, в ній знайдете посилання на запис лекцій на YouTube.</li>
                            <li>У папці Caiete ви зможете знайдете зошити із вправами до кожної лекції.</li>
                            <li>У кожному зошиті є онлайн ігри. Потрібно просканувати QR- код за допомогою свого телефону.</li>
                        </ul>

                        <p style="font-size: 16px; line-height: 1.6;">Після проходження навчання буду вдячна за ваш відгук 🌷</p>

                        <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #28a745;">
                            <p style="font-size: 16px; line-height: 1.6; color: #155724; margin: 0;">
                                Пишіть мені всі ваші відгуки на інстаграм сторінку <strong>@tinas_school</strong> та в подарунок 🎁 отримаєте чек-лист «250 іменинників румунської мови» із перекладом на українську та онлайн вправи для вивчення слів.
                            </p>
                        </div>
                        
                        <p style="font-size: 16px; line-height: 1.6;">Чекатиму на Ваш фідбек!</p>
                        <p style="font-size: 18px; line-height: 1.6; font-weight: bold; color: #2c3e50; text-align: left; margin-top: 20px;">
                            Succes la învățare 🦋
                        </p>

                        <hr style="border: none; border-top: 1px solid #dee2e6; margin: 30px 0;">
                        <div style="text-align: center; color: #6c757d; font-size: 14px;">
                            <p><strong>TinaSchool</strong></p>
                            <p>© 2025 TinaSchool. Всі права захищено.</p>
                        </div>

                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        metrics.emailsSent++;
        console.log(`✅ Email підтвердження відправлено на ${email}`);
    } catch (error) {
        metrics.emailsFailed++;
        console.error('❌ Помилка відправки email клієнту:', error.message);
    }
}

// Функція для відправки email адміністратору
async function sendAdminNotification(email, name, courseName, orderId, price) {
    try {
        const mailOptions = {
            from: EMAIL_FROM,
            to: EMAIL_FROM, // Відправляємо на власну пошту
            subject: `💰 Нове замовлення - ${orderId}`,
            html: `
                 <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
                        <h2 style="color: #28a745; margin-top: 0;">💰 Нове замовлення оплачено!</h2>
                        <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <h3 style="margin-top: 0; color: #495057;">📋 Деталі замовлення:</h3>
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr><td style="padding: 8px; border-bottom: 1px solid #dee2e6;"><strong>Номер замовлення:</strong></td><td style="padding: 8px; border-bottom: 1px solid #dee2e6;">${orderId}</td></tr>
                                <tr><td style="padding: 8px; border-bottom: 1px solid #dee2e6;"><strong>Курс:</strong></td><td style="padding: 8px; border-bottom: 1px solid #dee2e6;">${courseName}</td></tr>
                                <tr><td style="padding: 8px; border-bottom: 1px solid #dee2e6;"><strong>Сума:</strong></td><td style="padding: 8px; border-bottom: 1px solid #dee2e6;"><strong>${price} грн</strong></td></tr>
                                <tr><td style="padding: 8px; border-bottom: 1px solid #dee2e6;"><strong>Ім'я клієнта:</strong></td><td style="padding: 8px; border-bottom: 1px solid #dee2e6;">${name}</td></tr>
                                <tr><td style="padding: 8px; border-bottom: 1px solid #dee2e6;"><strong>Email клієнта:</strong></td><td style="padding: 8px; border-bottom: 1px solid #dee2e6;">${email}</td></tr>
                                <tr><td style="padding: 8px;"><strong>Дата:</strong></td><td style="padding: 8px;">${new Date().toLocaleString('uk-UA')}</td></tr>
                            </table>
                        </div>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log('✅ Сповіщення адміністратора відправлено');
    } catch (error) {
        console.error('❌ Помилка відправки сповіщення адміністратора:', error.message);
    }
}
// Виправлена функція для відправки повідомлення в Telegram
async function sendTelegramNotification(email, name, courseName, orderId, price) {
    console.log('📨 Викликано sendTelegramNotification з даними:', {
        email, name, courseName, orderId, price
    });

    try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        
        // Підтримуємо і старий формат (TELEGRAM_CHAT_ID), і новий (TELEGRAM_CHAT_IDS)
        const singleChatId = process.env.TELEGRAM_CHAT_ID;
        const multipleChatIds = process.env.TELEGRAM_CHAT_IDS;
        
        if (!TELEGRAM_BOT_TOKEN) {
            console.log('⚠️ TELEGRAM_BOT_TOKEN не налаштований, пропускаємо відправку');
            return;
        }
        
        // Формуємо список Chat ID
        const chatIds = singleChatId ? [singleChatId] : [];
        
        if (chatIds.length === 0) {
            console.log('⚠️ Жоден TELEGRAM_CHAT_ID не налаштований, пропускаємо відправку');
            return;
        }

        console.log('🤖 Відправляємо повідомлення в чати:', chatIds);

        const message = `✅ Успішна оплата на адресу мерчанта ${MERCHANT_ACCOUNT}

Дані платежу:
  - Призначення: Payment for - ${courseName} - (${price}) UAH 
  - Дата: ${new Date().toLocaleString('uk-UA')} 
  - Сума: ${price} UAH
  - Id платежу: ${orderId}
  - Метод оплати: картка
  - ПІБ клієнта: ${name}
  - Email: ${email}`;

        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        // 📤 Відправляємо в усі чати
        let successCount = 0;
        let errorCount = 0;
        
        for (const chatId of chatIds) {
            try {
                console.log(`📤 Відправляємо в чат: ${chatId}`);
                
                const response = await axios.post(url, {
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'HTML'
                }, {
                    timeout: 10000,
                    headers: { 'Content-Type': 'application/json' }
                });
                
                console.log(`✅ Повідомлення відправлено в чат ${chatId} (message_id: ${response.data.result.message_id})`);
                successCount++;
                
            } catch (error) {
                console.error(`❌ Помилка відправки в чат ${chatId}:`);
                console.error(`   Помилка: ${error.response?.data?.description || error.message}`);
                
                if (error.response?.status === 403) {
                    console.error(`   💡 Користувач ${chatId} заблокував бота або бот не має доступу`);
                } else if (error.response?.status === 400) {
                    console.error(`   💡 Неправильний Chat ID: ${chatId}`);
                }
                
                errorCount++;
            }
        }
        
        console.log(`📊 Результат Telegram розсилки: ${successCount} успішно, ${errorCount} помилок з ${chatIds.length} спроб`);
        
        if (successCount > 0) {
            console.log('✅ Telegram розсилка частково або повністю успішна');
        } else {
            console.error('❌ Жодне Telegram повідомлення не було відправлено');
        }
        
    } catch (error) {
        console.error('❌ Критична помилка в sendTelegramNotification:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// 📤 Додайте тестовий маршрут для перевірки розсилки
app.get('/test-telegram-one', async (req, res) => {
    try {
        await sendTelegramNotification(
            'test@example.com',
            'Тестовий користувач', 
            'Тестовий курс - один користувач',
            'ORDER-TEST-ONE-' + Date.now(),
            999,
            process.env.TELEGRAM_CHAT_ID
        );

        res.send('✅ Повідомлення відправлено одному користувачу!');
    } catch (err) {
        res.send('❌ Помилка: ' + err.message);
    }
});

app.get('/get-chat-ids', async (req, res) => {
    try {
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        if (!TELEGRAM_BOT_TOKEN) {
            return res.send('❌ TELEGRAM_BOT_TOKEN не налаштований');
        }
        
        const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`);
        const updates = response.data.result;
        
        if (!updates || updates.length === 0) {
            return res.send(`
                <h2>📱 Як отримати Chat ID:</h2>
                <ol>
                    <li>Відкрийте Telegram</li>
                    <li>Знайдіть вашого бота (він повинен мати username)</li>
                    <li>Напишіть боту будь-яке повідомлення, наприклад "/start"</li>
                    <li>Оновіть цю сторінку</li>
                </ol>
                <p><a href="/get-chat-ids">🔄 Оновити</a></p>
            `);
        }
        
        // Збираємо унікальні чати
        const chats = {};
        updates.forEach(update => {
            if (update.message && update.message.chat) {
                const chat = update.message.chat;
                const chatId = chat.id.toString();
                
                chats[chatId] = {
                    chatId: chatId,
                    name: [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || 'Невідомий',
                    username: chat.username ? '@' + chat.username : null,
                    lastMessage: update.message.text || '',
                    date: new Date(update.message.date * 1000).toLocaleString('uk-UA')
                };
            }
        });
        
        const currentChatIds = process.env.TELEGRAM_CHAT_IDS ? 
            process.env.TELEGRAM_CHAT_IDS.split(',').map(id => id.trim()) : 
            [process.env.TELEGRAM_CHAT_ID].filter(Boolean);
        
        let html = `
            <h2>📱 Всі користувачі, які писали боту:</h2>
            <table border="1" style="border-collapse: collapse; width: 100%;">
                <tr style="background: #f0f0f0;">
                    <th>Chat ID</th>
                    <th>Ім'я</th>
                    <th>Username</th>
                    <th>Останнє повідомлення</th>
                    <th>Дата</th>
                    <th>Статус</th>
                </tr>
        `;
        
        Object.values(chats).forEach(chat => {
            const isActive = currentChatIds.includes(chat.chatId);
            const statusColor = isActive ? '#28a745' : '#6c757d';
            const statusText = isActive ? '✅ Активний' : '➕ Доступний для додавання';
            
            html += `
                <tr>
                    <td><strong>${chat.chatId}</strong></td>
                    <td>${chat.name}</td>
                    <td>${chat.username || '—'}</td>
                    <td>${chat.lastMessage.substring(0, 30)}${chat.lastMessage.length > 30 ? '...' : ''}</td>
                    <td>${chat.date}</td>
                    <td style="color: ${statusColor};">${statusText}</td>
                </tr>
            `;
        });
        
        html += `
            </table>
            <hr>
            <h3>⚙️ Поточні налаштування:</h3>
            <p><strong>Активні Chat IDs:</strong> ${currentChatIds.join(', ') || 'Немає'}</p>
            
            <h3>📝 Як додати нового користувача:</h3>
            <ol>
                <li>Скопіюйте <strong>Chat ID</strong> потрібного користувача з таблиці</li>
                <li>Відкрийте файл <code>.env</code></li>
                <li>Змініть рядок на: <code>TELEGRAM_CHAT_IDS=${currentChatIds.join(',')},НОВИЙ_CHAT_ID</code></li>
                <li>Перезапустіть сервер</li>
            </ol>
            
            <p><a href="/get-chat-ids">🔄 Оновити</a> | <a href="/test-telegram-all">📤 Тестова розсилка</a></p>
        `;
        
        res.send(html);
        
    } catch (error) {
        res.send('❌ Помилка: ' + error.message);
    }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Маршрути
/*app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
*/
// Маршрут для статистики
app.get('/stats', (req, res) => {
    const uptime = Date.now() - metrics.startTime;
    const allOrders = readOrders();
    res.json({
        ...metrics,
        totalOrdersInFile: Object.keys(allOrders.orders).length,
        uptime: Math.floor(uptime / 1000) + ' секунд',
        timestamp: new Date().toISOString()
    });
});

// Створення платежу з валідацією
// ✅ УНІВЕРСАЛЬНЕ РІШЕННЯ для callback WayForPay
app.post('/server-callback', upload.none(), async (req, res) => {
    let paymentData = null; // ← Ініціалізуємо змінну
    let orderReference = null; // ← Додаємо для використання в finally
    
    try {
        console.log('📞 Callback отримано від WayForPay');
        console.log('📅 Час:', new Date().toISOString());

        // Парсинг даних
        if (Object.keys(req.body).length === 1 && typeof Object.keys(req.body)[0] === 'string') {
            try {
                paymentData = JSON.parse(Object.keys(req.body)[0]);
                console.log('✅ JSON успішно розпарсено з ключа');
            } catch (e) {
                paymentData = req.body;
            }
        } else {
            paymentData = req.body;
        }
        
        console.log('🔍 Отримані дані:', JSON.stringify(paymentData, null, 2));

        const { 
            merchantAccount,
            orderReference: orderRef, // ← Змінюємо назву змінної тут
            amount,
            currency,
            authCode,
            cardPan,
            transactionStatus, 
            reasonCode,
            merchantSignature 
        } = paymentData;

        orderReference = orderRef; // ← Присвоюємо для використання в finally

        if (!orderReference || !transactionStatus || !merchantSignature) {
            console.warn('⚠️ Відсутні необхідні поля в callback-запиті.');
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Перевірка підпису (ваш існуючий код)
        console.log('🔍 Спробуємо різні комбінації полів для підпису...');

        const fullFields = [
            merchantAccount,
            orderReference, 
            amount,
            currency,
            authCode || '',
            cardPan || '',
            transactionStatus,
            reasonCode || ''
        ];

        const basicFields = [
            merchantAccount,
            orderReference,
            amount,
            currency,
            transactionStatus
        ];

        const fieldsWithDate = [
            merchantAccount,
            orderReference,
            amount,
            currency,
            transactionStatus,
            paymentData.createdDate || ''
        ];

        const withoutMerchant = [
            orderReference, 
            amount,
            currency,
            authCode || '',
            cardPan || '',
            transactionStatus,
            reasonCode || ''
        ];

        const signatureVariants = [
            { name: 'Повний список', fields: fullFields },
            { name: 'Основні поля', fields: basicFields },
            { name: 'З датою', fields: fieldsWithDate },
            { name: 'Без merchant', fields: withoutMerchant }
        ];

        let signatureValid = false;
        let validVariant = null;

        for (const variant of signatureVariants) {
            const stringToSign = variant.fields.map(field => String(field || '')).join(';');
            const expectedSignature = crypto
                .createHmac('md5', MERCHANT_SECRET_KEY)
                .update(stringToSign)
                .digest('hex');

            console.log(`📋 ${variant.name}:`);
            console.log(`   Поля: [${variant.fields.join(', ')}]`);
            console.log(`   Рядок: ${stringToSign}`);
            console.log(`   Підпис: ${expectedSignature}`);
            console.log(`   Збігається: ${expectedSignature === merchantSignature}`);

            if (expectedSignature === merchantSignature) {
                signatureValid = true;
                validVariant = variant.name;
                break;
            }
        }

        if (signatureValid) {
            console.log(`✅ Підпис ВАЛІДНИЙ! Використано варіант: ${validVariant}`);
            
            // 🔍 ДОДАТКОВА ДІАГНОСТИКА ФАЙЛУ ЗАМОВЛЕНЬ
            console.log('🔍 Читаємо файл замовлень...');
            const allOrders = readOrders();
            console.log('📊 Загальна кількість замовлень у файлі:', Object.keys(allOrders.orders).length);
            console.log('🔍 Останні 5 замовлень:');
            Object.keys(allOrders.orders)
                .slice(-5)
                .forEach(orderId => {
                    const order = allOrders.orders[orderId];
                    console.log(`   ${orderId}: ${order.status} (${order.createdAt})`);
                });
            
            const customerOrder = allOrders.orders[orderReference];
            
            if (!customerOrder) {
                console.error('❌ Замовлення не знайдено:', orderReference);
                console.log('🔍 Можливі причини:');
                console.log('   1. Замовлення було створено на іншому сервері');
                console.log('   2. Файл orders.json був очищений або пошкоджений');
                console.log('   3. Замовлення було видалене');
                console.log('📋 Всі існуючі замовлення:');
                Object.keys(allOrders.orders).forEach(orderId => {
                    console.log(`   - ${orderId}`);
                });
                
                // Навіть якщо замовлення не знайдено, логуємо статус транзакції
                if (transactionStatus === 'Approved') {
                    console.log('💰 Транзакція APPROVED, але замовлення не знайдено!');
                    console.log('📧 Відправляємо сповіщення адміністратору про проблему...');
                    
                    try {
                        await sendAdminNotification(
                            'unknown@unknown.com',
                            'Невідомий клієнт',
                            'ПОМИЛКА: Замовлення не знайдено',
                            orderReference,
                            amount
                        );
                    } catch (emailError) {
                        console.error('❌ Помилка відправки email про проблему:', emailError);
                    }
                } else {
                    console.log(`📊 Статус транзакції: ${transactionStatus} (${paymentData.reason || 'Без причини'})`);
                }
            } else {
                console.log('✅ Замовлення знайдено:', customerOrder);
                
                if (customerOrder.status !== 'paid') {
                    if (transactionStatus === 'Approved') {
                        console.log('✅ Статус оплати підтверджено - обробляємо...');
                        customerOrder.status = 'paid';
                        customerOrder.paidAt = new Date().toISOString();
                        customerOrder.wayforpayData = paymentData;
                        writeOrders(allOrders);

                        console.log('📧 Відправляємо emails та Telegram...');
                        await Promise.all([
                            sendPaymentConfirmationEmail(
                                customerOrder.email, 
                                customerOrder.name, 
                                customerOrder.courseName, 
                                orderReference
                            ),
                            sendAdminNotification(
                                customerOrder.email, 
                                customerOrder.name, 
                                customerOrder.courseName, 
                                orderReference, 
                                customerOrder.price
                            ),
                            sendTelegramNotification(
                                customerOrder.email,
                                customerOrder.name,
                                customerOrder.courseName,
                                orderReference,
                                customerOrder.price
                            )
                        ]);
                        
                        metrics.successfulPayments++;
                        console.log('🎉 Успішна оплата оброблена!');
                    } else {
                        console.log(`❌ Статус оплати: ${transactionStatus} (${paymentData.reason || 'Без причини'})`);
                        
                        // Оновлюємо статус на failed тільки якщо це остаточна помилка
                        if (['Declined', 'Expired', 'Failed'].includes(transactionStatus)) {
                            customerOrder.status = 'failed';
                            customerOrder.failedAt = new Date().toISOString();
                            customerOrder.failureReason = paymentData.reason;
                            writeOrders(allOrders);
                        }
                        
                        metrics.failedPayments++;
                    }
                } else {
                    console.log('🔁 Замовлення вже було оплачено.');
                }
            }
        } else {
            console.error('❌ ЖОДЕН підпис не підійшов!');
            
            // Навіть з неправильним підписом, якщо це Approved транзакція
            if (transactionStatus === 'Approved') {
                console.log('⚠️ УВАГА: Approved транзакція з неправильним підписом');
                console.log('📧 Відправляємо попередження адміністратору...');
                
                try {
                    await sendAdminNotification(
                        'security@tinaschool.com',
                        'SECURITY WARNING',
                        'Approved платіж з неправильним підписом',
                        orderReference,
                        amount
                    );
                } catch (securityEmailError) {
                    console.error('❌ Помилка відправки security email:', securityEmailError);
                }
            }
        }

    } catch (error) {
        console.error('❌ Критична помилка обробки callback:', error);
        console.error('Stack trace:', error.stack);
    } finally {
        // ✅ Завжди відповідаємо позитивно
        const responseTime = Math.floor(Date.now() / 1000);
        const orderRef = orderReference || 'unknown'; // ← Використовуємо безпечне значення
        const responseStr = [orderRef, 'accept', responseTime].join(';');
        const signature = crypto.createHmac('md5', MERCHANT_SECRET_KEY).update(responseStr).digest('hex');
        
        console.log('📤 Відправляємо відповідь WayForPay:', {
            orderReference: orderRef,
            status: 'accept',
            time: responseTime,
            signature
        });
        
        res.json({ 
            orderReference: orderRef, 
            status: 'accept', 
            time: responseTime, 
            signature 
        });
    }
});

// Також додайте цей middleware для логування всіх запитів до callback
app.use('/server-callback', (req, res, next) => {
    console.log('📞 Incoming request to /server-callback');
    console.log('   Method:', req.method);
    console.log('   Content-Type:', req.headers['content-type']);
    console.log('   Content-Length:', req.headers['content-length']);
    next();
});

// ✅ Маршрут для створення платежу
const generateOrderId = () => 'ORDER-' + Date.now();

app.post('/create-payment', (req, res) => {
    try {
        const { name, email, course } = req.body;
            let price;
            let courseName;

            if (course === 'solo') {
                price = 950; // Ціна для тарифу "Самостійний"
                courseName = 'Тариф: САМОСТІЙНИЙ';
            } else if (course === 'support') {
                price = 997; // Ціна для тарифу "З підтримкою"
                courseName = 'Тариф: З ПІДТРИМКОЮ';
            } else {
                return res.status(400).json({ error: 'Некоректний тариф' });
            }


        const orderReference = generateOrderId();

        const newOrder = {
            name,
            email,
            courseName,
            price,
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        const allOrders = readOrders();
        allOrders.orders[orderReference] = newOrder;
        writeOrders(allOrders);
        metrics.totalOrders++;

        const orderData = {
            merchantAccount: MERCHANT_ACCOUNT,
            merchantDomainName: MERCHANT_DOMAIN_NAME,
            orderReference,
            orderDate: Math.floor(Date.now() / 1000),
            amount: parseFloat(price),
            currency: 'UAH',
            productName: [courseName],
            productPrice: [parseFloat(price)],
            productCount: [1],
            clientEmail: email,
            returnUrl: `${req.protocol}://${req.get('host')}/payment-return`,
            serviceUrl: `${req.protocol}://${req.get('host')}/server-callback`
        };

        const signatureStr = [
            orderData.merchantAccount,
            orderData.merchantDomainName,
            orderData.orderReference,
            orderData.orderDate,
            orderData.amount,
            orderData.currency,
            ...orderData.productName,
            ...orderData.productCount,
            ...orderData.productPrice
        ].join(';');

        const merchantSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(signatureStr)
            .digest('hex');

        orderData.merchantSignature = merchantSignature;

        res.render('redirect-to-wfp', orderData);
    } catch (error) {
        console.error('❌ Помилка створення платежу:', error);
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});


// Маршрут для обробки returnUrl та failUrl від WayForPay (приймає GET і POST)
app.all('/payment-return', (req, res) => {
    try {
        console.log(`➡️ Користувач повернувся на сайт. Метод: ${req.method}.`);
        console.log('🔍 Query params:', req.query);
        console.log('🔍 Body params:', req.body);
        
        // Спробуємо знайти orderReference у всіх можливих місцях
        let orderId = req.query.orderReference || 
                      req.body?.orderReference || 
                      req.query.order_id ||
                      req.body?.order_id ||
                      req.query.orderRef ||
                      req.body?.orderRef;

        if (orderId) {
            console.log(`✅ Знайдено orderId: ${orderId}. Перенаправлення на сторінку статусу.`);
            return res.redirect(`/status.html?order_id=${orderId}`);
        }

        // Якщо orderReference не знайдено, перенаправляємо на загальну сторінку успіху
        console.log('ℹ️ orderReference не передано від WayForPay (це нормально).');
        console.log('📄 Перенаправлення на загальну сторінку успіху.');
        
        // Перенаправляємо на сторінку успіху без конкретного order_id
        res.redirect('/success.html');

    } catch (error) {
        console.error('❌ Критична помилка в /payment-return:', error);
        res.redirect('/success.html'); // Все одно перенаправляємо на успіх
    }
});

// 🔄 Додатковий маршрут для отримання останніх оплачених замовлень (для success.html)
app.get('/get-recent-payments', (req, res) => {
    try {
        const { email } = req.query;
        
        if (!email) {
            return res.status(400).json({ error: 'Email не вказано' });
        }

        const allOrders = readOrders();
        const userOrders = Object.entries(allOrders.orders)
            .filter(([orderId, order]) => 
                order.email === email && 
                order.status === 'paid' &&
                order.paidAt && 
                // Показуємо тільки оплати за останні 10 хвилин
                (Date.now() - new Date(order.paidAt).getTime()) < 10 * 60 * 1000
            )
            .sort(([,a], [,b]) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
            .slice(0, 3); // Максимум 3 останні оплати

        const recentPayments = userOrders.map(([orderId, order]) => ({
            orderId,
            courseName: order.courseName,
            price: order.price,
            paidAt: order.paidAt,
            email: order.email,
            name: order.name
        }));

        res.json({ 
            success: true,
            payments: recentPayments,
            count: recentPayments.length
        });

    } catch (error) {
        console.error('❌ Помилка отримання останніх платежів:', error);
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});

// Маршрут для перевірки статусу оплати (використовується в status.html)  
app.get('/get-payment-status', (req, res) => {
    try {
        const { order_id } = req.query;
        
        if (!order_id) {
            return res.status(400).json({ error: 'Order ID не вказано' });
        }

        const allOrders = readOrders();
        const order = allOrders.orders[order_id];

        if (!order) {
            return res.status(404).json({ error: 'Замовлення не знайдено' });
        }

        // Повертаємо статус замовлення
        res.json({
            status: order.status === 'paid' ? 'accept' : order.status || 'pending',
            orderId: order_id,
            courseName: order.courseName
        });

    } catch (error) {
        console.error('❌ Помилка отримання статусу:', error);
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});
// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 Отримано сигнал SIGTERM, завершення роботи...');
    transporter.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🔄 Отримано сигнал SIGINT, завершення роботи...');
    transporter.close();
    process.exit(0);
});
// 🔍 Додайте цей маршрут для діагностики файлу замовлень
app.get('/debug-orders', (req, res) => {
    try {
        const { order_id } = req.query;
        const allOrders = readOrders();
        
        if (order_id) {
            // Шукаємо конкретне замовлення
            const order = allOrders.orders[order_id];
            return res.json({
                found: !!order,
                orderId: order_id,
                order: order || null,
                message: order ? 'Замовлення знайдено' : 'Замовлення не знайдено'
            });
        }
        
        // Показуємо всі замовлення
        const ordersList = Object.entries(allOrders.orders)
            .sort(([,a], [,b]) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 20) // Останні 20
            .map(([orderId, order]) => ({
                orderId,
                status: order.status,
                email: order.email,
                name: order.name,
                courseName: order.courseName,
                price: order.price,
                createdAt: order.createdAt,
                paidAt: order.paidAt
            }));
        
        res.json({
            total: Object.keys(allOrders.orders).length,
            latest20: ordersList,
            filePath: ORDERS_FILE_PATH,
            fileExists: require('fs').existsSync(ORDERS_FILE_PATH)
        });
        
    } catch (error) {
        res.status(500).json({
            error: 'Помилка читання замовлень',
            details: error.message
        });
    }
});

// 🔍 Маршрут для пошуку замовлення за email
app.get('/find-orders-by-email', (req, res) => {
    try {
        const { email } = req.query;
        
        if (!email) {
            return res.status(400).json({ error: 'Email параметр обов\'язковий' });
        }
        
        const allOrders = readOrders();
        const userOrders = Object.entries(allOrders.orders)
            .filter(([orderId, order]) => order.email === email)
            .sort(([,a], [,b]) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map(([orderId, order]) => ({
                orderId,
                status: order.status,
                courseName: order.courseName,
                price: order.price,
                createdAt: order.createdAt,
                paidAt: order.paidAt
            }));
        
        res.json({
            email,
            ordersCount: userOrders.length,
            orders: userOrders
        });
        
    } catch (error) {
        res.status(500).json({
            error: 'Помилка пошуку замовлень',
            details: error.message
        });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущено на http://localhost:${PORT}`);
    console.log(`📊 Статистика доступна на http://localhost:${PORT}/stats`);
    console.log(`📧 Email: ${EMAIL_USER} → ${EMAIL_HOST}:${EMAIL_PORT}`);
});
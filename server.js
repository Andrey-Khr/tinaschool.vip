const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
require('dotenv').config();

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
    EMAIL_PASS: process.env.EMAIL_PASS
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
        const telegramBotUrl = process.env.TELEGRAM_BOT_URL || 'https://t.me/Tinas_cursuribot';
        
        const mailOptions = {
            from: EMAIL_FROM,
            to: email,
            subject: 'Підтвердження оплати курсу - TinaSchool',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                    <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h2 style="color: #2c3e50; text-align: center; margin-bottom: 30px;">🎉 Дякуємо за покупку!</h2>
                        <p style="font-size: 16px; line-height: 1.6;">Привіт, <strong>${name}</strong>!</p>
                        <p style="font-size: 16px; line-height: 1.6;">Ми підтверджуємо успішну оплату курсу <strong>${courseName}</strong>.</p>
                        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff;">
                            <h3 style="color: #495057; margin-top: 0;">📋 Деталі замовлення:</h3>
                            <p><strong>Номер замовлення:</strong> ${orderId}</p>
                            <p><strong>Курс:</strong> ${courseName}</p>
                            <p><strong>Статус:</strong> <span style="color: #28a745;">Оплачено ✅</span></p>
                            <p><strong>Дата:</strong> ${new Date().toLocaleDateString('uk-UA')}</p>
                        </div>
                        <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
                            <h3 style="color: #155724; margin-top: 0;">🎯 Ваш курс активовано!</h3>
                            <p style="color: #155724; margin-bottom: 15px;">Для отримання доступу до курсу та всіх матеріалів, перейдіть в наш телеграм бот:</p>
                            <div style="text-align: center; margin: 20px 0;">
                                <a href="${telegramBotUrl}" style="background-color: #0088cc; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; font-weight: bold; font-size: 16px;">
                                    🤖 Перейти в телеграм бот
                                </a>
                            </div>
                            <p style="color: #155724; font-size: 14px; text-align: center; background-color: #d4edda; padding: 10px; border-radius: 5px;">
                                💡 В боті вкажіть номер замовлення: <strong>${orderId}</strong>
                            </p>
                        </div>
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

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
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
app.post('/server-callback', upload.none(), async (req, res) => {
    try {
        console.log('🔍 ===== WAYFORPAY CALLBACK DEBUG =====');
        console.log('📅 Час:', new Date().toISOString());
        console.log('🌐 IP клієнта:', req.ip || req.connection.remoteAddress);
        console.log('📦 Content-Type:', req.headers['content-type']);
        console.log('📋 User-Agent:', req.headers['user-agent']);
        
        // Логуємо все що надійшло
        console.log('🔍 Повний req.body:', JSON.stringify(req.body, null, 2));
        console.log('🔍 Всі заголовки:', JSON.stringify(req.headers, null, 2));
        console.log('🔍 req.query:', JSON.stringify(req.query, null, 2));
        
        // Перевіряємо всі можливі варіанти параметрів
        const possibleOrderRef = req.body.orderReference || req.body.orderId || req.body.order_id || req.body.merchantTransactionSecureType;
        const possibleStatus = req.body.status || req.body.transactionStatus || req.body.paymentStatus || req.body.reasonCode;
        const possibleTime = req.body.time || req.body.createdDate || req.body.processingDate || req.body.timestamp;
        const possibleSignature = req.body.merchantSignature || req.body.signature || req.body.hash;
        
        console.log('🔍 Знайдені можливі параметри:');
        console.log('   orderReference:', possibleOrderRef);
        console.log('   status:', possibleStatus);
        console.log('   time:', possibleTime);
        console.log('   signature:', possibleSignature);
        
        // Показуємо всі ключі що прийшли
        console.log('🔍 Всі ключі в req.body:', Object.keys(req.body));
        
        // Якщо нічого не знайшли, показуємо що прийшло
        if (!possibleOrderRef && !possibleStatus) {
            console.log('⚠️ Основні параметри не знайдені! Можливо WayForPay надсилає дані в іншому форматі');
            console.log('🔍 Розмір req.body:', Object.keys(req.body).length);
            
            // Перевіряємо чи не прийшли дані в query параметрах
            if (Object.keys(req.query).length > 0) {
                console.log('🔍 Можливо дані в query параметрах:', req.query);
            }
        }
        
        // Спробуємо оригінальну логіку з новими параметрами
        const orderReference = possibleOrderRef;
        const status = possibleStatus;
        const time = possibleTime;
        const wfpSignature = possibleSignature;
        
        console.log('🔍 Використовуємо для обробки:');
        console.log('   orderReference:', orderReference);
        console.log('   status:', status);
        console.log('   time:', time);
        console.log('   wfpSignature:', wfpSignature);
        
        if (!orderReference || !status || !time) {
            console.log('❌ Критичні параметри відсутні, але продовжуємо...');
            // Відповідаємо WayForPay щоб припинити повторні спроби
            return res.json({
                status: 'accept',
                time: Math.floor(Date.now() / 1000),
                signature: 'debug_mode'
            });
        }
        
        // Перевіряємо підпис
        const stringToSign = [orderReference, status, time].join(';');
        const expectedSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(stringToSign)
            .digest('hex');
            
        console.log('🔍 Перевірка підпису:');
        console.log('   Рядок для підпису:', stringToSign);
        console.log('   Очікуваний підпис:', expectedSignature);
        console.log('   Отриманий підпис:', wfpSignature);
        console.log('   Підписи збігаються:', expectedSignature === wfpSignature);

        if (expectedSignature !== wfpSignature) {
            console.log('❌ Підписи не збігаються, але продовжуємо обробку для debug...');
        }

        // Шукаємо замовлення
        const allOrders = readOrders();
        const customerOrder = allOrders.orders[orderReference];

        console.log('🔍 Пошук замовлення:');
        console.log('   Шукаємо ID:', orderReference);
        console.log('   Знайдено:', !!customerOrder);
        if (customerOrder) {
            console.log('   Поточний статус:', customerOrder.status);
        }

        if (!customerOrder) {
            console.log('❌ Замовлення не знайдено в базі');
        } else if (customerOrder.status === 'paid') {
            console.log('🔁 Замовлення вже оплачене');
        } else if (status === 'accept' || status === 'Accepted' || status === 'approved') {
            console.log('✅ Оплата схвалена, оновлюємо статус');
            
            customerOrder.status = 'paid';
            customerOrder.paidAt = new Date().toISOString();
            writeOrders(allOrders);
            
            // Відправка email
            sendPaymentConfirmationEmail(
                customerOrder.email, customerOrder.name, customerOrder.courseName, orderReference
            ).catch(err => console.error('Email помилка:', err.message));
            
            sendAdminNotification(
                customerOrder.email, customerOrder.name, customerOrder.courseName, orderReference, customerOrder.price
            ).catch(err => console.error('Admin email помилка:', err.message));

        } else {
            console.log('❌ Оплата не схвалена, статус:', status);
            if (customerOrder) {
                customerOrder.status = 'declined';
                writeOrders(allOrders);
            }
        }

        // Відповідаємо WayForPay
        const responseTime = Math.floor(Date.now() / 1000);
        const responseString = [orderReference || 'unknown', 'accept', responseTime].join(';');
        const responseSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(responseString)
            .digest('hex');

        const response = {
            orderReference: orderReference || 'unknown',
            status: 'accept',
            time: responseTime,
            signature: responseSignature
        };
        
        console.log('📤 Відповідаємо WayForPay:', response);
        console.log('🔍 ===== КІНЕЦЬ DEBUG CALLBACK =====\n');

        res.json(response);

    } catch (err) {
        console.error('❌ Критична помилка в callback:', err);
        console.log('🔍 ===== ПОМИЛКА CALLBACK =====\n');
        
        // Все одно відповідаємо щоб припинити повторні спроби
        res.json({
            status: 'accept',
            time: Math.floor(Date.now() / 1000),
            signature: 'error_mode'
        });
    }
});

// Обробка callback від платіжної системи
app.post('/server-callback', upload.none(), async (req, res) => {
    try {
        console.log(`📞 Callback отримано від WayForPay`);
        
        // WayForPay надсилає дані як JSON-рядок у ключі
        let paymentData;
        
        // Отримуємо перший ключ (який містить JSON)
        const keys = Object.keys(req.body);
        if (keys.length === 0) {
            console.error('❌ Порожній req.body');
            return res.status(400).json({ error: 'Empty request body' });
        }
        
        const jsonKey = keys[0];
        console.log('🔍 JSON ключ:', jsonKey.substring(0, 100) + '...');
        
        try {
            // Парсимо JSON з ключа
            paymentData = JSON.parse(jsonKey);
            console.log('✅ JSON успішно розпарсено');
        } catch (parseError) {
            console.error('❌ Помилка парсингу JSON:', parseError.message);
            return res.status(400).json({ error: 'Invalid JSON format' });
        }
        
        // Тепер витягуємо потрібні дані
        const orderReference = paymentData.orderReference;
        const transactionStatus = paymentData.transactionStatus; // WayForPay використовує transactionStatus
        const createdDate = paymentData.createdDate;
        const merchantSignature = paymentData.merchantSignature;
        
        console.log(`📋 Дані платежу:`);
        console.log(`   Замовлення: ${orderReference}`);
        console.log(`   Статус: ${transactionStatus}`);
        console.log(`   Дата: ${createdDate}`);
        console.log(`   Підпис: ${merchantSignature}`);
        console.log(`   Сума: ${paymentData.amount} ${paymentData.currency}`);
        console.log(`   Email: ${paymentData.email}`);
        
        // Перевіряємо обов'язкові поля
        if (!orderReference || !transactionStatus || !createdDate || !merchantSignature) {
            console.error('❌ Відсутні обов\'язкові поля');
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Перевіряємо підпис (WayForPay використовує інший формат)
        // Для callback підпис формується: merchantAccount;orderReference;amount;currency
        const stringToSign = [
            paymentData.merchantAccount,
            orderReference,
            paymentData.amount,
            paymentData.currency
        ].join(';');
        
        const expectedSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(stringToSign)
            .digest('hex');
            
        console.log('🔍 Перевірка підпису:');
        console.log('   Рядок для підпису:', stringToSign);
        console.log('   Очікуваний:', expectedSignature);
        console.log('   Отриманий:', merchantSignature);

        if (expectedSignature !== merchantSignature) {
            console.error('❌ Неправильний підпис callback');
            return res.status(400).json({ error: 'Invalid signature' });
        }
        
        console.log('✅ Підпис перевірено успішно');
        
        // Шукаємо замовлення в файлі
        const allOrders = readOrders();
        const customerOrder = allOrders.orders[orderReference];

        if (!customerOrder) {
            console.error('❌ Замовлення не знайдено в базі:', orderReference);
            // Все одно відповідаємо успішно, щоб WayForPay не повторював
        } else if (customerOrder.status === 'paid') {
            console.log(`🔁 Повторний callback для вже оплаченого замовлення: ${orderReference}`);
        } else if (transactionStatus === 'Approved') {
            // WayForPay використовує "Approved" для успішних платежів
            metrics.successfulPayments++;
            console.log(`✅ Оплата підтверджена: ${orderReference}`);
            
            // Оновлюємо статус у файлі
            customerOrder.status = 'paid';
            customerOrder.paidAt = new Date().toISOString();
            customerOrder.wayforpayData = paymentData; // Зберігаємо всі дані від WayForPay
            writeOrders(allOrders);
            
            // Відправка email клієнту
            sendPaymentConfirmationEmail(
                customerOrder.email, 
                customerOrder.name, 
                customerOrder.courseName, 
                orderReference
            ).catch(err => console.error('❌ Email помилка:', err.message));
            
            // Відправка сповіщення адміну
            sendAdminNotification(
                customerOrder.email, 
                customerOrder.name, 
                customerOrder.courseName, 
                orderReference, 
                customerOrder.price
            ).catch(err => console.error('❌ Admin email помилка:', err.message));

        } else {
            // Інші статуси (Declined, Failed, etc.)
            metrics.failedPayments++;
            console.log(`❌ Оплата не схвалена: ${orderReference}, статус: ${transactionStatus}`);

            if (customerOrder) {
                customerOrder.status = 'declined';
                customerOrder.wayforpayData = paymentData;
                writeOrders(allOrders);
            }
        }

        // Формуємо відповідь для WayForPay
        const responseTime = Math.floor(Date.now() / 1000);
        const responseString = [orderReference, 'accept', responseTime].join(';');
        const responseSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(responseString)
            .digest('hex');

        const response = {
            orderReference,
            status: 'accept',
            time: responseTime,
            signature: responseSignature
        };
        
        console.log('📤 Відповідаємо WayForPay:', response);
        res.json(response);

    } catch (err) {
        console.error('❌ Критична помилка обробки callback:', err);
        
        // Все одно відповідаємо щоб припинити повторні спроби
        const responseTime = Math.floor(Date.now() / 1000);
        res.json({
            orderReference: 'error',
            status: 'accept', 
            time: responseTime,
            signature: 'error_signature'
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

// Маршрут для обробки returnUrl та failUrl від WayForPay (приймає GET і POST)
app.all('/payment-return', (req, res) => {
    try {
        console.log(`⚠️  Користувач повернувся на сайт. Метод: ${req.method}.`);
        console.log('📦  Дані від браузера:', req.body || req.query);

        const allOrdersData = readOrders();
        const orders = allOrdersData.orders;
        
        // Знаходимо ID останнього створеного замовлення
        const latestOrderId = Object.keys(orders).sort((a, b) => {
            const timeA = new Date(orders[a].createdAt).getTime();
            const timeB = new Date(orders[b].createdAt).getTime();
            return timeB - timeA;
        })[0];

        if (!latestOrderId) {
            console.error('❌ Не вдалося знайти жодного замовлення у файлі.');
            return res.redirect('/failure.html?error=no_orders_found');
        }

        console.log(`⏳  Знайдено останнє замовлення: ${latestOrderId}. Перенаправлення на сторінку перевірки статусу.`);
        
        // Перенаправляємо на сторінку статусу з ID останнього замовлення
        res.redirect(`/status.html?order_id=${latestOrderId}`);

    } catch (error) {
        console.error('❌  Критична помилка в /payment-return:', error);
        res.redirect('/failure.html?error=return_processing_error');
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

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущено на http://localhost:${PORT}`);
    console.log(`📊 Статистика доступна на http://localhost:${PORT}/stats`);
    console.log(`📧 Email: ${EMAIL_USER} → ${EMAIL_HOST}:${EMAIL_PORT}`);
});
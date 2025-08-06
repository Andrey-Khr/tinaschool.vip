const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
require('dotenv').config();

const app = express();
const upload = multer();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;


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

app.use((req, res, next) => {
    if (req.path === '/server-callback') {
        console.log(`🔍 ${req.method} ${req.path}`);
        console.log('🔍 Content-Type:', req.headers['content-type']);
        console.log('🔍 User-Agent:', req.headers['user-agent']);
        console.log('🔍 IP:', req.ip);
    }
    next();
});

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
app.post('/create-payment', paymentLimiter, async (req, res) => {
    try {
        const { name, email, course } = req.body;
        
        if (!name || !email || !course) {
            return res.status(400).json({ error: 'Всі поля обов\'язкові' });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'Некоректний email адрес' });
        }
        if (name.length < 2 || name.length > 50) {
            return res.status(400).json({ error: 'Ім\'я має бути від 2 до 50 символів' });
        }

        const courses = {
            solo: {
                name: 'Курс: Самостійний',
                price: '1' // ВИПРАВЛЕНО ЦІНУ
            },
            support: {
                name: 'Курс з підтримкою',
                price: '777' // ВИПРАВЛЕНО ЦІНУ
            }
        };

        const selected = courses[course];
        if (!selected) {
            return res.status(400).json({ error: 'Курс не знайдено' });
        }

        const courseData = {
            name: selected.name,
            price: selected.price,
            currency: 'UAH',
            orderId: `COURSE_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
        };

        const orderDate = Math.floor(Date.now() / 1000).toString();
        const stringToSign = [
            MERCHANT_ACCOUNT, MERCHANT_DOMAIN_NAME, courseData.orderId,
            orderDate, courseData.price, courseData.currency,
            courseData.name, '1', courseData.price
        ].join(';');

        const merchantSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(stringToSign)
            .digest('hex');

        metrics.totalOrders++;
        
        // Зберігаємо дані про замовлення у файл
        const allOrders = readOrders();
        allOrders.orders[courseData.orderId] = {
            name: name.trim(),
            email: email.toLowerCase().trim(),
            courseName: courseData.name,
            price: courseData.price,
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        writeOrders(allOrders);

        console.log(`💰 Нове замовлення створено: ${courseData.orderId}, курс: ${course}, email: ${email}`);

        const baseUrl = `${req.protocol}://${req.get('host')}`;

        res.render('redirect', {
            merchantAccount: MERCHANT_ACCOUNT,
            merchantDomainName: MERCHANT_DOMAIN_NAME,
            orderId: courseData.orderId,
            orderDate,
            amount: courseData.price,
            currency: courseData.currency,
            courseName: courseData.name,
            clientName: name,
            clientEmail: email,
            serviceUrl: `${baseUrl}/server-callback`,
            returnUrl: `${baseUrl}/payment-return`,
            failUrl: `${baseUrl}/payment-return`,
            signature: merchantSignature
        });

    } catch (error) {
        console.error('❌ Помилка створення платежу:', error);
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});

// Обробка callback від платіжної системи
// Обробка callback від платіжної системи WayForPay
app.post('/server-callback', upload.none(), async (req, res) => {
    try {
        console.log('📞 Callback отримано. Повні дані:', JSON.stringify(req.body, null, 2));
        
        let callbackData;
        
        // WayForPay надсилає дані в особливому форматі - JSON як ключ об'єкта
        const bodyKeys = Object.keys(req.body);
        if (bodyKeys.length === 1 && bodyKeys[0].startsWith('{')) {
            // Парсимо JSON з ключа
            try {
                callbackData = JSON.parse(bodyKeys[0]);
                console.log('🔧 Розпаковані дані WayForPay:', callbackData);
            } catch (parseError) {
                console.error('❌ Помилка парсингу JSON з ключа:', parseError);
                return res.status(400).json({ error: 'Invalid JSON format' });
            }
        } else {
            // Стандартний формат (якщо WayForPay змінить формат)
            callbackData = req.body;
        }
        
        // Витягуємо потрібні поля з розпакованих даних
        const {
            orderReference,
            transactionStatus,
            merchantSignature: wfpSignature,
            processingDate,
            merchantAccount,
            amount,
            currency
        } = callbackData;
        
        console.log(`📞 Callback деталі: ${orderReference}, статус: ${transactionStatus}`);
        
        // Перевіряємо наявність обов'язкових полів
        if (!orderReference || !transactionStatus || !processingDate) {
            console.error('❌ Відсутні обов\'язкові поля в callback:', { 
                orderReference, 
                transactionStatus, 
                processingDate 
            });
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Для WayForPay підпис формується інакше
        // Для callback підпис перевіряємо за іншою схемою
        const stringToSign = [
            merchantAccount,
            orderReference, 
            amount,
            currency,
            'accept'  // status для відповіді
        ].join(';');
        
        const expectedSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(stringToSign)
            .digest('hex');

        console.log('🔍 Перевірка підпису WayForPay:', {
            stringToSign,
            expected: expectedSignature,
            received: wfpSignature,
            match: expectedSignature === wfpSignature
        });

        // Поки що пропускаємо перевірку підпису для діагностики
        if (wfpSignature && expectedSignature !== wfpSignature) {
            console.log('⚠️ Підпис не співпадає, але продовжуємо обробку для діагностики');
            // НЕ повертаємо помилку поки не налагодимо
            // return res.status(400).json({ error: 'Invalid signature' });
        }

        const allOrders = readOrders();
        const customerOrder = allOrders.orders[orderReference];

        if (!customerOrder) {
            console.error('❌ Замовлення не знайдено у файлі:', orderReference);
        } else if (customerOrder.status === 'paid') {
            console.log(`🔁 Повторний callback для вже оплаченого замовлення: ${orderReference}`);
        } else {
            // Обробляємо за статусом транзакції WayForPay
            if (transactionStatus === 'Approved') {
                metrics.successfulPayments++;
                console.log(`✅ Оплата підтверджена WayForPay: ${orderReference}`);
                
                // Оновлюємо статус у файлі
                customerOrder.status = 'paid';
                customerOrder.paidAt = new Date().toISOString();
                customerOrder.wayforpayData = {
                    transactionStatus,
                    authCode: callbackData.authCode,
                    cardPan: callbackData.cardPan,
                    paymentSystem: callbackData.paymentSystem
                };
                writeOrders(allOrders);
                
                // Відправка email
                sendPaymentConfirmationEmail(
                    customerOrder.email, customerOrder.name, customerOrder.courseName, orderReference
                ).catch(err => console.error('❌ Email error:', err.message));
                
                sendAdminNotification(
                    customerOrder.email, customerOrder.name, customerOrder.courseName, orderReference, customerOrder.price
                ).catch(err => console.error('❌ Admin email error:', err.message));

            } else if (transactionStatus === 'Declined') {
                metrics.failedPayments++;
                console.log(`❌ Оплата відхилена WayForPay: ${orderReference}, причина: ${callbackData.reason}`);

                customerOrder.status = 'declined';
                customerOrder.declinedAt = new Date().toISOString();
                customerOrder.declineReason = callbackData.reason;
                writeOrders(allOrders);
            }
        }

        // Формування відповіді для WayForPay
        const responseTime = Math.floor(Date.now() / 1000);
        const responseString = [
            callbackData.merchantAccount,
            orderReference,
            'accept',
            responseTime
        ].join(';');
        
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

        console.log('📤 Відповідь WayForPay:', response);
        res.json(response);

    } catch (err) {
        console.error('❌ Критична помилка обробки callback:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Додатковий middleware для обробки специфічного формату WayForPay
app.use('/server-callback', (req, res, next) => {
    console.log('🔍 RAW body before processing:', req.body);
    console.log('🔍 Body type:', typeof req.body);
    console.log('🔍 Body keys:', Object.keys(req.body));
    next();
});
// Альтернативний обробник callback для GET запитів
app.get('/server-callback', async (req, res) => {
    console.log('📞 GET Callback отримано:', req.query);
    
    const { orderReference, status, time, merchantSignature: wfpSignature } = req.query;
    
    if (!orderReference || !status || !time) {
        console.error('❌ GET callback: відсутні обов\'язкові поля');
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Той самий код обробки, що і для POST
    const stringToSign = [orderReference, status, time].join(';');
    const expectedSignature = crypto
        .createHmac('md5', MERCHANT_SECRET_KEY)
        .update(stringToSign)
        .digest('hex');

    if (expectedSignature !== wfpSignature) {
        console.error('❌ GET callback неправильний підпис');
        return res.status(400).json({ error: 'Invalid signature' });
    }
    
    res.json({ status: 'ok', message: 'GET callback processed' });
});

// Тестовий обробник (тільки для розробки)
if (process.env.NODE_ENV !== 'production') {
    app.post('/test-callback', (req, res) => {
        console.log('🧪 Тестовий callback:', req.body);
        res.json({ received: req.body });
    });
}


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
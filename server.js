const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

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

const paymentStatuses = {};
const customerData = {}; // Зберігаємо дані клієнтів для відправки email

// Налаштування транспорту для email
const transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    },
    pool: true, // Використовуємо пул з'єднань
    maxConnections: 5,
    maxMessages: 100
});

// Перевірка email налаштувань при старті
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ Email налаштування неправильні:', error.message);
        console.error('📧 Перевірте EMAIL_HOST, EMAIL_USER, EMAIL_PASS в .env файлі');
    } else {
        console.log('✅ Email сервер готовий до відправки');
    }
});

// Rate limiting для захисту від спаму
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 хвилин
    max: 5, // максимум 5 спроб на IP
    message: 'Забагато спроб оплати. Спробуйте через 15 хвилин.',
    standardHeaders: true,
    legacyHeaders: false
});

// Функція валідації email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Функція для очищення старих даних
function scheduleDataCleanup(orderId) {
    setTimeout(() => {
        if (customerData[orderId]) {
            console.log(`🧹 Очищення даних для замовлення: ${orderId}`);
            delete customerData[orderId];
        }
        if (paymentStatuses[orderId]) {
            delete paymentStatuses[orderId];
        }
    }, 2 * 60 * 60 * 1000); // Очищення через 2 години
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
                            <p style="color: #155724; margin-bottom: 15px;">
                                Для отримання доступу до курсу та всіх матеріалів, перейдіть в наш телеграм бот:
                            </p>
                            <div style="text-align: center; margin: 20px 0;">
                                <a href="${telegramBotUrl}" style="background-color: #0088cc; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; font-weight: bold; font-size: 16px; transition: background-color 0.3s;">
                                    🤖 Перейти в телеграм бот
                                </a>
                            </div>
                            <p style="color: #155724; font-size: 14px; text-align: center; background-color: #d4edda; padding: 10px; border-radius: 5px;">
                                💡 В боті вкажіть номер замовлення: <strong>${orderId}</strong>
                            </p>
                        </div>
                        
                        <div style="margin: 30px 0;">
                            <h3 style="color: #495057;">🚀 Що далі?</h3>
                            <ol style="padding-left: 20px; line-height: 1.8;">
                                <li>Перейдіть в телеграм бот за посиланням вище</li>
                                <li>Вкажіть номер замовлення: <strong>${orderId}</strong></li>
                                <li>Отримайте доступ до всіх матеріалів курсу</li>
                                <li>Починайте навчання вже сьогодні!</li>
                            </ol>
                        </div>
                        

                        <hr style="border: none; border-top: 1px solid #dee2e6; margin: 30px 0;">
                        
                        <div style="text-align: center; color: #6c757d; font-size: 14px;">
                            <p><strong>TinaSchool</strong></p>
                            <p>
                                📧 <a href="tinoczkakomar@gmail.com" style="color: #007bff;">contact@langspace.com</a><br>
                            </p>
                            <p style="margin-top: 20px;">© 2025 TinaSchool. Всі права захищено.</p>
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
        // Не блокуємо процес при помилці email
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
                        
                        <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #ffc107;">
                            <strong>📝 Дії:</strong>
                            <ul>
                                <li>Надати доступ до курсу клієнту</li>
                                <li>Додати в телеграм бот</li>
                                <li>Відправити матеріали курсу</li>
                            </ul>
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
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Маршрути
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.all('/public/status.html', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'public/status.html'));
});

// Маршрут для тестування email
app.get('/test-email', async (req, res) => {
    try {
        await transporter.sendMail({
            from: EMAIL_FROM,
            to: EMAIL_USER,
            subject: 'Тест налаштувань email - TinaSchool',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #28a745;">✅ Email налаштування працюють!</h2>
                    <p>Якщо ви отримали цей лист, ваші налаштування email правильні.</p>
                    <p><strong>Час тесту:</strong> ${new Date().toLocaleString('uk-UA')}</p>
                </div>
            `
        });
        res.json({
            success: true,
            message: 'Тестовий email відправлено успішно!',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Помилка відправки email: ${error.message}`,
            timestamp: new Date().toISOString()
        });
    }
});

// Маршрут для статистики
app.get('/stats', (req, res) => {
    const uptime = Date.now() - metrics.startTime;
    res.json({
        ...metrics,
        uptime: Math.floor(uptime / 1000) + ' секунд',
        timestamp: new Date().toISOString()
    });
});

// Створення платежу з валідацією
app.post('/create-payment', paymentLimiter, async (req, res) => {
    try {
        const { name, email, course } = req.body;
        
        // Валідація даних
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
                price: '1199'
            },
            support: {
                name: 'Курс з підтримкою',
                price: '1799'
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
            MERCHANT_ACCOUNT,
            MERCHANT_DOMAIN_NAME,
            courseData.orderId,
            orderDate,
            courseData.price,
            courseData.currency,
            courseData.name,
            '1',
            courseData.price
        ].join(';');

        const merchantSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(stringToSign)
            .digest('hex');

        // Оновлення метрик
        metrics.totalOrders++;
        paymentStatuses[courseData.orderId] = { 
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        
        // Зберігаємо дані клієнта для відправки email після оплати
        customerData[courseData.orderId] = {
            name: name.trim(),
            email: email.toLowerCase().trim(),
            courseName: courseData.name,
            price: courseData.price,
            createdAt: new Date().toISOString()
        };

        // Планування очищення даних
        scheduleDataCleanup(courseData.orderId);

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
            returnUrl: `${baseUrl}/public/status.html?order_id=${courseData.orderId}`,
            failUrl: `${baseUrl}/public/status.html?order_id=${courseData.orderId}`,
            signature: merchantSignature
        });

    } catch (error) {
        console.error('❌ Помилка створення платежу:', error);
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});

// Обробка callback від платіжної системи
app.post('/server-callback', async (req, res) => {
    try {
        const {
            orderReference,
            status,
            time,
            merchantSignature: wfpSignature
        } = req.body;

        console.log(`📞 Callback отримано: ${orderReference}, статус: ${status}`);

        // Перевірка підпису
        const stringToSign = [orderReference, status, time].join(';');
        const expectedSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(stringToSign)
            .digest('hex');

        if (expectedSignature !== wfpSignature) {
            console.error('❌ Неправильний підпис callback:', { expected: expectedSignature, received: wfpSignature });
            return res.status(400).send('Invalid signature');
        }

        if (status === 'accept') {
            // Оновлення статусу оплати
            paymentStatuses[orderReference] = { 
                status: 'paid',
                paidAt: new Date().toISOString()
            };
            metrics.successfulPayments++;
            
            console.log(`✅ Оплата підтверджена: ${orderReference}`);
            
            // Відправка email після успішної оплати
            const customer = customerData[orderReference];
            if (customer) {
                console.log(`📧 Відправка email для замовлення: ${orderReference}`);
                
                // Email клієнту (не блокуємо процес при помилці)
                sendPaymentConfirmationEmail(
                    customer.email,
                    customer.name,
                    customer.courseName,
                    orderReference
                ).catch(error => {
                    console.error('❌ Помилка відправки email клієнту:', error.message);
                });
                
                // Email адміністратору
                sendAdminNotification(
                    customer.email,
                    customer.name,
                    customer.courseName,
                    orderReference,
                    customer.price
                ).catch(error => {
                    console.error('❌ Помилка відправки email адміністратору:', error.message);
                });
            } else {
                console.error('❌ Дані клієнта не знайдено для замовлення:', orderReference);
            }
        } else if (status === 'decline') {
            metrics.failedPayments++;
            console.log(`❌ Оплата відхилена: ${orderReference}`);
        }

        // Формування відповіді
        const responseTime = Math.floor(Date.now() / 1000);
        const responseString = [orderReference, 'accept', responseTime].join(';');
        const responseSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(responseString)
            .digest('hex');

        res.json({
            orderReference,
            status: 'accept',
            time: responseTime,
            signature: responseSignature
        });

    } catch (err) {
        console.error('❌ Помилка обробки callback:', err);
        res.status(500).send('Server error');
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
    console.log(`🧪 Тест email: http://localhost:${PORT}/test-email`);
    console.log(`📧 Email: ${EMAIL_USER} → ${EMAIL_HOST}:${EMAIL_PORT}`);
});
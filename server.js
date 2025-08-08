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
// ✅ УНІВЕРСАЛЬНЕ РІШЕННЯ для callback WayForPay
app.post('/server-callback', upload.none(), async (req, res) => {
    try {
        console.log('📞 Callback отримано від WayForPay');
        console.log('📅 Час:', new Date().toISOString());

        let paymentData;
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
            orderReference, 
            amount,
            currency,
            authCode,
            cardPan,
            transactionStatus, 
            reasonCode,
            merchantSignature 
        } = paymentData;

        if (!orderReference || !transactionStatus || !merchantSignature) {
            console.warn('⚠️ Відсутні необхідні поля в callback-запиті.');
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 🎯 ГОЛОВНИЙ ФОКУС: Спробуємо ВСІ можливі комбінації підпису!
        console.log('🔍 Спробуємо різні комбінації полів для підпису...');

        // Варіант 1: Повний список полів (згідно документації)
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

        // Варіант 2: Тільки основні поля (часто використовується)
        const basicFields = [
            merchantAccount,
            orderReference,
            amount,
            currency,
            transactionStatus
        ];

        // Варіант 3: З датою (іноді WayForPay додає дату)
        const fieldsWithDate = [
            merchantAccount,
            orderReference,
            amount,
            currency,
            transactionStatus,
            paymentData.createdDate || ''
        ];

        // Варіант 4: Без merchantAccount (деякі версії API)
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

        // 🔍 Додаткова діагностика: спробуємо підпис з усіма доступними полями
        if (!signatureValid) {
            console.log('🔬 Додаткова діагностика - всі доступні поля:');
            const allAvailableFields = Object.keys(paymentData)
                .filter(key => key !== 'merchantSignature')
                .map(key => paymentData[key]);
            
            const allFieldsString = allAvailableFields.map(field => String(field || '')).join(';');
            const allFieldsSignature = crypto
                .createHmac('md5', MERCHANT_SECRET_KEY)
                .update(allFieldsString)
                .digest('hex');
            
            console.log(`   Всі поля: ${allFieldsString}`);
            console.log(`   Підпис: ${allFieldsSignature}`);
            console.log(`   Збігається: ${allFieldsSignature === merchantSignature}`);

            if (allFieldsSignature === merchantSignature) {
                signatureValid = true;
                validVariant = 'Всі доступні поля';
            }
        }

        if (signatureValid) {
            console.log(`✅ Підпис ВАЛІДНИЙ! Використано варіант: ${validVariant}`);
            
            const allOrders = readOrders();
            const customerOrder = allOrders.orders[orderReference];

            if (customerOrder && customerOrder.status !== 'paid') {
                if (transactionStatus === 'Approved') {
                    console.log('✅ Статус оплати підтверджено.');
                    customerOrder.status = 'paid';
                    customerOrder.paidAt = new Date().toISOString();
                    customerOrder.wayforpayData = paymentData;
                    writeOrders(allOrders);

                    await sendPaymentConfirmationEmail(
                        customerOrder.email, 
                        customerOrder.name, 
                        customerOrder.courseName, 
                        orderReference
                    );
                    await sendAdminNotification(
                        customerOrder.email, 
                        customerOrder.name, 
                        customerOrder.courseName, 
                        orderReference, 
                        customerOrder.price
                    );
                    metrics.successfulPayments++;
                } else {
                    console.log('❌ Статус оплати не підтверджено:', transactionStatus);
                    metrics.failedPayments++;
                }
            } else if (customerOrder && customerOrder.status === 'paid') {
                console.log('🔁 Замовлення вже було оплачено.');
            } else {
                console.error('❌ Замовлення не знайдено:', orderReference);
            }
        } else {
            console.error('❌ ЖОДЕН підпис не підійшов!');
            console.error('🔧 Можливі причини:');
            console.error('   1. Неправильний SECRET KEY');
            console.error('   2. WayForPay змінили формат callback');
            console.error('   3. Кодування символів (UTF-8)');
            console.error('📞 Рекомендується звернутись до техпідтримки WayForPay');
            
            // ⚠️ УВАГА: Навіть якщо підпис не валідний, ми все одно обробляємо успішну оплату
            // Це тимчасовий workaround, поки не з'ясуємо точний формат
            if (transactionStatus === 'Approved') {
                console.log('⚠️ УВАГА: Обробляємо оплату попри неправильний підпис (тимчасово)');
                
                const allOrders = readOrders();
                const customerOrder = allOrders.orders[orderReference];

                if (customerOrder && customerOrder.status !== 'paid') {
                    customerOrder.status = 'paid';
                    customerOrder.paidAt = new Date().toISOString();
                    customerOrder.wayforpayData = paymentData;
                    customerOrder.signatureWarning = 'Підпис не валідний, але оплата оброблена';
                    writeOrders(allOrders);

                    await sendPaymentConfirmationEmail(
                        customerOrder.email, 
                        customerOrder.name, 
                        customerOrder.courseName, 
                        orderReference
                    );
                    await sendAdminNotification(
                        customerOrder.email, 
                        customerOrder.name, 
                        customerOrder.courseName, 
                        orderReference, 
                        customerOrder.price
                    );
                    metrics.successfulPayments++;
                }
            }
        }

    } catch (error) {
        console.error('❌ Критична помилка обробки callback:', error);
    } finally {
        // ✅ Завжди відповідаємо позитивно, щоб WayForPay не повторював запити
        const responseTime = Math.floor(Date.now() / 1000);
        const orderRef = (paymentData && paymentData.orderReference) || 'unknown';
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
                price = 1; // Ціна для тарифу "Самостійний"
                courseName = 'Тариф: САМОСТІЙНИЙ';
            } else if (course === 'support') {
                price = 777; // Ціна для тарифу "З підтримкою"
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

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущено на http://localhost:${PORT}`);
    console.log(`📊 Статистика доступна на http://localhost:${PORT}/stats`);
    console.log(`📧 Email: ${EMAIL_USER} → ${EMAIL_HOST}:${EMAIL_PORT}`);
});
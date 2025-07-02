// server.js
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ----- НАЛАШТУВАННЯ WAYFORPAY -----
const MERCHANT_ACCOUNT = process.env.MERCHANT_ACCOUNT;
const MERCHANT_SECRET_KEY = process.env.MERCHANT_SECRET_KEY;
const MERCHANT_DOMAIN_NAME = process.env.MERCHANT_DOMAIN_NAME;

// Тимчасове сховище для статусів платежів (в реальному проекті використовуйте базу даних)
const paymentStatuses = {};

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Маршрут для створення платежу
app.post('/create-payment', (req, res) => {
    const { name, email } = req.body;
    const course = {
        name: 'Англійська з нуля за 30 днів',
        price: '1500',
        currency: 'UAH',
        orderId: `COURSE_${Date.now()}`
    };
    const orderDate = Math.floor(Date.now() / 1000).toString();

    // ВАЖЛИВО: Змінюємо returnUrl на нашу нову сторінку статусу
    const returnUrl = `http://${req.get('host')}/public/status.html?order_id=${course.orderId}`;

    const stringToSign = [MERCHANT_ACCOUNT, MERCHANT_DOMAIN_NAME, course.orderId, orderDate, course.price, course.currency, course.name, '1', course.price].join(';');
    const merchantSignature = crypto.createHmac('md5', MERCHANT_SECRET_KEY).update(stringToSign).digest('hex');
    
    // Ініціалізуємо статус як "в очікуванні"
    paymentStatuses[course.orderId] = { status: 'pending' };

    res.send(`
        <html>
            <body>
                <p>Перенаправляємо на сторінку оплати...</p>
                <form id="wayforpay-form" action="https://secure.wayforpay.com/pay" method="POST">
                    <input type="hidden" name="merchantAccount" value="${MERCHANT_ACCOUNT}">
                    <input type="hidden" name="merchantAuthType" value="SimpleSignature">
                    <input type="hidden" name="merchantDomainName" value="${MERCHANT_DOMAIN_NAME}">
                    <input type="hidden" name="orderReference" value="${course.orderId}">
                    <input type="hidden" name="orderDate" value="${orderDate}">
                    <input type="hidden" name="amount" value="${course.price}">
                    <input type="hidden" name="currency" value="${course.currency}">
                    <input type="hidden" name="productName[]" value="${course.name}">
                    <input type="hidden" name="productCount[]" value="1">
                    <input type="hidden" name="productPrice[]" value="${course.price}">
                    <input type="hidden" name="clientFirstName" value="${name}">
                    <input type="hidden" name="clientEmail" value="${email}">
                    <input type="hidden" name="serviceUrl" value="http://${req.get('host')}/server-callback"> 
                    <input type="hidden" name="returnUrl" value="${returnUrl}">
                    <input type="hidden" name="merchantSignature" value="${merchantSignature}">
                </form>
                <script>document.getElementById('wayforpay-form').submit();</script>
            </body>
        </html>
    `);
});

// Обробка Service URL (Server-to-Server Callback)
app.post('/server-callback', (req, res) => {
    try {
        const { orderReference, status, reason, merchantSignature: wfpSignature } = req.body;
        const stringToSign = [orderReference, status, req.body.time].join(';');
        const signature = crypto.createHmac('md5', MERCHANT_SECRET_KEY).update(stringToSign).digest('hex');

        if (signature !== wfpSignature) {
            console.error('Invalid signature from Wayforpay');
            return res.status(400).send('Invalid signature');
        }

        // Оновлюємо статус платежу в нашому сховищі
        paymentStatuses[orderReference] = { status: status, reason: reason };
        console.log(`Статус для ${orderReference} оновлено: ${status}`);

        const responseTime = Math.floor(Date.now() / 1000);
        const responseStringToSign = [orderReference, 'accept', responseTime].join(';');
        const responseSignature = crypto.createHmac('md5', MERCHANT_SECRET_KEY).update(responseStringToSign).digest('hex');
            
        res.json({
            orderReference: orderReference,
            status: 'accept',
            time: responseTime,
            signature: responseSignature
        });
    } catch (error) {
        console.error('Callback error:', error);
        res.status(500).send('Server error');
    }
});

// НОВИЙ МАРШРУТ: Надає статус платежу для фронтенду
app.get('/get-payment-status', (req, res) => {
    const { order_id } = req.query;
    const payment = paymentStatuses[order_id];

    if (payment) {
        res.json({ status: payment.status });
    } else {
        // Якщо замовлення не знайдено, повертаємо помилку
        res.status(404).json({ status: 'not_found' });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущено на http://localhost:${PORT}`);
});
// server.js
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Підключення шаблонізатора EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Дані для WayforPay
const MERCHANT_ACCOUNT = process.env.MERCHANT_ACCOUNT;
const MERCHANT_SECRET_KEY = process.env.MERCHANT_SECRET_KEY;
const MERCHANT_DOMAIN_NAME = process.env.MERCHANT_DOMAIN_NAME;

const paymentStatuses = {};

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Головна сторінка
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.all('/public/status.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'status.html'));
});

// Створення платежу
app.post('/create-payment', (req, res) => {
    const { name, email } = req.body;

    const course = {
        name: 'Англійська з нуля за 30 днів',
        price: '2', // тестова ціна
        currency: 'UAH',
        orderId: `COURSE_${Date.now()}`
    };

    const orderDate = Math.floor(Date.now() / 1000).toString();

    const stringToSign = [
        MERCHANT_ACCOUNT,
        MERCHANT_DOMAIN_NAME,
        course.orderId,
        orderDate,
        course.price,
        course.currency,
        course.name,
        '1',
        course.price
    ].join(';');

    const merchantSignature = crypto
        .createHmac('md5', MERCHANT_SECRET_KEY)
        .update(stringToSign)
        .digest('hex');

    paymentStatuses[course.orderId] = { status: 'pending' };

    const protocol = req.protocol;
    const baseUrl = `${protocol}://${req.get('host')}`;

    res.render('redirect', {
        merchantAccount: MERCHANT_ACCOUNT,
        merchantDomainName: MERCHANT_DOMAIN_NAME,
        orderId: course.orderId,
        orderDate,
        amount: course.price,
        currency: course.currency,
        courseName: course.name,
        clientName: name,
        clientEmail: email,
        serviceUrl: `${baseUrl}/server-callback`,
        returnUrl: `${baseUrl}/public/status.html?order_id=${course.orderId}`,
        failUrl: `${baseUrl}/public/status.html?order_id=${course.orderId}`,
        signature: merchantSignature
    });
});

// Callback від WayforPay
app.post('/server-callback', (req, res) => {
    try {
        const { orderReference, status, time, merchantSignature: wfpSignature } = req.body;

        const stringToSign = [orderReference, status, time].join(';');
        const expectedSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(stringToSign)
            .digest('hex');

        if (expectedSignature !== wfpSignature) {
            return res.status(400).send('Invalid signature');
        }

        paymentStatuses[orderReference] = { status };

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
        res.status(500).send('Server error');
    }
});

// Перевірка статусу платежу
app.get('/get-payment-status', (req, res) => {
    const { order_id } = req.query;
    const payment = paymentStatuses[order_id];

    if (payment) {
        res.json({ status: payment.status });
    } else {
        res.status(404).json({ status: 'not_found' });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Сервер запущено на http://localhost:${PORT}`);
});

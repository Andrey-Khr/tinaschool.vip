const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const MERCHANT_ACCOUNT = process.env.MERCHANT_ACCOUNT;
const MERCHANT_SECRET_KEY = process.env.MERCHANT_SECRET_KEY;
const MERCHANT_DOMAIN_NAME = process.env.MERCHANT_DOMAIN_NAME;

const paymentStatuses = {};

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.all('/public/status.html', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'public/status.html'));
});

app.post('/create-payment', async (req, res) => {
    const { name, email, course } = req.body;

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
        return res.status(400).send('Курс не знайдено');
    }

    const courseData = {
        name: selected.name,
        price: selected.price,
        currency: 'UAH',
        orderId: `COURSE_${Date.now()}`
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

    paymentStatuses[courseData.orderId] = { status: 'pending' };

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
});

app.post('/server-callback', async (req, res) => {
    try {
        const {
            orderReference,
            status,
            time,
            merchantSignature: wfpSignature
        } = req.body;

        const stringToSign = [orderReference, status, time].join(';');
        const expectedSignature = crypto
            .createHmac('md5', MERCHANT_SECRET_KEY)
            .update(stringToSign)
            .digest('hex');

        if (expectedSignature !== wfpSignature) {
            return res.status(400).send('Invalid signature');
        }

        if (status === 'accept') {
            // Тут можна зберегти статус, якщо буде потрібно в майбутньому
            paymentStatuses[orderReference] = { status: 'paid' };
        }

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
        console.error('Callback error:', err);
        res.status(500).send('Server error');
    }
});

app.listen(PORT, () => {
    console.log(`✅ Сервер запущено на http://localhost:${PORT}`);
});

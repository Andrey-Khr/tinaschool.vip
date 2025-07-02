const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Дані для WayforPay
const MERCHANT_ACCOUNT = process.env.MERCHANT_ACCOUNT;
const MERCHANT_SECRET_KEY = process.env.MERCHANT_SECRET_KEY;
const MERCHANT_DOMAIN_NAME = process.env.MERCHANT_DOMAIN_NAME;

// Email налаштування
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

function sendSuccessEmail(to, name, courseName) {
    const mailOptions = {
        from: `"Tina's School" <${process.env.EMAIL_USER}>`,
        to,
        subject: 'Оплата курсу успішна ✔',
        html: `
            <h2>Привіт, ${name}!</h2>
            <p>Дякуємо за оплату курсу <strong>${courseName}</strong>.</p>
            <p>Найближчим часом ви отримаєте доступ до навчальних матеріалів.</p>
            <br>
            <p>З повагою,<br>Tina's School</p>
        `
    };

    return transporter.sendMail(mailOptions);
}

// EJS шаблони
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const paymentStatuses = {};

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Головна
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Сторінка перевірки статусу
app.all('/public/status.html', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'public/status.html'));
});

// Створення платежу
app.post('/create-payment', (req, res) => {
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

// Callback від WayforPay
app.post('/server-callback', async (req, res) => {
    try {
        const {
            orderReference,
            status,
            time,
            merchantSignature: wfpSignature,
            clientEmail,
            clientFirstName,
            productName
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
            paymentStatuses[orderReference] = { status };

            // Email розсилка
            const courseTitle = Array.isArray(productName) ? productName[0] : 'Ваш курс';
            if (clientEmail && clientFirstName) {
                try {
                    await sendSuccessEmail(clientEmail, clientFirstName, courseTitle);
                    console.log(`✅ Email надіслано: ${clientEmail}`);
                } catch (err) {
                    console.error('❌ Email не надіслано:', err);
                }
            }
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

// Перевірка статусу
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

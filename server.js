// server.js
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 3000;

// ----- НАЛАШТУВАННЯ WAYFORPAY (через .env) -----
const MERCHANT_ACCOUNT = process.env.MERCHANT_ACCOUNT;
const MERCHANT_SECRET_KEY = process.env.MERCHANT_SECRET_KEY;
const MERCHANT_DOMAIN_NAME = process.env.MERCHANT_DOMAIN_NAME;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname))); // Дозволяє віддавати статичні файли (CSS, JS, HTML)

// Якщо Wayforpay надсилає POST на success.html, перенаправляємо на GET
app.post('/public/success.html', (req, res) => {
    res.redirect('/public/success.html');
});

// Аналогічно для failure.html (на випадок POST)
app.post('/public/failure.html', (req, res) => {
    res.redirect('/public/failure.html');
});

// Головний маршрут - віддаємо index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Маршрут для обробки форми оплати
app.post('/create-payment', (req, res) => {
    const { name, email } = req.body;
    
    // Дані курсу
    const course = {
        name: 'Англійська з нуля за 30 днів',
        price: '2', // Фіктивна ціна
        currency: 'UAH',
        orderId: `COURSE_${Date.now()}`
    };

    // Формування підпису згідно з документацією Wayforpay
    const orderDate = Math.floor(Date.now() / 1000).toString();
    const stringToSign = [
        MERCHANT_ACCOUNT,
        MERCHANT_DOMAIN_NAME,
        course.orderId,
        orderDate,
        course.price,
        course.currency,
        course.name,
        '1', // Кількість
        course.price
    ].join(';');

    const merchantSignature = crypto
        .createHmac('md5', MERCHANT_SECRET_KEY)
        .update(stringToSign)
        .digest('hex');

    // Рендеримо приховану форму, яка автоматично перенаправить користувача на сторінку оплати
    res.send(`
        <html>
            <head><title>Перенаправлення на сторінку оплати...</title></head>
            <body>
                <h1 style="font-family: sans-serif; text-align: center;">Зачекайте, перенаправляємо на сторінку оплати...</h1>
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
                    <input type="hidden" name="returnUrl" value="http://${req.get('host')}/public/success.html">
                    <input type="hidden" name="failUrl" value="http://${req.get('host')}/public/failure.html">
                    <input type="hidden" name="merchantSignature" value="${merchantSignature}">
                </form>
                <script type="text/javascript">
                    document.getElementById('wayforpay-form').submit();
                </script>
            </body>
        </html>
    `);
});


// Запуск серверу
app.listen(PORT, () => {
    console.log(`Сервер запущено на http://localhost:${PORT}`);
});
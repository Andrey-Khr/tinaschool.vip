// ========================================
// routes/createPayment.js
// ========================================
const crypto = require('crypto');

module.exports = (dependencies) => {
    const { 
        MERCHANT_ACCOUNT, 
        MERCHANT_DOMAIN_NAME, 
        MERCHANT_SECRET_KEY,
        readOrders,
        writeOrders,
        metrics 
    } = dependencies;

    const generateOrderId = () => 'ORDER-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);

    return (req, res) => {
        try {
            console.log('💳 Створення платежу розпочато:', new Date().toISOString());
            console.log('   Отримані дані:', req.body);

            const { name, email, course } = req.body;

            // Валідація
            if (!name || !email || !course) {
                console.warn('⚠️ Відсутні обов\'язкові поля');
                return res.status(400).json({ error: 'Всі поля обов\'язкові' });
            }

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                console.warn('⚠️ Некоректний email:', email);
                return res.status(400).json({ error: 'Некоректний email' });
            }

            let price, courseName;

            switch (course) {
                case 'solo':
                    price = 1;
                    courseName = 'Тариф: САМОСТІЙНИЙ';
                    break;
                case 'support':
                    price = 777;
                    courseName = 'Тариф: З ПІДТРИМКОЮ';
                    break;
                default:
                    console.warn('⚠️ Некоректний тариф:', course);
                    return res.status(400).json({ error: 'Некоректний тариф' });
            }

            const orderReference = generateOrderId();
            console.log('🆔 Згенеровано ID замовлення:', orderReference);

            const newOrder = {
                name,
                email,
                courseName,
                price,
                status: 'pending',
                createdAt: new Date().toISOString(),
                course
            };

            // Зберігаємо замовлення
            const allOrders = readOrders();
            allOrders.orders[orderReference] = newOrder;
            writeOrders(allOrders);
            metrics.totalOrders++;

            console.log('💾 Замовлення збережено:', orderReference);

            // Створюємо дані для WayForPay
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

            // Генеруємо підпис
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

            console.log('🔐 Рядок для підпису:', signatureStr);

            const merchantSignature = crypto
                .createHmac('md5', MERCHANT_SECRET_KEY)
                .update(signatureStr)
                .digest('hex');

            orderData.merchantSignature = merchantSignature;

            console.log('✅ Платіж створено успішно:', orderReference);
            res.render('redirect-to-wfp', orderData);

        } catch (error) {
            console.error('❌ Критична помилка створення платежу:', error);
            res.status(500).json({ error: 'Внутрішня помилка сервера' });
        }
    };
};
// ========================================
// routes/paymentReturn.js
// ========================================
module.exports = () => {
    return (req, res) => {
        try {
            console.log(`➡️ Користувач повернувся на сайт. Метод: ${req.method}.`);
            console.log('🔍 Query params:', req.query);
            console.log('🔍 Body params:', req.body);
            
            let orderId;
            let paymentData;

            // Обробка POST даних
            if (req.method === 'POST' && req.body && typeof req.body === 'object') {
                const bodyKeys = Object.keys(req.body);
                if (bodyKeys.length === 1 && typeof bodyKeys[0] === 'string') {
                    try {
                        paymentData = JSON.parse(bodyKeys[0]);
                        orderId = paymentData.orderReference;
                        console.log('📋 Розпарсено JSON з POST body');
                    } catch (e) {
                        console.log('📋 Не JSON дані, перевіряємо як звичайні поля');
                        orderId = req.body.orderReference;
                    }
                } else {
                    orderId = req.body.orderReference;
                }
            }
            
            // Якщо в POST не знайшли, шукаємо в GET параметрах
            if (!orderId && req.query) {
                orderId = req.query.orderReference;
            }

            console.log('🆔 Знайдений Order ID:', orderId);

            if (!orderId) {
                console.error('❌ WayForPay не повернув orderReference при поверненні клієнта.');
                return res.redirect('/failure.html?error=no_order_id_returned');
            }

            console.log(`⏳ Користувач повернувся для замовлення: ${orderId}. Перенаправлення на сторінку перевірки статусу.`);
            res.redirect(`/status.html?order_id=${orderId}`);

        } catch (error) {
            console.error('❌ Критична помилка в /payment-return:', error);
            res.redirect('/failure.html?error=return_processing_error');
        }
    };
};
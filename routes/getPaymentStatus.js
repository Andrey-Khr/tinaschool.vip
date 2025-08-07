// ========================================
// routes/getPaymentStatus.js
// ========================================
module.exports = (dependencies) => {
    const { readOrders } = dependencies;

    return (req, res) => {
        try {
            console.log('🔍 Перевірка статусу платежу:', new Date().toISOString());
            const { order_id } = req.query;
            
            if (!order_id) {
                console.warn('⚠️ Order ID не вказано');
                return res.status(400).json({ error: 'Order ID не вказано' });
            }

            console.log('🆔 Шукаємо замовлення:', order_id);
            const allOrders = readOrders();
            const order = allOrders.orders[order_id];

            if (!order) {
                console.error('❌ Замовлення не знайдено:', order_id);
                return res.status(404).json({ error: 'Замовлення не знайдено' });
            }

            const response = {
                status: order.status === 'paid' ? 'accept' : order.status || 'pending',
                orderId: order_id,
                courseName: order.courseName,
                timestamp: new Date().toISOString()
            };

            console.log('📊 Статус замовлення:', response);
            res.json(response);

        } catch (error) {
            console.error('❌ Помилка отримання статусу:', error);
            res.status(500).json({ error: 'Внутрішня помилка сервера' });
        }
    };
};
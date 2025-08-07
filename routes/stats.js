// ========================================
// routes/stats.js
// ========================================
module.exports = (metrics) => {
    return (req, res) => {
        try {
            const uptime = Date.now() - metrics.startTime;
            const allOrders = require('../utils/orderManager').readOrders();
            
            const stats = {
                ...metrics,
                totalOrdersInFile: Object.keys(allOrders.orders).length,
                uptime: Math.floor(uptime / 1000) + ' секунд',
                timestamp: new Date().toISOString(),
                server: {
                    nodeVersion: process.version,
                    platform: process.platform,
                    memory: process.memoryUsage()
                }
            };
            
            console.log('📊 Stats requested:', stats);
            res.json(stats);
        } catch (error) {
            console.error('❌ Помилка отримання статистики:', error);
            res.status(500).json({ error: 'Помилка сервера' });
        }
    };
};
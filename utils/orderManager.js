// ========================================
// utils/orderManager.js (додатковий файл)
// ========================================
const fs = require('fs');
const path = require('path');

const ORDERS_FILE_PATH = path.join(__dirname, '..', 'orders.json');

function readOrders() {
    try {
        if (!fs.existsSync(ORDERS_FILE_PATH)) {
            fs.writeFileSync(ORDERS_FILE_PATH, JSON.stringify({ orders: {} }, null, 2));
        }
        return JSON.parse(fs.readFileSync(ORDERS_FILE_PATH, 'utf-8'));
    } catch (err) {
        console.error('❌ Помилка читання файлу замовлень:', err);
        return { orders: {} };
    }
}

function writeOrders(data) {
    try {
        fs.writeFileSync(ORDERS_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.error('❌ Помилка запису у файл замовлень:', err);
    }
}

module.exports = {
    readOrders,
    writeOrders,
    ORDERS_FILE_PATH
};
// ========================================
// middleware/paymentReturnLogger.js
// ========================================
module.exports = (req, res, next) => {
    console.log('🔄 Incoming request to /payment-return');
    console.log('   Method:', req.method);
    console.log('   Content-Type:', req.headers['content-type']);
    console.log('   Timestamp:', new Date().toISOString());
    
    // Безпечна перевірка req.body
    if (req.body && typeof req.body === 'object') {
        console.log('   Raw body keys:', Object.keys(req.body));
        
        // Якщо це POST з одним ключем, спробуємо його розпарсити
        if (req.method === 'POST' && Object.keys(req.body).length === 1) {
            const key = Object.keys(req.body)[0];
            console.log('   Trying to parse key:', key ? key.substring(0, 100) + '...' : 'empty key');
            try {
                const parsed = JSON.parse(key);
                console.log('   Parsed orderReference:', parsed.orderReference);
            } catch (e) {
                console.log('   Key is not JSON');
            }
        }
    } else {
        console.log('   Body is null/undefined or not object');
    }
    
    console.log('   Query string:', req.url);
    next();
};
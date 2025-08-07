// ========================================
// middleware/serverCallbackLogger.js
// ========================================
module.exports = (req, res, next) => {
    console.log('📞 Incoming request to /server-callback');
    console.log('   Method:', req.method);
    console.log('   Content-Type:', req.headers['content-type']);
    console.log('   Content-Length:', req.headers['content-length']);
    console.log('   User-Agent:', req.headers['user-agent']);
    console.log('   Timestamp:', new Date().toISOString());
    
    // Логуємо raw body для детального аналізу
    if (req.body) {
        console.log('   Raw body type:', typeof req.body);
        console.log('   Raw body keys count:', Object.keys(req.body).length);
        
        if (Object.keys(req.body).length > 0) {
            const firstKey = Object.keys(req.body)[0];
            console.log('   First key preview:', firstKey ? firstKey.substring(0, 50) + '...' : 'empty');
        }
    }
    next();
};
// ========================================
// routes/serverCallback.js
// ========================================
const crypto = require('crypto');

module.exports = (dependencies) => {
    const {
        MERCHANT_SECRET_KEY,
        readOrders,
        writeOrders,
        sendPaymentConfirmationEmail,
        sendAdminNotification,
        metrics
    } = dependencies;

    return async (req, res) => {
        let paymentData;
        let orderReference = 'unknown';
        
        try {
            console.log('📞 Callback отримано від WayForPay');
            console.log('📅 Час:', new Date().toISOString());
            
            // Покращена обробка різних форматів даних
            if (Object.keys(req.body).length === 1 && typeof Object.keys(req.body)[0] === 'string') {
                const bodyKey = Object.keys(req.body)[0];
                console.log('🔍 Спроба парсити JSON з ключа body');
                
                try {
                    paymentData = JSON.parse(bodyKey);
                    console.log('✅ JSON успішно розпарсено з ключа');
                } catch (parseError) {
                    console.log('⚠️ Парсинг JSON не вдався, використовуємо raw body');
                    paymentData = req.body;
                }
            } else {
                paymentData = req.body;
            }
            
            console.log('🔍 Отримані дані:', JSON.stringify(paymentData, null, 2));
            
            // Безпечне отримання orderReference
            if (paymentData && paymentData.orderReference) {
                orderReference = paymentData.orderReference;
            }
            
            const { 
                merchantAccount,
                transactionStatus, 
                processingDate,
                amount,
                merchantSignature 
            } = paymentData || {};

            // Валідація обов'язкових полів
            if (!orderReference || !transactionStatus || !processingDate || !merchantSignature) {
                console.warn('⚠️ Відсутні необхідні поля в callback-запиті.');
                console.warn('   orderReference:', orderReference);
                console.warn('   transactionStatus:', transactionStatus);
                console.warn('   processingDate:', processingDate);
                console.warn('   merchantSignature:', merchantSignature ? 'present' : 'missing');
                
                return res.status(400).json({ 
                    error: 'Missing required fields',
                    orderReference: orderReference,
                    status: 'accept',
                    time: Math.floor(Date.now() / 1000)
                });
            }

            // Перевірка підпису (декілька варіантів)
            const signatureVariants = [
                [merchantAccount || process.env.MERCHANT_ACCOUNT, orderReference, transactionStatus, processingDate].join(';'),
                [orderReference, transactionStatus, processingDate].join(';'),
                [merchantAccount || process.env.MERCHANT_ACCOUNT, orderReference, amount, transactionStatus, processingDate].join(';')
            ];

            let signatureValid = false;
            signatureVariants.forEach((variant, index) => {
                const expectedSig = crypto.createHmac('md5', MERCHANT_SECRET_KEY).update(variant).digest('hex');
                console.log(`   Варіант ${index + 1}:`, variant, '→', expectedSig);
                if (expectedSig === merchantSignature) {
                    signatureValid = true;
                }
            });
            
            console.log('   Отриманий підпис:', merchantSignature);
            console.log('   Підписи збігаються:', signatureValid);

            if (!signatureValid) {
                console.warn('❌ Неправильний підпис для всіх варіантів. Продовжуємо обробку...');
            }

            // Обробляємо замовлення
            const allOrders = readOrders();
            const customerOrder = allOrders.orders[orderReference];

            if (customerOrder && customerOrder.status !== 'paid') {
                if (transactionStatus === 'Approved') {
                    console.log('✅ Статус оплати підтверджено.');
                    customerOrder.status = 'paid';
                    customerOrder.paidAt = new Date().toISOString();
                    customerOrder.wayforpayData = paymentData;
                    writeOrders(allOrders);

                    await sendPaymentConfirmationEmail(
                        customerOrder.email, 
                        customerOrder.name, 
                        customerOrder.courseName, 
                        orderReference
                    );
                    
                    await sendAdminNotification(
                        customerOrder.email, 
                        customerOrder.name, 
                        customerOrder.courseName, 
                        orderReference, 
                        customerOrder.price
                    );
                    
                    metrics.successfulPayments++;
                    console.log('✅ Замовлення успішно оброблено');
                } else {
                    console.log('⚠️ Статус транзакції не Approved:', transactionStatus);
                    metrics.failedPayments++;
                }
            } else if (customerOrder && customerOrder.status === 'paid') {
                console.log('🔁 Замовлення вже було оплачено.');
            } else {
                console.error('❌ Замовлення не знайдено:', orderReference);
            }

        } catch (error) {
            console.error('❌ Критична помилка обробки callback:', error);
            console.error('❌ Stack trace:', error.stack);
            metrics.failedPayments++;
        } finally {
            // Відповідь WayForPay
            const responseTime = (paymentData && paymentData.processingDate) || Math.floor(Date.now() / 1000);
            const responseStr = [orderReference, 'accept', responseTime].join(';');
            const signature = crypto.createHmac('md5', MERCHANT_SECRET_KEY).update(responseStr).digest('hex');
            
            const response = { 
                orderReference: orderReference, 
                status: 'accept', 
                time: responseTime, 
                signature: signature 
            };
            
            console.log('📤 Відправляємо відповідь WayForPay:', response);
            res.json(response);
        }
    };
};
import { Request, Response } from "express";
import express from "express";
import telnyx from 'telnyx';
import { getDb } from '../db'; // Adjust the import based on your project structure

const router = express.Router();

const db = getDb();


// Initialize Telnyx
const telnyxClient = new telnyx(process.env.TELNYX_API_KEY!);


// SMS Routes
router.post('/sms/send', async (req, res) => {
    try {
        const { to, message, from } = req.body;

        const response = await telnyxClient.messages.create({

            to: to,
            auto_detect: true,
            use_profile_webhooks: true,
        });


        // Store in MongoDB
 response.data &&       await db.collection('messages').insertOne({
            type: 'sms_sent',
            to,
            from,
            message,
            telnyxId: response.data.id,
            status: response.data!.to![0].status,
            createdAt: new Date()
        });

        res.json({ success: true, data: response.data });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/sms/messages', async (req, res) => {
    try {
        const messages = await db.collection('messages')
            .find({ type: 'sms_sent' })
            .sort({ createdAt: -1 })
            .limit(50)
            .toArray();

        res.json(messages);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Voice/Call Routes
// router.post('/api/calls/make', async (req, res) => {
//     try {
//         const { to, from } = req.body;

//         const response = await telnyxClient.calls.create({
//            answering_machine_detection: 'detect',
//            connection_id: process.env.TELNYX_CONNECTION_ID,

//         });

//         // Store call record
//         await db.collection('calls').insertOne({
//             type: 'outbound',
//             to,
//             from,
//             telnyxCallId: response.data!.call_control_id,
//             status: 'initiated',
//             createdAt: new Date()
//         });

//         res.json({ success: true, data: response.data });
//     } catch (error: any) {
//         res.status(500).json({ error: error.message });
//     }
// });

// router.get('/api/calls/history', async (req, res) => {
//     try {
//         const calls = await db.collection('calls')
//             .find({})
//             .sort({ createdAt: -1 })
//             .limit(50)
//             .toArray();

//         res.json(calls);
//     } catch (error: any) {
//         res.status(500).json({ error: error.message });
//     }
// });

// // Number Management Routes
// router.get('/api/numbers/available', async (req, res) => {
//     try {
//         const { areaCode, country = 'US' } = req.query;

//         const response = await telnyxClient.availablePhoneNumbers.list({
//             filter: {
//                 country_code: country as string,
//                 ...(areaCode && { national_destination_code: areaCode as string }),
//                 phone_number_type: 'local',
//                 features: ['sms', 'voice']
//             }
//         });

//         res.json(response.data);
//     } catch (error: any) {
//         res.status(500).json({ error: error.message });
//     }
// });

// // router.post('/api/numbers/purchase', async (req, res) => {
// //     try {
// //         const { phoneNumber } = req.body;

// //         const response = await telnyxClient.phoneNumbers.create({
// //             phone_number: phoneNumber,
// //             connection_id: process.env.TELNYX_CONNECTION_ID,
// //             messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID
// //         });

// //         // Store purchased number
// //         await db.collection('phone_numbers').insertOne({
// //             phoneNumber,
// //             telnyxId: response.data.id,
// //             status: 'active',
// //             purchasedAt: new Date()
// //         });

// //         res.json({ success: true, data: response.data });
// //     } catch (error: any) {
// //         res.status(500).json({ error: error.message });
// //     }
// // });

// router.get('/api/numbers/owned', async (req, res) => {
//     try {
//         const response = await telnyxClient.phoneNumbers.list();
//         res.json(response.data);
//     } catch (error: any) {
//         res.status(500).json({ error: error.message });
//     }
// });



// Webhook handlers
router.post('/sms/receive', async (req, res) => {
    try {
        const { data } = req.body;

        if (data.event_type === 'message.received') {
            await db.collection('messages').insertOne({
                type: 'sms_received',
                from: data.payload.from.phone_number,
                to: data.payload.to[0].phone_number,
                message: data.payload.text,
                telnyxId: data.payload.id,
                receivedAt: new Date()
            });
        }

        res.status(200).send('OK');
    } catch (error) {
        res.status(500).send('Error');
    }
});

// router.post('/api/webhooks/voice', async (req, res) => {
//     try {
//         const { data } = req.body;

//         // Update call status
//         await db.collection('calls').updateOne(
//             { telnyxCallId: data.payload.call_control_id },
//             {
//                 $set: {
//                     status: data.event_type,
//                     updatedAt: new Date()
//                 }
//             }
//         );

//         // Handle different call events
//         if (data.event_type === 'call.initiated') {
//             // Answer the call
//             await telnyxClient.calls.answer(data.payload.call_control_id);
//         } else if (data.event_type === 'call.answered') {
//             // Play a message or transfer
//             await telnyxClient.calls.speak(data.payload.call_control_id, {
//                 payload: 'Hello, this is a Telnyx demo call. Thank you for testing!',
//                 voice: 'female'
//             });
//         }

//         res.status(200).send('OK');
//     } catch (error) {
//         res.status(500).send('Error');
//     }
// });

// Statistics endpoint
router.get('/api/stats', async (req, res) => {
    try {
        const [messageCount, callCount, numberCount] = await Promise.all([
            db.collection('messages').countDocuments(),
            db.collection('calls').countDocuments(),
            db.collection('phone_numbers').countDocuments()
        ]);

        res.json({
            messages: messageCount,
            calls: callCount,
            phoneNumbers: numberCount
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});


export default router;
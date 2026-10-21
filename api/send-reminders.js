import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

// Initialize Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();
const messaging = getMessaging();

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    
    // Time windows (Checking appointments roughly 1 hour away with a 20-minute buffer)
    const oneHourFromNowStart = new Date(now.getTime() + 50 * 60000);
    const oneHourFromNowEnd = new Date(now.getTime() + 70 * 60000);

    const bookingsSnapshot = await db.collection('bookings')
      .where('status', '==', 'confirmed')
      .where('notified_1hr', '==', false)
      .where('appointment_time', '>=', oneHourFromNowStart)
      .where('appointment_time', '<=', oneHourFromNowEnd)
      .get();

    let notificationCount = 0;

    for (const doc of bookingsSnapshot.docs) {
      const booking = doc.data();
      const clientId = booking.client_id;

      const userDoc = await db.collection('users').doc(clientId).get();
      if (!userDoc.exists) continue;
      
      const fcmToken = userDoc.data().fcm_token;
      if (!fcmToken) continue;

      const message = {
        token: fcmToken,
        notification: {
          title: 'Appointment in 1 Hour! ⏱️',
          body: `Your ${booking.service_name || 'salon'} appointment starts soon. See you at Glamish!`,
        },
      };

      await messaging.send(message);
      await doc.ref.update({ notified_1hr: true });
      notificationCount++;
    }

    return res.status(200).json({ success: true, notificationsSent: notificationCount });
  } catch (error) {
    console.error('Error processing reminders:', error);
    return res.status(500).json({ error: error.message });
  }
}

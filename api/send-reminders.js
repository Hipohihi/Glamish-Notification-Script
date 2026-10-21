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
    
    // Expanded 24-hour window for testing to ensure your upcoming appointments are caught immediately
    const twentyFourHoursLater = new Date(now.getTime() + 24 * 60 * 60000);

    const bookingsSnapshot = await db.collection('bookings')
      .where('status', '==', 'Confirmed') // Matches the capitalized status saved by Flutter
      .where('notified_1hr', '==', false)
      .where('appointment_time', '>=', now)
      .where('appointment_time', '<=', twentyFourHoursLater)
      .get();

    let notificationCount = 0;

    for (const doc of bookingsSnapshot.docs) {
      const booking = doc.data();
      const clientId = booking.userId; // FIXED: Changed from client_id to userId

      if (!clientId) continue;

      const userDoc = await db.collection('users').doc(clientId).get();
      if (!userDoc.exists) continue;
      
      const fcmToken = userDoc.data().fcm_token;
      if (!fcmToken) continue;

      const message = {
        token: fcmToken,
        notification: {
          title: 'Appointment Reminder! ⏱️',
          body: `Your Glamish appointment is coming up soon. We look forward to seeing you!`,
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

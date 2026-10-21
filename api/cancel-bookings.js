import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Query for bookings that are past their appointment time and still need cancellation
    // (You can adjust the status condition based on your workflow, e.g., 'Pending' or 'Confirmed')
    const bookingsSnapshot = await db.collection('bookings')
      .where('status', '==', 'Pending') // or 'Confirmed' if unfulfilled
      .where('appointment_time', '<', now)
      .get();

    let cancelledCount = 0;

    const batch = db.batch();

    for (const doc of bookingsSnapshot.docs) {
      // Update status to Cancelled
      batch.update(doc.ref, { status: 'Cancelled' });
      cancelledCount++;
    }

    if (cancelledCount > 0) {
      await batch.commit();
    }

    return res.status(200).json({ success: true, bookingsCancelled: cancelledCount });
  } catch (error) {
    console.error('Error auto-cancelling bookings:', error);
    return res.status(500).json({ error: error.message });
  }
}

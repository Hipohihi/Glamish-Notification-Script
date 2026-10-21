const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        : undefined,
    }),
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  // Authorization Check
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = admin.firestore.Timestamp.now();

    // Query for past-due confirmed bookings
    const snapshot = await db
      .collection('bookings')
      .where('status', '==', 'Confirmed')
      .where('appointment_time', '<', now)
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ success: true, bookingsMoved: 0 });
    }

    const batch = db.batch();

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      
      // Update status to Cancelled
      const updatedData = {
        ...data,
        status: 'Cancelled',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // 1. Copy document to finished_appointments collection
      const finishedRef = db.collection('finished_appointments').doc(doc.id);
      batch.set(finishedRef, updatedData);

      // 2. Delete original document from bookings collection
      batch.delete(doc.ref);
    });

    // Commit atomic transaction
    await batch.commit();

    return res.status(200).json({
      success: true,
      bookingsMoved: snapshot.size,
    });
  } catch (error) {
    console.error('Error auto-cancelling and moving bookings:', error);
    return res.status(500).json({ error: error.message });
  }
};

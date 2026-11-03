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
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    console.log('Server Current Time (UTC):', now.toISOString());

    const snapshot = await db
      .collection('bookings')
      .where('status', '==', 'Confirmed')
      .get();

    console.log(`Total 'Confirmed' bookings found in DB: ${snapshot.size}`);

    if (snapshot.empty) {
      return res.status(200).json({ success: true, bookingsMoved: 0, debug: 'No confirmed bookings found' });
    }

    const batch = db.batch();
    let movedCount = 0;
    let debugInfo = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      let appointmentDate = null;

      const rawTimeField = data['appointment_time'] || data['appointmentTimestamp'];

      if (rawTimeField && typeof rawTimeField.toDate === 'function') {
        appointmentDate = rawTimeField.toDate();
      } else if (rawTimeField) {
        appointmentDate = new Date(rawTimeField);
      }

      debugInfo.push({
        id: doc.id,
        client: data['clientName'],
        parsedTime: appointmentDate ? appointmentDate.toISOString() : 'INVALID',
        isPast: appointmentDate ? appointmentDate < now : false
      });

      if (appointmentDate && appointmentDate < now) {
        const updatedData = {
          ...data,
          status: 'Cancelled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const finishedRef = db.collection('finished_appointments').doc(doc.id);
        batch.set(finishedRef, updatedData);
        batch.delete(doc.ref);
        movedCount++;
      }
    });

    if (movedCount > 0) {
      await batch.commit();
    }

    return res.status(200).json({
      success: true,
      bookingsMoved: movedCount,
      evaluatedBookings: debugInfo
    });
  } catch (error) {
    console.error('Error auto-cancelling and moving bookings:', error);
    return res.status(500).json({ error: error.message });
  }
};

const mongoose = require('mongoose');

async function connectMongoDB() {
  try {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      console.warn('MONGO_URI not configured. Analytics disabled.');
      return null;
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('✓ Proxy Service: MongoDB connected successfully');
    return mongoose.connection;
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    return null;
  }
}

module.exports = { connectMongoDB };

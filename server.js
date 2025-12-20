const express = require('express');
const cors = require('cors');
const compression = require('compression');
require('dotenv').config();

const { createRedisClient, closeRedis } = require('./config/redis');
const { ensureStorageDir } = require('./config/storage');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const downloadRoutes = require('./routes/download');

const PORT = process.env.PORT || 4000;
const app = express();

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

app.use(compression({
  filter: (req, res) => {
    // Don't compress video streams
    if (req.path.startsWith('/download/')) return false;
    return compression.filter(req, res);
  }
}));

app.use(express.json());

// Routes
app.use('/', downloadRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize
async function initialize() {
  try {
    // Create cache directory
    ensureStorageDir();

    // Connect to Redis
    createRedisClient();

    // Start server - bind to 0.0.0.0 to accept connections from any network interface
    app.listen(PORT, '0.0.0.0', () => {
      console.log('='.repeat(50));
      console.log('✓ Video Proxy Service Started');
      console.log('='.repeat(50));
      console.log(`  Port: ${PORT}`);
      console.log(`  Host: 0.0.0.0 (listening on all interfaces)`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`  Cache Path: ${process.env.STORAGE_PATH || '/tmp/video-cache'}`);
      console.log(`  Max Cache Size: ${process.env.MAX_CACHE_SIZE_GB || 10} GB`);
      console.log('='.repeat(50));
    });
  } catch (error) {
    console.error('Failed to initialize proxy service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received - shutting down gracefully');
  await closeRedis();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received - shutting down gracefully');
  await closeRedis();
  process.exit(0);
});

// Start the service
initialize();

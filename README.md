# Video Proxy Service

Production-ready video streaming proxy with caching, range requests, and rate limiting.

Live Demo: [https://owais-task-repo.vercel.app/](https://owais-task-repo.vercel.app/)

## Features

- **Video Streaming** - Stream videos with session header preservation
- **File Caching** - LRU cache with 10GB limit
- **HTTP Range Requests** - Resumable downloads (HTTP 206)
- **Rate Limiting** - 10 downloads per hour per IP
- **Analytics Tracking** - Download statistics in MongoDB
- **Compression** - Gzip for JSON responses

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create `.env` file:

```env
PORT=4000
REDIS_URL=redis://default:password@host:port
MONGO_URI=mongodb+srv://username:password@cluster/db
STORAGE_PATH=/tmp/video-cache
MAX_CACHE_SIZE_GB=10
RATE_LIMIT_DOWNLOAD_MAX=10
RATE_LIMIT_DOWNLOAD_WINDOW=3600
ALLOWED_ORIGINS=http://localhost:3000,https://owais-task-repo.vercel.app/
```

### 3. Start Server

```bash
# Development
pnpm run dev

# Production
pnpm start
```

## API Endpoints

### Download Video

```
GET /download/:videoId/:quality
```

**Response**: Video stream (MP4)

**Headers**:

- `X-Cache-Status`: HIT or MISS
- `X-RateLimit-Limit`: 10
- `X-RateLimit-Remaining`: 7
- `Accept-Ranges`: bytes
- `Content-Range`: bytes (for range requests)

### Health Check

```
GET /health
```

**Response**:

```json
{
  "status": "healthy",
  "uptime": 12345,
  "cache": {
    "totalFiles": 42,
    "totalSizeGB": "3.5",
    "utilizationPercent": "35.0"
  }
}
```

### Cache Stats

```
GET /stats
```

## Deployment

### Heroku (Recommended)

1. Push to GitHub
2. Import to Heroku
3. Add environment variables
4. Add persistent disk (10GB)
5. Deploy

### Render

1. Create Web Service
2. Connect GitHub repo
3. Add Redis instance
4. Configure persistent disk
5. Set environment variables

## Architecture

```
Client Request
    ↓
Rate Limiter → Check IP limit
    ↓
Check Cache → If HIT: Serve from disk
    ↓         If MISS: Stream from CDN
Stream Video
    ↓
Track Analytics
```

## Cache Management

- **LRU Eviction**: Automatically removes least-recently-used files
- **Max Size**: 10GB (configurable)
- **Cleanup Trigger**: 90% capacity
- **TTL**: 24 hours per file

## Rate Limiting

- **Downloads**: 10 per hour per IP
- **API Calls**: 30 per 15 minutes per IP
- **Storage**: Redis-based sliding window

## Monitoring

Check logs for:

- Cache hit rate
- Download success/failure
- Storage utilization
- Rate limit violations

## License

ISC

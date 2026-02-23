# Port Configuration Fix

## Problem
Port 3000 was already in use (process ID 22760), preventing the backend server from starting.

## Solution
Changed the port configuration to avoid conflicts:

### Backend Configuration
- **Created:** `backend/.env`
- **Port:** 3001
- **API Endpoint:** `http://localhost:3001/api/v1/orders`

### Frontend Configuration
- **Updated:** `frontend/health-chain/.env.local`
- **Backend URL:** `http://localhost:3001`
- **WebSocket URL:** `http://localhost:3001`
- **Frontend Port:** 3000 (default Next.js port)

## New Port Assignments

| Service  | Port | URL                                    |
|----------|------|----------------------------------------|
| Backend  | 3001 | http://localhost:3001/api/v1          |
| Frontend | 3000 | http://localhost:3000                 |
| Dashboard| 3000 | http://localhost:3000/dashboard/orders|

## Files Modified

1. ✅ **Created** `backend/.env` with PORT=3001
2. ✅ **Updated** `frontend/health-chain/.env.local` to point to port 3001
3. ✅ **Updated** `SETUP_INSTRUCTIONS.md` with correct port information

## Next Steps

### 1. Start the Backend Server
```bash
cd backend
npm run start:dev
```

Expected output:
```
Application is running on: http://localhost:3001/api/v1
Environment: development
```

### 2. Start the Frontend Server
```bash
cd frontend/health-chain
npm run dev
```

Expected output:
```
- ready started server on 0.0.0.0:3000, url: http://localhost:3000
```

### 3. Access the Dashboard
Open your browser and navigate to:
```
http://localhost:3000/dashboard/orders
```

## Verification

Test the API connection:
```bash
curl "http://localhost:3001/api/v1/orders?hospitalId=HOSP-001"
```

## Troubleshooting

### If Backend Still Won't Start
Check if port 3001 is available:
```bash
netstat -ano | findstr :3001
```

If port 3001 is also in use, change to another port:
1. Edit `backend/.env` and set `PORT=3002`
2. Edit `frontend/health-chain/.env.local` and update URLs to `http://localhost:3002`

### If Frontend Can't Connect
1. Verify backend is running on port 3001
2. Check browser console for CORS errors
3. Ensure `.env.local` has correct backend URL

## Configuration Files

### backend/.env
```env
PORT=3001
NODE_ENV=development
API_PREFIX=api/v1
CORS_ORIGIN=http://localhost:3001,http://localhost:3002
```

### frontend/health-chain/.env.local
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_API_PREFIX=api/v1
NEXT_PUBLIC_WS_URL=http://localhost:3001
```

## Status
✅ Port conflict resolved
✅ Configuration files updated
✅ Documentation updated
✅ Ready to start servers


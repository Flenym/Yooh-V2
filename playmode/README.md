# Metior Local Site

Standalone local website with:
- Registration and login
- Personal servers and channels
- Real-time chat
- Voice calls in channels (WebRTC + signaling over Socket.IO)
- Local database stored on your PC (`backend/data/db.json`)

## Run (Windows)

From `metior_local_site`:

```bat
npm install
npm run install:all
npm run dev
```

Frontend:
- `http://127.0.0.1:5173`

Backend API:
- `http://127.0.0.1:4000/api`

## Notes

- This is a clean new local project.
- It does not depend on Docker.
- Calls are peer-to-peer and best for small groups/local usage.

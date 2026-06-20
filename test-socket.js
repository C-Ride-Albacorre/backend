// Install dependencies first:
// npm install socket.io-client

const { io } = require("socket.io-client");

// Replace with your actual values
const SERVER_URL = "wss://backend-service-1rc7.onrender.com";
const NAMESPACE = "/driver";
const DRIVER_ID = "621cf9e2-b70f-48f5-b96b-845abf3605d3";
const ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2MjFjZjllMi1iNzBmLTQ4ZjUtYjk2Yi04NDVhYmYzNjA1ZDMiLCJlbWFpbCI6ImJpbW9jb3cyNjdAb2N1c2VyLmNvbSIsInJvbGUiOiJESVNQQVRDSEVSIiwidHlwZSI6ImFjY2VzcyIsImlhdCI6MTc4MTk0MTMwNywiZXhwIjoxNzgxOTQ0OTA3fQ.QohJhp4ocCDYWOtRCgyBdSFYNWwCdqXxJY3FV-_jycs";

// Connect with query params and auth
const socket = io(`${SERVER_URL}${NAMESPACE}`, {
  query: {
    driverId: DRIVER_ID,
  },
  auth: {
    token: ACCESS_TOKEN, // Access token, not refresh token
  },
  transports: ["websocket"], // Force WebSocket transport
});

// Connection events
socket.on("connect", () => {
  console.log("✅ Connected to server with ID:", socket.id);

  // Example: emit a pickup event
 socket.on('new-order-request', (data) => console.log('📦 Order:', data));

});

socket.on("connect_error", (err) => {
  console.error("❌ Connection error:", err.message);
});

socket.on("disconnect", (reason) => {
  console.log("🔴 Disconnected:", reason);
});

// Listen for server events
socket.on("pickupConfirmed", (data) => {
  console.log("📦 Pickup confirmed:", data);
});

socket.on("error", (err) => {
  console.error("⚠️ Server error:", err);
});

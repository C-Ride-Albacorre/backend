// npm install socket.io-client
const { io } = require("socket.io-client");

const SERVER_URL = "wss://backend-service-1rc7.onrender.com";

const DRIVER_ID = "621cf9e2-b70f-48f5-b96b-845abf3605d3";
const ORDER_ID = "f629b1d2-024f-4b59-b376-cef8102d9b88";

const ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2MjFjZjllMi1iNzBmLTQ4ZjUtYjk2Yi04NDVhYmYzNjA1ZDMiLCJlbWFpbCI6ImJpbW9jb3cyNjdAb2N1c2VyLmNvbSIsInJvbGUiOiJESVNQQVRDSEVSIiwidHlwZSI6ImFjY2VzcyIsImlhdCI6MTc4MzExNDYxNiwiZXhwIjoxNzgzMTE4MjE2fQ.girtzbnqY9ORboHDpWWsQ6KrhVgTebXHfzJCYAY7VBg";
// ───────────────────────────────────────────────
// 1. DRIVER SOCKET
// ───────────────────────────────────────────────
const driverSocket = io(`${SERVER_URL}/driver`, {
  auth: { token: ACCESS_TOKEN },
  query: { driverId: DRIVER_ID },
  transports: ["websocket"],
});

driverSocket.on("connected", (data) => {
  console.log("🟢 Driver Connection Confirmed");
  console.dir(data, { depth: null });
});

driverSocket.on("new-order-request", (data) => {
  console.log("📦 Order:", data);
});

driverSocket.on("request-timeout", (data) => {
  console.log("⏰ REQUEST TIMEOUT");
  console.dir(data, { depth: null });
});

driverSocket.on("order-taken", (data) => {
  console.log("🚫 ORDER TAKEN BY ANOTHER DRIVER");
  console.dir(data, { depth: null });
});

driverSocket.on("status-updated", (data) => {
  console.log("🟢 STATUS UPDATED");
  console.dir(data, { depth: null });
});

driverSocket.on("connect_error", (err) => {
  console.error("❌ DRIVER CONNECTION ERROR");
  console.error(err.message);
});

driverSocket.on("disconnect", (reason) => {
  console.log("🔴 DRIVER DISCONNECTED:", reason);
});

driverSocket.on("error", (err) => {
  console.error("⚠️ DRIVER ERROR");
  console.dir(err, { depth: null });
});

// ───────────────────────────────────────────────
// 2. MAP SOCKET
// ───────────────────────────────────────────────
const mapSocket = io(`${SERVER_URL}/map`, {
  query: { orderId: ORDER_ID },
  transports: ["websocket"],
});

// location interval (declared once)
let locationInterval = null;

function startLocationUpdates() {
  if (locationInterval) return; // prevent duplicate intervals

  locationInterval = setInterval(() => {
    // Only send if both sockets are connected
    if (!driverSocket.connected || !mapSocket.connected) {
      console.log("⏳ Sockets not ready, skipping location");
      return;
    }

    const fakeLocation = {
      lat: 6.5460833,
      lng: 3.3805733,
      heading: 0,
    };

    driverSocket.emit("driver-location", {
      driverId: DRIVER_ID,
      orderId: ORDER_ID,
      lat: fakeLocation.lat,
      lng: fakeLocation.lng,
      heading: fakeLocation.heading,
    });

    console.log("📍 Location sent:", fakeLocation);
  }, 2000);
}

function stopLocationUpdates() {
  if (locationInterval) {
    clearInterval(locationInterval);
    locationInterval = null;
  }
}

mapSocket.on("connect", () => {
  console.log("🗺 MAP CONNECTED:", mapSocket.id);

  // 1. Subscribe to order room
  mapSocket.emit("subscribe-order", ORDER_ID);

  // 2. Start location updates (if not already running)
  startLocationUpdates();
});

mapSocket.on("disconnect", (reason) => {
  console.log("🔴 MAP DISCONNECTED:", reason);
  // Optionally stop updates on disconnect (but will restart on reconnect)
  // stopLocationUpdates(); // uncomment if you want to stop on disconnect
});

mapSocket.on("driver-location", (data) => {
  console.log("📍 DRIVER LOCATION (received from backend)");
  console.dir(data, { depth: null });
});

mapSocket.on("eta-update", (data) => {
  console.log("⏱ ETA UPDATE");
  console.dir(data, { depth: null });
});

mapSocket.on("polyline-update", (data) => {
  console.log("🛣 POLYLINE UPDATE");
  console.dir(data, { depth: null });
});

mapSocket.on("order-status", (data) => {
  console.log("📋 ORDER STATUS UPDATE");
  console.dir(data, { depth: null });
});

mapSocket.on("connect_error", (err) => {
  console.error("❌ MAP CONNECTION ERROR");
  console.error(err.message);
});

// ───────────────────────────────────────────────
// DEBUG: Listen to all events (optional)
// ───────────────────────────────────────────────
// driverSocket.onAny((event, ...args) => {
//   console.log(`🔥 DRIVER EVENT -> ${event}`);
//   console.dir(args, { depth: null });
// });
// mapSocket.onAny((event, ...args) => {
//   console.log(`🔥 MAP EVENT -> ${event}`);
//   console.dir(args, { depth: null });
// });
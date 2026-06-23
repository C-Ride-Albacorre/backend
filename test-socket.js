// npm install socket.io-client

const { io } = require("socket.io-client");

const SERVER_URL = "wss://backend-service-1rc7.onrender.com";

const DRIVER_ID = "621cf9e2-b70f-48f5-b96b-845abf3605d3";
// const ORDER_ID = "f4f80773-750d-48e2-823b-ee5dd1acd93c";
const ORDER_ID = "59b388f2-4146-4feb-bc74-dece5e9d1353"

//"0b916838-d817-474f-ad57-f8a27899d7b9";

const ACCESS_TOKEN ="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2MjFjZjllMi1iNzBmLTQ4ZjUtYjk2Yi04NDVhYmYzNjA1ZDMiLCJlbWFpbCI6ImJpbW9jb3cyNjdAb2N1c2VyLmNvbSIsInJvbGUiOiJESVNQQVRDSEVSIiwidHlwZSI6ImFjY2VzcyIsImlhdCI6MTc4MjIzMzQ1OSwiZXhwIjoxNzgyMjM3MDU5fQ.cz6B-hUzWdTEv8IZ23gaCMTjgviZlNOV9k2azCfo2yY"
const driverSocket = io(`${SERVER_URL}/driver`, {
  query: {
    driverId: DRIVER_ID,
  },
  auth: {
    token: ACCESS_TOKEN,
  },
  transports: ["websocket"],
});

driverSocket.on("connect", () => {
  console.log("✅ DRIVER CONNECTED:", driverSocket.id);
});

driverSocket.on("connected", (data) => {
  console.log("🟢 Driver Connection Confirmed");
  console.dir(data, { depth: null });
});

driverSocket.on("new-order-request", (data) => {
  console.log('📦 Order:', data)
  //console.log("📦 NEW ORDER REQUEST");
  //console.dir(data, { depth: null });
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

// ======================================================
// MAP NAMESPACE
// ======================================================

const mapSocket = io(`${SERVER_URL}/map`, {
  query: {
    orderId: ORDER_ID,
  },
  transports: ["websocket"],
});

mapSocket.on("connect", () => {
  console.log("🗺 MAP CONNECTED:", mapSocket.id);

  // Optional. Your gateway already joins the room using
  // handshake.query.orderId, but this doesn't hurt.
  mapSocket.emit("subscribe-order", ORDER_ID);
});

mapSocket.on("driver-location", (data) => {
  console.log("📍 DRIVER LOCATION");
  console.dir(data, { depth: null });

  /*
    {
      lat: 12.345,
      lng: 7.890,
      heading: 180
    }
  */
});

mapSocket.on("eta-update", (data) => {
  console.log("⏱ ETA UPDATE");
  console.dir(data, { depth: null });

  /*
    {
      leg: "to-vendor",
      etaSeconds: 420
    }
  */
});

mapSocket.on("polyline-update", (data) => {
  console.log("🛣 POLYLINE UPDATE");
  console.dir(data, { depth: null });
});

mapSocket.on("order-status", (data) => {
  console.log("📋 ORDER STATUS UPDATE");
  console.dir(data, { depth: null });

  /*
    {
      status: "...",
      history: [...]
    }
  */
});

mapSocket.on("connect_error", (err) => {
  console.error("❌ MAP CONNECTION ERROR");
  console.error(err.message);
});

mapSocket.on("disconnect", (reason) => {
  console.log("🔴 MAP DISCONNECTED:", reason);
});

// ======================================================
// DEBUG EVERYTHING
// ======================================================

driverSocket.onAny((event, ...args) => {
  console.log(`🔥 DRIVER EVENT -> ${event}`);
  console.dir(args, { depth: null });
});

mapSocket.onAny((event, ...args) => {
  console.log(`🔥 MAP EVENT -> ${event}`);
  console.dir(args, { depth: null });
});
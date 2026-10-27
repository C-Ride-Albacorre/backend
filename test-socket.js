// 

//////////NEW////////////

// npm install socket.io-client

const { io } = require("socket.io-client");

const SERVER_URL = "wss://backend-service-1rc7.onrender.com";

const DRIVER_ID = "a8fb9168-b6bf-4ef9-9135-12f8b4bd69a2";
const ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhOGZiOTE2OC1iNmJmLTRlZjktOTEzNS0xMmY4YjRiZDY5YTIiLCJlbWFpbCI6ImNyaWRlZHJpdmVyQGdtYWlsLmNvbSIsInJvbGUiOiJESVNQQVRDSEVSIiwidHlwZSI6ImFjY2VzcyIsImlhdCI6MTc5MzEwODk0MiwiZXhwIjoxNzkzMTEyNTQyfQ.S4FDCWbnE9utgev20MRTXVoWhGantHG-hDWX11wWXds"
// --- Local State (mimics the mobile app) ---
let orderList = [];

// --- Helper to render the current state ---
function printState(action) {
  console.log(`\n============================================================`);
  console.log(`📱 UI UPDATE: ${action}`);
  console.log(`📦 Current Orders in List: ${orderList.length}`);
  console.log(`============================================================`);
  if (orderList.length === 0) {
    console.log("   (empty screen)");
  } else {
    orderList.forEach((o, idx) => {
      console.log(`   [${idx + 1}] ID: ${o.order_id.substring(0, 8)}... | #${o.order_number} | ₦${o.total_amount} | Store: ${o.store_name}`);
    });
  }
  console.log(`============================================================\n`);
}

// --- Socket Connection ---
const driverSocket = io(`${SERVER_URL}/driver`, {
  auth: {
    token: ACCESS_TOKEN,
  },
  query: {
    driverId: DRIVER_ID,
  },
  transports: ["websocket"],
});

// --- Event Listeners ---

driverSocket.on("connect", () => {
  console.log(`🔌 Connected to WebSocket server (socket: ${driverSocket.id})`);
});

driverSocket.on("connected", (data) => {
  console.log("🟢 Driver Connection Confirmed by Backend");
  console.dir(data, { depth: null });
});

// 1. SYNC ORDERS (Hard Reset on Connect/Reconnect)
driverSocket.on("sync-orders", (payload) => {
  console.log("🔄 SYNC-ORDERS received from server");
  
  // CLEAR the current list on screen
  orderList = [];

  // ADD the fresh batch
  if (payload && Array.isArray(payload.orders)) {
    payload.orders.forEach((order) => orderList.push(order));
  }

  console.log(`📦 Orders synced: ${orderList.length} orders received`);
  console.dir(payload.orders, { depth: null });
  printState("sync-orders (Hard Reset)");
});

// 2. NEW ORDER REQUEST (Merge on live dispatch)
driverSocket.on("new-order-request", (payload) => {
  console.log("📦 NEW-ORDER-REQUEST received from server");
  
  const incoming = payload.orders ?? [payload];

  incoming.forEach((newOrder) => {
    // Merge: only add if it's not already in the list
    if (!orderList.find((o) => o.order_id === newOrder.order_id)) {
      orderList.push(newOrder);
    }
  });

  console.log(`📦 Orders merged: ${incoming.length} new orders received`);
  console.dir(incoming, { depth: null });
  printState("new-order-request (Merged)");
});

// 3. ORDER REMOVED (Cleanup when assigned/declined/cancelled)
driverSocket.on("order-removed", (payload) => {
  console.log(`🗑️ ORDER-REMOVED received: ${payload.order_id}`);
  
  orderList = orderList.filter((o) => o.order_id !== payload.order_id);
  
  printState("order-removed (Filtered)");
});

driverSocket.on("request-timeout", (data) => {
  console.log("⏰ REQUEST TIMEOUT");
  console.dir(data, { depth: null });
});

driverSocket.on("disconnect", (reason) => {
  console.log(`🔴 Disconnected from server: ${reason}`);
});

driverSocket.on("connect_error", (err) => {
  console.error(`❌ Connection Error: ${err.message}`);
});
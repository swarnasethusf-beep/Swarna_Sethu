require("dotenv").config();
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

// ── Security Config ─────────────────────────────────────────
const SALT_ROUNDS = 10;
const ENC_KEY = process.env.ENCRYPTION_SECRET; // 32 chars for AES-256

if (!ENC_KEY || ENC_KEY.length !== 32) {
  console.error("❌ ENCRYPTION_SECRET in .env must be exactly 32 characters!");
  process.exit(1);
}

// ── AES-256-CBC Encrypt (license keys) ──────────────────────
function encryptKey(plainText) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENC_KEY), iv);
  let encrypted = cipher.update(plainText);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

// ── AES-256-CBC Decrypt (license keys) ──────────────────────
function decryptKey(cipherText) {
  try {
    const [ivHex, encHex] = cipherText.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const encBuf = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENC_KEY), iv);
    let decrypted = decipher.update(encBuf);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch { return null; }
}

// ── SHA-256 Hash (deterministic lookup for license keys) ─────
function hashKeyForLookup(plainText) {
  return crypto.createHash("sha256").update(plainText).digest("hex");
}

// 🔹 Firebase Admin Configuration
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 📦 INVENTORY / PRODUCTS API
app.post("/add-product", async (req, res) => {
  try {
    const { licenseDocId, userId, userName, itemCode, description, weight, makingCharges } = req.body;
    if (!licenseDocId) return res.status(400).send({ error: "licenseDocId required" });
    const docRef = await db.collection("licenses").doc(licenseDocId).collection("products").add({
      itemCode,
      description,
      weight: parseFloat(weight) || 0,
      makingCharges: parseFloat(makingCharges) || 0,
      createdBy: userId || null,       // 🔑 who created this
      createdByName: userName || "",   // display name
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(200).send({ id: docRef.id });
  } catch (err) {
    console.error("Error adding product:", err);
    res.status(500).send({ error: "Failed to add product" });
  }
});

app.get("/products", async (req, res) => {
  try {
    const { licenseDocId, role, userId } = req.query;
    if (!licenseDocId) return res.status(400).send({ error: "licenseDocId required" });

    // Fetch all products for this license
    const snapshot = await db
      .collection("licenses").doc(licenseDocId)
      .collection("products")
      .orderBy("createdAt", "desc")
      .get();

    let products = [];
    snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));

    // Super admin sees everything; admin sees only their own
    if (role === "admin" && userId) {
      products = products.filter(p => p.createdBy === userId);
    }

    res.status(200).send(products);
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).send({ error: "Failed to fetch products" });
  }
});

// 👥 STAFF MANAGEMENT API
app.post("/add-staff", async (req, res) => {
  try {
    const { licenseDocId, userId, userName, ...data } = req.body;
    if (!licenseDocId) return res.status(400).send({ error: "licenseDocId required" });
    const docRef = await db.collection("licenses").doc(licenseDocId).collection("staff").add({
      ...data,
      createdBy: userId || null,       // 🔑 who created this
      createdByName: userName || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(200).send({ id: docRef.id });
  } catch (err) {
    console.error("Error adding staff:", err);
    res.status(500).send({ error: "Failed to add staff" });
  }
});

app.get("/staff", async (req, res) => {
  try {
    const { licenseDocId, role, userId } = req.query;
    if (!licenseDocId) return res.status(400).send({ error: "licenseDocId required" });

    const snapshot = await db
      .collection("licenses").doc(licenseDocId)
      .collection("staff")
      .orderBy("createdAt", "desc")
      .get();

    let staffList = [];
    snapshot.forEach(doc => staffList.push({ id: doc.id, ...doc.data() }));

    // Super admin sees everyone's staff; admin sees only their own
    if (role === "admin" && userId) {
      staffList = staffList.filter(s => s.createdBy === userId);
    }

    res.status(200).send(staffList);
  } catch (err) {
    console.error("Error fetching staff:", err);
    res.status(500).send({ error: "Failed to fetch staff" });
  }
});

// ⚙️ DISPLAY SETTINGS (Super Admin)
app.get("/settings", async (req, res) => {
  try {
    const { licenseDocId } = req.query;
    if (!licenseDocId) return res.status(400).send({ error: "licenseDocId required" });
    const doc = await db.collection("licenses").doc(licenseDocId).get();
    if (!doc.exists) return res.status(404).send({ error: "License not found" });
    const settings = doc.data().displaySettings || {
      invoice: false, dashboard: false, inventory: false, staff: false
    };
    res.status(200).send(settings);
  } catch (err) {
    console.error("Settings fetch error:", err);
    res.status(500).send({ error: "Failed to fetch settings" });
  }
});

app.post("/settings", async (req, res) => {
  try {
    const { licenseDocId, displaySettings } = req.body;
    if (!licenseDocId) return res.status(400).send({ error: "licenseDocId required" });
    await db.collection("licenses").doc(licenseDocId).update({ displaySettings });
    res.status(200).send({ success: true });
  } catch (err) {
    console.error("Settings save error:", err);
    res.status(500).send({ error: "Failed to save settings" });
  }
});


app.post("/create-invoice", async (req, res) => {
  try {
    const { licenseDocId, userId, userName, ...data } = req.body;
    if (!licenseDocId) return res.status(400).send({ error: "licenseDocId required" });
    if (!data.invoiceNumber) data.invoiceNumber = "INV-" + Date.now();
    const docRef = await db.collection("licenses").doc(licenseDocId).collection("invoices").add({
      ...data,
      createdBy: userId || null,       // 🔑 who created this invoice
      createdByName: userName || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(200).send({ id: docRef.id, invoiceNumber: data.invoiceNumber });
  } catch (err) {
    console.error("Error creating invoice:", err);
    res.status(500).send({ error: "Failed to create invoice" });
  }
});

// 📋 LIST INVOICES
app.get("/invoices", async (req, res) => {
  try {
    const { licenseDocId, role, userId } = req.query;
    if (!licenseDocId) return res.status(400).send({ error: "licenseDocId required" });

    const snapshot = await db
      .collection("licenses").doc(licenseDocId)
      .collection("invoices")
      .orderBy("createdAt", "desc")
      .get();

    let invoices = [];
    snapshot.forEach(doc => invoices.push({ id: doc.id, ...doc.data() }));

    if (role === "admin" && userId) {
      invoices = invoices.filter(inv => inv.createdBy === userId);
    }

    res.status(200).send(invoices);
  } catch (err) {
    console.error("Fetch invoices error:", err);
    res.status(500).send({ error: "Failed to fetch invoices" });
  }
});

// 🪙 METAL PRICES
app.get("/metal-prices", async (req, res) => {
  const API_KEY = "goldapi-5d8smnzxbagj-io";
  try {
    const config = { headers: { "x-access-token": API_KEY, "Content-Type": "application/json" }};
    const goldRes = await axios.get("https://www.goldapi.io/api/XAU/INR", config);
    const goldPerGram = goldRes.data.price / 31.1035;
    res.status(200).send({ gold: goldPerGram.toFixed(2), currency: "INR" });
  } catch (err) {
    res.status(200).send({ gold: "6300.00", isFallback: true });
  }
});

// 🛡️ LICENSE VERIFICATION (legacy - kept for compatibility)
app.post("/verify-license", async (req, res) => {
  try {
    const { key } = req.body;
    const keyHash = hashKeyForLookup(key);
    // Try hash lookup first, fallback to plain key for old records
    let snapshot = await db.collection("licenses").where("keyHash", "==", keyHash).get();
    if (snapshot.empty) snapshot = await db.collection("licenses").where("key", "==", key).get();
    if (snapshot.empty) return res.status(200).send({ valid: false });
    const docData = snapshot.docs[0].data();
    if (docData.active !== true) return res.status(200).send({ valid: false });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const expiryDate = new Date(docData.expiry); expiryDate.setHours(0, 0, 0, 0);
    if (expiryDate < today) return res.status(200).send({ valid: false, message: "License expired" });
    res.status(200).send({ valid: true, licenseDocId: snapshot.docs[0].id });
  } catch (err) {
    res.status(500).send({ error: "Internal Server Error" });
  }
});

// 🔐 USER LOGIN (License Key + Username + Password)
app.post("/login", async (req, res) => {
  try {
    const { licenseKey, username, password } = req.body;
    if (!licenseKey || !username || !password)
      return res.status(400).send({ valid: false, message: "All fields required" });

    // Step 1: Find license by SHA-256 hash (fast, secure)
    const keyHash = hashKeyForLookup(licenseKey);
    let licenseSnap = await db.collection("licenses").where("keyHash", "==", keyHash).get();
    // Fallback: support old plain-text key records not yet migrated
    if (licenseSnap.empty) {
      licenseSnap = await db.collection("licenses").where("key", "==", licenseKey).get();
    }
    if (licenseSnap.empty)
      return res.status(200).send({ valid: false, message: "Invalid license key" });

    const licenseDoc = licenseSnap.docs[0];
    const licenseData = licenseDoc.data();

    if (licenseData.active !== true)
      return res.status(200).send({ valid: false, message: "License is inactive" });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const expiry = new Date(licenseData.expiry); expiry.setHours(0, 0, 0, 0);
    if (expiry < today)
      return res.status(200).send({ valid: false, message: "License expired" });

    // Step 2: Find user by username (fetch, then bcrypt.compare)
    const userSnap = await db
      .collection("licenses").doc(licenseDoc.id)
      .collection("users")
      .where("username", "==", username)
      .get();

    if (userSnap.empty)
      return res.status(200).send({ valid: false, message: "Invalid username or password" });

    const userDoc = userSnap.docs[0];
    const userData = userDoc.data();

    // Step 3: bcrypt compare (handles both hashed and legacy plain passwords)
    const passwordMatch = userData.password.startsWith("$2b$")
      ? await bcrypt.compare(password, userData.password)
      : password === userData.password; // fallback for unmigrated

    if (!passwordMatch)
      return res.status(200).send({ valid: false, message: "Invalid username or password" });

    // Step 4: Return session info
    res.status(200).send({
      valid: true,
      licenseDocId: licenseDoc.id,
      userId: userDoc.id,
      role: userData.role,
      name: userData.name,
      permissions: userData.permissions || {
        invoice: true, inventory: true, staff: true, reports: true
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

// 👤 ADD ADMIN USER (Super Admin only)
app.post("/add-user", async (req, res) => {
  try {
    const { licenseDocId, name, username, password, mobile, permissions } = req.body;
    if (!licenseDocId || !username || !password)
      return res.status(400).send({ error: "licenseDocId, username and password are required" });
    if (!mobile || mobile.replace(/\D/g, "").length !== 10)
      return res.status(400).send({ error: "A valid 10-digit mobile number is required" });

    // Check username is not already taken within this license
    const existing = await db
      .collection("licenses").doc(licenseDocId)
      .collection("users")
      .where("username", "==", username)
      .get();
    if (!existing.empty)
      return res.status(400).send({ error: "Username already exists" });

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const docRef = await db
      .collection("licenses").doc(licenseDocId)
      .collection("users").add({
        name: name || username,
        username,
        password: hashedPassword,   // ✅ bcrypt hashed
        mobile: mobile || "",       // 📱 for OTP password reset
        role: "admin",
        permissions: {
          invoice:   permissions?.invoice   || false,
          inventory: permissions?.inventory || false,
          staff:     permissions?.staff     || false,
          reports:   permissions?.reports   || false
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    res.status(200).send({ success: true, id: docRef.id });
  } catch (err) {
    console.error("Add user error:", err);
    res.status(500).send({ error: "Failed to create user" });
  }
});

// 📋 LIST USERS under a license
app.get("/users", async (req, res) => {
  try {
    const { licenseDocId } = req.query;
    if (!licenseDocId) return res.status(400).send({ error: "licenseDocId required" });
    const snapshot = await db
      .collection("licenses").doc(licenseDocId)
      .collection("users")
      .orderBy("createdAt", "asc")
      .get();
    let users = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      users.push({
        id: doc.id,
        name: data.name,
        username: data.username,
        role: data.role,
        permissions: data.permissions
      }); // Never expose password in list
    });
    res.status(200).send(users);
  } catch (err) {
    console.error("List users error:", err);
    res.status(500).send({ error: "Failed to fetch users" });
  }
});

// 🗑️ DELETE ADMIN USER
app.delete("/delete-user", async (req, res) => {
  try {
    const { licenseDocId, userId } = req.body;
    if (!licenseDocId || !userId) return res.status(400).send({ error: "Required fields missing" });
    await db.collection("licenses").doc(licenseDocId).collection("users").doc(userId).delete();
    res.status(200).send({ success: true });
  } catch (err) {
    res.status(500).send({ error: "Failed to delete user" });
  }
});


app.get("/licenses", async (req, res) => {
  try {
    const snapshot = await db.collection("licenses").orderBy("createdAt", "desc").get();
    let licenses = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      // Decrypt key for admin display; fallback to plain key for old records
      const displayKey = data.keyEncrypted ? (decryptKey(data.keyEncrypted) || data.key) : data.key;
      licenses.push({ id: doc.id, ...data, key: displayKey });
    });
    res.status(200).send(licenses);
  } catch (err) { res.status(500).send({ error: "Failed" }); }
});

app.post("/add-license", async (req, res) => {
  try {
    const { name, business, mobile, email, location, expiry, superAdminUsername, superAdminPassword } = req.body;
    const generateKey = () => {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let result = "SW-";
      for (let i = 0; i < 6; i++) { result += chars.charAt(Math.floor(Math.random() * chars.length)); }
      return result;
    };
    const key = generateKey();
    const newLicense = {
      key,                              // kept for legacy/display fallback
      keyHash: hashKeyForLookup(key),   // SHA-256 for fast login lookup
      keyEncrypted: encryptKey(key),    // AES-256 for secure storage
      name, business, mobile, email, location,
      active: true, expiry,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    const licenseRef = await db.collection("licenses").add(newLicense);

    // Hash super admin password before storing
    const hashedPassword = await bcrypt.hash(superAdminPassword || key, SALT_ROUNDS);
    await db.collection("licenses").doc(licenseRef.id).collection("users").add({
      name,
      username: superAdminUsername || email,
      password: hashedPassword,   // ✅ bcrypt hash
      role: "super_admin",
      permissions: { invoice: true, inventory: true, staff: true, reports: true },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).send({ success: true, key }); // Return plain key once for display
  } catch (err) {
    console.error("Add license error:", err);
    res.status(500).send({ error: "Error creating license" });
  }
});

const PORT = 5000;

// 🔄 RENEW LICENSE (Admin)
app.post("/renew-license", async (req, res) => {
  try {
    const { id, newExpiry } = req.body;
    if (!id || !newExpiry) return res.status(400).send({ error: "ID and new expiry date are required" });
    await db.collection("licenses").doc(id).update({
      expiry: newExpiry,
      active: true,
      renewedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(200).send({ success: true });
  } catch (err) {
    console.error("Renew error:", err);
    res.status(500).send({ error: "Failed to renew license" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 📱 OTP / FORGOT PASSWORD ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// 1️⃣ Get masked mobile for a user (to show on Forgot Password screen)
app.post("/get-user-mobile", async (req, res) => {
  try {
    const { licenseKey, username } = req.body;
    if (!licenseKey || !username)
      return res.status(400).send({ error: "licenseKey and username required" });

    // Look up the license
    const keyHash = hashKeyForLookup(licenseKey);
    let licenseSnap = await db.collection("licenses").where("keyHash", "==", keyHash).get();
    if (licenseSnap.empty)
      licenseSnap = await db.collection("licenses").where("key", "==", licenseKey).get();
    if (licenseSnap.empty)
      return res.status(200).send({ found: false, message: "Invalid license key" });

    const licenseDoc = licenseSnap.docs[0];
    const licenseData = licenseDoc.data();

    // Look up the user
    const userSnap = await db
      .collection("licenses").doc(licenseDoc.id)
      .collection("users")
      .where("username", "==", username)
      .get();

    if (userSnap.empty)
      return res.status(200).send({ found: false, message: "Username not found" });

    const userData = userSnap.docs[0].data();
    const userId = userSnap.docs[0].id;

    // Get mobile: from user record (admin) or from license (super_admin)
    let mobile = userData.mobile || licenseData.mobile || null;

    if (!mobile)
      return res.status(200).send({ found: true, hasMobile: false, userId, licenseDocId: licenseDoc.id, role: userData.role });

    // Mask all but last 4 digits
    const masked = "•".repeat(mobile.length - 4) + mobile.slice(-4);

    res.status(200).send({
      found: true,
      hasMobile: true,
      maskedMobile: masked,
      rawMobile: mobile,       // needed by frontend to build E.164 phone number for OTP
      userId,
      licenseDocId: licenseDoc.id,
      role: userData.role
    });
  } catch (err) {
    console.error("get-user-mobile error:", err);
    res.status(500).send({ error: "Server error" });
  }
});

// 2️⃣ Request mobile number change
app.post("/request-mobile-change", async (req, res) => {
  try {
    const { licenseDocId, userId, userName, role, newMobile, shopName } = req.body;
    if (!licenseDocId || !userId || !newMobile)
      return res.status(400).send({ error: "Required fields missing" });

    const docRef = await (role === "admin"
      ? db.collection("licenses").doc(licenseDocId).collection("pendingRequests").add({
          type: "mobile_change",
          requestedBy: userId,
          requestedByName: userName || "Admin",
          newMobile,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        })
      : db.collection("globalPendingRequests").add({
          type: "mobile_change",
          licenseDocId,
          shopName: shopName || "Unknown Shop",
          requestedBy: userId,
          requestedByName: userName || "Super Admin",
          newMobile,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        })
    );

    res.status(200).send({ success: true, requestId: docRef.id });
  } catch (err) {
    console.error("request-mobile-change error:", err);
    res.status(500).send({ error: "Failed to submit request" });
  }
});

// 3️⃣ Get pending requests for a license (Super Admin views Admin requests)
app.get("/pending-requests", async (req, res) => {
  try {
    const { licenseDocId } = req.query;
    if (!licenseDocId) return res.status(400).send({ error: "licenseDocId required" });

    const snap = await db.collection("licenses").doc(licenseDocId)
      .collection("pendingRequests")
      .orderBy("createdAt", "desc")
      .get();

    let requests = [];
    snap.forEach(doc => requests.push({ id: doc.id, ...doc.data() }));
    res.status(200).send(requests);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch requests" });
  }
});

// 4️⃣ Approve / Reject an Admin's mobile change request (Super Admin)
app.post("/approve-request", async (req, res) => {
  try {
    const { licenseDocId, requestId, action, targetUserId } = req.body;
    // action = "approved" | "rejected"
    if (!licenseDocId || !requestId || !action)
      return res.status(400).send({ error: "Required fields missing" });

    const reqRef = db.collection("licenses").doc(licenseDocId)
      .collection("pendingRequests").doc(requestId);

    const reqDoc = await reqRef.get();
    if (!reqDoc.exists) return res.status(404).send({ error: "Request not found" });

    const reqData = reqDoc.data();

    if (action === "approved") {
      // Update the user's mobile number
      await db.collection("licenses").doc(licenseDocId)
        .collection("users").doc(reqData.requestedBy)
        .update({ mobile: reqData.newMobile });
    }

    await reqRef.update({ status: action, resolvedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).send({ success: true });
  } catch (err) {
    console.error("approve-request error:", err);
    res.status(500).send({ error: "Failed to process request" });
  }
});

// 5️⃣ Get global pending requests (You — global admin — view Super Admin requests)
app.get("/global-pending-requests", async (req, res) => {
  try {
    const snap = await db.collection("globalPendingRequests")
      .orderBy("createdAt", "desc")
      .get();
    let requests = [];
    snap.forEach(doc => requests.push({ id: doc.id, ...doc.data() }));
    res.status(200).send(requests);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch global requests" });
  }
});

// 6️⃣ Approve / Reject a Super Admin's mobile change request (Global Admin = You)
app.post("/approve-global-request", async (req, res) => {
  try {
    const { requestId, action } = req.body;
    if (!requestId || !action) return res.status(400).send({ error: "Required fields missing" });

    const reqRef = db.collection("globalPendingRequests").doc(requestId);
    const reqDoc = await reqRef.get();
    if (!reqDoc.exists) return res.status(404).send({ error: "Request not found" });

    const reqData = reqDoc.data();

    if (action === "approved") {
      // Update the Super Admin's mobile in their license's users sub-collection
      await db.collection("licenses").doc(reqData.licenseDocId)
        .collection("users").doc(reqData.requestedBy)
        .update({ mobile: reqData.newMobile });
      // Also update the license document's mobile
      await db.collection("licenses").doc(reqData.licenseDocId)
        .update({ mobile: reqData.newMobile });
    }

    await reqRef.update({ status: action, resolvedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).send({ success: true });
  } catch (err) {
    console.error("approve-global-request error:", err);
    res.status(500).send({ error: "Failed to process request" });
  }
});

// 7️⃣  SEND OTP — backend generates OTP, sends via Fast2SMS, stores hash
app.post("/send-otp", async (req, res) => {
  try {
    const { licenseDocId, userId, mobile } = req.body;
    if (!mobile || !licenseDocId || !userId)
      return res.status(400).send({ error: "mobile, licenseDocId and userId are required" });

    const phone = mobile.replace(/\D/g, "").slice(-10);
    if (phone.length !== 10)
      return res.status(400).send({ error: "Invalid mobile number" });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`🔑 Generated OTP for ${phone}: ${otp}`);

    const otpHash = await bcrypt.hash(otp, SALT_ROUNDS);
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store OTP session in Firestore
    console.log("💾 Saving OTP session to Firestore...");
    const sessionRef = await db.collection("otpSessions").add({
      licenseDocId, userId, phone,
      otpHash, expiresAt,
      verified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log("✅ OTP session saved:", sessionRef.id);

    // Check API key
    const apiKey = process.env.FAST2SMS_API_KEY;
    console.log("🔑 FAST2SMS_API_KEY present:", !!apiKey);
    if (!apiKey) {
      console.log(`\n📱 DEV MODE OTP for ${phone}: ${otp}\n`);
      return res.status(200).send({ success: true, sessionId: sessionRef.id, dev: true });
    }

    // Send SMS via Fast2SMS Quick route
    console.log("📤 Calling Fast2SMS API...");
    const smsRes = await axios.get("https://www.fast2sms.com/dev/bulkV2", {
      params: {
        authorization: apiKey,
        route: "q",
        message: `Your OTP for Swarna Raseid is ${otp}. Valid for 10 minutes. Do not share.`,
        flash: 0,
        numbers: phone
      },
      headers: { "cache-control": "no-cache" }
    });

    console.log("📨 Fast2SMS response:", JSON.stringify(smsRes.data));

    if (!smsRes.data?.return) {
      const errMsg = Array.isArray(smsRes.data?.message)
        ? smsRes.data.message.join(", ")
        : (smsRes.data?.message || "SMS delivery failed");
      console.error("❌ Fast2SMS rejected:", errMsg);
      return res.status(500).send({ error: `SMS failed: ${errMsg}` });
    }

    res.status(200).send({ success: true, sessionId: sessionRef.id });

  } catch (err) {
    // Show the full Fast2SMS error response if it's an axios error
    if (err.response) {
      console.error("❌ Fast2SMS HTTP error:", err.response.status, JSON.stringify(err.response.data));
      return res.status(500).send({ error: `SMS API error: ${JSON.stringify(err.response.data)}` });
    }
    console.error("❌ send-otp error:", err.message);
    res.status(500).send({ error: err.message || "Failed to send OTP" });
  }
});


// 8️⃣  VERIFY OTP — check entered OTP against stored hash
app.post("/verify-otp", async (req, res) => {
  try {
    const { sessionId, enteredOtp } = req.body;
    if (!sessionId || !enteredOtp)
      return res.status(400).send({ error: "sessionId and enteredOtp are required" });

    const sessionRef = db.collection("otpSessions").doc(sessionId);
    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) return res.status(404).send({ error: "OTP session not found" });

    const session = sessionDoc.data();
    if (session.verified)  return res.status(400).send({ error: "OTP already used" });
    if (Date.now() > session.expiresAt) return res.status(400).send({ error: "OTP expired" });

    const valid = await bcrypt.compare(enteredOtp, session.otpHash);
    if (!valid) return res.status(401).send({ error: "Invalid OTP" });

    // Mark session as verified
    await sessionRef.update({ verified: true });
    res.status(200).send({ success: true, licenseDocId: session.licenseDocId, userId: session.userId });
  } catch (err) {
    console.error("verify-otp error:", err);
    res.status(500).send({ error: "Failed to verify OTP" });
  }
});

// 9️⃣  RESET PASSWORD — after OTP verified via sessionId
app.post("/reset-password", async (req, res) => {
  try {
    const { sessionId, licenseDocId, userId, newUsername, newPassword } = req.body;
    if (!sessionId || !licenseDocId || !userId || !newPassword)
      return res.status(400).send({ error: "Required fields missing" });

    // Re-check session is verified
    const sessionDoc = await db.collection("otpSessions").doc(sessionId).get();
    if (!sessionDoc.exists || !sessionDoc.data().verified)
      return res.status(401).send({ error: "OTP not verified. Please complete OTP verification first." });

    // Confirm session belongs to this user
    const session = sessionDoc.data();
    if (session.userId !== userId || session.licenseDocId !== licenseDocId)
      return res.status(403).send({ error: "Session mismatch" });

    const userRef = db.collection("licenses").doc(licenseDocId).collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).send({ error: "User not found" });

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const updateData = { password: hashedPassword };

    if (newUsername && newUsername !== userDoc.data().username) {
      const taken = await db.collection("licenses").doc(licenseDocId)
        .collection("users").where("username", "==", newUsername).get();
      if (!taken.empty && taken.docs[0].id !== userId)
        return res.status(400).send({ error: "Username already taken" });
      updateData.username = newUsername;
    }

    await userRef.update(updateData);
    // Clean up OTP session
    await db.collection("otpSessions").doc(sessionId).delete();
    res.status(200).send({ success: true, message: "Credentials updated successfully" });
  } catch (err) {
    console.error("reset-password error:", err);
    res.status(500).send({ error: "Failed to reset password" });
  }
});

app.listen(PORT, () => { console.log(`🚀 Server running on http://localhost:${PORT}`); });
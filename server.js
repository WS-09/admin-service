require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { admin, db } = require("./firebase");
const { sendUserCredentials } = require("./email");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

app.get("/gas-warm", async (req, res) => {
  try {
    await fetch(`${process.env.GAS_URL}?warm=1`);
    console.log("🔥 GAS warmed");
    res.send("GAS warmed");
  } catch (err) {
    console.error("❌ GAS warm failed:", err.message);
    res.status(500).send("Failed");
  }
});

// Helper: Handle errors cleanly
function handleError(error) {
  // 🔐 Firebase Auth errors
  if (error.code === "auth/email-already-exists") {
    return {
      case: "email_used",
      error: "Email already used by another account",
    };
  }

  if (error.code === "auth/invalid-email") {
    return { case: "invalid_email", error: "Invalid email format" };
  }

  if (error.code === "auth/weak-password") {
    return {
      case: "weak_password",
      error:
        "Password must be at least 8 characters with uppercase, lowercase, and numbers",
    };
  }

  // 🧾 Custom validation errors
  if (error.message?.includes("Missing required fields")) {
    return { case: "missing_fields", error: error.message };
  }

  if (error.message?.includes("Invalid role")) {
    return { case: "invalid_role", error: error.message };
  }

  if (error.message?.includes("primary_school")) {
    return { case: "missing_primary_school", error: error.message };
  }

  if (error.message?.includes("Only admin")) {
    return { case: "not_authorized", error: error.message };
  }

  if (error.message?.includes("No token")) {
    return { case: "no_token", error: error.message };
  }

  // ❌ Default fallback
  return {
    case: "unknown_error",
    error: error.message || "Something went wrong",
  };
}

app.post("/create-user", async (req, res) => {
  const { email, password, full_name, role, primary_school } = req.body;

  try {
    // 🔐 1. Verify token
    const token = req.headers.authorization?.split("Bearer ")[1];

    if (!token) {
      throw new Error("No token provided");
    }

    const decoded = await admin.auth().verifyIdToken(token);

    // 🔐 2. Check admin role from Firestore
    const userDoc = await db.collection("users").doc(decoded.uid).get();

    if (!userDoc.exists || userDoc.data().role !== "Admin") {
      throw new Error("Only admin can create users");
    }

    // ✅ 3. Validate input
    if (!email || !password || !full_name || !role) {
      throw new Error("Missing required fields");
    }

    const allowedRoles = ["Admin", "Teacher", "Therapist"];
    if (!allowedRoles.includes(role)) {
      throw new Error("Invalid role");
    }

    // ✅ 4. Conditional validation
    if ((role === "Teacher" || role === "Therapist") && !primary_school) {
      throw new Error("primary_school is required for Teacher or Therapist");
    }

    // 🔥 5. Create Firebase Auth user
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: true,
    });

    const uid = userRecord.uid;
    const now = admin.firestore.FieldValue.serverTimestamp();

    // 🧠 6. Build user data dynamically
    const userData = {
      uid,
      full_name,
      email,
      role,
      status: "active",
      new_reports: false,
      new_meetings: false,
      created_at: now,
      updated_at: now,
    };

    // 👉 Add primary_school if needed
    if (role === "Teacher" || role === "Therapist") {
      userData.primary_school = primary_school;
      userData.profile_image = "https://iili.io/30oSNn9.png";
    }

    // 🔥 7. Save to Firestore
    await db.collection("users").doc(uid).set(userData);

    // 🔥 Generate reset link + send email in background
    (async () => {
      try {
        const resetLink = await admin.auth().generatePasswordResetLink(email);
        await sendUserCredentials(email, resetLink);
      } catch (err) {
        console.error("❌ failed:", err.message);
      }
    })();

    // ✅ Send response immediately
    res.status(201).json({
      message: "User created successfully",
      uid,
    });
  } catch (error) {
    const err = handleError(error);

    res.status(400).json(err);
  }
});


app.post("/disable-user", async (req, res) => {
  const { uid } = req.body;

  try {
    // 🔐 Verify token
    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) throw new Error("No token provided");

    const decoded = await admin.auth().verifyIdToken(token);

    // 🔐 Check admin
    const adminDoc = await db.collection("users").doc(decoded.uid).get();
    if (!adminDoc.exists || adminDoc.data().role !== "Admin") {
      throw new Error("Only admin can disable users");
    }

    if (!uid) throw new Error("Missing uid");

    // 🚫 Disable user in Auth
    await admin.auth().updateUser(uid, {
      disabled: true,
    });

    // 🔄 Update Firestore
    await db.collection("users").doc(uid).update({
      status: "disabled", // or "banned"
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      message: "User disabled successfully",
    });
  } catch (error) {
    const err = handleError(error);
    res.status(400).json(err);
  }
});


app.post("/enable-user", async (req, res) => {
  const { uid } = req.body;

  try {
    // 🔐 Verify token
    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) throw new Error("No token provided");

    const decoded = await admin.auth().verifyIdToken(token);

    // 🔐 Check admin
    const adminDoc = await db.collection("users").doc(decoded.uid).get();
    if (!adminDoc.exists || adminDoc.data().role !== "Admin") {
      throw new Error("Only admin can enable users");
    }

    if (!uid) throw new Error("Missing uid");

    // ✅ Enable user in Auth
    await admin.auth().updateUser(uid, {
      disabled: false,
    });

    // 🔄 Update Firestore
    await db.collection("users").doc(uid).update({
      status: "active",
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      message: "User enabled successfully",
    });
  } catch (error) {
    const err = handleError(error);
    res.status(400).json(err);
  }
});


app.post("/send-notification", async (req, res) => {
  try {
    const { title, body, payload } = req.body;

    // 🔐 Verify Firebase token
    const token = req.headers.authorization?.split("Bearer ")[1];

    if (!token) {
      throw new Error("No token provided");
    }

    const decoded = await admin.auth().verifyIdToken(token);

    // 🔐 Check admin role
    const adminDoc = await db.collection("users").doc(decoded.uid).get();

    if (!adminDoc.exists || adminDoc.data().role !== "Admin") {
      throw new Error("Only admins can send notifications");
    }

    // Data-only FCM message
    const message = {
      topic: "all",
      data: {
        title: title || "",
        body: body || "",
        payload: payload || "",
      },
    };

    // Send notification
    const response = await admin.messaging().send(message);

    console.log("✅ Notification sent:", response);

    res.json({
      success: true,
      messageId: response,
    });

  } catch (error) {
    console.error("❌ Notification error:", error.message);

    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});



const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} 🚀`);
});

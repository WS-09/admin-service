require("dotenv").config();

const https = require("https");
https.globalAgent.keepAlive = true;

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const timeout = require("connect-timeout");

const { admin, db } = require("./firebase");
const { sendUserCredentials } = require("./email");

const app = express();

/**
 * Middlewares
 */
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "100kb" }));
app.use(timeout("20s"));

/**
 * Warm Firebase Admin SDK
 */
admin
  .auth()
  .listUsers(1)
  .then(() => console.log("🔥 Firebase warmed"))
  .catch(console.error);

/**
 * Health check
 */
app.get("/health", (_, res) => {
  res.status(200).send("ok");
});

/**
 * Root
 */
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

/**
 * Warm GAS manually
 */
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

/**
 * Error handler helper
 */
function handleError(error) {
  // Firebase Auth
  if (error.code === "auth/email-already-exists") {
    return {
      case: "email_used",
      error: "Email already used by another account",
    };
  }

  if (error.code === "auth/invalid-email") {
    return {
      case: "invalid_email",
      error: "Invalid email format",
    };
  }

  if (error.code === "auth/id-token-expired") {
    return {
      case: "token_expired",
      error: "Session expired. Please login again.",
    };
  }

  // Validation
  if (error.message?.includes("Missing required fields")) {
    return {
      case: "missing_fields",
      error: error.message,
    };
  }

  if (error.message?.includes("Invalid role")) {
    return {
      case: "invalid_role",
      error: error.message,
    };
  }

  if (error.message?.includes("primary_school")) {
    return {
      case: "missing_primary_school",
      error: error.message,
    };
  }

  if (error.message?.includes("Only admin")) {
    return {
      case: "not_authorized",
      error: error.message,
    };
  }

  if (error.message?.includes("No token")) {
    return {
      case: "no_token",
      error: error.message,
    };
  }

  return {
    case: "unknown_error",
    error: error.message || "Something went wrong",
  };
}

/**
 * Verify admin middleware
 */
async function verifyAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];

    if (!token) {
      return res.status(401).json({
        case: "no_token",
        error: "No token provided",
      });
    }

    const decoded = await admin.auth().verifyIdToken(token);

    const userDoc = await db
      .collection("users")
      .doc(decoded.uid)
      .get();

    if (!userDoc.exists || userDoc.data().role !== "Admin") {
      return res.status(403).json({
        case: "not_authorized",
        error: "Only admin allowed",
      });
    }

    req.user = decoded;

    next();
  } catch (error) {
    const err = handleError(error);

    return res.status(401).json(err);
  }
}

/**
 * Create user
 */
app.post("/create-user", verifyAdmin, async (req, res) => {
  const {
    email,
    password,
    full_name,
    role,
    primary_school,
  } = req.body;

  try {
    // Validation
    if (!email || !password || !full_name || !role) {
      throw new Error("Missing required fields");
    }

    const allowedRoles = [
      "Admin",
      "Teacher",
      "Therapist",
    ];

    if (!allowedRoles.includes(role)) {
      throw new Error("Invalid role");
    }

    if (
      (role === "Teacher" || role === "Therapist") &&
      !primary_school
    ) {
      throw new Error(
        "primary_school is required for Teacher or Therapist"
      );
    }

    /**
     * Create auth user
     */
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: true,
    });

    const uid = userRecord.uid;

    const now =
      admin.firestore.FieldValue.serverTimestamp();

    /**
     * User data
     */
    const userData = {
      uid,
      full_name,
      email,
      role,
      status: "active",
      created_at: now,
      updated_at: now,
    };

    if (
      role === "Teacher" ||
      role === "Therapist"
    ) {
      userData.primary_school = primary_school;
      userData.new_meetings = false,

      userData.profile_image =
        "https://iili.io/30oSNn9.png";

      userData.checked_by_admin = true;
    }

    /**
     * Save Firestore
     */
    await db
      .collection("users")
      .doc(uid)
      .set(userData);

    /**
     * 🚀 Respond immediately
     */
    res.status(201).json({
      success: true,
      message: "User created successfully",
      uid,
    });

    /**
     * Background email sending
     */
    (async () => {
      try {
        const resetLink =
          await admin
            .auth()
            .generatePasswordResetLink(email);

        await sendUserCredentials(
          email,
          resetLink
        );

        console.log(
          "📧 Credentials email sent:",
          email
        );
      } catch (err) {
        console.error(
          "❌ Email send failed:",
          err.message
        );
      }
    })();

  } catch (error) {
    const err = handleError(error);

    res.status(400).json(err);
  }
});

/**
 * Disable user
 */
app.post(
  "/disable-user",
  verifyAdmin,
  async (req, res) => {
    try {
      const { uid } = req.body;

      if (!uid) {
        throw new Error("Missing uid");
      }

      await admin.auth().updateUser(uid, {
        disabled: true,
      });

      await db
        .collection("users")
        .doc(uid)
        .update({
          status: "disabled",
          updated_at:
            admin.firestore.FieldValue.serverTimestamp(),
        });

      res.json({
        success: true,
        message: "User disabled successfully",
      });

    } catch (error) {
      const err = handleError(error);

      res.status(400).json(err);
    }
  }
);

/**
 * Enable user
 */
app.post(
  "/enable-user",
  verifyAdmin,
  async (req, res) => {
    try {
      const { uid } = req.body;

      if (!uid) {
        throw new Error("Missing uid");
      }

      await admin.auth().updateUser(uid, {
        disabled: false,
      });

      await db
        .collection("users")
        .doc(uid)
        .update({
          status: "active",
          updated_at:
            admin.firestore.FieldValue.serverTimestamp(),
        });

      res.json({
        success: true,
        message: "User enabled successfully",
      });

    } catch (error) {
      const err = handleError(error);

      res.status(400).json(err);
    }
  }
);

/**
 * Send notification
 */
app.post(
  "/send-notification",
  verifyAdmin,
  async (req, res) => {
    try {
      const {
        title,
        body,
        payload,
      } = req.body;

      /**
       * Respond immediately
       */
      res.json({
        success: true,
        message: "Notification queued",
      });

      /**
       * Background FCM send
       */
      const message = {
        topic: "all",

        data: {
          title: title || "",
          body: body || "",
          payload: payload || "",
        },
      };

      admin
        .messaging()
        .send(message)
        .then((response) => {
          console.log(
            "✅ Notification sent:",
            response
          );
        })
        .catch((err) => {
          console.error(
            "❌ Notification failed:",
            err.message
          );
        });

    } catch (error) {
      const err = handleError(error);

      res.status(400).json(err);
    }
  }
);

/**
 * Start server
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `🚀 Server running on port ${PORT}`
  );
});
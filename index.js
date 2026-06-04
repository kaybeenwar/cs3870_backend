import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ?? 8081;
const HOST = process.env.HOST ?? "0.0.0.0";

const MONGO_URI = process.env.MONGO_URI;
const DBNAME = process.env.DBNAME;
const COLLECTION = process.env.COLLECTION;
const USERS_COLLECTION = process.env.USERS_COLLECTION ?? "users";
const DELETION_REQUESTS_COLLECTION =
    process.env.DELETION_REQUESTS_COLLECTION ?? "deletion_requests";
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "12h";

const client = new MongoClient(MONGO_URI);
const db = client.db(DBNAME);

// Keep a single shared connection rather than opening/closing per request.
// connect() is idempotent on MongoClient v6+, but we still gate it.
let mongoReady = false;
async function ensureMongo() {
    if (!mongoReady) {
        await client.connect();
        mongoReady = true;
        console.log("Mongo connected");
    }
}

const usersCol = () => db.collection(USERS_COLLECTION);
const contactsCol = () => db.collection(COLLECTION);
const deletionsCol = () => db.collection(DELETION_REQUESTS_COLLECTION);

function signToken(user) {
    return jwt.sign(
        { sub: user._id.toString(), username: user.username, is_admin: !!user.is_admin },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function publicUser(user) {
    return {
        id: user._id.toString(),
        username: user.username,
        is_admin: !!user.is_admin,
        created_at: user.created_at,
    };
}

async function requireAuth(req, res, next) {
    try {
        const header = req.headers.authorization ?? "";
        const [scheme, token] = header.split(" ");
        if (scheme !== "Bearer" || !token) {
            return res.status(401).json({ message: "Missing bearer token." });
        }
        const payload = jwt.verify(token, JWT_SECRET);
        await ensureMongo();
        const user = await usersCol().findOne({ _id: new ObjectId(payload.sub) });
        if (!user) {
            return res.status(401).json({ message: "User no longer exists." });
        }
        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid or expired token." });
    }
}

function requireAdmin(req, res, next) {
    if (!req.user?.is_admin) {
        return res.status(403).json({ message: "Admin privileges required." });
    }
    next();
}

app.get("/hello", (req, res) => {
    res.send("Hello World from Express.js!");
});

// ---------- Auth ----------

app.post("/auth/register", async (req, res) => {
    try {
        const { username, password } = req.body ?? {};
        if (typeof username !== "string" || typeof password !== "string") {
            return res.status(400).json({ message: "username and password are required." });
        }
        const normalizedUsername = username.trim().toLowerCase();
        if (normalizedUsername.length < 3) {
            return res.status(400).json({ message: "Username must be at least 3 characters." });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: "Password must be at least 8 characters." });
        }

        await ensureMongo();
        await usersCol().createIndex({ username: 1 }, { unique: true });

        const existing = await usersCol().findOne({ username: normalizedUsername });
        if (existing) {
            return res.status(409).json({ message: "Username already taken." });
        }

        // First registered user becomes admin.
        const userCount = await usersCol().countDocuments();
        const passwordHash = await bcrypt.hash(password, 12);
        const newUser = {
            username: normalizedUsername,
            password_hash: passwordHash,
            is_admin: userCount === 0,
            created_at: new Date(),
        };
        const result = await usersCol().insertOne(newUser);
        newUser._id = result.insertedId;

        const token = signToken(newUser);
        return res.status(201).json({ token, user: publicUser(newUser) });
    } catch (err) {
        console.error("Error in POST /auth/register:", err);
        return res.status(500).json({ message: "Registration failed: " + err.message });
    }
});

app.post("/auth/login", async (req, res) => {
    try {
        const { username, password } = req.body ?? {};
        if (typeof username !== "string" || typeof password !== "string") {
            return res.status(400).json({ message: "username and password are required." });
        }
        await ensureMongo();
        const user = await usersCol().findOne({ username: username.trim().toLowerCase() });
        if (!user) {
            return res.status(401).json({ message: "Invalid credentials." });
        }
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
            return res.status(401).json({ message: "Invalid credentials." });
        }
        const token = signToken(user);
        return res.status(200).json({ token, user: publicUser(user) });
    } catch (err) {
        console.error("Error in POST /auth/login:", err);
        return res.status(500).json({ message: "Login failed: " + err.message });
    }
});

app.get("/auth/me", requireAuth, async (req, res) => {
    return res.status(200).json({ user: publicUser(req.user) });
});

// ---------- Contacts ----------

// Admin sees all contacts; regular users see only their own.
app.get("/contacts", requireAuth, async (req, res) => {
    try {
        await ensureMongo();
        const query = req.user.is_admin ? {} : { owner_username: req.user.username };
        const results = await contactsCol().find(query).limit(500).toArray();
        return res.status(200).json(results);
    } catch (err) {
        console.error("Error in GET /contacts:", err);
        return res.status(500).json({ message: "Failed to load contacts: " + err.message });
    }
});

app.post("/contacts", requireAuth, async (req, res) => {
    try {
        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({ message: "Bad request: No data provided." });
        }
        const { contact_name, phone_number, message, image_url } = req.body;
        if (typeof contact_name !== "string" || !contact_name.trim()) {
            return res.status(400).json({ message: "contact_name is required." });
        }

        await ensureMongo();
        // Uniqueness is per-owner — two users can each have a "Mom".
        const existing = await contactsCol().findOne({
            contact_name,
            owner_username: req.user.username,
        });
        if (existing) {
            return res.status(409).json({
                message: `You already have a contact named '${contact_name}'.`,
            });
        }

        const newDocument = {
            contact_name,
            phone_number,
            message,
            image_url,
            owner_username: req.user.username,
            created_at: new Date(),
        };
        await contactsCol().insertOne(newDocument);
        return res.status(201).json({ message: "New contact added successfully" });
    } catch (err) {
        console.error("Error in POST /contacts:", err);
        return res.status(500).json({ message: "Failed to add contact: " + err.message });
    }
});

app.put("/contacts/:name", requireAuth, async (req, res) => {
    try {
        const currentName = req.params.name;
        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({ message: "Bad request: No data provided." });
        }
        const { contact_name, phone_number, message, image_url } = req.body;

        await ensureMongo();
        const ownerFilter = req.user.is_admin ? {} : { owner_username: req.user.username };
        const existing = await contactsCol().findOne({
            contact_name: currentName,
            ...ownerFilter,
        });
        if (!existing) {
            return res.status(404).json({
                message: `Contact '${currentName}' not found.`,
            });
        }

        if (contact_name && contact_name !== currentName) {
            const conflict = await contactsCol().findOne({
                contact_name,
                owner_username: existing.owner_username,
            });
            if (conflict) {
                return res.status(409).json({
                    message: `Contact '${contact_name}' already exists.`,
                });
            }
        }

        const updateDoc = {};
        if (contact_name !== undefined) updateDoc.contact_name = contact_name;
        if (phone_number !== undefined) updateDoc.phone_number = phone_number;
        if (message !== undefined) updateDoc.message = message;
        if (image_url !== undefined) updateDoc.image_url = image_url;

        const result = await contactsCol().updateOne(
            { _id: existing._id },
            { $set: updateDoc }
        );

        if (result.modifiedCount === 0) {
            return res.status(200).json({ message: "No changes were made to the contact." });
        }
        return res.status(200).json({
            message: `Contact '${currentName}' was updated successfully.`,
        });
    } catch (err) {
        console.error("Error in PUT /contacts:", err);
        return res.status(500).json({ message: "Failed to update contact: " + err.message });
    }
});

// Admin: delete immediately. Non-admin: file a deletion request instead.
app.delete("/contacts/:name", requireAuth, async (req, res) => {
    try {
        const name = req.params.name;
        await ensureMongo();

        const ownerFilter = req.user.is_admin ? {} : { owner_username: req.user.username };
        const existing = await contactsCol().findOne({
            contact_name: name,
            ...ownerFilter,
        });
        if (!existing) {
            return res.status(404).json({
                message: `Contact '${name}' not found.`,
            });
        }

        if (req.user.is_admin) {
            await contactsCol().deleteOne({ _id: existing._id });
            return res
                .status(200)
                .json({ message: `Contact '${name}' was DELETED successfully.` });
        }

        // Non-admin: open (or reuse) a pending request.
        const existingRequest = await deletionsCol().findOne({
            contact_id: existing._id,
            status: "pending",
        });
        if (existingRequest) {
            return res.status(200).json({
                message: `Deletion already pending admin approval for '${name}'.`,
                request_id: existingRequest._id.toString(),
                status: "pending",
            });
        }
        const request = {
            contact_id: existing._id,
            contact_name: existing.contact_name,
            owner_username: existing.owner_username,
            requester_username: req.user.username,
            status: "pending",
            created_at: new Date(),
            resolved_at: null,
            resolved_by: null,
        };
        const result = await deletionsCol().insertOne(request);
        return res.status(202).json({
            message: `Deletion request for '${name}' submitted for admin approval.`,
            request_id: result.insertedId.toString(),
            status: "pending",
        });
    } catch (err) {
        console.error("Error in DELETE /contacts:", err);
        return res.status(500).json({ message: "Internal Server Error: " + err.message });
    }
});

// ---------- Deletion requests (admin) ----------

app.get("/deletion-requests", requireAuth, requireAdmin, async (req, res) => {
    try {
        await ensureMongo();
        const status = req.query.status ?? "pending";
        const query = status === "all" ? {} : { status };
        const results = await deletionsCol()
            .find(query)
            .sort({ created_at: -1 })
            .limit(200)
            .toArray();
        return res.status(200).json(
            results.map((r) => ({
                id: r._id.toString(),
                contact_name: r.contact_name,
                owner_username: r.owner_username,
                requester_username: r.requester_username,
                status: r.status,
                created_at: r.created_at,
                resolved_at: r.resolved_at,
                resolved_by: r.resolved_by,
            }))
        );
    } catch (err) {
        console.error("Error in GET /deletion-requests:", err);
        return res.status(500).json({ message: "Failed to load requests: " + err.message });
    }
});

app.post(
    "/deletion-requests/:id/approve",
    requireAuth,
    requireAdmin,
    async (req, res) => {
        try {
            await ensureMongo();
            let requestId;
            try {
                requestId = new ObjectId(req.params.id);
            } catch {
                return res.status(400).json({ message: "Invalid request id." });
            }
            const reqDoc = await deletionsCol().findOne({ _id: requestId });
            if (!reqDoc) {
                return res.status(404).json({ message: "Request not found." });
            }
            if (reqDoc.status !== "pending") {
                return res.status(409).json({
                    message: `Request already ${reqDoc.status}.`,
                });
            }
            await contactsCol().deleteOne({ _id: reqDoc.contact_id });
            await deletionsCol().updateOne(
                { _id: requestId },
                {
                    $set: {
                        status: "approved",
                        resolved_at: new Date(),
                        resolved_by: req.user.username,
                    },
                }
            );
            return res.status(200).json({
                message: `Deletion of '${reqDoc.contact_name}' approved and applied.`,
            });
        } catch (err) {
            console.error("Error approving deletion:", err);
            return res
                .status(500)
                .json({ message: "Failed to approve: " + err.message });
        }
    }
);

app.post(
    "/deletion-requests/:id/reject",
    requireAuth,
    requireAdmin,
    async (req, res) => {
        try {
            await ensureMongo();
            let requestId;
            try {
                requestId = new ObjectId(req.params.id);
            } catch {
                return res.status(400).json({ message: "Invalid request id." });
            }
            const reqDoc = await deletionsCol().findOne({ _id: requestId });
            if (!reqDoc) {
                return res.status(404).json({ message: "Request not found." });
            }
            if (reqDoc.status !== "pending") {
                return res.status(409).json({
                    message: `Request already ${reqDoc.status}.`,
                });
            }
            await deletionsCol().updateOne(
                { _id: requestId },
                {
                    $set: {
                        status: "rejected",
                        resolved_at: new Date(),
                        resolved_by: req.user.username,
                    },
                }
            );
            return res.status(200).json({
                message: `Deletion request for '${reqDoc.contact_name}' rejected.`,
            });
        } catch (err) {
            console.error("Error rejecting deletion:", err);
            return res
                .status(500)
                .json({ message: "Failed to reject: " + err.message });
        }
    }
);

// Lets the frontend tell a fresh user "no one has signed up yet — you'll be admin".
app.get("/auth/bootstrap-status", async (req, res) => {
    try {
        await ensureMongo();
        const count = await usersCol().countDocuments();
        return res.status(200).json({ has_users: count > 0 });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});

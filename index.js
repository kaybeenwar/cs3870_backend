import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import { sendAppointmentConfirmation } from "./emailService.js";
import dotenv from "dotenv";

dotenv.config();

// Server configuration
const PORT = process.env.PORT ?? 8081;
const HOST = process.env.HOST ?? "0.0.0.0";

// MongoDB configuration
const MONGO_URI = process.env.MONGO_URI;
const DBNAME = process.env.DBNAME;
const COLLECTION = process.env.COLLECTION;

const client = new MongoClient(MONGO_URI);
const db = client.db(DBNAME);
// Create Express app
const app = express();
// Middleware
app.use(cors());
app.use(express.json()); // replaces body-parser

// ============ APPOINTMENTS ENDPOINTS ============

// POST: Create new appointment
app.post("/appointments", async (req, res) => {
  try {
    // Validate request body
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ message: "Bad request: No data provided." });
    }

    // Extract appointment fields from body
    const { name, email, phone, date, service } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !date || !service) {
      return res.status(400).json({ 
        message: "Bad request: All fields (name, email, phone, date, service) are required." 
      });
    }

    // Connect to MongoDB
    await client.connect();
    console.log("Node connected successfully to POST appointment to MongoDB");

    // Reference appointments collection
    const appointmentsCol = db.collection(appointmentsCollection);

    // Create new appointment document
    const newAppointment = {
      name,
      email,
      phone,
      date,
      service,
      status: "pending",
      createdAt: new Date(),
    };
    
    console.log("New appointment:", newAppointment);

    // Insert appointment into MongoDB
    const result = await appointmentsCol.insertOne(newAppointment);
    console.log("Appointment inserted:", result);

    // Send confirmation email
    const emailResult = await sendAppointmentConfirmation({
      name,
      email,
      phone,
      date,
      service
    });

    if (emailResult.success) {
      console.log("Confirmation email sent to:", email);
    } else {
      console.error("Failed to send confirmation email:", emailResult.error);
      // Note: We still return success even if email fails
    }

    // Send success response
    res.status(201).json({ 
      message: "Appointment booked successfully",
      appointmentId: result.insertedId,
      emailSent: emailResult.success
    });

  } catch (error) {
    console.error("Error in POST /appointments:", error);
    res.status(500).json({ 
      message: "Failed to book appointment: " + error.message 
    });
  } finally {
    await client.close();
  }
});

// GET: Retrieve all appointments
app.get("/appointments", async (req, res) => {
  try {
    await client.connect();
    console.log("Node connected successfully to GET appointments from MongoDB");
    
    const results = await db
      .collection(appointmentsCollection)
      .find({})
      .limit(100)
      .toArray();
    
    console.log(`Found ${results.length} appointments`);
    res.status(200).json(results);
    
  } catch (error) {
    console.error("Error in GET /appointments:", error);
    res.status(500).json({ 
      message: "Failed to retrieve appointments: " + error.message 
    });
  } finally {
    await client.close();
  }
});


// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

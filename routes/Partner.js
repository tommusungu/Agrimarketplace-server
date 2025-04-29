const express = require("express");
const { authenticate } = require("../utils/Auth");
const { uploadMultipleFiles } = require("../utils/FileUpload");
const Vehicle = require("../models/Vehicle");
const mpesaService = require("../utils/mpesa");
const Payment = require("../models/Payment");
const Product = require("../models/Product");
const router = express.Router();


// Partner middleware
const isPartner = (req, res, next) => {
  if (req.user.payload.userType !== "partner") {
    return res.status(403).json({ message: "Access denied. Partner only." });
  }
  next();
};

// Apply both JWT auth and partner check to all routes
router.use(authenticate, isPartner);

// Get all vehicles belonging to partner
router.get("/get-my-vehicles", async (req, res) => {
  try {
    const vehicles = await Product.find({ owner: req.user.payload._id }).sort({
      dateAdded: -1,
    });
    res.json(vehicles);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get one specific vehicle belonging to partner
router.get("/get-one-vehicle/:id", async (req, res) => {
  try {
    const vehicle = await Product.findOne({
      _id: req.params.id,
      owner: req.user.payload._id,
    });

    if (!vehicle) {
      return res
        .status(404)
        .json({ message: "Vehicle not found or unauthorized" });
    }

    res.json(vehicle);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add new vehicle with images
router.post("/add-vehicle", uploadMultipleFiles(), async (req, res) => {
  try {
    const vehicleData = {
      ...req.body,
      owner: req.user.payload._id,
      picturesArray: req.body.fileURLs,
      available: false, // Initially false until assessed
    };

    const vehicle = new Product(vehicleData);
    await vehicle.save();

    res.status(201).json(vehicle);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Edit vehicle details
router.put("/edit-vehicle/:id", uploadMultipleFiles(), async (req, res) => {
  try {
    const vehicle = await Product.findOne({
      _id: req.params.id,
      owner: req.user.payload._id,
    });

    if (!vehicle) {
      return res
        .status(404)
        .json({ message: "Vehicle not found or unauthorized" });
    }

    // If new images are uploaded, add them to existing pictures
    if (req.body.fileURLs && req.body.fileURLs.length > 0) {
      req.body.picturesArray = [...vehicle.picturesArray, ...req.body.fileURLs];
    }

    const updatedVehicle = await Product.findByIdAndUpdate(
      req.params.id,
      { ...req.body },
      { new: true }
    );

    res.json(updatedVehicle);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Change vehicle availability status
router.patch("/change-availability/:id", async (req, res) => {
  try {
    const vehicle = await Product.findOne({
      _id: req.params.id,
      owner: req.user.payload._id,
    });

    if (!vehicle) {
      return res
        .status(404)
        .json({ message: "Vehicle not found or unauthorized" });
    }

    // Only allow changing availability if vehicle has been assessed
    if (!vehicle.assessed) {
      return res.status(400).json({
        message: "Vehicle must be assessed before changing availability",
      });
    }

    vehicle.available = !vehicle.available;
    await vehicle.save();

    res.json({
      message: `Vehicle availability changed to ${vehicle.available}`,
      vehicle,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Pay for vehicle assessment
router.post("/pay-assessment/:vehicleId", async (req, res) => {
  try {
    const vehicle = await Product.findOne({
      _id: req.params.vehicleId,
      // owner: req.user.payload._id,
    });

    if (!vehicle) {
      return res
        .status(404)
        .json({ message: "Vehicle not found or unauthorized" });
    }

    if (vehicle.assessed) {
      return res
        .status(400)
        .json({ message: "Vehicle has already been assessed" });
    }

    // Create payment record
    const payment = new Payment({
      vehicle: vehicle._id, // Link payment to vehicle instead of application
      amount: process.env.ASSESSMENT_FEE || 1000,
      paymentType: "assessment",
      phoneNumber: req.user.payload.phoneNumber,
      description: `Assessment fee for ${vehicle.make} ${vehicle.model} (${vehicle.plateNo})`,
      reference: `ASSESS-${vehicle._id}`,
    });

    // Initiate STK Push
    const stkPushResponse = await mpesaService.initiateSTKPush({
      phone: req.user.payload.phoneNumber,
      amount: payment.amount,
      reference: payment.reference,
      description: payment.description,
    });

    if (!stkPushResponse.success) {
      return res.status(400).json({
        message: "Payment initiation failed",
        error: stkPushResponse.error,
      });
    }

    // Update payment with STK push details
    payment.CheckoutRequestID = stkPushResponse.data.CheckoutRequestID;
    payment.stkRequest = stkPushResponse.data;
    await payment.save();

    res.json({
      message: "Assessment payment initiated",
      checkoutRequestID: stkPushResponse.data.CheckoutRequestID,
      vehicleId: vehicle._id,
    });
  } catch (error) {
    console.error("Assessment payment error:", error);
    res.status(500).json({ message: error.message });
  }
});

// M-PESA callback for assessment payment
router.post("/assessment-callback", async (req, res) => {
  try {
    const {
      Body: {
        stkCallback: { CheckoutRequestID, ResultCode, ResultDesc },
      },
    } = req.body;

    if (ResultCode === 0) {
      // Extract vehicle ID from reference
      const vehicleId = CheckoutRequestID.split("-")[1];

      // Update vehicle assessment status
      await Product.findByIdAndUpdate(vehicleId, {
        assessmentPaid: true,
        assessmentPaidDate: new Date(),
      });
    }

    res.json({ message: "Callback processed successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/check-assessment-payment/:vehicleId", async (req, res) => {
  try {
    const vehicle = await Product.findOne({
      _id: req.params.vehicleId,
      // owner: req.user.payload._id,
    });

    if (!vehicle) {
      return res
        .status(404)
        .json({ message: "Vehicle not found or unauthorized" });
    }

    // Get latest assessment payment for this vehicle
    const payment = await Payment.findOne({
      vehicle: vehicle._id,
      paymentType: "assessment",
    }).sort({ createdAt: -1 });

    if (!payment) {
      return res.json({
        paid: false,
        message: "No payment found",
      });
    }

    // If payment is still pending, query MPESA
    if (payment.status === "pending") {
      const queryResponse = await mpesaService.querySTKStatus(
        payment.CheckoutRequestID
      );

      if (queryResponse.success) {
        payment.queryResponse = queryResponse.data;

        if (queryResponse.paid) {
          await payment.markAsCompleted();
          vehicle.assessmentPaid = true;
          vehicle.assessmentPaidDate = new Date();
          await vehicle.save();
        }

        await payment.save();
      }
    }

    res.json({
      paid: payment.status === "completed",
      status: payment.status,
      paidDate: vehicle.assessmentPaidDate,
      payment: {
        amount: payment.amount,
        paymentType: payment.paymentType,
        transactionDate: payment.transactionDate,
        processedAt: payment.processedAt,
      },
    });
  } catch (error) {
    console.error("Check assessment payment error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

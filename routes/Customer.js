const express = require("express");
const { authenticate } = require("../utils/Auth");
const { uploadMultipleFiles } = require("../utils/FileUpload");
const Vehicle = require("../models/Vehicle");
const Application = require("../models/Application");
const mpesaService = require("../utils/mpesa");
const Payment = require("../models/Payment");
const Product = require("../models/Product");

const router = express.Router();


// Customer middleware
const isCustomer = (req, res, next) => {
  if (req.user.payload.userType !== "customer") {
    return res.status(403).json({ message: "Access denied. Customer only." });
  }
  next();
};

// Apply both JWT auth and customer check to all routes
router.use(authenticate, isCustomer);

// Get available vehicles (paginated)
router.get("/available-vehicles", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const vehicles = await Product.find({ available: true })
      .skip(skip)
      .limit(limit)
      .populate("owner");

    const total = await Product.countDocuments({ available: true });

    res.json({
      vehicles,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalVehicles: total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get one vehicle
router.get("/vehicle/:id", async (req, res) => {
  try {
    const vehicle = await Product.findById(req.params.id).populate("owner");
    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }
    res.json(vehicle);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reserve car with M-PESA STK Push
router.post("/reserve-car/:vehicleId", async (req, res) => {
  try {
    const vehicle = await Product.findById(req.params.vehicleId);
    if (!vehicle || !vehicle.available) {
      return res.status(400).json({ message: "Vehicle not available" });
    }

    // Validate dates
    const startDate = new Date(req.body.startDate);
    const endDate = new Date(req.body.endDate);

    if (startDate < new Date() || endDate <= startDate) {
      return res.status(400).json({
        message:
          "Invalid dates. Start date must be in the future and end date must be after start date",
      });
    }

    // Calculate rental duration and fees
    const durationInDays = Math.ceil(
      (endDate - startDate) / (1000 * 60 * 60 * 24)
    );
    const totalFee = req.body.totalFee; //durationInDays * vehicle.dailyRate;
    const bookingFee = req.body.bookingFee; //(totalFee * vehicle.reservePercentage) / 100;

    // Create pending application
    const application = new Application({
      user: req.user.payload._id,
      vehicle: vehicle._id,
      phoneNumber: req.body.phoneNumber,
      bookingFee: bookingFee,
      totalFee: totalFee,
      startDate: startDate,
      endDate: endDate,
    });

    await application.save();

    // Create payment record
    const payment = new Payment({
      application: application._id,
      amount: 1, //bookingFee,
      paymentType: "booking",
      phoneNumber: req.body.phoneNumber,
      description: `Booking fee for ${vehicle.make} ${vehicle.model} (${vehicle.plateNo})`,
      reference: `BOOK-${application._id}`,
    });

    // Initiate STK Push
    const stkPushResponse = await mpesaService.initiateSTKPush({
      phone: req.body.phoneNumber,
      amount: bookingFee,
      reference: payment.reference,
      description: payment.description,
    });

    if (!stkPushResponse.success) {
      await Application.findByIdAndDelete(application._id);
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
      message: "Payment initiated",
      checkoutRequestID: stkPushResponse.data.CheckoutRequestID,
      applicationId: application._id,
      bookingDetails: {
        totalAmount: totalFee,
        bookingFee: bookingFee,
        remainingBalance: totalFee - bookingFee,
        durationInDays,
      },
    });
  } catch (error) {
    console.error("Reserve car error:", error);
    res.status(500).json({ message: error.message });
  }
});

// M-PESA callback URL
router.post("/mpesa-callback", async (req, res) => {
  try {
    const {
      Body: {
        stkCallback: { CheckoutRequestID, ResultCode, ResultDesc },
      },
    } = req.body;

    // Find payment by CheckoutRequestID
    const payment = await Payment.findByCheckoutRequestId(CheckoutRequestID);
    if (!payment) {
      console.error(
        "Payment not found for CheckoutRequestID:",
        CheckoutRequestID
      );
      return res.json({ message: "Payment not found" });
    }

    // Update payment with callback response
    payment.stkCallback = req.body;

    if (ResultCode === 0) {
      // Payment successful
      await payment.markAsCompleted();

      // Update application
      await Application.findByIdAndUpdate(payment.application, {
        dateReservationPaid: new Date(),
      });
    } else {
      // Payment failed
      await payment.markAsFailed();
    }

    res.json({ message: "Callback processed successfully" });
  } catch (error) {
    console.error("MPESA callback error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Check transaction status
router.get("/check-payment/:applicationId", async (req, res) => {
  try {
    const application = await Application.findById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    // Get latest payment for this application
    const payment = await Payment.findOne({
      application: application._id,
    }).sort({ createdAt: -1 });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // If payment is still pending, query MPESA
    if (payment.status === "pending") {
      const queryResponse = await mpesaService.querySTKStatus(
        payment.CheckoutRequestID
      );

      console.log(queryResponse);

      if (queryResponse.success) {
        payment.queryResponse = queryResponse.data;

        if (queryResponse.paid) {
          await payment.markAsCompleted();
          application.dateReservationPaid = new Date();
          await application.save();
        }

        await payment.save();
      }
    }

    res.json({
      paid: payment.status === "completed",
      status: payment.status,
      application,
      payment: {
        amount: payment.amount,
        paymentType: payment.paymentType,
        transactionDate: payment.transactionDate,
        processedAt: payment.processedAt,
      },
    });
  } catch (error) {
    console.error("Check payment error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Submit additional details with files
router.post(
  "/submit-details/:applicationId",
  uploadMultipleFiles(),
  async (req, res) => {
    try {
      const application = await Application.findById(req.params.applicationId);
      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }

      // Add uploaded files URLs
      application.additionalDocuments = req.body.fileURLs;
      await application.save();

      res.json(application);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Pay remaining balance
router.post("/pay-balance/:applicationId", async (req, res) => {
  try {
    const application = await Application.findById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    const remainingBalance = application.totalFee - application.bookingFee;

    // Initiate STK Push for balance
    const stkPushResponse = await mpesaService.initiateSTKPush({
      phone: req.user.payload.phoneNumber,
      amount: remainingBalance,
      reference: application._id,
    });

    res.json({
      message: "Balance payment initiated",
      checkoutRequestID: stkPushResponse.CheckoutRequestID,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Extend rental period
router.post("/extend/:applicationId", async (req, res) => {
  try {
    const application = await Application.findById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    // Validate extension period and calculate fee
    const { extensionDays, amount } = req.body;
    if (!extensionDays || extensionDays <= 0) {
      return res
        .status(400)
        .json({ message: "Valid extension period required" });
    }

    // Calculate extension fee based on daily rate
    const extensionFee = amount;

    // Create payment record for extension
    const payment = new Payment({
      application: application._id,
      amount: extensionFee,
      paymentType: "extension",
      phoneNumber: req.user.payload.phoneNumber,
      description: `Extension fee for ${extensionDays} days - ${application.vehicle.make} ${application.vehicle.model} (${application.vehicle.plateNo})`,
      reference: `EXT-${application._id}-${Date.now()}`,
    });

    // Initiate STK Push
    const stkPushResponse = await mpesaService.initiateSTKPush({
      phone: req.user.payload.phoneNumber,
      amount: extensionFee,
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
      message: "Extension payment initiated",
      checkoutRequestID: stkPushResponse.data.CheckoutRequestID,
      paymentId: payment._id,
      extensionDetails: {
        days: extensionDays,
        fee: extensionFee,
        newEndDate: new Date(
          application.endDate.getTime() + extensionDays * 24 * 60 * 60 * 1000
        ),
      },
    });
  } catch (error) {
    console.error("Extension error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get user's rentals
router.get("/my-rentals", async (req, res) => {
  try {
    const user = req.user.payload._id;
    const activeRentals = await Application.find({ user, status: "approved" });
    const rentalHistory = await Application.find({
      user,
      status: { $ne: "approved" },
    });

    res.json({
      activeRentals,
      rentalHistory,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's applications
router.get("/my-applications", async (req, res) => {
  try {
    const user = req.user.payload._id;
    const activeApplications = await Application.find({
      user,
      status: "approved",
    }).populate("vehicle");

    const applicationHistory = await Application.find({
      user,
      status: { $ne: "approved" },
    }).populate("vehicle");

    res.json({
      activeApplications,
      applicationHistory,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get specific application details
router.get("/application/:id", async (req, res) => {
  try {
    const application = await Application.findOne({
      _id: req.params.id,
      user: req.user.payload._id,
    }).populate("vehicle");

    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    // Get related payments
    const payments = await Payment.find({
      application: application._id,
    }).sort({ createdAt: -1 });

    // Get reservation payment details
    const reservationPayment = payments.find((p) => p.type === "reservation");
    const reservationDetails = reservationPayment
      ? {
          amount: reservationPayment.amount,
          datePaid: reservationPayment.createdAt,
          status: reservationPayment.status, // 'pending' or 'confirmed'
        }
      : null;

    // Get balance payment details
    const balancePayment = payments.find((p) => p.type === "balance");
    const balanceDetails = balancePayment
      ? {
          amount: balancePayment.amount,
          datePaid: balancePayment.createdAt,
          status: balancePayment.status,
        }
      : null;

    // Get extension payment details
    const extensionPayment = payments.find((p) => p.type === "extension");
    const extensionDetails = extensionPayment
      ? {
          amount: extensionPayment.amount,
          datePaid: extensionPayment.createdAt,
          status: extensionPayment.status,
        }
      : null;

    res.json({
      application,
      vehicle: application.vehicle,
      payments: {
        reservation: reservationDetails,
        balance: balanceDetails,
        extension: extensionDetails,
        all: payments, // Include all payments for reference
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get customer's unique locations
router.get("/my-locations", async (req, res) => {
  try {
    const userId = req.user.payload._id;

    // Get all applications for this user
    const applications = await Application.find({ user: userId })
      .select("deliveryLocation pickupLocation dateApplied")
      .sort({ dateApplied: -1 });

    // Create a map to store unique locations using address as key
    const locationMap = new Map();

    applications.forEach((app) => {
      // Process delivery location
      if (app.deliveryLocation) {
        const deliveryKey = `${app.deliveryLocation.address}-${app.deliveryLocation.coordinates.latitude}-${app.deliveryLocation.coordinates.longitude}`;

        if (!locationMap.has(deliveryKey)) {
          locationMap.set(deliveryKey, {
            ...app.deliveryLocation,
            lastUsed: app.dateApplied,
          });
        }
      }

      // Process pickup location
      if (app.pickupLocation) {
        const pickupKey = `${app.pickupLocation.address}-${app.pickupLocation.coordinates.latitude}-${app.pickupLocation.coordinates.longitude}`;

        if (!locationMap.has(pickupKey)) {
          locationMap.set(pickupKey, {
            ...app.pickupLocation,
            lastUsed: app.dateApplied,
          });
        }
      }
    });

    // Convert map to array and sort by lastUsed date
    const locations = Array.from(locationMap.values()).sort(
      (a, b) => new Date(b.lastUsed) - new Date(a.lastUsed)
    );

    res.json({
      success: true,
      count: locations.length,
      locations,
    });
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get all vehicles with pagination
router.get("/vehicles", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 10, 50); // Max 50 items per page

    const skip = (page - 1) * pageSize;

    // Get only approved and available vehicles
    const query = {
      status: "approved",
      available: true,
    };

    // Get total count for pagination
    const totalItems = await Product.countDocuments(query);
    const totalPages = Math.ceil(totalItems / pageSize);

    // Get vehicles for current page
    const vehicles = await Product.find(query)
      .sort({ dateAdded: -1 }) // Newest first
      .skip(skip)
      .limit(pageSize)
      .populate("owner", "name phoneNumber"); // Include owner details

    res.json({
      vehicles,
      pagination: {
        currentPage: page,
        pageSize,
        totalPages,
        totalItems,
      },
    });
  } catch (error) {
    console.error("Fetch vehicles error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Search vehicles with pagination
router.get("/vehicles/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 10, 50);

    const skip = (page - 1) * pageSize;

    // Create search query
    const searchQuery = {
      status: "approved",
      available: true,
      $or: [
        // Search by model (higher priority)
        { model: { $regex: q, $options: "i" } },
        // Search by make (lower priority)
        { make: { $regex: q, $options: "i" } },
      ],
    };

    // Get total count for pagination
    const totalItems = await Product.countDocuments(searchQuery);
    const totalPages = Math.ceil(totalItems / pageSize);

    // Get vehicles for current page
    const vehicles = await Product.find(searchQuery)
      .sort({
        // Sort by match priority
        $expr: {
          $cond: {
            if: { $regexMatch: { input: "$model", regex: q, options: "i" } },
            then: 1,
            else: 2,
          },
        },
        dateAdded: -1, // Then by date
      })
      .skip(skip)
      .limit(pageSize)
      .populate("owner", "name phoneNumber");

    res.json({
      vehicles,
      pagination: {
        currentPage: page,
        pageSize,
        totalPages,
        totalItems,
      },
    });
  } catch (error) {
    console.error("Search vehicles error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

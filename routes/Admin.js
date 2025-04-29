const express = require("express");
const { authenticate } = require("../utils/Auth");
const Vehicle = require("../models/Vehicle");
const Application = require("../models/Application");
const SendSMS = require("../utils/sendSMS");
const { uploadMultipleFiles } = require("../utils/FileUpload");
const Product = require("../models/Product");
const router = express.Router();


// Admin middleware
const isAdmin = (req, res, next) => {
  if (req.user.payload.userType !== "admin") {
    return res.status(403).json({ message: "Access denied. Admin only." });
  }
  next();
};

// Apply both JWT auth and admin check to all routes
router.use(authenticate, isAdmin);

// Get all applications
router.get("/get-applications", async (req, res) => {
  try {
    const applications = await Application.find()
      .populate("user")
      .populate("vehicle")
      .populate("deliveredBy");
    res.json(applications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get specific application
router.get("/get-application/:id", async (req, res) => {
  try {
    const application = await Application.findById(req.params.id)
      .populate("user")
      .populate("vehicle")
      .populate("deliveredBy");
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }
    res.json(application);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update vehicle information
router.put("/update-vehicle-info/:id", async (req, res) => {
  try {
    const updatedVehicle = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!updatedVehicle) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(updatedVehicle);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add new vehicle with images
router.post("/add-vehicle", uploadMultipleFiles(), async (req, res) => {
  try {
    const { price, title } = req.body;

    // Validate all rates and percentage are provided
    if (!price || !title) {
      return res.status(400).json({
        message:
          "The product title, price and reserve percentage are required",
      });
    }

    // Validate rates are positive numbers
    if (price <= 0) {
      return res.status(400).json({
        message: "All prices must be positive numbers",
      });
    }

    // Validate reserve percentage is between 0 and 100
    // if (reservePercentage < 0 || reservePercentage > 100) {
    //   return res.status(400).json({
    //     message: "Reserve percentage must be between 0 and 100",
    //   });
    // }

    const vehicleData = {
      ...req.body,
      owner: req.user.payload._id,
      picturesArray: req.body.fileURLs,
      available: true, // Initially false until assessed
    };

    const vehicle = new Product(vehicleData);
    await vehicle.save();

    res.status(201).json(vehicle);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Mark car as delivered
router.post("/deliver-car/:applicationId", async (req, res) => {
  try {
    const application = await Application.findById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    application.picturesOnDelivery = req.body.pictures;
    application.deliveredBy = req.user.payload._id;
    await application.save();

    // Update vehicle availability
    await Product.findByIdAndUpdate(application.vehicle, {
      available: false,
      deliveredBy: req.user.payload._id,
    });

    res.json(application);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get cars pending assessment
router.get("/cars-to-assess", async (req, res) => {
  try {
    const vehicles = await Product.find({ status: "pending" });
    res.json(vehicles);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Approve car
router.post("/approve-car/:applicationId", async (req, res) => {
  try {
    const application = await Application.findById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    application.dateApproved = new Date();
    await application.save();
    res.json(application);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reject car
router.post("/reject-car/:applicationId", async (req, res) => {
  try {
    const application = await Application.findById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    // Update vehicle availability
    await Product.findByIdAndUpdate(application.vehicle, {
      available: true,
    });

    await Application.findByIdAndDelete(req.params.applicationId);
    res.json({ message: "Application rejected and deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Accept vehicle assessment and set rates
router.post("/accept-assessment/:vehicleId", async (req, res) => {
  try {
    const vehicle = await Product.findById(req.params.vehicleId).populate(
      "owner"
    ); // Populate owner to get phone number

    if (!vehicle) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Validate rates
    const { price, reservePercentage } = req.body;

    if (!price || !reservePercentage) {
      return res
        .status(400)
        .json({ message: "All rates and reserve percentage are required" });
    }

    if (reservePercentage < 0 || reservePercentage > 100) {
      return res
        .status(400)
        .json({ message: "Reserve percentage must be between 0 and 100" });
    }

    // Update vehicle with rates and status
    vehicle.price = price;
    vehicle.reservePercentage = reservePercentage;
    vehicle.status = "approved";

    await vehicle.save();

    // Send SMS notification to owner
    // const message = `Congratulations! Your ${vehicle.title} has been approved. Rates set: Price: ${price} per ${unitOfMeasurement}`;
    // await SendSMS(message, vehicle.owner.phoneNumber);

    res.json({
      message: "Product assessment accepted and rates set successfully",
      vehicle,
    });
  } catch (error) {
    console.error("Accept assessment error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Reject vehicle assessment
router.post("/reject-assessment/:vehicleId", async (req, res) => {
  try {
    const vehicle = await Product.findById(req.params.vehicleId).populate(
      "owner"
    ); // Populate owner to get phone number

    if (!vehicle) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Validate rejection reason
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }

    // Update vehicle status
    vehicle.status = "rejected";
    await vehicle.save();

    // Send SMS notification to owner
    // const message = `Your ${vehicle.make} ${vehicle.model} (${vehicle.plateNo}) assessment was rejected. Reason: ${reason}. Please contact support for more information.`;
    // await SendSMS(message, vehicle.owner.phoneNumber);

    res.json({
      message: "Product assessment rejected successfully",
      vehicle,
      rejectionReason: reason,
    });
  } catch (error) {
    console.error("Reject assessment error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get all vehicles with pagination (Admin)
router.get("/vehicles", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100); // Max 100 items per page
    const status = req.query.status; // Optional status filter

    const skip = (page - 1) * pageSize;

    // Build query
    const query = {};
    if (status) {
      query.status = status;
    }

    // Get total count for pagination
    const totalItems = await Product.countDocuments(query);
    const totalPages = Math.ceil(totalItems / pageSize);

    // Get vehicles for current page
    const vehicles = await Product.find(query)
      .sort({ dateAdded: -1 }) // Newest first
      .skip(skip)
      .limit(pageSize)
      .populate("owner", "name phoneNumber email"); // Include more owner details for admin

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
    console.error("Admin fetch vehicles error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Search vehicles with pagination (Admin)
router.get("/vehicles/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const status = req.query.status; // Optional status filter

    const skip = (page - 1) * pageSize;

    // Build search query
    const searchQuery = {
      $or: [
        { model: { $regex: q, $options: "i" } },
        { make: { $regex: q, $options: "i" } },
        { plateNo: { $regex: q, $options: "i" } },
        { chassisNo: { $regex: q, $options: "i" } },
      ],
    };

    // Add status filter if provided
    if (status) {
      searchQuery.status = status;
    }

    // Get total count for pagination
    const totalItems = await Product.countDocuments(searchQuery);
    const totalPages = Math.ceil(totalItems / pageSize);

    // Get vehicles for current page with priority sorting
    const vehicles = await Product.find(searchQuery)
      .sort({
        $expr: {
          $switch: {
            branches: [
              // Highest priority: Exact plate number match
              { case: { $eq: ["$plateNo", q] }, then: 1 },
              // High priority: Exact chassis number match
              { case: { $eq: ["$chassisNo", q] }, then: 2 },
              // Medium priority: Model match
              {
                case: {
                  $regexMatch: { input: "$model", regex: q, options: "i" },
                },
                then: 3,
              },
              // Lower priority: Make match
              {
                case: {
                  $regexMatch: { input: "$make", regex: q, options: "i" },
                },
                then: 4,
              },
            ],
            default: 5,
          },
        },
        dateAdded: -1, // Secondary sort by date
      })
      .skip(skip)
      .limit(pageSize)
      .populate("owner", "name phoneNumber email");

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
    console.error("Admin search vehicles error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

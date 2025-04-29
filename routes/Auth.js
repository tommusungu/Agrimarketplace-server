const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { generateToken } = require("../utils/Auth");
// const SendSMS = require("../utils/sendSMS");
const router = express.Router();

router.post("/signup", async (req, res) => {
  try {
    // Check if user already exists
    const existingUser = await User.findOne({
      phoneNumber: req.body.phoneNumber,
    });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(req.body.password, salt);

    // Create new user
    const user = new User({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      otherNames: req.body.otherNames,
      phoneNumber: req.body.phoneNumber,
      password: hashedPassword,
      userType: req.body.userType,
      email: req.body.email,
    });

    const savedUser = await user.save();

    // Generate token
    const token = generateToken({
      _id: savedUser._id,
      userType: savedUser.userType,
      phoneNumber: savedUser.phoneNumber,
    });

    // Send welcome SMS
    // const smsMessage = `Welcome to Agri-Market! Download our application here: ${process.env.APP_DOWNLOAD_LINK}`;
    // await SendSMS(smsMessage, savedUser.phoneNumber);

    res.status(201).json({
      token,
      user: {
        _id: savedUser._id,
        firstName: savedUser.firstName,
        lastName: savedUser.lastName,
        userType: savedUser.userType,
        phoneNumber: savedUser.phoneNumber,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Login route
router.post("/login", async (req, res) => {
  try {
    // Find user
    const user = await User.findOne({ phoneNumber: req.body.phoneNumber });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // Verify password
    const validPassword = await bcrypt.compare(
      req.body.password,
      user.password
    );
    if (!validPassword) {
      return res.status(400).json({ message: "Invalid password" });
    }

    // Generate token
    const token = generateToken({
      _id: user._id,
      userType: user.userType,
      phoneNumber: user.phoneNumber,
    });

    res.json({
      token,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        phoneNumber: user.phoneNumber,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Forgot Password route
router.post("/forgot-password", async (req, res) => {
  try {
    const user = await User.findOne({ phoneNumber: req.body.phoneNumber });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // Generate temporary password
    const tempPassword = Math.random().toString(36).slice(-8);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    // Update user password
    user.password = hashedPassword;
    await user.save();

    // Send SMS with temporary password
    // const smsMessage = `Your temporary password is: ${tempPassword}. Please change it after logging in.`;
    // await SendSMS(smsMessage, user.phoneNumber);

    res.json({ message: "Temporary password has been sent to your phone" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

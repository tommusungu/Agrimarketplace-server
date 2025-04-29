const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ApplicationSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  vehicle: {
    type: Schema.Types.ObjectId,
    ref: "Vehicle",
    required: true,
  },
  phoneNumber: {
    type: String,
    required: true,
  },
  bookingFee: {
    type: Number,
    required: true,
  },
  deliveredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  totalFee: {
    type: Number,
    required: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  dateApplied: {
    type: Date,
    default: Date.now,
  },
  dateReservationPaid: {
    type: Date,
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  deliveryLocation: {
    address: String,
    county: String,
    city: String,
    coordinates: {
      latitude: Number,
      longitude: Number,
    },
    label: String,
  },
  pickupLocation: {
    address: String,
    county: String,
    city: String,
    coordinates: {
      latitude: Number,
      longitude: Number,
    },
    label: String,
  },
  additionalDocuments: [String],
});

module.exports = mongoose.model("Application", ApplicationSchema);

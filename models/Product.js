const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema({
  // make: {
  //   type: String,
  //   required: true,
  // },
  title: {
    type: String,
    required: true,
  }, 
  description: {
    type: String,
    required: true,
  },
 
  // model: {
  //   type: String,
  //   required: true,
  // },
  // plateNo: {
  //   type: String,
  //   required: true,
  //   unique: true,
  // },
  // YoM: {
  //   type: Number,
  //   required: true,
  // },
  // chassisNo: {
  //   type: String,
  //   required: true,
  //   unique: true,
  // },
  // ProductType: {
  //   type: String,
  //   required: true,
  //   enum: ["Sedan", "SUV", "Van", "Pickup", "Truck", "Bus", "Motorcycle"],
  // },
  location: {
    type: String,
    required: true,
  },
  productCategory: {
    type: String,
    required: true,
    enum: [
      "Vegetables",
      "Fruits",
      "Grains",
      "Dairy",
      "Livestock",
      "Seeds",
      "Fertilizers",
      "Equipment",
      "Poultry",
      "Fishery",
      "Herbs & Spices",
      "Flowers & Plants"
    ],
  },
  unitOfMeasurement: {
    type: String,
    required: true,
    enum: [
      "Kg",     
      "g",      
      "Ton",    
      "L",       
      "ml",     
      "Piece",  
      "Crate",  
      "Bale",    
      "Sack",    
      "Packet",  
      "Tray",    
      "Carton",  
      "Bundle",  
      "Bushel" 
    ],
  },
  // color: {
  //   type: String,
  //   required: true,
  // },
  // passengerCapacity: {
  //   type: Number,
  //   required: true,
  // },
  // carryingCapacity: {
  //   type: Number, // in KGs
  //   required: function () {
  //     return ["Pickup", "Truck", "Van"].includes(this.ProductType);
  //   },
  // },
  price: {
    type: Number,
    min: 0,
    default: 0,
  },
  // hourlyRate: {
  //   type: Number,
  //   min: 0,
  //   default: 0,
  // },
  // dailyRate: {
  //   type: Number,
  //   min: 0,
  //   default: 0,
  // },
  // monthlyRate: {
  //   type: Number,
  //   min: 0,
  //   default: 0,
  // },
  reservePercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 50,
  },
  picturesArray: [
    {
      type: String, // URLs to stored images
    },
  ],
  dateAdded: {
    type: Date,
    default: Date.now,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  available: {
    type: Boolean,
    default: true,
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
});

const Product = mongoose.model("Product", ProductSchema);
module.exports = Product;

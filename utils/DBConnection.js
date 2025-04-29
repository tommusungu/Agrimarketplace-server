const mongoose = require("mongoose");

const database = process.env.PRODUCTION === "true" ? "live" : "test";
const mongo_url = process.env.MONGO_BASE_URL;
// const mongo_uri = process.env.MONGO_URI;
const ConnectToDB = async () => {
  try {
    mongoose.connect(mongo_url);
    console.log("DB connected");
  } catch (err) {
    console.log(err, "Failed to connect to database");
  }
};

// rDpZMBelNoed7IR7
module.exports = ConnectToDB;

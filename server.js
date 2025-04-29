const express = require("express");
require("dotenv").config();
const app = express();
const mongoose = require('mongoose')
const cors = require("cors");
const path = require("path");
const CustomerRouter = require("./routes/Customer");
const PartnerRouter = require("./routes/Partner");
const AdminRouter = require("./routes/Admin");
const AuthRouter = require("./routes/Auth");
const swagger = require("./swagger");
// const db = require("./utils/DBConnection");

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Add Swagger UI route - Make sure this is before other routes
app.use("/api-docs", swagger.serve, swagger.setup);

app.use(cors());

app.use(express.json());

// db();

 mongoose
 .connect(process.env.MONGO_BASE_URL)
 .then(()=>{console.log('Success DB connection!')})
 .catch((error)=>{console.log('Error Connecting to DB!',error)})


app.use("/customer", CustomerRouter);
app.use("/partner", PartnerRouter);
app.use("/admin", AdminRouter);
app.use("/auth", AuthRouter);

// Serve home page
app.get("/home", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

// Serve add vehicle page
app.get("/add-vehicle", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "add-vehicle.html"));
});

const port = process.env.port || process.env.PORT || 3002;

app.use(cors());

app.listen(port, () => {
  console.log("Server started at port " + port);
  console.log(
    `Swagger documentation available at http://localhost:${port}/api-docs`
  );
});

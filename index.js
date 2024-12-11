require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const db = require("./var/dbConfig");
const profileRouter = require("./routes/profile");

// intialize app and define the server port
const app = express();
const port = process.env.PORT || 3000;

// Connect to MySQL
db.connect((err) => {
	if (err) {
		console.error("Database connection failed: ", err.stack);
		return;
	}
	console.log("Connected to MySQL database.");
});

app.use(
	cors({
		origin: "http://localhost:3000",
		credentials: true,
		// allowedHeaders: ["Content-Type", "Authorization"],
		// methods: ["GET", "POST", "OPTIONS"],
	})
);

// app.options("*", (req, res) => {
// 	res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
// 	res.setHeader("Access-Control-Allow-Credentials", "true");
// 	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
// 	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
// 	res.sendStatus(200); // Respond with 200 OK
// });

app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/", profileRouter);

// a function to start the server  and listen to the port defined
const start = async () => {
	try {
		app.listen(port, () => console.log(`server is running on port ${port}`));
	} catch (error) {
		console.log(error);
	}
};

// call the function
start();

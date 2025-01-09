const jwt = require("jsonwebtoken");

const authorization = (req, res, next) => {
	const token =
		req.cookies.jwtToken || req.headers.authorization?.split(" ")[1];
	if (!token) {
		return res.status(401).send("Unauthorized: No token provided!");
	}
	try {
		let payload = jwt.verify(token, process.env.JWT_SECRET);
		req.user = payload;
		return next();
	} catch (err) {
		if (err.name === "TokenExpiredError") {
			return res.status(401).send("Session expired. Please log in again.");
		}
		return res.status(401).send("Invalid token");
	}
};

// Role-specific middleware for Project Managers
const authorizePM = (req, res, next) => {
	authorization(req, res, () => {
		if (req.user.role !== 3) {
			//project_manager
			return res.status(403).json({
				message: "Access denied: Project Manager role required",
			});
		}
		next();
	});
};

// Role-specific middleware for Admins
const authorizeAdmin = (req, res, next) => {
	authorization(req, res, () => {
		if (req.user.role !== 1) {
			//admin
			return res.status(403).json({
				message: "Access denied: Admin role required",
			});
		}
		next();
	});
};

// Export all middleware functions
module.exports = {
	authorization,
	authorizePM,
	authorizeAdmin,
};

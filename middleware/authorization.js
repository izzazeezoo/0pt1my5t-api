const jwt = require("jsonwebtoken");

const authorization = (req, res, next) => {
	const token =
		req.cookies.jwtToken || req.headers.authorization?.split(" ")[1];
	console.log("current token : ", token);
	if (!token) {
		return res.status(401).send("Unauthorized: No token provided!");
	}
	try {
		let payload = jwt.verify(token, process.env.JWT_SECRET);
		console.log("payload : ", payload);
		return next();
	} catch (err) {
    if (err.name === 'TokenExpiredError') {
        return res.status(401).send("Session expired. Please log in again.");
    }
    return res.status(401).send("Invalid token");
}
};

module.exports = authorization;

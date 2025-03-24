const db = require("../var/dbConfig");

const verifyUserGID = (req, res, next) => {
    const gidUser = req.headers["x-google-id"];

    // Check for missing parameter
    if (!gidUser) {
        return res.status(400).send({ message: "Parameter missing (GID)." });
    }

    // Fetch user data from the database
    db.query(
        `SELECT id, role_id, display_name FROM users WHERE google_id = ?`,
        [gidUser],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: true, message: "Database error" });
            }

            if (results.length === 0) {
                return res.status(404).json({ error: true, message: "User not found" });
            }

            // Attach user data to the request object
            req.user = results[0];
            next();
        }
    );
};

const verifyCoPMRole = (userId) => {
    return new Promise((resolve, reject) => {
        db.query(
            `SELECT role_id FROM users WHERE id = ?`,
            [userId],
            (err, results) => {
                if (err) {
                    console.error(err);
                    return reject(new Error("Database error while verifying role"));
                }

                if (results.length === 0 || results[0].role_id !== 3) {
                    return resolve(false); // User is not authorized
                }

                resolve(true); // User is authorized
            }
        );
    });
};

module.exports = {
    verifyUserGID,
    verifyCoPMRole
};
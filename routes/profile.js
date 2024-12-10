const db = require('../var/dbConfig');
const express = require('express');
const router = express.Router();
const authorization  = require('../middleware/authorization');

router.get("/", (req, res) => {
    console.log("OK")
    res.send("Response Success!")
});

// ------------------------------------- DASHBOARD
//GET Profile Data
router.get("/profile", authorization, (req, res) => {
    let gidUser = req.cookies.google_id;
    console.log("Google ID dari Cookies:", gidUser);

    //Check invalid parameter or parameter missing
    if (!gidUser) {
        return res.status(400).send({ message: "Parameter missing." });
    }

    db.query(`SELECT id FROM users WHERE google_id = ?`, [gidUser], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: true, message: "Database error" });
        }
    
        if (results.length === 0) {
            return res.status(404).json({ error: true, message: "User not found" });
        }
    
        const idUser = results[0].id; // Extract the idUser from the query result
    
        db.query(`SELECT A.np, A.department, A.role, A.experience_level, B.display_name
            FROM profiles AS A
            JOIN users AS B ON A.user_id = B.id
            WHERE B.id_user = (${db.escape(idUser)});`, (err, result) => {
                if(err) {
                    return res.status(500).send({message: err.sqlMessage});
                }
                if (!result.length) {
                    return res.status(400).send({ message: "No such data exist" });
                } else {
                    return res.status(200).send({error: false, message: 'Retrieve data success', dashboardResult: result[0]});
                }
            })
    });
    
});

//Post profile form
router.post("/form", authorization, (req, res) => {
    let gidUser = req.cookies.google_id;
    console.log("Google ID dari Cookies:", gidUser);

    //Check invalid parameter or parameter missing
    if (!gidUser) {
        return res.status(400).send({ message: "Parameter missing (GID)." });
    }
    
    console.log(req.body);
    
    const { employeeNumber, department, expLevel, role} = req.body;

    //Check parameter missing
    if (!gidUser || !employeeNumber || !department || !expLevel || !role ) {
        return res.status(400).send({ message: "Parameter missing." });
    }

    db.query(`SELECT id FROM users WHERE google_id = ?`, [gidUser], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: true, message: "Database error" });
        }
    
        if (results.length === 0) {
            return res.status(404).json({ error: true, message: "User not found" });
        }
    
        const idUser = results[0].id; // Extract the idUser from the query result
    
        db.query(
            `INSERT INTO profiles (user_id, department, role, experience_level, np) VALUES (?, ?, ?, ?, ?)`,
            [idUser, department, role, expLevel, employeeNumber],
            (err) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: true, message: "Failed to insert profile data" });
                }
    
                return res.status(201).json({
                    error: false,
                    message: "Profile data successfully created",
                });
            });
    });
});

module.exports = router;
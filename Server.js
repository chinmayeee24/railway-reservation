// server.js
const express = require("express");
const mysql = require("mysql");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "Chin@2004",        // <-- set your MySQL root password here
  database: "railway_db" // <-- your DB name from Workbench (railway_db)
});

db.connect(err => {
  if (err) return console.error("MySQL connection error:", err);
  console.log("Connected to MySQL");
});

// GET trains
app.get("/trains", (req, res) => {
  const sql = "SELECT * FROM trains";
  db.query(sql, (err, result) => {
    if (err) return res.json({ success: false, error: err });
    return res.json(result);
  });
});

// LOGIN or AUTO-CREATE USER
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  // Check if user exists
  const checkUser = "SELECT * FROM users WHERE email = ?";
  db.query(checkUser, [email], (err, result) => {
    if (err) return res.json({ success: false, error: err });

    if (result.length > 0) {
      // User found → check password
      if (result[0].password === password) {
        return res.json({ success: true, user: result[0] });
      } else {
        return res.json({ success: false, message: "Wrong password!" });
      }
    } 
    
    // User NOT found → create user automatically
    const insert = "INSERT INTO users (email, password) VALUES (?, ?)";
    db.query(insert, [email, password], (err2, insertResult) => {
      if (err2) return res.json({ success: false, error: err2 });

      // Return newly created user
      return res.json({
        success: true,
        user: { id: insertResult.insertId, email, password }
      });
    });
  });
});

// BOOK: create booking and decrement available seats (basic)
app.post("/book", (req, res) => {
  const { user_id, train_id, passenger_name, seats } = req.body;
  if (!user_id) return res.json({ success: false, error: "Not logged in" });

  // Check availability first
  db.query("SELECT available_seats FROM trains WHERE train_id = ?", [train_id], (err, rows) => {
    if (err) return res.json({ success: false, error: err });
    if (!rows.length) return res.json({ success: false, error: "Train not found" });
    const avail = rows[0].available_seats;
    if (avail < seats) return res.json({ success: false, error: "Not enough seats" });

    // Insert booking
    const insert = "INSERT INTO bookings (user_id, train_id, passenger_name, seats) VALUES (?, ?, ?, ?)";
    db.query(insert, [user_id, train_id, passenger_name, seats], (err2, result) => {
      if (err2) return res.json({ success: false, error: err2 });

      // Reduce seats
      const upd = "UPDATE trains SET available_seats = available_seats - ? WHERE train_id = ?";
      db.query(upd, [seats, train_id], (err3) => {
        if (err3) {
          // Ideally rollback insertion — simple approach: return error
          return res.json({ success: false, error: err3 });
        }
        return res.json({ success: true, booking_id: result.insertId });
      });
    });
  });
});

// GET bookings by user (joins trains for train_name)
app.get("/bookings/:userId", (req, res) => {
  const userId = req.params.userId;
  const sql = `SELECT b.id, b.train_id, t.train_name, b.passenger_name, b.seats
               FROM bookings b LEFT JOIN trains t ON b.train_id = t.train_id
               WHERE b.user_id = ?`;
  db.query(sql, [userId], (err, result) => {
    if (err) return res.json({ success: false, error: err });
    return res.json({ success: true, bookings: result });
  });
});

// UPDATE booking (adjust seats on trains table accordingly)
app.put("/update-booking", (req, res) => {
  const { booking_id, newSeats } = req.body;
  if (!booking_id) return res.json({ success: false, error: "booking_id required" });

  // Get existing booking
  db.query("SELECT * FROM bookings WHERE id = ?", [booking_id], (err, rows) => {
    if (err) return res.json({ success: false, error: err });
    if (!rows.length) return res.json({ success: false, error: "Booking not found" });

    const booking = rows[0];
    const train_id = booking.train_id;
    const oldSeats = booking.seats;
    const diff = newSeats - oldSeats; // positive means need extra seats, negative means refund

    if (diff === 0) return res.json({ success: true, message: "No change" });

    // If need more seats, check availability
    if (diff > 0) {
      db.query("SELECT available_seats FROM trains WHERE train_id = ?", [train_id], (err2, rows2) => {
        if (err2) return res.json({ success: false, error: err2 });
        const avail = rows2[0].available_seats;
        if (avail < diff) return res.json({ success: false, error: "Not enough seats to increase" });

        // Update booking and reduce train seats
        db.query("UPDATE bookings SET seats = ? WHERE id = ?", [newSeats, booking_id], (err3) => {
          if (err3) return res.json({ success: false, error: err3 });
          db.query("UPDATE trains SET available_seats = available_seats - ? WHERE train_id = ?", [diff, train_id], (err4) => {
            if (err4) return res.json({ success: false, error: err4 });
            return res.json({ success: true });
          });
        });
      });
    } else {
      // diff < 0 => refund seats
      const refund = Math.abs(diff);
      db.query("UPDATE bookings SET seats = ? WHERE id = ?", [newSeats, booking_id], (err5) => {
        if (err5) return res.json({ success: false, error: err5 });
        db.query("UPDATE trains SET available_seats = available_seats + ? WHERE train_id = ?", [refund, train_id], (err6) => {
          if (err6) return res.json({ success: false, error: err6 });
          return res.json({ success: true });
        });
      });
    }
  });
});

// CANCEL booking (refund seats)
app.delete("/cancel-booking", (req, res) => {
  const { booking_id } = req.body;
  if (!booking_id) return res.json({ success: false, error: "booking_id required" });

  db.query("SELECT * FROM bookings WHERE id = ?", [booking_id], (err, rows) => {
    if (err) return res.json({ success: false, error: err });
    if (!rows.length) return res.json({ success: false, error: "Booking not found" });

    const booking = rows[0];
    const train_id = booking.train_id;
    const seats = booking.seats;

    // Delete booking
    db.query("DELETE FROM bookings WHERE id = ?", [booking_id], (err2) => {
      if (err2) return res.json({ success: false, error: err2 });
      // Refund seats
      db.query("UPDATE trains SET available_seats = available_seats + ? WHERE train_id = ?", [seats, train_id], (err3) => {
        if (err3) return res.json({ success: false, error: err3 });
        return res.json({ success: true });
      });
    });
  });
});

const PORT = 5000;
app.listen(PORT, () => console.log("Server running on port", PORT));

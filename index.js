const express = require('express')
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const stripe = require("stripe")(process.env.STRIPE_SECRIT_KEY);

const app = express()
const port = process.env.PORT || 5000

// middleware
app.use(cors())
app.use(express.json())




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.2elctou.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// jwt middleware
function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access')
    }
    const token = authHeader.split(' ')[1]

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(401).send({ message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    try {
        const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOptions')
        const bookingsCollection = client.db('doctorsPortal').collection('bookings')
        const usersCollection = client.db('doctorsPortal').collection('users')
        const doctorsCollection = client.db('doctorsPortal').collection('doctors')
        const paymentsCollection = client.db('doctorsPortal').collection('payments')

        // Note: verifyAdmin after verify JWT
        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail }
            const user = await usersCollection.findOne(query)

            if (user?.role !== 'admin') {
                return res.send.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            console.log(date)
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray();

            // get the booking of the provide date
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

            // code valo vabe bujhe korte hobe
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name)
                const bookedSlots = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots;
            })
            res.send(options)
        })

        // add a doctor specality api
        app.get('/appointmentSpeciality', async (req, res) => {
            const query = {};
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray();
            res.send(result)
        })

        // show doctor information in website
        app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const query = {};
            const doctor = await doctorsCollection.find(query).toArray()
            res.send(doctor)
        })

        // add a doctor
        app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result)
        })

        // delete doctor
        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await doctorsCollection.deleteOne(query);
            res.send(result)
        })

        /*
            API Naming Convention
            app.get('/bookings')
            app.get('/bookings/:id')
            app.post('/bookings')
            app.patch('/bookings:/id')
            app.delete('/bookings:/id')
        */

        // query user email
        app.get('/bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;

            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'Forbidden Access' })
            }

            const query = { email: email };
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings)
        })

        // bookings id for payment
        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingsCollection.findOne(query);
            res.send(booking)
        })

        // booking schedule
        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatment: booking.treatment
            }

            const alreadyBooked = await bookingsCollection.find(query).toArray()

            if (alreadyBooked.length) {
                const message = `Your are already Booking on ${booking.appointmentDate}`
                return res.send({ acknowledged: false, message })
            }

            const result = await bookingsCollection.insertOne(booking);
            res.send(result)
        })

        // Payment Method
        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        // customer payment store in the database
        app.post('/payments', async(req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);

            const id = payment.bookingId;
            const filter = {_id: ObjectId(id)}
            const updatedDoc= {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
            res.send(result)
        })

        // JWT TOKEN
        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);

            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1d' })
                return res.send({ accessToken: token });
            }
            res.status(403).send({ accessToken: '' })
        })

        // user display in website
        app.get('/users', async (req, res) => {
            const query = {}
            const user = await usersCollection.find(query).toArray()
            res.send(user)
        })

        // check user admin
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })

        // user create and user save database
        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })

        // user update make a admin
        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            console.log(id)
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options);
            res.send(result)
        })


        // temporary update price on appointment options
        // app.get('/addprice', async(req, res) => {
        //     const filter = {};
        //     const options = { upsert: true };
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, options);
        //     res.send(result)
        // })

    }
    finally {

    }
}
run().catch(console.log)

app.get('/', (req, res) => {
    res.send('Doctors portal server running')
})

app.listen(port, () => {
    console.log(`Doctors portal server running on port ${port}`)
})